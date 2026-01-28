CREATE OR REPLACE FUNCTION public.admin_create_account(
  p_username TEXT,
  p_password TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_username IS NULL OR btrim(p_username) = '' THEN
    RAISE EXCEPTION 'username_required';
  END IF;
  IF p_password IS NULL OR length(p_password) < 8 THEN
    RAISE EXCEPTION 'password_too_short';
  END IF;

  INSERT INTO public.admin_accounts (username, password_hash, is_protected)
  VALUES (btrim(p_username), extensions.crypt(p_password, extensions.gen_salt('bf')), TRUE)
  ON CONFLICT (username) DO NOTHING;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_verify_account(
  p_username TEXT,
  p_password TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_accounts a
    WHERE a.username = btrim(p_username)
      AND a.password_hash = extensions.crypt(p_password, a.password_hash)
  );
$$;
