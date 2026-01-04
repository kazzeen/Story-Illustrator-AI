DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_credits_balance_nonnegative'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_credits_balance_nonnegative
      CHECK (credits_balance >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_credits_monthly_per_cycle_matches_tier'
  ) THEN
    ALTER TABLE public.user_credits
      ADD CONSTRAINT user_credits_monthly_per_cycle_matches_tier
      CHECK (monthly_credits_per_cycle = public._credits_per_cycle_for_tier(tier));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ensure_profile_credits_initialized()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_user_credits(NEW.user_id);
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'credits_initialization_failed' USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS ensure_profile_credits_initialized_on_insert ON public.profiles;
CREATE TRIGGER ensure_profile_credits_initialized_on_insert
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.ensure_profile_credits_initialized();

DROP TRIGGER IF EXISTS ensure_profile_credits_initialized_on_activation ON public.profiles;
CREATE TRIGGER ensure_profile_credits_initialized_on_activation
  AFTER UPDATE OF subscription_status ON public.profiles
  FOR EACH ROW
  WHEN (NEW.subscription_status = 'active' AND (OLD.subscription_status IS DISTINCT FROM 'active'))
  EXECUTE FUNCTION public.ensure_profile_credits_initialized();

CREATE OR REPLACE FUNCTION public.admin_init_active_accounts_free_5(
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
  v_missing_count INTEGER := 0;
  v_initialized_count INTEGER := 0;
  v_fixed_basic_count INTEGER := 0;
  r RECORD;
BEGIN
  SELECT COUNT(*) INTO v_target_count
  FROM public.profiles p
  WHERE p.subscription_status = 'active';

  SELECT COUNT(*) INTO v_missing_count
  FROM public.profiles p
  LEFT JOIN public.user_credits uc ON uc.user_id = p.user_id
  WHERE p.subscription_status = 'active'
    AND uc.user_id IS NULL;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'run_id', v_run_id,
      'target_count', v_target_count,
      'missing_count', v_missing_count
    );
  END IF;

  FOR r IN
    SELECT p.user_id
    FROM public.profiles p
    LEFT JOIN public.user_credits uc ON uc.user_id = p.user_id
    WHERE p.subscription_status = 'active'
      AND uc.user_id IS NULL
  LOOP
    PERFORM public.ensure_user_credits(r.user_id);
    v_initialized_count := v_initialized_count + 1;
  END LOOP;

  UPDATE public.user_credits uc
  SET monthly_credits_per_cycle = 5
  FROM public.profiles p
  WHERE p.user_id = uc.user_id
    AND p.subscription_status = 'active'
    AND uc.tier = 'basic'
    AND uc.monthly_credits_per_cycle IS DISTINCT FROM 5
    AND uc.monthly_credits_used = 0
    AND uc.bonus_credits_total = 0
    AND uc.bonus_credits_used = 0
    AND uc.cycle_source = 'profile_created';

  GET DIAGNOSTICS v_fixed_basic_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'run_id', v_run_id,
    'target_count', v_target_count,
    'missing_count', v_missing_count,
    'initialized_count', v_initialized_count,
    'fixed_basic_count', v_fixed_basic_count,
    'created_by', p_created_by
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_init_active_accounts_free_5(BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_init_active_accounts_free_5(BOOLEAN, UUID) TO service_role;

SELECT public.admin_init_active_accounts_free_5(FALSE, NULL);
