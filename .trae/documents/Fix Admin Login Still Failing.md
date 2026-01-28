## What’s Most Likely Happening
1. The browser is still getting a non-200 from `/api/admin/login` (401/404/500), but the UI only shows a generic “Sign in failed”.
2. Or you’re testing a deployed environment that does not yet include the latest backend/frontend changes (function deploy + frontend build), so it still behaves like before.
3. Or cookies are not being stored/sent (HTTPS/SameSite/secure/cross-domain), causing `/api/admin/session` to immediately return 401 even after a successful login.

## Investigation (No-Guessing)
1. Reproduce the failure in the same environment you’re using (local vs deployed).
2. Inspect the browser Network tab for the **exact** response from `POST /api/admin/login`:
   - status code
   - JSON body `{ error: ... }`
   - whether `Set-Cookie` headers are present
3. Inspect `GET /api/admin/session` right after login:
   - status code + JSON body
   - whether the request includes cookies and/or an `Authorization: Bearer ...` header

## Fix Implementation
1. Backend hardening (api-admin Edge Function)
   - Ensure the admin API is enabled by default unless explicitly disabled.
   - Ensure login sets session cookies correctly for HTTP vs HTTPS.
   - Ensure login response includes a `sessionToken` that can be used as a bearer token fallback.
   - Ensure `/session` and `/logout` accept either cookie token or bearer token.
2. Frontend hardening (AdminProvider)
   - Store `sessionToken` + `csrfToken` in `sessionStorage`.
   - Send `Authorization: Bearer <sessionToken>` on all `/api/admin/*` calls as a fallback when cookies fail.
   - Improve UI error reporting so “Sign in failed” shows the real server error string and HTTP code.

## Verification
1. Automated verification
   - Run `npm run typecheck` and `npm run test`.
2. Real login verification
   - Make a real login request in the browser and confirm:
     - `POST /api/admin/login` returns 200
     - `GET /api/admin/session` returns 200
     - navigating to `/admin` works (no redirect loop)

## Deployment (If You’re Testing a Hosted Site)
1. Deploy the updated `api-admin` function.
2. Rebuild/redeploy the frontend so it includes the token fallback changes.

If you confirm this plan, I’ll implement the backend+frontend changes and then verify the login end-to-end in the running dev server (and describe what to check for your deployed environment if that’s where you’re testing).