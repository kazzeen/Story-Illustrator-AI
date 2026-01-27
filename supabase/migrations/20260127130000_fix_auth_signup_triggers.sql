DROP TRIGGER IF EXISTS ensure_user_credits_on_signup ON auth.users;
DROP FUNCTION IF EXISTS public.ensure_user_credits_record();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (NEW.id, NEW.raw_user_meta_data ->> 'display_name')
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    PERFORM 1;
  END;

  BEGIN
    PERFORM public.ensure_user_credits_v2(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    PERFORM 1;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
