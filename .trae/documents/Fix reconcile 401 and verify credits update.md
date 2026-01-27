## What’s Actually Failing
- `reconcile-stripe-checkout` is still returning **401**.
- In the current Edge Function code, it calls `authClient.auth.getUser()` **without passing the JWT**. In Supabase JS v2 on server/Edge, `getUser()` without an explicit token can fail because there is no stored session, even if you set `global.headers`.
- That explains a persistent 401 even after redeploy.

## Fix 1: Make reconcile validate the JWT correctly (Backend)
1. In [reconcile-stripe-checkout/index.ts](file:///d:/Projects/SIAI%20Lovable/supabase/functions/reconcile-stripe-checkout/index.ts#L84-L99), change user lookup to explicitly pass the JWT:
   - Use the service-role client and call `admin.auth.getUser(token)` (or `authClient.auth.getUser(token)`).
   - Remove reliance on implicit session/global header for user resolution.
2. Keep current config validation (requires `SUPABASE_SERVICE_ROLE_KEY` and `STRIPE_SECRET_KEY`).

## Fix 2: Improve client-side diagnostics for non-2xx bodies (Frontend)
1. In [Pricing.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/Pricing.tsx#L446-L456), if the error body is a `ReadableStream`, read it (`await new Response(stream).text()`) and attempt JSON parse.
2. Include parsed `{error, details}` in the toast message so we can immediately tell whether it’s:
   - “Missing Authorization header”
   - “Authorization failed”
   - “Session does not belong to current user” (403)

## Deployment
- Redeploy the updated `reconcile-stripe-checkout` Edge Function.

## Thorough Testing
1. Run locally:
   - `npm run typecheck`
   - `npm test`
2. Manual validation:
   - Complete a subscription checkout → return to `/pricing?checkout=success&session_id=...`.
   - Confirm reconcile no longer 401s.
   - Confirm `credits` status shows updated tier + credits and the “Checkout complete” toast fires.

If you approve, I’ll implement these changes, redeploy the function, and re-run the full test suite before finishing.