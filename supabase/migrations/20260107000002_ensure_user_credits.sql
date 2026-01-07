-- Migration to ensure all users have user_credits records
-- This fixes the "no_user_credits" error when trying to reserve credits

-- Function to create user_credits record if it doesn't exist
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

-- Create trigger to automatically create user_credits records
DROP TRIGGER IF EXISTS ensure_user_credits_on_signup ON auth.users;

CREATE TRIGGER ensure_user_credits_on_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_user_credits_record();

-- Also create records for existing users that don't have them
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
  SELECT 1 FROM public.user_credits uc 
  WHERE uc.user_id = u.id
);

-- Add comment for documentation
COMMENT ON FUNCTION public.ensure_user_credits_record() IS 
  'Automatically creates user_credits record when a new user signs up, ensuring they have credits available for image generation.';