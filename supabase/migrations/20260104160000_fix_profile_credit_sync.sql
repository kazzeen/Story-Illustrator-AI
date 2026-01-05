CREATE OR REPLACE FUNCTION public.sync_user_credits_to_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance INTEGER;
  v_subscription_tier TEXT;
BEGIN
  v_balance := GREATEST(
    (NEW.monthly_credits_per_cycle - NEW.monthly_credits_used - COALESCE(NEW.reserved_monthly, 0)) +
    (NEW.bonus_credits_total - NEW.bonus_credits_used - COALESCE(NEW.reserved_bonus, 0)),
    0
  );

  v_subscription_tier := CASE
    WHEN NEW.tier = 'basic' THEN 'free'
    ELSE NEW.tier::text
  END;

  UPDATE public.profiles
  SET
    credits_balance = v_balance,
    subscription_tier = v_subscription_tier,
    next_billing_date = NEW.cycle_end_at
  WHERE user_id = NEW.user_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_credits_to_profile_trigger ON public.user_credits;
CREATE TRIGGER sync_credits_to_profile_trigger
  AFTER INSERT OR UPDATE OF
    tier,
    cycle_end_at,
    monthly_credits_per_cycle,
    monthly_credits_used,
    bonus_credits_total,
    bonus_credits_used,
    reserved_monthly,
    reserved_bonus
  ON public.user_credits
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_credits_to_profile();

UPDATE public.profiles p
SET
  credits_balance = GREATEST(
    (uc.monthly_credits_per_cycle - uc.monthly_credits_used - COALESCE(uc.reserved_monthly, 0)) +
    (uc.bonus_credits_total - uc.bonus_credits_used - COALESCE(uc.reserved_bonus, 0)),
    0
  ),
  subscription_tier = CASE WHEN uc.tier = 'basic' THEN 'free' ELSE uc.tier::text END,
  next_billing_date = uc.cycle_end_at
FROM public.user_credits uc
WHERE uc.user_id = p.user_id;

