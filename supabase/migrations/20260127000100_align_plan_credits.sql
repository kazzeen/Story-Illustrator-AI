CREATE OR REPLACE FUNCTION public._credits_per_cycle_for_tier(p_tier public.credit_tier)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_tier
    WHEN 'basic' THEN 5
    WHEN 'starter' THEN 100
    WHEN 'creator' THEN 200
    WHEN 'professional' THEN 1000
  END;
$$;

UPDATE public.user_credits
SET monthly_credits_per_cycle = public._credits_per_cycle_for_tier(tier)
WHERE tier IN ('starter', 'creator', 'professional');

