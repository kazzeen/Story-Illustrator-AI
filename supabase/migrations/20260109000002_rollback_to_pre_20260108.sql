DROP FUNCTION IF EXISTS public.force_refund_credits(UUID, UUID, TEXT, JSONB);

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

  UPDATE public.user_credits
  SET
    monthly_credits_used = GREATEST(monthly_credits_used - v_res.monthly_credits_used, 0),
    bonus_credits_used = GREATEST(bonus_credits_used - v_res.bonus_credits_used, 0),
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
    metadata = metadata || p_metadata || jsonb_build_object('refund_reason', p_reason, 'failure_reason', p_reason, 'original_cost', (v_res.monthly_credits_used + v_res.bonus_credits_used)),
    updated_at = now()
  WHERE request_id = p_request_id AND transaction_type = 'usage';

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

CREATE OR REPLACE FUNCTION public.reconcile_failed_generation_credits(
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
  v_user_id UUID;
  v_res_status public.credit_reservation_status;
  v_tx_count INTEGER;
  v_attempt_status TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT status INTO v_attempt_status
  FROM public.image_generation_attempts
  WHERE request_id = p_request_id AND user_id = v_user_id;

  SELECT status INTO v_res_status
  FROM public.credit_reservations
  WHERE request_id = p_request_id AND user_id = v_user_id;

  IF v_res_status IS NOT NULL THEN
    IF v_res_status = 'reserved' THEN
      RETURN public.release_reserved_credits(v_user_id, p_request_id, p_reason, p_metadata);
    ELSIF v_res_status = 'committed' THEN
      NULL;
    ELSIF v_res_status = 'released' THEN
      RETURN jsonb_build_object('ok', true, 'already_released', true);
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_tx_count
  FROM public.credit_transactions
  WHERE request_id = p_request_id AND user_id = v_user_id AND transaction_type = 'refund';

  IF v_tx_count > 0 THEN
    RETURN jsonb_build_object('ok', true, 'already_refunded', true);
  END IF;

  RETURN public.refund_consumed_credits(v_user_id, p_request_id, p_reason, p_metadata);
END;
$$;

GRANT EXECUTE ON FUNCTION public.refund_consumed_credits(UUID, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_consumed_credits(UUID, UUID, TEXT, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.reconcile_failed_generation_credits(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_failed_generation_credits(UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_failed_generation_credits(UUID, TEXT, JSONB) TO service_role;
