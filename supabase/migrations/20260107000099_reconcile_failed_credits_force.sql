-- Migration 20260107000099_reconcile_failed_credits_force.sql

-- Ensure release_reserved_credits updates the transaction log correctly
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

  -- Idempotency check
  IF v_res.status = 'released' THEN
    SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
    v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
    v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);
    RETURN jsonb_build_object('ok', true, 'already_released', true, 'remaining_monthly', v_monthly_after, 'remaining_bonus', v_bonus_after);
  END IF;

  IF v_res.status = 'committed' THEN
    -- Redirect to refund if committed
    RETURN public.refund_consumed_credits(p_user_id, p_request_id, p_reason, p_metadata);
  END IF;

  IF v_res.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_reservation_state', 'status', v_res.status);
  END IF;

  -- Restore reserved credits
  UPDATE public.user_credits
  SET
    reserved_monthly = GREATEST(reserved_monthly - v_res.monthly_credits_used, 0),
    reserved_bonus = GREATEST(reserved_bonus - v_res.bonus_credits_used, 0),
    updated_at = now()
  WHERE user_id = p_user_id;

  -- Update reservation status
  UPDATE public.credit_reservations
  SET status = 'released',
      metadata = (metadata || p_metadata) || jsonb_build_object('release_reason', p_reason),
      updated_at = now()
  WHERE request_id = p_request_id AND user_id = p_user_id;

  -- Update transaction log (convert reservation to release)
  UPDATE public.credit_transactions
  SET
    transaction_type = 'release',
    amount = 0,
    description = COALESCE(p_reason, 'Credit reservation released'),
    metadata = COALESCE(metadata, '{}'::jsonb) || p_metadata || jsonb_build_object('feature', v_res.feature, 'release_reason', p_reason)
  WHERE user_id = p_user_id AND request_id = p_request_id AND transaction_type = 'reservation';

  -- If no reservation transaction found (maybe created before we started logging reservations?), insert a release record
  IF NOT FOUND THEN
    INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
    VALUES (
      p_user_id,
      0,
      'release',
      COALESCE(p_reason, 'Credit reservation released'),
      (v_res.metadata || p_metadata || jsonb_build_object('feature', v_res.feature, 'release_reason', p_reason)),
      p_request_id
    );
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

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


-- Ensure refund_consumed_credits updates the transaction log correctly
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

  -- Update transaction log (convert usage to refund/release)
  -- We want to "erase" the cost, so we set amount to 0 and type to 'released' or 'refund'
  -- User requested "categorizing all failed image generations... in the description"
  UPDATE public.credit_transactions
  SET 
    transaction_type = 'refund',
    amount = 0,
    description = COALESCE(p_reason, 'Credit usage refunded'),
    metadata = metadata || p_metadata || jsonb_build_object('refund_reason', p_reason, 'original_cost', (v_res.monthly_credits_used + v_res.bonus_credits_used)),
    updated_at = now()
  WHERE request_id = p_request_id AND transaction_type = 'usage';

  -- If no usage transaction found (should not happen if committed), insert a refund record
  IF NOT FOUND THEN
    INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
    VALUES (
      p_user_id,
      0,
      'refund',
      COALESCE(p_reason, 'Credit usage refunded'),
      (v_res.metadata || p_metadata || jsonb_build_object('feature', v_res.feature, 'refund_reason', p_reason)),
      p_request_id
    );
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

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


-- Master function to reconcile failed generation credits
CREATE OR REPLACE FUNCTION public.reconcile_failed_generation_credits(
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
  v_res_status TEXT;
  v_result JSONB;
BEGIN
  -- Get reservation status
  SELECT status INTO v_res_status
  FROM public.credit_reservations
  WHERE request_id = p_request_id AND user_id = p_user_id;

  -- If no reservation found, check if there is a usage transaction (maybe legacy or race condition)
  IF v_res_status IS NULL THEN
     IF EXISTS (SELECT 1 FROM public.credit_transactions WHERE request_id = p_request_id AND transaction_type = 'usage') THEN
        v_res_status := 'committed';
     ELSE
        RETURN jsonb_build_object('ok', true, 'status', 'not_found', 'message', 'No reservation or usage found');
     END IF;
  END IF;

  IF v_res_status = 'reserved' THEN
    RETURN public.release_reserved_credits(p_user_id, p_request_id, p_reason, p_metadata);
  ELSIF v_res_status = 'committed' THEN
    RETURN public.refund_consumed_credits(p_user_id, p_request_id, p_reason, p_metadata);
  ELSIF v_res_status = 'released' THEN
     RETURN jsonb_build_object('ok', true, 'status', 'already_released');
  ELSE
     RETURN jsonb_build_object('ok', false, 'error', 'unknown_status', 'status', v_res_status);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_reserved_credits(UUID, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_reserved_credits(UUID, UUID, TEXT, JSONB) TO authenticated;

GRANT EXECUTE ON FUNCTION public.refund_consumed_credits(UUID, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_consumed_credits(UUID, UUID, TEXT, JSONB) TO authenticated;

GRANT EXECUTE ON FUNCTION public.reconcile_failed_generation_credits(UUID, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_failed_generation_credits(UUID, UUID, TEXT, JSONB) TO authenticated;
