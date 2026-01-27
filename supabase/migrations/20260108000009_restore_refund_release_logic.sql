
-- Migration: Restore release_reserved_credits logic in force_refund_credits
-- This ensures that we handle both reservation release and usage refund, 
-- preventing "stuck" credits if consumption hasn't happened yet.

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
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;
  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_request_id');
  END IF;

  v_combined_metadata := COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('forced_refund', true, 'refund_timestamp', now());

  -- 1. Attempt Release Reservation (Restored)
  -- This handles 'reserved' status cases
  v_release_res := public.release_reserved_credits(
    p_user_id,
    p_request_id,
    p_reason,
    v_combined_metadata
  );

  -- 2. Attempt Refund Consumption
  v_refund_res := public.refund_consumed_credits(
    p_user_id,
    p_request_id,
    p_reason,
    v_combined_metadata
  );

  -- 3. CRITICAL FIX: Update ALL transaction descriptions to reflect the refund status
  -- This ensures "Recent Activity" shows "Refunded: ..." for all relevant transaction types
  UPDATE public.credit_transactions
  SET 
    description = 'Refunded: ' || p_reason,
    metadata = metadata || jsonb_build_object('refunded', true, 'refund_reason', p_reason)
  WHERE user_id = p_user_id 
    AND request_id = p_request_id 
    AND transaction_type IN ('usage', 'release', 'released', 'reservation', 'reserved');

  RETURN jsonb_build_object(
    'ok', true,
    'release_result', v_release_res,
    'refund_result', v_refund_res,
    'summary', CASE
      WHEN (v_release_res->>'ok')::boolean AND NOT (v_release_res->>'already_released')::boolean THEN 'released'
      WHEN (v_refund_res->>'refunded_monthly')::int > 0 OR (v_refund_res->>'refunded_bonus')::int > 0 THEN 'refunded'
      WHEN (v_refund_res->>'already_refunded')::boolean THEN 'already_refunded'
      WHEN (v_refund_res->>'released')::boolean THEN 'released'
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
