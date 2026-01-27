-- Migration 20260107000100_fix_reservation_flow_v2.sql

-- 1. Reserve Credits: Now explicitly creates a 'reservation' transaction
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

  -- Idempotency check: if reservation exists, return it
  IF EXISTS (
    SELECT 1
    FROM public.credit_reservations
    WHERE request_id = p_request_id AND user_id = p_user_id
  ) THEN
    v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
    v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);
    
    -- Ensure transaction exists even for idempotent return
    IF NOT EXISTS (SELECT 1 FROM public.credit_transactions WHERE request_id = p_request_id) THEN
       INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
       VALUES (p_user_id, p_amount, 'reservation', 'Credit reservation', p_metadata || jsonb_build_object('feature', p_feature), p_request_id);
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'remaining_monthly', v_remaining_monthly,
      'remaining_bonus', v_remaining_bonus,
      'reserved_monthly', (SELECT monthly_credits_used FROM public.credit_reservations WHERE request_id = p_request_id),
      'reserved_bonus', (SELECT bonus_credits_used FROM public.credit_reservations WHERE request_id = p_request_id)
    );
  END IF;

  -- Calculate remaining credits
  v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
  v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);

  -- Check sufficiency
  IF (v_remaining_monthly + v_remaining_bonus) < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_credits', 'remaining_monthly', v_remaining_monthly, 'remaining_bonus', v_remaining_bonus);
  END IF;

  -- Split reservation
  IF v_remaining_monthly >= p_amount THEN
    v_use_monthly := p_amount;
    v_use_bonus := 0;
  ELSE
    v_use_monthly := v_remaining_monthly;
    v_use_bonus := p_amount - v_remaining_monthly;
  END IF;

  -- Update user credits (Balance Drop)
  UPDATE public.user_credits
  SET 
    reserved_monthly = COALESCE(reserved_monthly, 0) + v_use_monthly,
    reserved_bonus = COALESCE(reserved_bonus, 0) + v_use_bonus,
    updated_at = now()
  WHERE user_id = p_user_id;

  -- Create reservation record
  INSERT INTO public.credit_reservations (
    user_id,
    request_id,
    amount,
    monthly_credits_used,
    bonus_credits_used,
    feature,
    metadata,
    status,
    created_at
  ) VALUES (
    p_user_id,
    p_request_id,
    p_amount,
    v_use_monthly,
    v_use_bonus,
    p_feature,
    p_metadata,
    'reserved',
    now()
  );

  -- Create Transaction Record (Pending)
  INSERT INTO public.credit_transactions (
    user_id,
    amount,
    transaction_type,
    description,
    metadata,
    request_id
  ) VALUES (
    p_user_id,
    p_amount,
    'reservation',
    'Credit reservation',
    p_metadata || jsonb_build_object('feature', p_feature),
    p_request_id
  );

  -- Calculate new remaining
  v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - (COALESCE(v_row.reserved_monthly, 0) + v_use_monthly), 0);
  v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - (COALESCE(v_row.reserved_bonus, 0) + v_use_bonus), 0);

  -- Update profile cache
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


-- 2. Commit Reserved Credits: Updates 'reservation' to 'usage'
CREATE OR REPLACE FUNCTION public.commit_reserved_credits(
  p_user_id UUID,
  p_request_id UUID,
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

  IF v_res.status = 'committed' THEN
    SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
    v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
    v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);
    UPDATE public.profiles
    SET credits_balance = (v_remaining_monthly + v_remaining_bonus)
    WHERE user_id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'remaining_monthly', v_remaining_monthly, 'remaining_bonus', v_remaining_bonus);
  END IF;

  IF v_res.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_reservation_state', 'status', v_res.status);
  END IF;

  -- Apply usage
  UPDATE public.user_credits
  SET
    monthly_credits_used = monthly_credits_used + v_res.monthly_credits_used,
    bonus_credits_used = bonus_credits_used + v_res.bonus_credits_used,
    reserved_monthly = GREATEST(COALESCE(reserved_monthly, 0) - v_res.monthly_credits_used, 0),
    reserved_bonus = GREATEST(COALESCE(reserved_bonus, 0) - v_res.bonus_credits_used, 0),
    updated_at = now()
  WHERE user_id = p_user_id;

  -- Update reservation status
  UPDATE public.credit_reservations
  SET status = 'committed',
      metadata = metadata || p_metadata,
      updated_at = now()
  WHERE request_id = p_request_id AND user_id = p_user_id;

  -- Update transaction: Reservation -> Usage
  UPDATE public.credit_transactions
  SET
    transaction_type = 'usage',
    description = 'Image generation',
    metadata = metadata || p_metadata,
    updated_at = now()
  WHERE user_id = p_user_id AND request_id = p_request_id AND transaction_type = 'reservation';

  -- Fallback if no reservation tx found
  IF NOT FOUND THEN
    INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
    VALUES (
      p_user_id,
      v_res.amount,
      'usage',
      'Image generation',
      v_res.metadata || p_metadata,
      p_request_id
    );
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
  v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);

  UPDATE public.profiles
  SET credits_balance = (v_remaining_monthly + v_remaining_bonus)
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'remaining_monthly', v_remaining_monthly,
    'remaining_bonus', v_remaining_bonus
  );
END;
$$;


