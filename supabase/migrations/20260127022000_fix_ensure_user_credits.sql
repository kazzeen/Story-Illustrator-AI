CREATE OR REPLACE FUNCTION public.ensure_user_credits_v2(
  p_user_id UUID
)
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

  IF EXISTS (SELECT 1 FROM public.user_credits WHERE user_id = p_user_id) THEN
    RETURN jsonb_build_object('ok', true, 'existing', true);
  END IF;

  SELECT subscription_tier INTO v_profile_tier
  FROM public.profiles
  WHERE user_id = p_user_id;

  v_credit_tier := CASE v_profile_tier
    WHEN 'starter' THEN 'starter'
    WHEN 'creator' THEN 'creator'
    WHEN 'professional' THEN 'professional'
    ELSE 'basic'
  END;

  v_per_cycle := public._credits_per_cycle_for_tier(v_credit_tier);

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
    0,
    0,
    0,
    0,
    FALSE,
    now(),
    now()
  );

  RETURN jsonb_build_object('ok', true, 'created', true, 'tier', v_credit_tier, 'monthly_credits_per_cycle', v_per_cycle);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_user_credits_v2(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_user_credits_v2(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_user_credits_v2(UUID) TO authenticated;
