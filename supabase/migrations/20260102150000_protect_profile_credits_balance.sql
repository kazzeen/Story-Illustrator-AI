REVOKE UPDATE (credits_balance) ON TABLE public.profiles FROM anon;
REVOKE UPDATE (credits_balance) ON TABLE public.profiles FROM authenticated;

CREATE OR REPLACE FUNCTION public.ensure_profile_credits_initialized()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.ensure_user_credits(NEW.user_id);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN NEW;
  END;

  RETURN NEW;
END;
$$;

INSERT INTO public.profiles (user_id, display_name)
SELECT u.id, u.raw_user_meta_data ->> 'display_name'
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1
  FROM public.profiles p
  WHERE p.user_id = u.id
);

UPDATE public.profiles p
SET
  credits_balance = GREATEST(
    (uc.monthly_credits_per_cycle - uc.monthly_credits_used) + (uc.bonus_credits_total - uc.bonus_credits_used),
    0
  ),
  updated_at = now()
FROM public.user_credits uc
WHERE uc.user_id = p.user_id;
