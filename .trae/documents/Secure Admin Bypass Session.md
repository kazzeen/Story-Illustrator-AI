## Summary
Implement a **secure admin-bypass flow** that lets a user who is already authenticated with Supabase and verified as an admin create an admin dashboard session **without entering the separate admin password**.

This will be a controlled troubleshooting feature:
- Disabled by default via an environment flag.
- Requires a valid Supabase JWT and a server-side admin check.
- Creates the same admin session/cookies as normal login.
- Writes an audit log record with admin user id + timestamp + IP.

## Backend Changes (Supabase Edge Function: api-admin)
### 1) Add `POST /api-admin/bypass`
In [api-admin/index.ts](file:///D:/Projects/SIAI%20Lovable/supabase/functions/api-admin/index.ts):
- Require `ADMIN_BYPASS_ENABLED=true` (otherwise return 404).
- Require `Authorization: Bearer <supabase_user_access_token>`.
- Verify the Supabase user with `admin.auth.getUser(token)`.
- Verify admin status (server-side):
  - Primary: `profiles.is_admin = true` for that `user_id`.
  - Optional allowlist fallback: `ADMIN_BOOTSTRAP_EMAILS` contains the email.
- Ensure an `admin_accounts` row exists for the email (create if missing, same as SSO bootstrapping).

### 2) Create a secure admin session
Reuse the existing `issueAdminSession(req, admin, email)` to generate:
- fresh random `sessionToken` + `csrfToken`
- `admin_session` (httpOnly) + `admin_csrf` cookies
- `admin_sessions` row with `ip_hash` + `user_agent_hash`
This satisfies session-fixation protection because the token is always newly issued.

### 3) Log the bypass event
Insert into `public.audit_logs` (service-role path bypasses RLS) with:
- `action_type = 'admin.bypass'`
- `admin_username = <email>`
- `target_user_id = <supabase_user_id>`
- `after` JSON includes:
  - `ip` (raw)
  - `user_agent`
  - `method = 'bypass'`
  - `allowed_via = 'profile.is_admin' | 'bootstrap_emails'`
This meets the requirement to log admin user id, timestamp (via `created_at`), and IP.

### 4) Rate limit
Apply the existing rate limiter to the bypass route (similar to `/sso` and `/login`) to prevent abuse.

## Frontend Changes (Admin login UI)
In [AdminLogin.tsx](file:///D:/Projects/SIAI%20Lovable/src/pages/admin/AdminLogin.tsx):
- Add a **“Bypass (admin-only)”** button that appears only when the user is already signed in as a normal Supabase user.
- On click:
  - Call `POST /api/admin/bypass` with the Supabase access token.
  - On success, redirect to `/admin`.
- Keep the standard login flow intact; bypass is only for troubleshooting.

## Security Guarantees
- Not a public endpoint: requires an authenticated Supabase JWT.
- Not hard-coded password: server checks admin privilege via DB (`profiles.is_admin`) / allowlist.
- Session fixation resistant: always mints a fresh session token.
- Auditable: writes an `audit_logs` entry each success.

## Tests
Add an integration-style script/test that:
1) Creates a test user with `profiles.is_admin=true`, signs in, calls `/api-admin/bypass`:
   - expect 200 + session cookie/sessionToken response.
   - expect audit log row `action_type='admin.bypass'` for that user.
2) Creates a non-admin user and calls `/api-admin/bypass`:
   - expect 403.
3) Calls `/api-admin/bypass` with no Authorization header:
   - expect 401.
