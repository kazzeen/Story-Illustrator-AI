## What’s Happening
- The UI is successfully reaching the `reconcile-stripe-checkout` Edge Function, but it’s returning a non-2xx response (seen as `FunctionsHttpError`).
- When that happens, credits/plan won’t update locally unless the Stripe webhook already processed successfully.
- Right now the UI log isn’t showing the actual HTTP status and JSON error payload, so we can’t see whether it’s a 400 (bad session_id), 401/403 (auth/session mismatch), 404 (function not deployed), or 500 (missing Edge Function secrets / RPC failure).

## Fix 1: Surface the Real Edge Function Error (Frontend)
1. Update [Pricing.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/Pricing.tsx) reconcile catch block to log **status + response body** for `FunctionsHttpError`.
2. Improve `summarizeFunctionError()` to properly decode:
   - `context.status`
   - `context.body.error`, `context.body.details`
   - `context.body.missing` when it’s an **object of booleans** (like `{stripeSecretKey: true}`), not just an array.
3. Update the toast shown on reconcile failure to include the decoded error (so you immediately see e.g. `HTTP 500 - Missing configuration: STRIPE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY`).

## Fix 2: Make reconcile-stripe-checkout Return Clear Missing-Config Details (Backend)
1. Update [reconcile-stripe-checkout/index.ts](file:///d:/Projects/SIAI%20Lovable/supabase/functions/reconcile-stripe-checkout/index.ts) config error response to return `missing` as a **string array** of missing env var names (e.g. `["STRIPE_SECRET_KEY","SUPABASE_SERVICE_ROLE_KEY"]`).
2. Keep existing compatibility (still accept both SB_* and SUPABASE_* env vars) but make the payload consistent so the frontend always prints useful info.

## Fix 3: Thorough Testing
1. Add/extend tests to cover the previously failing real-world path:
   - Pricing checkout-return flow shows a clear destructive toast on non-2xx reconcile with decoded details.
   - Pricing signed-out → sign-in → return preserves params and still runs reconcile/poll.
2. Run:
   - `npm run typecheck`
   - `npm test`
3. Manual verification checklist (local):
   - Trigger checkout → complete payment → return to pricing → confirm toast shows either:
     - success with updated credits/tier, or
     - a *specific actionable error* (e.g. missing Edge Function secrets) instead of a generic “non-2xx”.

## Expected Outcome
- If the failure is a configuration issue in Supabase Edge Functions (most commonly missing `STRIPE_SECRET_KEY` and/or `SUPABASE_SERVICE_ROLE_KEY` in the Edge Function environment), the UI will explicitly say so.
- Once those secrets are present, the reconcile call should return 200 and the user’s plan + credits will update, followed by a “Checkout complete” toast.

I’ll implement the code changes above and run the full test suite before finishing.