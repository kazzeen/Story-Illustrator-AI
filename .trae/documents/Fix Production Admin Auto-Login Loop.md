## What’s Actually Happening (Why You Keep Getting Sent Back)
- On `https://story-illustrator-ai.vercel.app/admin/login?redirect=%2Fadmin` the UI is showing **Restricted Access** (meaning the app does not recognize you as an authorized admin user on the frontend).
- That causes `/admin` to continuously redirect back to `/admin/login?redirect=/admin` because there is no valid admin session.
- The most common production causes are:
  1) The Vercel deployment is still running an older build where admin access is hard-coded to a single email.
  2) You are not actually signed into Supabase on that domain (no normal user session), so the admin session cannot be auto-created.
  3) Vercel `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` mismatch causes the app to clear the stored Supabase auth token (see `siai:supabase-fingerprint:v1` behavior in [client.ts](file:///D:/Projects/SIAI%20Lovable/src/integrations/supabase/client.ts)).

## Changes I Will Implement
### 1) Ensure the deployed frontend auto-detects admins via `profiles.is_admin`
- Use `profiles.is_admin` (not a hard-coded email) to determine admin authorization.
- If a logged-in user is `is_admin=true`, automatically mint the admin session via `/admin/bypass` and redirect into the dashboard.

### 2) Make `/admin` route guard auto-route verified admins to bypass
- If user is logged in and `profiles.is_admin=true`, redirect to `/admin/bypass?redirect=…` (instead of `/admin/login`) to avoid looping.

### 3) Production deployment checks (Vercel)
- Verify Vercel env vars match your Supabase project:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`
  If these change, the app intentionally clears the stored Supabase auth token and you’ll appear logged out.
- Verify Supabase Auth settings include your Vercel domain as an allowed site/redirect.

### 4) Admin account verification
- Ensure your admin user’s profile has `profiles.is_admin = true` in production.

## Verification Steps
- Deploy the updated frontend to Vercel.
- In production browser:
  - Sign in at `/auth`.
  - Visit `/admin`.
  - Confirm you are redirected once to `/admin/bypass` and then land in `/admin` without bouncing.
  - Confirm a non-admin remains blocked.

If you confirm this plan, I’ll proceed to implement any remaining code changes and also provide the exact Vercel/Supabase settings checklist to eliminate the loop permanently.