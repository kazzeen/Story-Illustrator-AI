-- Grant permissions for credit functions to authenticated users
-- This ensures that if the Edge Function calls these via RPC with a user token, it succeeds.

DO $$
BEGIN
  -- Grant for release_reserved_credits
  IF to_regprocedure('public.release_reserved_credits(uuid,uuid,text,jsonb)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.release_reserved_credits(UUID, UUID, TEXT, JSONB) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.release_reserved_credits(UUID, UUID, TEXT, JSONB) TO service_role';
  END IF;

  -- Grant for refund_consumed_credits
  IF to_regprocedure('public.refund_consumed_credits(uuid,uuid,text,jsonb)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.refund_consumed_credits(UUID, UUID, TEXT, JSONB) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.refund_consumed_credits(UUID, UUID, TEXT, JSONB) TO service_role';
  END IF;
END $$;
