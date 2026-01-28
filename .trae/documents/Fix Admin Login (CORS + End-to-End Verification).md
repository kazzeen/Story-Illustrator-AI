## What’s Most Likely Broken
- The deployed site’s `/api/admin/login` is returning 405 (so the UI must fall back to calling the Supabase Edge Function directly).
- If the Edge Function’s responses are missing `Access-Control-Allow-Origin` / `Access-Control-Allow-Credentials`, the browser will block the request, making login fail even though the credentials are correct.
- In this codebase, the most likely culprit is the Edge Function `json()` helper merging headers incorrectly (object-spreading a `Headers` instance drops all headers). That would strip CORS + `Set-Cookie` on login/logout responses.

## Codebase Analysis (Read-Only)
- Admin UI calls `/api/admin/*` and, on certain failures, falls back to `https://<ref>.functions.supabase.co/api-admin/*`.
- CORS is implemented inside `supabase/functions/api-admin/index.ts` via `withCors(req)` and preflight handling.
- Login/logout append cookies by passing a `Headers` object into `json(...)`, which is where headers can be lost if `json()` merges incorrectly.

## Fix
1. Update the Edge Function `json()` helper to merge response headers using `new Headers(headers)` and then set `Content-Type`.
2. Keep existing `withCors(req)` behavior (echo origin, allow credentials when origin is present).
3. (If needed) tighten fallback logic in `src/hooks/admin-provider.tsx` to ensure it falls back on 405/404 and clearly surfaces the upstream error.

## Verification (My Own Tests)
1. Add a small Node smoke-test script (e.g., `scripts/admin-login-smoke.mjs`) that:
   - Calls `https://<ref>.functions.supabase.co/api-admin/login` with an `Origin` header set to:
     - `http://localhost:5173`
     - `https://story-illustrator-ai.vercel.app`
   - Asserts the response includes:
     - `access-control-allow-origin` matching the Origin
     - `access-control-allow-credentials: true`
   - Verifies `{ ok: true }` for the admin credentials.
   - Uses the returned `sessionToken` to call `/api-admin/session` with `Authorization: Bearer …` and asserts `{ ok: true }`.
2. Local end-to-end check:
   - Start the local dev server.
   - Log in through `/admin/login` and confirm the redirect to `/admin` succeeds (no redirect loop back to login).
3. Deployed end-to-end check:
   - Load `https://story-illustrator-ai.vercel.app/admin/login` and sign in.
   - Confirm session persists and `/admin` loads.

## Deployment
- Deploy the updated `api-admin` Edge Function.
- If any frontend changes are required (fallback/error surfacing), rebuild + redeploy the Vercel frontend.

If you confirm, I’ll implement the fix, deploy it, and run the smoke test + local/deployed login checks before finishing.