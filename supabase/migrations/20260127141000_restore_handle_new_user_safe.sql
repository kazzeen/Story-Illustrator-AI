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
