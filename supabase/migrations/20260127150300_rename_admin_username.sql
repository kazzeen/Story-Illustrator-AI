DO $$
DECLARE
  v_old TEXT := 'admin';
  v_new TEXT := 'admin@siai.com';
  v_hash TEXT;
BEGIN
  SELECT password_hash INTO v_hash
  FROM public.admin_accounts
  WHERE username = v_old;

  IF v_hash IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.admin_accounts WHERE username = v_new) THEN
      INSERT INTO public.admin_accounts (username, password_hash, is_protected)
      SELECT v_new, password_hash, is_protected
      FROM public.admin_accounts
      WHERE username = v_old;
    END IF;

    UPDATE public.admin_sessions
    SET admin_username = v_new
    WHERE admin_username = v_old;

    UPDATE public.audit_logs
    SET admin_username = v_new
    WHERE admin_username = v_old;

    UPDATE public.plan_history
    SET admin_username = v_new
    WHERE admin_username = v_old;

    DELETE FROM public.admin_accounts
    WHERE username = v_old;
  END IF;
END $$;
