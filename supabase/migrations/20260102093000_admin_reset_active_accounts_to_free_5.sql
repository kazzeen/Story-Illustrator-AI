CREATE OR REPLACE FUNCTION public.admin_reset_active_accounts_to_free_5(
  p_dry_run BOOLEAN DEFAULT TRUE,
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id UUID := gen_random_uuid();
  v_target_count INTEGER := 0;
  v_updated_count INTEGER := 0;
  v_verified_ok_count INTEGER := 0;
  v_verification_mismatch_count INTEGER := 0;
  v_sample_user_ids JSONB := '[]'::jsonb;
BEGIN
  SELECT COUNT(*) INTO v_target_count
  FROM public.profiles p
  WHERE p.subscription_status = 'active';

  SELECT COALESCE(jsonb_agg(s.user_id), '[]'::jsonb) INTO v_sample_user_ids
  FROM (
    SELECT p.user_id
    FROM public.profiles p
    WHERE p.subscription_status = 'active'
    ORDER BY p.user_id
    LIMIT 50
  ) s;

  PERFORM public.ensure_user_credits(p.user_id)
  FROM public.profiles p
  WHERE p.subscription_status = 'active';

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'run_id', v_run_id,
      'target_count', v_target_count,
      'sample_user_ids', v_sample_user_ids
    );
  END IF;

  WITH targets AS (
    SELECT p.user_id
    FROM public.profiles p
    WHERE p.subscription_status = 'active'
  ),
  before_rows AS (
    SELECT uc.user_id,
           uc.tier,
           uc.monthly_credits_per_cycle,
           uc.monthly_credits_used,
           uc.bonus_credits_total,
           uc.bonus_credits_used,
           uc.cycle_start_at,
           uc.cycle_end_at,
           uc.cycle_source
    FROM public.user_credits uc
    JOIN targets t ON t.user_id = uc.user_id
    FOR UPDATE
  ),
  updated AS (
    UPDATE public.user_credits uc
    SET
      tier = 'basic',
      monthly_credits_per_cycle = 5,
      monthly_credits_used = 0,
      bonus_credits_total = 0,
      bonus_credits_used = 0,
      cycle_source = 'profile_created',
      stripe_customer_id = NULL,
      stripe_subscription_id = NULL,
      stripe_price_id = NULL,
      bonus_granted = FALSE,
      updated_at = now()
    FROM targets t
    WHERE uc.user_id = t.user_id
    RETURNING uc.user_id
  ),
  audit AS (
    INSERT INTO public.credit_transactions (
      user_id,
      amount,
      transaction_type,
      description,
      metadata,
      pool,
      balance_monthly_after,
      balance_bonus_after,
      request_id,
      created_by
    )
    SELECT
      b.user_id,
      0,
      'adjustment',
      'Admin reset credits to 5',
      jsonb_build_object(
        'operation', 'admin_reset_active_accounts_to_free_5',
        'run_id', v_run_id,
        'before', jsonb_build_object(
          'tier', b.tier,
          'monthly_credits_per_cycle', b.monthly_credits_per_cycle,
          'monthly_credits_used', b.monthly_credits_used,
          'bonus_credits_total', b.bonus_credits_total,
          'bonus_credits_used', b.bonus_credits_used,
          'cycle_start_at', b.cycle_start_at,
          'cycle_end_at', b.cycle_end_at,
          'cycle_source', b.cycle_source
        ),
        'after', jsonb_build_object(
          'tier', 'basic',
          'monthly_credits_per_cycle', 5,
          'monthly_credits_used', 0,
          'bonus_credits_total', 0,
          'bonus_credits_used', 0,
          'cycle_source', 'profile_created'
        )
      ),
      'monthly',
      5,
      0,
      v_run_id,
      p_created_by
    FROM before_rows b
    JOIN updated u ON u.user_id = b.user_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_updated_count FROM updated;

  SELECT COUNT(*) INTO v_verified_ok_count
  FROM public.user_credits uc
  JOIN public.profiles p ON p.user_id = uc.user_id
  WHERE p.subscription_status = 'active'
    AND uc.tier = 'basic'
    AND uc.monthly_credits_per_cycle = 5
    AND uc.monthly_credits_used = 0
    AND uc.bonus_credits_total = 0
    AND uc.bonus_credits_used = 0;

  SELECT COUNT(*) INTO v_verification_mismatch_count
  FROM public.user_credits uc
  JOIN public.profiles p ON p.user_id = uc.user_id
  WHERE p.subscription_status = 'active'
    AND NOT (
      uc.tier = 'basic'
      AND uc.monthly_credits_per_cycle = 5
      AND uc.monthly_credits_used = 0
      AND uc.bonus_credits_total = 0
      AND uc.bonus_credits_used = 0
    );

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'run_id', v_run_id,
    'target_count', v_target_count,
    'updated_count', v_updated_count,
    'verified_ok_count', v_verified_ok_count,
    'verification_mismatch_count', v_verification_mismatch_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_active_accounts_to_free_5(BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_active_accounts_to_free_5(BOOLEAN, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_verify_active_accounts_free_5(
  p_sample_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_count INTEGER := 0;
  v_ok_count INTEGER := 0;
  v_mismatch_count INTEGER := 0;
  v_missing_count INTEGER := 0;
  v_sample_mismatch_user_ids JSONB := '[]'::jsonb;
  v_sample_missing_user_ids JSONB := '[]'::jsonb;
BEGIN
  SELECT COUNT(*) INTO v_target_count
  FROM public.profiles p
  WHERE p.subscription_status = 'active';

  SELECT COUNT(*) INTO v_missing_count
  FROM public.profiles p
  LEFT JOIN public.user_credits uc ON uc.user_id = p.user_id
  WHERE p.subscription_status = 'active'
    AND uc.user_id IS NULL;

  SELECT COUNT(*) INTO v_ok_count
  FROM public.profiles p
  JOIN public.user_credits uc ON uc.user_id = p.user_id
  WHERE p.subscription_status = 'active'
    AND uc.tier = 'basic'
    AND uc.monthly_credits_per_cycle = 5
    AND uc.monthly_credits_used = 0
    AND uc.bonus_credits_total = 0
    AND uc.bonus_credits_used = 0;

  SELECT COUNT(*) INTO v_mismatch_count
  FROM public.profiles p
  JOIN public.user_credits uc ON uc.user_id = p.user_id
  WHERE p.subscription_status = 'active'
    AND NOT (
      uc.tier = 'basic'
      AND uc.monthly_credits_per_cycle = 5
      AND uc.monthly_credits_used = 0
      AND uc.bonus_credits_total = 0
      AND uc.bonus_credits_used = 0
    );

  SELECT COALESCE(jsonb_agg(s.user_id), '[]'::jsonb) INTO v_sample_missing_user_ids
  FROM (
    SELECT p.user_id
    FROM public.profiles p
    LEFT JOIN public.user_credits uc ON uc.user_id = p.user_id
    WHERE p.subscription_status = 'active'
      AND uc.user_id IS NULL
    ORDER BY p.user_id
    LIMIT GREATEST(0, LEAST(COALESCE(p_sample_limit, 50), 200))
  ) s;

  SELECT COALESCE(jsonb_agg(s.user_id), '[]'::jsonb) INTO v_sample_mismatch_user_ids
  FROM (
    SELECT p.user_id
    FROM public.profiles p
    JOIN public.user_credits uc ON uc.user_id = p.user_id
    WHERE p.subscription_status = 'active'
      AND NOT (
        uc.tier = 'basic'
        AND uc.monthly_credits_per_cycle = 5
        AND uc.monthly_credits_used = 0
        AND uc.bonus_credits_total = 0
        AND uc.bonus_credits_used = 0
      )
    ORDER BY p.user_id
    LIMIT GREATEST(0, LEAST(COALESCE(p_sample_limit, 50), 200))
  ) s;

  RETURN jsonb_build_object(
    'ok', true,
    'target_count', v_target_count,
    'ok_count', v_ok_count,
    'mismatch_count', v_mismatch_count,
    'missing_count', v_missing_count,
    'sample_missing_user_ids', v_sample_missing_user_ids,
    'sample_mismatch_user_ids', v_sample_mismatch_user_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_verify_active_accounts_free_5(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_verify_active_accounts_free_5(INTEGER) TO service_role;
