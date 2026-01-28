-- Fix "Database error saving new user" by removing conflicting legacy triggers
-- This legacy trigger tries to insert into user_credits without required cycle_start_at/cycle_end_at fields

DROP TRIGGER IF EXISTS ensure_user_credits_on_signup ON auth.users;
DROP FUNCTION IF EXISTS public.ensure_user_credits_record();

-- Ensure the correct modern trigger is active
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
