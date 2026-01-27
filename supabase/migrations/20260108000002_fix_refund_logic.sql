-- Fix refund_consumed_credits to robustly handle detached usage transactions
-- and prevent early return on 'released' status if refund hasn't actually happened.

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
  v_remaining_monthly INTEGER;
  v_remaining_bonus INTEGER;
  v_monthly_refund INTEGER := 0;
  v_bonus_refund INTEGER := 0;
  v_monthly_after INTEGER;
  v_bonus_after INTEGER;
  v_has_reservation BOOLEAN := FALSE;
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

  -- 1. Check if ALREADY refunded (Transaction Source of Truth)
  IF EXISTS (
    SELECT 1
    FROM public.credit_transactions ct
    WHERE ct.user_id = p_user_id
      AND ct.request_id = p_request_id
      AND ct.transaction_type = 'refund'
  ) THEN
    SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
    v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
    v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);
    UPDATE public.profiles
    SET credits_balance = (v_remaining_monthly + v_remaining_bonus)
    WHERE user_id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'already_refunded', true, 'remaining_monthly', v_remaining_monthly, 'remaining_bonus', v_remaining_bonus);
  END IF;

  PERFORM public.ensure_user_credits(p_user_id);

  -- 2. Check Reservation
  SELECT * INTO v_res
  FROM public.credit_reservations
  WHERE request_id = p_request_id AND user_id = p_user_id
  FOR UPDATE;

  IF FOUND THEN
    v_has_reservation := TRUE;

    IF v_res.status = 'reserved' THEN
      RETURN public.release_reserved_credits(p_user_id, p_request_id, p_reason, p_metadata);
    END IF;

    -- If status is 'committed', we can use the reservation data
    IF v_res.status = 'committed' THEN
      v_monthly_refund := COALESCE(v_res.monthly_credits_used, 0);
      v_bonus_refund := COALESCE(v_res.bonus_credits_used, 0);
    END IF;
    
    -- If status is 'released', we continue to check transactions (fallback below)
    -- because 'released' might mean reservation was released but usage (from consume_credits) remains.
  END IF;

  -- 3. Fallback: Calculate from Transactions
  -- If reservation didn't give us amounts (or didn't exist), check usage transactions.
  IF v_monthly_refund = 0 AND v_bonus_refund = 0 THEN
    SELECT
      COALESCE(SUM(CASE WHEN ct.pool = 'monthly' THEN -ct.amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN ct.pool = 'bonus' THEN -ct.amount ELSE 0 END), 0)
    INTO v_monthly_refund, v_bonus_refund
    FROM public.credit_transactions ct
    WHERE ct.user_id = p_user_id
      AND ct.request_id = p_request_id
      AND ct.transaction_type = 'usage';
  END IF;

  -- 4. Execute Refund
  IF COALESCE(v_monthly_refund, 0) <= 0 AND COALESCE(v_bonus_refund, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_usage_to_refund');
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_credit_account');
  END IF;

  UPDATE public.user_credits
  SET
    monthly_credits_used = GREATEST(COALESCE(monthly_credits_used, 0) - COALESCE(v_monthly_refund, 0), 0),
    bonus_credits_used = GREATEST(COALESCE(bonus_credits_used, 0) - COALESCE(v_bonus_refund, 0), 0),
    updated_at = now()
  WHERE user_id = p_user_id;

  -- Mark reservation as released/refunded if it exists
  IF v_has_reservation THEN
    UPDATE public.credit_reservations
    SET
      status = 'released',
      metadata = (metadata || p_metadata) || jsonb_build_object('refund_reason', p_reason),
      updated_at = now()
    WHERE request_id = p_request_id AND user_id = p_user_id
      AND status <> 'released';
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
  v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);

  UPDATE public.profiles
  SET credits_balance = (v_remaining_monthly + v_remaining_bonus)
  WHERE user_id = p_user_id;

  v_monthly_after := v_remaining_monthly;
  v_bonus_after := v_remaining_bonus;

  IF v_monthly_refund > 0 THEN
    INSERT INTO public.credit_transactions (
      user_id,
      amount,
      transaction_type,
      description,
      metadata,
      pool,
      balance_monthly_after,
      balance_bonus_after,
      request_id
    ) VALUES (
      p_user_id,
      v_monthly_refund,
      'refund',
      p_reason,
      p_metadata || jsonb_build_object('refund_of_request_id', p_request_id, 'refund_reason', p_reason, 'original_cost', (v_monthly_refund + v_bonus_refund), 'feature', CASE WHEN v_has_reservation THEN v_res.feature ELSE (p_metadata ->> 'feature') END),
      'monthly',
      v_monthly_after,
      v_bonus_after,
      p_request_id
    );
  END IF;

  IF v_bonus_refund > 0 THEN
    INSERT INTO public.credit_transactions (
      user_id,
      amount,
      transaction_type,
      description,
      metadata,
      pool,
      balance_monthly_after,
      balance_bonus_after,
      request_id
    ) VALUES (
      p_user_id,
      v_bonus_refund,
      'refund',
      p_reason,
      p_metadata || jsonb_build_object('refund_of_request_id', p_request_id, 'refund_reason', p_reason, 'original_cost', (v_monthly_refund + v_bonus_refund), 'feature', CASE WHEN v_has_reservation THEN v_res.feature ELSE (p_metadata ->> 'feature') END),
      'bonus',
      v_monthly_after,
      v_bonus_after,
      p_request_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'refunded_monthly', v_monthly_refund,
    'refunded_bonus', v_bonus_refund,
    'remaining_monthly', v_remaining_monthly,
    'remaining_bonus', v_remaining_bonus
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.refund_consumed_credits(UUID, UUID, TEXT, JSONB) TO service_role;


-- Update force_refund_credits to try refund FIRST, then release.
-- This handles the case where reservation is 'released' but usage exists more gracefully
-- (though refund_consumed_credits handles it now anyway).

CREATE OR REPLACE FUNCTION public.force_refund_credits(
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
  v_release_res JSONB;
  v_refund_res JSONB;
  v_combined_metadata JSONB;
BEGIN
  -- 1. Validate Inputs
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;
  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_request_id');
  END IF;

  v_combined_metadata := COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('forced_refund', true, 'refund_timestamp', now());

  -- 2. Attempt Refund Consumption FIRST
  -- This ensures we catch any usage transactions (detached or committed)
  -- The updated refund_consumed_credits will now correctly check transactions even if reservation is released.
  v_refund_res := public.refund_consumed_credits(
    p_user_id,
    p_request_id,
    p_reason,
    v_combined_metadata
  );

  -- 3. Attempt Release Reservation
  -- This cleans up any 'reserved' status if it wasn't handled by refund (e.g. if no usage existed)
  v_release_res := public.release_reserved_credits(
    p_user_id,
    p_request_id,
    p_reason,
    v_combined_metadata
  );

  -- 4. Construct Result
  RETURN jsonb_build_object(
    'ok', true,
    'release_result', v_release_res,
    'refund_result', v_refund_res,
    'summary', CASE
      WHEN (v_refund_res->>'ok')::boolean AND NOT (v_refund_res->>'already_refunded')::boolean THEN 'refunded'
      WHEN (v_release_res->>'ok')::boolean AND NOT (v_release_res->>'already_released')::boolean THEN 'released'
      WHEN (v_refund_res->>'already_refunded')::boolean THEN 'already_refunded'
      WHEN (v_release_res->>'already_released')::boolean THEN 'already_released'
      ELSE 'no_action_needed'
    END
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', false,
    'reason', 'exception',
    'error', SQLERRM,
    'details', SQLSTATE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.force_refund_credits(UUID, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.force_refund_credits(UUID, UUID, TEXT, JSONB) TO authenticated;
