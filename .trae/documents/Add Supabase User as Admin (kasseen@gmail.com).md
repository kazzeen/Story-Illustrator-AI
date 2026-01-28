## Why “Add My User As Admin” Isn’t Working Today
- Your admin system is **separate** from normal Supabase Auth users: admin access is stored in `public.admin_accounts` (username + bcrypt hash) and sessions in `public.admin_sessions`.
- A Supabase Auth user (like `kasseen@gmail.com`) does **not** automatically become an admin, and there’s no safe way to “reuse” their existing password hash because Supabase Auth password hashes aren’t accessible.

## Easiest Reliable Fix
Implement **Admin SSO**: if you are already signed in as a normal user, the admin site can create an admin session for you.
- You sign in normally at `/auth` using your existing account.
- On `/admin/login`, you click **“Continue as kasseen@gmail.com”** (or “Continue with current account”).
- The frontend sends your **Supabase access token** to the admin Edge Function.
- The Edge Function validates the token, checks whether the email is allowed, inserts `kasseen@gmail.com` into `admin_accounts` if needed, then issues the normal admin session cookies/token.

## Backend Changes (Supabase Edge Function)
1. Add a new endpoint `POST /sso` in `supabase/functions/api-admin/index.ts`.
2. Validate the caller’s Supabase Auth JWT via `supabase.auth.getUser(jwt)`.
3. Authorization logic:
   - If email exists in `admin_accounts`, allow.
   - Else, if email is in an env allowlist `ADMIN_BOOTSTRAP_EMAILS` (comma-separated) and includes `kasseen@gmail.com`, auto-create the admin account using `admin_create_account(email, <random strong password>)`, then allow.
4. Create an admin session exactly like the existing password login flow and return `{ ok: true, username, sessionToken, csrfToken }` + set cookies.

## Frontend Changes (Admin Login UI)
1. Update `src/pages/admin/AdminLogin.tsx`:
   - If a Supabase user session exists (`useAuth().session`), show a “Continue as …” button.
   - Clicking it calls the admin API `/api/admin/sso` (which will fall back to Supabase functions), passing `Authorization: Bearer <supabase access_token>`.
2. Reuse the existing `AdminProvider` to store the returned admin session token and redirect to `/admin`.

## Configuration Needed
- Add a Supabase Function secret (not committed to git):
  - `ADMIN_BOOTSTRAP_EMAILS=kasseen@gmail.com`

## Testing (My Verification)
1. Local:
   - Create a local Supabase user for `kasseen@gmail.com` (or use existing).
   - Sign in at `/auth`.
   - Go to `/admin/login` and use “Continue as …”; verify redirect to `/admin` and `/api-admin/session` returns ok.
2. Deployed:
   - Same flow on `https://story-illustrator-ai.vercel.app`.
   - Validate in Network tab that `/functions/v1/api-admin/sso` returns 200 and session persists.

If you confirm, I’ll implement the SSO endpoint + UI button, add a small smoke script for `/sso`, deploy the Edge Function + frontend, and verify end-to-end using the real account `kasseen@gmail.com`.