CREATE OR REPLACE FUNCTION public.ensure_profile_credits_initialized()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.ensure_user_credits_v2(NEW.user_id);
  EXCEPTION WHEN OTHERS THEN
    PERFORM 1;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_user_credits_on_signup ON auth.users;
DROP FUNCTION IF EXISTS public.ensure_user_credits_record();

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS ensure_profile_credits_initialized_on_insert ON public.profiles;
CREATE TRIGGER ensure_profile_credits_initialized_on_insert
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.ensure_profile_credits_initialized();

DROP TRIGGER IF EXISTS ensure_profile_credits_initialized_on_activation ON public.profiles;
CREATE TRIGGER ensure_profile_credits_initialized_on_activation
  AFTER UPDATE OF subscription_status ON public.profiles
  FOR EACH ROW
  WHEN (NEW.subscription_status = 'active' AND (OLD.subscription_status IS DISTINCT FROM 'active'))
  EXECUTE FUNCTION public.ensure_profile_credits_initialized();
