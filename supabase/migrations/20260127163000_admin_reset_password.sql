DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
END $$;

INSERT INTO public.admin_accounts (username, password_hash, is_protected)
VALUES ('admin@siai.com', extensions.crypt('Kasseen77', extensions.gen_salt('bf')), TRUE)
ON CONFLICT (username) DO UPDATE
SET password_hash = EXCLUDED.password_hash,
    is_protected = TRUE,
    updated_at = now();

