-- Migration: Quick fix for user credits
-- This migration adds credits to existing users to fix the "failed to reserve credits" error

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