-- Fix column name mismatches in credit refund functions.
-- credit_reservations columns: monthly_amount, bonus_amount (NOT monthly_credits_used, bonus_credits_used)
-- credit_reservations has no 'feature' column (it's in metadata).

-- 0a. Fix reserve_credits(uuid,uuid,int,text,jsonb): wrong column names in INSERT
-- This is the overload called by generate-scene-image
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
    SELECT 1 FROM public.credit_reservations
    WHERE request_id = p_request_id AND user_id = p_user_id
  ) THEN
    v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
    v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);

    IF NOT EXISTS (SELECT 1 FROM public.credit_transactions WHERE request_id = p_request_id) THEN
       INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
       VALUES (p_user_id, p_amount, 'reservation', 'Credit reservation', p_metadata || jsonb_build_object('feature', p_feature), p_request_id);
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'remaining_monthly', v_remaining_monthly,
      'remaining_bonus', v_remaining_bonus,
      'reserved_monthly', (SELECT monthly_amount FROM public.credit_reservations WHERE request_id = p_request_id),
      'reserved_bonus', (SELECT bonus_amount FROM public.credit_reservations WHERE request_id = p_request_id)
    );
  END IF;

  v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
  v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);

  IF (v_remaining_monthly + v_remaining_bonus) < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_credits', 'remaining_monthly', v_remaining_monthly, 'remaining_bonus', v_remaining_bonus);
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

  -- Use correct column names: monthly_amount, bonus_amount (NOT monthly_credits_used, bonus_credits_used)
  -- Store feature in metadata (no feature column on table)
  INSERT INTO public.credit_reservations (
    user_id, request_id, amount, monthly_amount, bonus_amount,
    status, description, metadata, created_at
  ) VALUES (
    p_user_id, p_request_id, p_amount, v_use_monthly, v_use_bonus,
    'reserved', 'Credit reservation',
    p_metadata || jsonb_build_object('feature', p_feature),
    now()
  );

  INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
  VALUES (p_user_id, p_amount, 'reservation', 'Credit reservation',
    p_metadata || jsonb_build_object('feature', p_feature), p_request_id);

  v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - (COALESCE(v_row.reserved_monthly, 0) + v_use_monthly), 0);
  v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - (COALESCE(v_row.reserved_bonus, 0) + v_use_bonus), 0);

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

-- 0b. Fix commit_reserved_credits: wrong column references
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
    UPDATE public.profiles SET credits_balance = (v_remaining_monthly + v_remaining_bonus) WHERE user_id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'remaining_monthly', v_remaining_monthly, 'remaining_bonus', v_remaining_bonus);
  END IF;

  IF v_res.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_reservation_state', 'status', v_res.status);
  END IF;

  -- Apply usage: move from reserved to used (using correct column names)
  UPDATE public.user_credits
  SET
    monthly_credits_used = monthly_credits_used + v_res.monthly_amount,
    bonus_credits_used = bonus_credits_used + v_res.bonus_amount,
    reserved_monthly = GREATEST(COALESCE(reserved_monthly, 0) - v_res.monthly_amount, 0),
    reserved_bonus = GREATEST(COALESCE(reserved_bonus, 0) - v_res.bonus_amount, 0),
    updated_at = now()
  WHERE user_id = p_user_id;

  UPDATE public.credit_reservations
  SET status = 'committed', metadata = metadata || p_metadata, updated_at = now()
  WHERE request_id = p_request_id AND user_id = p_user_id;

  UPDATE public.credit_transactions
  SET transaction_type = 'usage', description = 'Image generation', metadata = metadata || p_metadata
  WHERE user_id = p_user_id AND request_id = p_request_id AND transaction_type = 'reservation';

  IF NOT FOUND THEN
    INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
    VALUES (p_user_id, v_res.amount, 'usage', 'Image generation', v_res.metadata || p_metadata, p_request_id);
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
  v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);

  UPDATE public.profiles SET credits_balance = (v_remaining_monthly + v_remaining_bonus) WHERE user_id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'remaining_monthly', v_remaining_monthly, 'remaining_bonus', v_remaining_bonus);
END;
$$;

