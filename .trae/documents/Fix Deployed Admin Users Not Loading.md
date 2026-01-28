## Root Cause
- In production on Vercel, requests to `/api/admin/*` are being served the SPA HTML (`index.html`) instead of JSON (due to missing backend routes + Vercel rewrites). The admin UI then attempts to parse HTML as JSON, producing `Unexpected token '<'`.

## Code Changes
1. **Harden the admin API client to detect “HTML pretending to be JSON”**
   - Update [admin-provider.tsx](file:///d:/Projects/SIAI%20Lovable/src/hooks/admin-provider.tsx) `fetchJson()` to:
     - Read the response body safely.
     - If JSON parsing fails, throw a structured `AdminApiError` (treated as a non-JSON response) so fallback logic triggers.

2. **Prefer Supabase Functions gateway for admin endpoints in production**
   - Update [admin-provider.tsx](file:///d:/Projects/SIAI%20Lovable/src/hooks/admin-provider.tsx) `api()` so that for paths starting with `/api/admin` it will:
     - Use the Supabase Functions gateway (`{VITE_SUPABASE_URL}/functions/v1/api-admin/*`) as the primary path when running on non-localhost / production builds.
     - Keep same-origin as a fallback for local dev or environments that actually host `/api/admin/*`.

3. **Ensure all admin pages use the centralized client**
   - Confirm [AdminUsers.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/admin/AdminUsers.tsx), [AdminAuditLogs.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/admin/AdminAuditLogs.tsx), and [AdminUserDetails.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/admin/AdminUserDetails.tsx) only call `adminApi(...)` (no direct `fetch`), so production always benefits from gateway + HTML detection.

4. **Optional: tighten Vercel rewrites** (only if needed)
   - If production still serves HTML for `/api/admin/*`, adjust [vercel.json](file:///d:/Projects/SIAI%20Lovable/vercel.json) to avoid SPA rewriting `/api/admin/*` to `index.html`.

## Verification
- Add/extend a unit test in [admin-provider.test.tsx](file:///d:/Projects/SIAI%20Lovable/src/hooks/admin-provider.test.tsx) that simulates a `200 text/html` (or JSON parse failure) from `/api/admin/users` and asserts the client falls back to the Functions gateway.
- Run `npm run typecheck` and `npm test`.

## Expected Outcome
- On the deployed site, `/admin/users` loads successfully because it consistently routes through Supabase Functions (and never tries to JSON-parse Vercel’s SPA HTML).