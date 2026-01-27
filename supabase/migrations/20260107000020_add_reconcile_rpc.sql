-- Add reconcile_failed_generation_credits RPC for client-side failure handling
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

  -- Optional: Check image_generation_attempts status
  SELECT status INTO v_attempt_status
  FROM public.image_generation_attempts
  WHERE request_id = p_request_id AND user_id = v_user_id;

  -- If the system thinks it succeeded, we might still allow refund if client claims blank image,
  -- but we should probably log this discrepancy.
  
  -- Check reservation status
  SELECT status INTO v_res_status
  FROM public.credit_reservations
  WHERE request_id = p_request_id AND user_id = v_user_id;

  IF v_res_status IS NOT NULL THEN
    IF v_res_status = 'reserved' THEN
      RETURN public.release_reserved_credits(v_user_id, p_request_id, p_reason, p_metadata);
    ELSIF v_res_status = 'committed' THEN
      -- Fall through to check transactions for refund
      NULL;
    ELSIF v_res_status = 'released' THEN
       RETURN jsonb_build_object('ok', true, 'already_released', true);
    END IF;
  END IF;

  -- Check if already refunded
  SELECT COUNT(*) INTO v_tx_count
  FROM public.credit_transactions
  WHERE request_id = p_request_id AND user_id = v_user_id AND transaction_type = 'refund';

  IF v_tx_count > 0 THEN
     RETURN jsonb_build_object('ok', true, 'already_refunded', true);
  END IF;

  -- Attempt refund if committed or if no reservation found (direct usage)
  -- refund_consumed_credits checks if usage exists internally.
  RETURN public.refund_consumed_credits(v_user_id, p_request_id, p_reason, p_metadata);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_failed_generation_credits(UUID, TEXT, JSONB) TO authenticated;
