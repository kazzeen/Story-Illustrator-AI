-- Sync user_credits to profiles.credits_balance
-- This ensures that the cached value in profiles always reflects the authoritative value in user_credits

CREATE OR REPLACE FUNCTION public.sync_user_credits_to_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  -- Calculate total available credits (monthly + bonus - used)
  -- Clamped to 0 minimum
  v_balance := GREATEST(
    (NEW.monthly_credits_per_cycle - NEW.monthly_credits_used) + 
    (NEW.bonus_credits_total - NEW.bonus_credits_used),
    0
  );

  -- Update profiles table
  UPDATE public.profiles
  SET 
    credits_balance = v_balance,
    updated_at = now()
  WHERE user_id = NEW.user_id;

  RETURN NEW;
END;
$$;

-- Create trigger on user_credits
DROP TRIGGER IF EXISTS sync_credits_to_profile_trigger ON public.user_credits;
CREATE TRIGGER sync_credits_to_profile_trigger
  AFTER INSERT OR UPDATE OF 
    monthly_credits_per_cycle, 
    monthly_credits_used, 
    bonus_credits_total, 
    bonus_credits_used
  ON public.user_credits
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_credits_to_profile();

-- Ensure profiles.credits_balance default is 5 (idempotent check)
ALTER TABLE public.profiles 
ALTER COLUMN credits_balance SET DEFAULT 5;

-- One-time backfill: Sync all existing user_credits to profiles
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT 
      user_id, 
      monthly_credits_per_cycle, 
      monthly_credits_used, 
      bonus_credits_total, 
      bonus_credits_used
    FROM public.user_credits
  LOOP
    UPDATE public.profiles
    SET credits_balance = GREATEST(
      (r.monthly_credits_per_cycle - r.monthly_credits_used) + 
      (r.bonus_credits_total - r.bonus_credits_used),
      0
    )
    WHERE user_id = r.user_id;
  END LOOP;
END $$;
