-- Fix tier credit amounts to match pricing page
-- basic: 5, starter: 100, creator: 200, professional: 1000
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

-- Update any existing users who have stale monthly_credits_per_cycle values
UPDATE public.user_credits
SET monthly_credits_per_cycle = public._credits_per_cycle_for_tier(tier)
WHERE tier IN ('starter', 'creator', 'professional')
  AND monthly_credits_per_cycle != public._credits_per_cycle_for_tier(tier);
