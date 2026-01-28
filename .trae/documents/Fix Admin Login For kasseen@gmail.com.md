## What’s Happening
- The admin dashboard uses a **separate admin auth system** (table `admin_accounts` + sessions), not your normal Supabase user password.
- The error you’re seeing (`invalid_credentials (HTTP 401)`) comes from the **password-based admin login endpoint** (`POST /api-admin/login`) when the submitted username/password doesn’t match an entry in `admin_accounts` ([api-admin/index.ts](file:///D:/Projects/SIAI%20Lovable/supabase/functions/api-admin/index.ts#L393-L431), [admin_auth_rpcs.sql](file:///D:/Projects/SIAI%20Lovable/supabase/migrations/20260127150100_admin_auth_rpcs.sql#L26-L42)).
- For `kasseen@gmail.com`, the intended flow is **SSO** (click “Continue as kasseen@gmail.com”), but SSO currently only auto-creates an admin account if `ADMIN_BOOTSTRAP_EMAILS` includes the email ([api-admin/index.ts](file:///D:/Projects/SIAI%20Lovable/supabase/functions/api-admin/index.ts#L361-L390)). If that env var isn’t set for your Edge Function environment, SSO won’t bootstrap.

## Goal
Make `kasseen@gmail.com` able to log into the admin dashboard reliably via SSO (no separate admin password needed).

## Changes I’ll Make
### 1) Backend: allow SSO bootstrap for authorized emails
Update [api-admin/index.ts](file:///D:/Projects/SIAI%20Lovable/supabase/functions/api-admin/index.ts) so that when `/sso` is called:
- If `admin_accounts` doesn’t have the email yet, it can still create it when the email is allowed.
- “Allowed” will include:
  - `ADMIN_BOOTSTRAP_EMAILS` list (existing behavior), OR
  - `email === "kasseen@gmail.com"` (explicit allow for your admin account)

This ensures SSO works immediately even if env vars weren’t configured yet.

### 2) Frontend: prevent accidental password-login for kasseen@gmail.com
Update [AdminLogin.tsx](file:///D:/Projects/SIAI%20Lovable/src/pages/admin/AdminLogin.tsx) so that when the signed-in user email is `kasseen@gmail.com`:
- The UI strongly prefers the SSO button.
- The password form is hidden behind a “Use password instead” toggle (so you don’t accidentally hit the wrong flow and get `invalid_credentials`).

## Verification
- Use the existing “Continue as kasseen@gmail.com” button and confirm it creates an admin session and navigates to `/admin`.
- Confirm `/api/admin/session` returns `{ ok: true, username: "kasseen@gmail.com" }` afterward.
