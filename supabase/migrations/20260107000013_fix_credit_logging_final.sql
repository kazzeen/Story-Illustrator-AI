-- Comprehensive fix for Credit Logging
-- 1. Ensures reserve_credits always logs a 'reservation' transaction
-- 2. Ensures release_reserved_credits always updates or inserts a 'release' transaction
-- 3. Handles NULL metadata safely
-- 4. Ensures permissions are correct

-- Fix reserve_credits to log transaction
CREATE OR REPLACE FUNCTION public.reserve_credits(
  p_user_id UUID,
  p_request_id UUID,
  p_amount INTEGER,
  p_feature TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.user_credits%ROWTYPE;
  v_remaining_monthly INTEGER;
  v_remaining_bonus INTEGER;
  v_use_monthly INTEGER;
  v_use_bonus INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;

  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_request_id');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;

  SELECT * INTO v_row
  FROM public.user_credits
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_credit_account');
  END IF;

  -- Idempotency check
  IF EXISTS (
    SELECT 1
    FROM public.credit_reservations
    WHERE request_id = p_request_id AND user_id = p_user_id
  ) THEN
    v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
    v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);
    
    -- Ensure transaction exists even if idempotent
    IF NOT EXISTS (
      SELECT 1
      FROM public.credit_transactions
      WHERE user_id = p_user_id AND request_id = p_request_id AND transaction_type = 'reservation'
    ) THEN
      INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
      VALUES (
        p_user_id,
        -p_amount,
        'reservation',
        'Image generation (Reserved)',
        (COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('feature', p_feature)),
        p_request_id
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'remaining_monthly', v_remaining_monthly,
      'remaining_bonus', v_remaining_bonus
    );
  END IF;

  v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
  v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);

  IF (v_remaining_monthly + v_remaining_bonus) < p_amount THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'insufficient_credits',
      'remaining_monthly', v_remaining_monthly,
      'remaining_bonus', v_remaining_bonus
    );
  END IF;

  IF v_remaining_monthly >= p_amount THEN
    v_use_monthly := p_amount;
    v_use_bonus := 0;
  ELSE
    v_use_monthly := v_remaining_monthly;
    v_use_bonus := p_amount - v_remaining_monthly;
  END IF;

  UPDATE public.user_credits
  SET 
    reserved_monthly = COALESCE(reserved_monthly, 0) + v_use_monthly,
    reserved_bonus = COALESCE(reserved_bonus, 0) + v_use_bonus,
    updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.credit_reservations (
    user_id,
    request_id,
    amount,
    monthly_credits_used,
    bonus_credits_used,
    feature,
    metadata,
    status,
    created_at,
    updated_at
  ) VALUES (
    p_user_id,
    p_request_id,
    p_amount,
    v_use_monthly,
    v_use_bonus,
    p_feature,
    COALESCE(p_metadata, '{}'::jsonb),
    'reserved',
    now(),
    now()
  );

  -- Log the reservation transaction
  INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
  VALUES (
    p_user_id,
    -p_amount,
    'reservation',
    'Image generation (Reserved)',
    (COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('feature', p_feature, 'reserved_monthly', v_use_monthly, 'reserved_bonus', v_use_bonus)),
    p_request_id
  );

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
  v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);

  UPDATE public.profiles
  SET credits_balance = (v_remaining_monthly + v_remaining_bonus)
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'remaining_monthly', v_remaining_monthly,
    'remaining_bonus', v_remaining_bonus,
    'reserved_monthly', v_use_monthly,
    'reserved_bonus', v_use_bonus
  );
END;
$$;

-- Fix release_reserved_credits to safely handle logging
CREATE OR REPLACE FUNCTION public.release_reserved_credits(
  p_user_id UUID,
  p_request_id UUID,
  p_reason TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.user_credits%ROWTYPE;
  v_res public.credit_reservations%ROWTYPE;
  v_remaining_monthly INTEGER;
  v_remaining_bonus INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;
  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_request_id');
  END IF;

  PERFORM public.ensure_user_credits(p_user_id);

  SELECT * INTO v_res
  FROM public.credit_reservations
  WHERE request_id = p_request_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_reservation');
  END IF;

  IF v_res.status = 'released' THEN
    SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
    v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
    v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);
    UPDATE public.profiles
    SET credits_balance = (v_remaining_monthly + v_remaining_bonus)
    WHERE user_id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'already_released', true, 'remaining_monthly', v_remaining_monthly, 'remaining_bonus', v_remaining_bonus);
  END IF;

  IF v_res.status = 'committed' THEN
    RETURN public.refund_consumed_credits(p_user_id, p_request_id, p_reason, p_metadata);
  END IF;

  IF v_res.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_reservation_state', 'status', v_res.status);
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_credit_account');
  END IF;

  UPDATE public.user_credits
  SET
    reserved_monthly = GREATEST(COALESCE(reserved_monthly, 0) - v_res.monthly_credits_used, 0),
    reserved_bonus = GREATEST(COALESCE(reserved_bonus, 0) - v_res.bonus_credits_used, 0),
    updated_at = now()
  WHERE user_id = p_user_id;

  UPDATE public.credit_reservations
  SET status = 'released',
      metadata = (COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb)) || jsonb_build_object('release_reason', p_reason),
      updated_at = now()
  WHERE request_id = p_request_id AND user_id = p_user_id;

  -- Update transaction log: Transform "Reservation" -> "Release"
  -- Or insert if missing
  UPDATE public.credit_transactions
  SET
    transaction_type = 'release',
    amount = 0,
    description = COALESCE(p_reason, 'Credit reservation released'),
    metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('feature', v_res.feature, 'release_reason', p_reason)
  WHERE user_id = p_user_id AND request_id = p_request_id AND transaction_type = 'reservation';

  IF NOT FOUND THEN
    INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
    VALUES (
      p_user_id,
      0,
      'release',
      COALESCE(p_reason, 'Credit reservation released'),
      (COALESCE(v_res.metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('feature', v_res.feature, 'release_reason', p_reason)),
      p_request_id
    );
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
  v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);

  UPDATE public.profiles
  SET credits_balance = (v_remaining_monthly + v_remaining_bonus)
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'remaining_monthly', v_remaining_monthly, 'remaining_bonus', v_remaining_bonus);
END;
$$;

-- Grant permissions again to be sure
GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID, UUID, INTEGER, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID, UUID, INTEGER, TEXT, JSONB) TO service_role;

GRANT EXECUTE ON FUNCTION public.release_reserved_credits(UUID, UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_reserved_credits(UUID, UUID, TEXT, JSONB) TO service_role;
