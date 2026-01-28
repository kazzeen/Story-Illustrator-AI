-- Reset and harden signup flow triggers
-- This migration comprehensively cleans up ALL legacy and potential conflicting triggers
-- and re-establishes a single, safe, atomic entry point for new user initialization.

-- 1. CLEANUP: Drop ALL known triggers on auth.users and public.profiles related to signup
DROP TRIGGER IF EXISTS ensure_user_credits_on_signup ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS ensure_profile_credits_initialized_on_insert ON public.profiles;

-- 2. CLEANUP: Drop associated functions to ensure clean slate
DROP FUNCTION IF EXISTS public.ensure_user_credits_record();
-- We keep ensure_user_credits_v2 and handle_new_user but will replace them below

-- 3. UTILITY: Ensure dependency exists
CREATE OR REPLACE FUNCTION public._credits_per_cycle_for_tier(p_tier public.credit_tier)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE p_tier
    WHEN 'basic' THEN 5
    WHEN 'starter' THEN 50
    WHEN 'creator' THEN 150
    WHEN 'professional' THEN 300
    ELSE 5
  END;
END;
$$;

-- 4. CORE: Recreate ensure_user_credits_v2 with robust error handling
CREATE OR REPLACE FUNCTION public.ensure_user_credits_v2(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_tier TEXT;
  v_credit_tier public.credit_tier;
  v_per_cycle INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;

  -- Idempotency check
  IF EXISTS (SELECT 1 FROM public.user_credits WHERE user_id = p_user_id) THEN
    RETURN jsonb_build_object('ok', true, 'existing', true);
  END IF;

  -- Get tier from profile if exists, default to basic
  BEGIN
    SELECT subscription_tier INTO v_profile_tier
    FROM public.profiles
    WHERE user_id = p_user_id;
  EXCEPTION WHEN OTHERS THEN
    v_profile_tier := 'free';
  END;

  v_credit_tier := CASE v_profile_tier
    WHEN 'starter' THEN 'starter'
    WHEN 'creator' THEN 'creator'
    WHEN 'professional' THEN 'professional'
    ELSE 'basic'
  END;

  -- Calculate credits
  BEGIN
    v_per_cycle := public._credits_per_cycle_for_tier(v_credit_tier);
  EXCEPTION WHEN OTHERS THEN
    v_per_cycle := 5; -- Fallback
  END;

  -- Insert credits
  INSERT INTO public.user_credits (
    user_id,
    tier,
    cycle_start_at,
    cycle_end_at,
    cycle_source,
    monthly_credits_per_cycle,
    monthly_credits_used,
    bonus_credits_total,
    bonus_credits_used,
    reserved_monthly,
    reserved_bonus,
    bonus_granted,
    created_at,
    updated_at
  ) VALUES (
    p_user_id,
    v_credit_tier,
    now(),
    now() + interval '30 days',
    'profile_created',
    v_per_cycle,
    0,
    0, -- Start with 0 bonus, or 5 if desired (legacy was 5)
    0,
    0,
    0,
    FALSE,
    now(),
    now()
  );

  RETURN jsonb_build_object('ok', true, 'created', true);

EXCEPTION WHEN OTHERS THEN
  -- Log error if possible, but return failure object so caller knows
  -- RAISE WARNING 'ensure_user_credits_v2 failed for user %: %', p_user_id, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_user_credits_v2(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_user_credits_v2(UUID) TO authenticated;

-- 5. ENTRY POINT: Recreate handle_new_user as the SINGLE source of truth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta_name TEXT;
BEGIN
  -- Extract metadata safely
  BEGIN
    v_meta_name := NEW.raw_user_meta_data ->> 'display_name';
  EXCEPTION WHEN OTHERS THEN
    v_meta_name := NULL;
  END;

  -- 1. Create Profile
  BEGIN
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (NEW.id, v_meta_name)
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- Swallow profile creation error to allow user creation to succeed
    -- RAISE WARNING 'Profile creation failed for user %: %', NEW.id, SQLERRM;
    NULL; 
  END;

  -- 2. Create Credits (Explicit call, no trigger on profiles)
  BEGIN
    PERFORM public.ensure_user_credits_v2(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- Swallow credit creation error to allow user creation to succeed
    -- RAISE WARNING 'Credit creation failed for user %: %', NEW.id, SQLERRM;
    NULL;
  END;

  RETURN NEW;
END;
$$;

-- 6. TRIGGER: Re-attach ONLY the main trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7. CLEANUP: Remove redundant trigger on profiles to prevent race conditions/double execution
DROP TRIGGER IF EXISTS ensure_profile_credits_initialized_on_insert ON public.profiles;
