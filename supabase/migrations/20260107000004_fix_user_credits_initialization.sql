-- Migration to fix user credit initialization issues
-- This addresses the "no_user_credits" error preventing image generation

-- First, let's ensure the ensure_user_credits_record function is properly created
CREATE OR REPLACE FUNCTION public.ensure_user_credits_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if user_credits record exists for the new user
  IF NOT EXISTS (
    SELECT 1 FROM public.user_credits 
    WHERE user_id = NEW.id
  ) THEN
    -- Create user_credits record with default values
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
    
    RAISE NOTICE 'Created user_credits record for user %', NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Ensure the trigger exists and is properly configured
DROP TRIGGER IF EXISTS ensure_user_credits_on_signup ON auth.users;

CREATE TRIGGER ensure_user_credits_on_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_user_credits_record();

-- Create records for existing users that don't have them
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
  10, -- Default monthly credits for existing users
  0,
  5, -- Bonus credits for existing users
  0,
  0,
  0,
  now(),
  now()
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_credits uc 
  WHERE uc.user_id = u.id
);

-- Add comment for documentation
COMMENT ON FUNCTION public.ensure_user_credits_record() IS 
  'Automatically creates user_credits record when a new user signs up, ensuring they have credits available for image generation.';

-- Create an admin function to manually create user credits if needed
CREATE OR REPLACE FUNCTION public.create_user_credits(
  p_user_id UUID,
  p_monthly_credits INTEGER DEFAULT 10,
  p_bonus_credits INTEGER DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Check if user already has credits
  IF EXISTS (
    SELECT 1 FROM public.user_credits 
    WHERE user_id = p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'user_already_has_credits');
  END IF;

  -- Create user_credits record
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
    p_user_id,
    p_monthly_credits,
    0,
    p_bonus_credits,
    0,
    0,
    0,
    now(),
    now()
  );

  RETURN jsonb_build_object('ok', true, 'message', 'User credits created successfully');
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_user_credits(UUID, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_user_credits(UUID, INTEGER, INTEGER) TO authenticated;