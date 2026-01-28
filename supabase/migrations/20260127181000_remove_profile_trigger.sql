-- Remove redundant trigger on profiles that causes transaction failures during signup
-- This trigger is redundant because handle_new_user now explicitly calls ensure_user_credits_v2
DROP TRIGGER IF EXISTS ensure_profile_credits_initialized_on_insert ON public.profiles;
