## Why The Admin Login Page “Glitches” / Loops
The redirect loop is caused by a timing bug in the admin route guard:
- [RequireAdmin.tsx](file:///D:/Projects/SIAI%20Lovable/src/components/routing/RequireAdmin.tsx#L11-L25) calls `refreshSession()` but **does not wait for it**.
- `loading` is only true during the AdminProvider’s initial mount; subsequent `refreshSession()` calls don’t set `loading=true`.
- Result: `/admin` often sees `loading=false` and `session=null` for a moment and immediately redirects to `/admin/login`, then the session loads and you get bounced back—appearing like “sign in then forced logout” repeatedly.

## What I’ll Change
### 1) Make `refreshSession()` toggle loading while it runs
Update [admin-provider.tsx](file:///D:/Projects/SIAI%20Lovable/src/hooks/admin-provider.tsx) so that:
- `refreshSession()` sets `loading=true` at start and `loading=false` in `finally`.
- It only clears `session` on definitive auth failures (401/403/404), not on transient network/5xx errors (to avoid flicker).

### 2) Adjust RequireAdmin to rely on refreshed loading state
Keep [RequireAdmin.tsx](file:///D:/Projects/SIAI%20Lovable/src/components/routing/RequireAdmin.tsx) logic, but it will now correctly pause redirects while `refreshSession()` is in-flight because `loading` will be true.

### 3) Stop auto-SSO attempts that can amplify loops
In [AdminLogin.tsx](file:///D:/Projects/SIAI%20Lovable/src/pages/admin/AdminLogin.tsx), remove (or strongly gate) the auto SSO attempt effect so it doesn’t repeatedly try SSO during any navigation loop.

## Verification
- Run `npm run typecheck`.
- Manual flow:
  - Load `/admin` while logged out → single redirect to `/admin/login`.
  - Log in (SSO or password) → stable navigation to `/admin` with no bouncing.
  - Refresh `/admin` → stays in admin without flicker.
