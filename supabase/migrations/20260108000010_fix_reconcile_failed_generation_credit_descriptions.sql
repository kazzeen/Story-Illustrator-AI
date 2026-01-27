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
  v_has_tx BOOLEAN;
  v_feature TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_request_id');
  END IF;

  v_feature := COALESCE(NULLIF(p_metadata->>'feature', ''), 'generate-scene-image');
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
  SET
    description = COALESCE(NULLIF(p_reason, ''), description),
    metadata = COALESCE(metadata, '{}'::jsonb) || v_metadata,
    updated_at = now()
  WHERE user_id = v_user_id
    AND request_id = p_request_id
    AND transaction_type IN ('reservation', 'usage', 'release', 'released', 'refund');

  SELECT EXISTS(
    SELECT 1
    FROM public.credit_transactions
    WHERE user_id = v_user_id
      AND request_id = p_request_id
      AND transaction_type IN ('reservation', 'usage', 'release', 'released', 'refund')
  ) INTO v_has_tx;

  IF NOT v_has_tx THEN
    INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
    VALUES (
      v_user_id,
      0,
      'release',
      COALESCE(NULLIF(p_reason, ''), 'Generation failed'),
      v_metadata || jsonb_build_object('feature', v_feature, 'release_type', 'rollback', 'release_reason', p_reason),
      p_request_id
    );
  END IF;

  UPDATE public.image_generation_attempts
  SET
    status = 'failed',
    error_message = COALESCE(NULLIF(p_reason, ''), error_message),
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

