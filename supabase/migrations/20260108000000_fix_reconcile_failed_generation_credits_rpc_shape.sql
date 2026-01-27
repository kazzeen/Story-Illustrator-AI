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
  v_release JSONB;
  v_refund JSONB;
  v_metadata JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_request_id');
  END IF;

  v_metadata := COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('failure_reason', p_reason, 'failure_timestamp', now());

  v_release := public.release_reserved_credits(
    v_user_id,
    p_request_id,
    p_reason,
    v_metadata
  );

  v_refund := public.refund_consumed_credits(
    v_user_id,
    p_request_id,
    p_reason,
    v_metadata
  );

  UPDATE public.credit_transactions
  SET metadata = COALESCE(metadata, '{}'::jsonb) || v_metadata
  WHERE user_id = v_user_id AND request_id = p_request_id;

  UPDATE public.image_generation_attempts
  SET
    status = 'failed',
    error_message = COALESCE(error_message, p_reason),
    metadata = COALESCE(metadata, '{}'::jsonb) || v_metadata,
    updated_at = now()
  WHERE user_id = v_user_id AND request_id = p_request_id;

  RETURN jsonb_build_object(
    'ok', true,
    'release', v_release,
    'refund', v_refund
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_failed_generation_credits(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_failed_generation_credits(UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_failed_generation_credits(UUID, TEXT, JSONB) TO service_role;

