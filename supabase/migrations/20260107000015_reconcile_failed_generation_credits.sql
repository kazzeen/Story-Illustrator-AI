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
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_request_id');
  END IF;

  v_release := public.release_reserved_credits(
    v_user_id,
    p_request_id,
    p_reason,
    COALESCE(p_metadata, '{}'::jsonb)
  );

  v_refund := public.refund_consumed_credits(
    v_user_id,
    p_request_id,
    p_reason,
    COALESCE(p_metadata, '{}'::jsonb)
  );

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
