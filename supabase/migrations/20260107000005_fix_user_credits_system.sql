-- Migration: Fix user credits system - handles existing tables
-- This migration safely handles cases where tables already exist

-- Drop existing tables if they exist to start fresh
DROP TABLE IF EXISTS public.credit_reservations CASCADE;
DROP TABLE IF EXISTS public.user_credits CASCADE;

-- Create user_credits table for advanced credit management
CREATE TABLE public.user_credits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  monthly_credits_per_cycle INTEGER NOT NULL DEFAULT 10,
  monthly_credits_used INTEGER NOT NULL DEFAULT 0,
  bonus_credits_total INTEGER NOT NULL DEFAULT 5,
  bonus_credits_used INTEGER NOT NULL DEFAULT 0,
  reserved_monthly INTEGER NOT NULL DEFAULT 0,
  reserved_bonus INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create credit_reservations table for tracking credit usage
CREATE TABLE public.credit_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id UUID NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  monthly_credits_used INTEGER NOT NULL DEFAULT 0,
  bonus_credits_used INTEGER NOT NULL DEFAULT 0,
  feature TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'committed', 'released')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_credit_reservations_user_id ON public.credit_reservations(user_id);
CREATE INDEX idx_credit_reservations_request_id ON public.credit_reservations(request_id);
CREATE INDEX idx_credit_reservations_status ON public.credit_reservations(status);
CREATE INDEX idx_credit_reservations_created_at ON public.credit_reservations(created_at);

-- Enable RLS
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_reservations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_credits
CREATE POLICY "Users can view their own credits" ON public.user_credits
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all credits" ON public.user_credits
  FOR ALL USING (public.is_admin());

-- RLS Policies for credit_reservations
CREATE POLICY "Users can view their own reservations" ON public.credit_reservations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all reservations" ON public.credit_reservations
  FOR ALL USING (public.is_admin());

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
DROP TRIGGER IF EXISTS ensure_user_credits_on_signup ON auth.users;
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