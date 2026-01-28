INSERT INTO public.admin_accounts (username, password_hash, is_protected)
SELECT
  'kasseen@gmail.com',
  a.password_hash,
  TRUE
FROM public.admin_accounts a
WHERE a.username = 'admin@siai.com'
ON CONFLICT (username) DO UPDATE
SET
  password_hash = EXCLUDED.password_hash,
  is_protected = TRUE,
  updated_at = now();

