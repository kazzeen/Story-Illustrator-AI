-- Manual Verification Script for Credit System
-- Usage: 
-- 1. Run this entire script in the Supabase SQL Editor to create the test function.
-- 2. Call the function with a valid user ID (pick one from auth.users or your own ID):
--    SELECT test_credit_flow('your-user-uuid-here');
-- 3. Check the output messages for test results.

CREATE OR REPLACE FUNCTION public.test_credit_flow(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_initial_monthly INTEGER;
  v_initial_bonus INTEGER;
  v_after_commit_monthly INTEGER;
  v_after_commit_bonus INTEGER;
  v_after_refund_monthly INTEGER;
  v_after_refund_bonus INTEGER;
  v_request_id_1 UUID := gen_random_uuid();
  v_request_id_2 UUID := gen_random_uuid();
  v_res JSONB;
  v_user_exists BOOLEAN;
BEGIN
  -- 1. Check user exists
  SELECT EXISTS(SELECT 1 FROM public.user_credits WHERE user_id = p_user_id) INTO v_user_exists;
  IF NOT v_user_exists THEN
    PERFORM public.ensure_user_credits(p_user_id);
  END IF;

  -- Get initial balance
  SELECT 
    (monthly_credits_per_cycle - monthly_credits_used - COALESCE(reserved_monthly, 0)),
    (bonus_credits_total - bonus_credits_used - COALESCE(reserved_bonus, 0))
  INTO v_initial_monthly, v_initial_bonus
  FROM public.user_credits
  WHERE user_id = p_user_id;

  RAISE NOTICE 'Initial Balance: Monthly=%, Bonus=%', v_initial_monthly, v_initial_bonus;

  IF (v_initial_monthly + v_initial_bonus) < 2 THEN
    RETURN 'Not enough credits to run test. Need at least 2 credits.';
  END IF;

  -- 2. Test Success Flow (Reserve -> Commit)
  RAISE NOTICE '--- Testing Success Flow ---';
  RAISE NOTICE 'Reserving 1 credit (Request ID: %)', v_request_id_1;
  
  v_res := public.reserve_credits(
    p_user_id, 
    1, 
    v_request_id_1, 
    'test_feature', 
    '{"test": true}'::jsonb
  );
  
  IF (v_res->>'ok')::boolean IS DISTINCT FROM true THEN
    RETURN 'Reservation 1 failed: ' || (v_res->>'reason');
  END IF;

  RAISE NOTICE 'Committing 1 credit...';
  v_res := public.commit_reserved_credits(p_user_id, v_request_id_1);

  IF (v_res->>'ok')::boolean IS DISTINCT FROM true THEN
    RETURN 'Commit 1 failed: ' || (v_res->>'reason');
  END IF;

  -- Check balance
  SELECT 
    (monthly_credits_per_cycle - monthly_credits_used - COALESCE(reserved_monthly, 0)),
    (bonus_credits_total - bonus_credits_used - COALESCE(reserved_bonus, 0))
  INTO v_after_commit_monthly, v_after_commit_bonus
  FROM public.user_credits
  WHERE user_id = p_user_id;

  RAISE NOTICE 'Balance after commit: Monthly=%, Bonus=%', v_after_commit_monthly, v_after_commit_bonus;

  IF (v_initial_monthly + v_initial_bonus - 1) <> (v_after_commit_monthly + v_after_commit_bonus) THEN
    RETURN 'Balance mismatch after commit. Expected ' || (v_initial_monthly + v_initial_bonus - 1) || ', got ' || (v_after_commit_monthly + v_after_commit_bonus);
  END IF;

  -- 3. Test Failure Flow (Reserve -> Refund)
  RAISE NOTICE '--- Testing Failure/Refund Flow ---';
  RAISE NOTICE 'Reserving 1 credit (Request ID: %)', v_request_id_2;

  v_res := public.reserve_credits(
    p_user_id, 
    1, 
    v_request_id_2, 
    'test_feature', 
    '{"test": true}'::jsonb
  );

  IF (v_res->>'ok')::boolean IS DISTINCT FROM true THEN
    RETURN 'Reservation 2 failed: ' || (v_res->>'reason');
  END IF;

  RAISE NOTICE 'Refunding 1 credit (simulating failure)...';
  -- We use force_refund_credits which should handle reservation release too
  v_res := public.force_refund_credits(
    p_user_id, 
    v_request_id_2, 
    'Test failure refund', 
    '{"test": true}'::jsonb
  );

  IF (v_res->>'ok')::boolean IS DISTINCT FROM true THEN
    RETURN 'Refund failed: ' || (v_res->>'reason');
  END IF;

  -- Check balance
  SELECT 
    (monthly_credits_per_cycle - monthly_credits_used - COALESCE(reserved_monthly, 0)),
    (bonus_credits_total - bonus_credits_used - COALESCE(reserved_bonus, 0))
  INTO v_after_refund_monthly, v_after_refund_bonus
  FROM public.user_credits
  WHERE user_id = p_user_id;

  RAISE NOTICE 'Balance after refund: Monthly=%, Bonus=%', v_after_refund_monthly, v_after_refund_bonus;

  IF (v_after_commit_monthly + v_after_commit_bonus) <> (v_after_refund_monthly + v_after_refund_bonus) THEN
    RETURN 'Balance mismatch after refund. Expected ' || (v_after_commit_monthly + v_after_commit_bonus) || ', got ' || (v_after_refund_monthly + v_after_refund_bonus);
  END IF;

  RETURN 'TEST PASSED SUCCESSFULLY. Note: 1 credit was consumed in the success flow test.';
END;
$$;