-- 1. Fix release_reserved_credits: wrong column references
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
  v_feature TEXT;
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

  -- Extract feature from metadata (no feature column on reservations table)
  v_feature := COALESCE(v_res.metadata->>'feature', 'unknown');

  -- Restore reserved credits
  UPDATE public.user_credits
  SET
    reserved_monthly = GREATEST(COALESCE(reserved_monthly, 0) - v_res.monthly_amount, 0),
    reserved_bonus = GREATEST(COALESCE(reserved_bonus, 0) - v_res.bonus_amount, 0),
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
    metadata = COALESCE(metadata, '{}'::jsonb) || p_metadata || jsonb_build_object('feature', v_feature, 'release_reason', p_reason, 'failure_reason', p_reason)
  WHERE user_id = p_user_id AND request_id = p_request_id AND transaction_type = 'reservation';

  -- Fallback insert if no transaction found
  IF NOT FOUND THEN
    INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
    VALUES (
      p_user_id,
      0,
      'release',
      COALESCE(p_reason, 'Credit reservation released'),
      (v_res.metadata || p_metadata || jsonb_build_object('feature', v_feature, 'release_reason', p_reason, 'failure_reason', p_reason)),
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

-- 2. Fix refund_consumed_credits: wrong column references
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
  v_monthly_after INTEGER;
  v_bonus_after INTEGER;
  v_feature TEXT;
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

  v_feature := COALESCE(v_res.metadata->>'feature', 'unknown');

  UPDATE public.user_credits
  SET
    monthly_credits_used = GREATEST(monthly_credits_used - v_res.monthly_amount, 0),
    bonus_credits_used = GREATEST(bonus_credits_used - v_res.bonus_amount, 0),
    updated_at = now()
  WHERE user_id = p_user_id;

  UPDATE public.credit_reservations
  SET status = 'released',
      metadata = (metadata || p_metadata) || jsonb_build_object('refund_reason', p_reason),
      updated_at = now()
  WHERE request_id = p_request_id AND user_id = p_user_id;

  UPDATE public.credit_transactions
  SET
    transaction_type = 'refund',
    amount = 0,
    description = COALESCE(p_reason, 'Credit usage refunded'),
    metadata = metadata || p_metadata || jsonb_build_object('refund_reason', p_reason, 'failure_reason', p_reason, 'original_cost', (v_res.monthly_amount + v_res.bonus_amount))
  WHERE request_id = p_request_id AND transaction_type = 'usage';

  IF NOT FOUND THEN
    INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
    VALUES (
      p_user_id,
      0,
      'refund',
      COALESCE(p_reason, 'Credit usage refunded'),
      (v_res.metadata || p_metadata || jsonb_build_object('feature', v_feature, 'refund_reason', p_reason, 'failure_reason', p_reason)),
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
    'refunded_monthly', v_res.monthly_amount,
    'refunded_bonus', v_res.bonus_amount,
    'remaining_monthly', v_monthly_after,
    'remaining_bonus', v_bonus_after
  );
END;
$$;

-- 3. Create the force_refund_credits RPC that generate-scene-image depends on.
-- This is a robust, catch-all refund function that handles all credit states:
--   reserved  → releases the reservation
--   committed → refunds consumed credits
--   no reservation → reverses usage transactions directly
-- Drop the old TEXT-typed version if it exists
DROP FUNCTION IF EXISTS public.force_refund_credits(uuid, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.force_refund_credits(
  p_user_id UUID,
  p_request_id UUID,
  p_reason TEXT DEFAULT 'generation_failed',
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res public.credit_reservations%ROWTYPE;
  v_row public.user_credits%ROWTYPE;
  v_monthly_after INTEGER;
  v_bonus_after INTEGER;
  v_result JSONB;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;
  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_request_id');
  END IF;

  PERFORM public.ensure_user_credits(p_user_id);

  -- Try to find a reservation for this request
  SELECT * INTO v_res
  FROM public.credit_reservations
  WHERE request_id = p_request_id AND user_id = p_user_id
  FOR UPDATE;

  IF FOUND THEN
    -- Reservation exists: delegate to the appropriate handler based on status
    IF v_res.status = 'released' THEN
      -- Already released, nothing to do
      SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
      v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
      v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);
      RETURN jsonb_build_object('ok', true, 'already_released', true, 'remaining_monthly', v_monthly_after, 'remaining_bonus', v_bonus_after);
    END IF;

    IF v_res.status = 'reserved' THEN
      -- Still reserved: release it
      RETURN public.release_reserved_credits(p_user_id, p_request_id, p_reason, p_metadata);
    END IF;

    IF v_res.status = 'committed' THEN
      -- Already committed/consumed: refund it
      RETURN public.refund_consumed_credits(p_user_id, p_request_id, p_reason, p_metadata);
    END IF;

    -- Unknown status
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_reservation_status', 'status', v_res.status);
  END IF;

  -- No reservation found: try to reverse any usage transactions directly
  -- This handles the case where consume_credits was used without a reservation
  v_result := public.force_refund_request(p_request_id::uuid, p_reason);

  IF v_result IS NOT NULL AND (v_result->>'ok')::boolean = true THEN
    RETURN v_result;
  END IF;

  -- Nothing found to refund
  RETURN jsonb_build_object('ok', true, 'reason', 'nothing_to_refund', 'details', 'No reservation or usage found for this request');
END;
$$;
