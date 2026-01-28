## Root Cause
Your deployed admin login page is hard-coded to only treat `kasseen@gmail.com` as authorized. If you’re logged in as any other “administrative” account, the UI shows **Restricted Access**, and `/admin` keeps redirecting you back to `/admin/login?redirect=%2Fadmin`.

Separately, the app currently does not load `profiles.is_admin` into the auth context, so the frontend cannot reliably detect “this signed-in user is an admin” and auto-establish an admin session.

## What I’ll Implement
### 1) Load admin privilege flag into the user profile
- Extend the `UserProfile` type to include `is_admin`.
- Update the `profiles` select in `AuthProvider` to include `is_admin` in both the “credits” and “basic” selects.

### 2) Treat any `profiles.is_admin=true` user as authorized on AdminLogin
- Replace the hard-coded `user.email === "kasseen@gmail.com"` checks with a computed `isAuthorizedAdmin = profile?.is_admin === true || user.email === "kasseen@gmail.com"`.
- When a signed-in user is `isAuthorizedAdmin`, the Admin Login page will automatically call the secure bypass flow (mint admin session) once, then redirect to the dashboard.

### 3) Stop the redirect loop at the route guard
- Update `RequireAdmin` to use the normal auth context:
  - If the user is signed in and `profile.is_admin === true` but there’s no admin session yet, redirect to `/admin/bypass?redirect=...` (one-shot session mint) instead of `/admin/login`.
  - Otherwise keep the normal `/admin/login?redirect=...` behavior.

### 4) Verification
- Run `npm run typecheck`.
- Local smoke test:
  - Sign in as an admin-flagged user (`profiles.is_admin=true`) and navigate to `/admin`.
  - Confirm it lands in the dashboard without bouncing.
  - Confirm a non-admin user is redirected to `/admin/login` and remains blocked.

## Notes
- This does not create a public backdoor: the bypass endpoint still requires a valid Supabase JWT and a server-side admin check.
- This change specifically targets the production loop you see at `https://story-illustrator-ai.vercel.app/admin/login?redirect=%2Fadmin` by making the app auto-establish the admin session whenever the signed-in user is an admin.