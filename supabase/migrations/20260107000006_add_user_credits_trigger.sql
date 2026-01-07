-- Migration: Add missing user credits functionality
-- This migration adds the trigger and creates credits for existing users

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS ensure_user_credits_on_signup ON auth.users;

-- Create function to ensure user credits record exists
CREATE OR REPLACE FUNCTION public.ensure_user_credits_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_credits 
    WHERE user_id = NEW.id
  ) THEN
    INSERT INTO public.user_credits (
      user_id,
      monthly_credits_per_cycle,
      monthly_credits_used,
      bonus_credits_total,
      bonus_credits_used,
      reserved_monthly,
      reserved_bonus,
      created_at,
      updated_at
    ) VALUES (
      NEW.id,
      10, -- Default monthly credits
      0,
      5, -- Bonus credits for new users
      0,
      0,
      0,
      now(),
      now()
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger for new user signup
CREATE TRIGGER ensure_user_credits_on_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_user_credits_record();

-- Create credits for all existing users who don't have them
INSERT INTO public.user_credits (
  user_id,
  monthly_credits_per_cycle,
  monthly_credits_used,
  bonus_credits_total,
  bonus_credits_used,
  reserved_monthly,
  reserved_bonus,
  created_at,
  updated_at
)
SELECT 
  u.id,
  10, -- Default monthly credits
  0,
  5, -- Bonus credits for existing users
  0,
  0,
  0,
  now(),
  now()
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_credits uc WHERE uc.user_id = u.id
);