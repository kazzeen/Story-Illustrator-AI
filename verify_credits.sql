
DO $$
DECLARE
  v_user_id UUID := '00000000-0000-0000-0000-000000000000'; -- Test UUID
  v_request_id UUID := gen_random_uuid();
  v_res JSONB;
  v_balance_before INTEGER;
  v_balance_reserved INTEGER;
  v_balance_after INTEGER;
BEGIN
  -- 1. Setup User
  INSERT INTO auth.users (id, email) VALUES (v_user_id, 'test@example.com')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_credits (user_id, monthly_credits_per_cycle, monthly_credits_used, reserved_monthly, updated_at)
  VALUES (v_user_id, 10, 0, 0, now())
  ON CONFLICT (user_id) DO UPDATE SET monthly_credits_used = 0, reserved_monthly = 0;

  -- Check Initial Balance
  SELECT (monthly_credits_per_cycle - monthly_credits_used - COALESCE(reserved_monthly, 0)) INTO v_balance_before
  FROM public.user_credits WHERE user_id = v_user_id;
  
  RAISE NOTICE 'Balance Before: %', v_balance_before;

  -- 2. Reserve
  v_res := public.reserve_credits(v_user_id, v_request_id, 1, 'test_feature');
  RAISE NOTICE 'Reserve Result: %', v_res;

  SELECT (monthly_credits_per_cycle - monthly_credits_used - COALESCE(reserved_monthly, 0)) INTO v_balance_reserved
  FROM public.user_credits WHERE user_id = v_user_id;

  RAISE NOTICE 'Balance Reserved: %', v_balance_reserved;

  IF v_balance_reserved <> (v_balance_before - 1) THEN
    RAISE EXCEPTION 'Reservation did not deduct balance correctly';
  END IF;

  -- 3. Release (Simulate Failure)
  v_res := public.release_reserved_credits(v_user_id, v_request_id, 'test_failure');
  RAISE NOTICE 'Release Result: %', v_res;

  SELECT (monthly_credits_per_cycle - monthly_credits_used - COALESCE(reserved_monthly, 0)) INTO v_balance_after
  FROM public.user_credits WHERE user_id = v_user_id;

  RAISE NOTICE 'Balance After Release: %', v_balance_after;

  IF v_balance_after <> v_balance_before THEN
    RAISE EXCEPTION 'Release did not restore balance correctly';
  END IF;

  -- 4. Test Commit -> Refund Flow
  v_request_id := gen_random_uuid();
  v_res := public.reserve_credits(v_user_id, v_request_id, 1, 'test_feature_2');
  v_res := public.commit_reserved_credits(v_user_id, v_request_id);
  
  SELECT (monthly_credits_per_cycle - monthly_credits_used - COALESCE(reserved_monthly, 0)) INTO v_balance_reserved
  FROM public.user_credits WHERE user_id = v_user_id;
  RAISE NOTICE 'Balance Committed: %', v_balance_reserved;

  -- Refund
  v_res := public.refund_consumed_credits(v_user_id, v_request_id, 'test_refund');
  RAISE NOTICE 'Refund Result: %', v_res;

  SELECT (monthly_credits_per_cycle - monthly_credits_used - COALESCE(reserved_monthly, 0)) INTO v_balance_after
  FROM public.user_credits WHERE user_id = v_user_id;
  RAISE NOTICE 'Balance After Refund: %', v_balance_after;

  IF v_balance_after <> v_balance_before THEN
    RAISE EXCEPTION 'Refund did not restore balance correctly';
  END IF;

  RAISE NOTICE 'ALL TESTS PASSED';
END;
$$;
