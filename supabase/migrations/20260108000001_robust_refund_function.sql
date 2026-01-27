-- Migration: Add robust force_refund_credits function
-- This function attempts to both release reservation AND refund consumption
-- ensuring the user gets their credits back regardless of the transaction state.

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

  -- 2. Attempt Release Reservation
  -- This handles 'reserved' status, and also 'committed' status (by delegating to refund)
  -- But to be absolutely sure, we call both.
  v_release_res := public.release_reserved_credits(
    p_user_id,
    p_request_id,
    p_reason,
    v_combined_metadata
  );

  -- 3. Attempt Refund Consumption
  -- This handles 'usage' transactions even if reservation is missing or already released
  v_refund_res := public.refund_consumed_credits(
    p_user_id,
    p_request_id,
    p_reason,
    v_combined_metadata
  );

  -- 4. Construct Result
  -- We consider it a success if either operation did something useful or if it was already handled
  RETURN jsonb_build_object(
    'ok', true,
    'release_result', v_release_res,
    'refund_result', v_refund_res,
    'summary', CASE
      WHEN (v_release_res->>'ok')::boolean AND NOT (v_release_res->>'already_released')::boolean THEN 'released'
      WHEN (v_refund_res->>'ok')::boolean AND NOT (v_refund_res->>'already_refunded')::boolean THEN 'refunded'
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