-- 3. Release Reserved Credits: Updates 'reservation' to 'release' (Balance Restores)
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
  v_monthly_after INTEGER;
  v_bonus_after INTEGER;
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
    v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
    v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);
    RETURN jsonb_build_object('ok', true, 'already_released', true, 'remaining_monthly', v_monthly_after, 'remaining_bonus', v_bonus_after);
  END IF;

  IF v_res.status = 'committed' THEN
    RETURN public.refund_consumed_credits(p_user_id, p_request_id, p_reason, p_metadata);
  END IF;

  IF v_res.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_reservation_state', 'status', v_res.status);
  END IF;

  -- Restore reserved credits (Balance Restores)
  UPDATE public.user_credits
  SET
    reserved_monthly = GREATEST(COALESCE(reserved_monthly, 0) - v_res.monthly_credits_used, 0),
    reserved_bonus = GREATEST(COALESCE(reserved_bonus, 0) - v_res.bonus_credits_used, 0),
    updated_at = now()
  WHERE user_id = p_user_id;

  -- Update reservation status
  UPDATE public.credit_reservations
  SET status = 'released',
      metadata = (metadata || p_metadata) || jsonb_build_object('release_reason', p_reason),
      updated_at = now()
  WHERE request_id = p_request_id AND user_id = p_user_id;

  -- Update transaction: Reservation -> Release
  UPDATE public.credit_transactions
  SET
    transaction_type = 'release',
    amount = 0,
    description = COALESCE(p_reason, 'Credit reservation released'),
    metadata = COALESCE(metadata, '{}'::jsonb) || p_metadata || jsonb_build_object('feature', v_res.feature, 'release_reason', p_reason, 'failure_reason', p_reason)
  WHERE user_id = p_user_id AND request_id = p_request_id AND transaction_type = 'reservation';

  -- Fallback
  IF NOT FOUND THEN
    INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
    VALUES (
      p_user_id,
      0,
      'release',
      COALESCE(p_reason, 'Credit reservation released'),
      (v_res.metadata || p_metadata || jsonb_build_object('feature', v_res.feature, 'release_reason', p_reason, 'failure_reason', p_reason)),
      p_request_id
    );
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);

  UPDATE public.profiles
  SET credits_balance = (v_monthly_after + v_bonus_after)
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'remaining_monthly', v_monthly_after,
    'remaining_bonus', v_bonus_after
  );
END;
$$;

-- 4. Refund Consumed Credits: Updates 'usage' to 'refund' (Balance Restores)
CREATE OR REPLACE FUNCTION public.refund_consumed_credits(
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
  v_monthly_refund INTEGER := 0;
  v_bonus_refund INTEGER := 0;
  v_monthly_after INTEGER;
  v_bonus_after INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;
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
    RETURN jsonb_build_object('ok', true, 'already_refunded', true);
  END IF;

  IF v_res.status = 'reserved' THEN
    RETURN public.release_reserved_credits(p_user_id, p_request_id, p_reason, p_metadata);
  END IF;

  IF v_res.status <> 'committed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_reservation_state', 'status', v_res.status);
  END IF;

  -- Restore used credits
  UPDATE public.user_credits
  SET
    monthly_credits_used = GREATEST(monthly_credits_used - v_res.monthly_credits_used, 0),
    bonus_credits_used = GREATEST(bonus_credits_used - v_res.bonus_credits_used, 0),
    updated_at = now()
  WHERE user_id = p_user_id;

  -- Update reservation status
  UPDATE public.credit_reservations
  SET status = 'released',
      metadata = (metadata || p_metadata) || jsonb_build_object('refund_reason', p_reason),
      updated_at = now()
  WHERE request_id = p_request_id AND user_id = p_user_id;

  -- Update transaction: Usage -> Refund
  UPDATE public.credit_transactions
  SET 
    transaction_type = 'refund',
    amount = 0,
    description = COALESCE(p_reason, 'Credit usage refunded'),
    metadata = metadata || p_metadata || jsonb_build_object('refund_reason', p_reason, 'failure_reason', p_reason, 'original_cost', (v_res.monthly_credits_used + v_res.bonus_credits_used)),
    updated_at = now()
  WHERE request_id = p_request_id AND transaction_type = 'usage';

  -- Fallback
  IF NOT FOUND THEN
    INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
    VALUES (
      p_user_id,
      0,
      'refund',
      COALESCE(p_reason, 'Credit usage refunded'),
      (v_res.metadata || p_metadata || jsonb_build_object('feature', v_res.feature, 'refund_reason', p_reason, 'failure_reason', p_reason)),
      p_request_id
    );
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);

  UPDATE public.profiles
  SET credits_balance = (v_monthly_after + v_bonus_after)
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'refunded_monthly', v_res.monthly_credits_used,
    'refunded_bonus', v_res.bonus_credits_used,
    'remaining_monthly', v_monthly_after,
    'remaining_bonus', v_bonus_after
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID, UUID, INTEGER, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID, UUID, INTEGER, TEXT, JSONB) TO authenticated;

GRANT EXECUTE ON FUNCTION public.commit_reserved_credits(UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_reserved_credits(UUID, UUID, JSONB) TO authenticated;

GRANT EXECUTE ON FUNCTION public.release_reserved_credits(UUID, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_reserved_credits(UUID, UUID, TEXT, JSONB) TO authenticated;

GRANT EXECUTE ON FUNCTION public.refund_consumed_credits(UUID, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_consumed_credits(UUID, UUID, TEXT, JSONB) TO authenticated;
