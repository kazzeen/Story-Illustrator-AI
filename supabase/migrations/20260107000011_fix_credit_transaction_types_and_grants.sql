ALTER TABLE public.credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_transaction_type_check;

ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_transaction_type_check
  CHECK (
    transaction_type IN (
      'purchase',
      'subscription_grant',
      'usage',
      'bonus',
      'refund',
      'adjustment',
      'reservation',
      'release',
      'released'
    )
  );

DO $$
BEGIN
  IF to_regprocedure('public.release_reserved_credits(uuid,uuid,text,jsonb)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.release_reserved_credits(UUID, UUID, TEXT, JSONB) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.release_reserved_credits(UUID, UUID, TEXT, JSONB) TO service_role';
  END IF;

  IF to_regprocedure('public.refund_consumed_credits(uuid,uuid,text,jsonb)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.refund_consumed_credits(UUID, UUID, TEXT, JSONB) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.refund_consumed_credits(UUID, UUID, TEXT, JSONB) TO service_role';
  END IF;

  IF to_regprocedure('public.commit_reserved_credits(uuid,uuid,jsonb)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.commit_reserved_credits(UUID, UUID, JSONB) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.commit_reserved_credits(UUID, UUID, JSONB) TO service_role';
  END IF;

  IF to_regprocedure('public.reserve_credits(uuid,uuid,integer,text,jsonb)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID, UUID, INTEGER, TEXT, JSONB) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID, UUID, INTEGER, TEXT, JSONB) TO service_role';
  END IF;

  IF to_regprocedure('public.reserve_credits(uuid,integer,text,jsonb,uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID, INTEGER, TEXT, JSONB, UUID) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID, INTEGER, TEXT, JSONB, UUID) TO service_role';
  END IF;
END $$;

