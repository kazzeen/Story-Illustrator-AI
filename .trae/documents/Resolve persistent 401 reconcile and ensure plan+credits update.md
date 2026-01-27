## What’s Broken (Root Cause)
- The credits/plan update depends on either:
  - Stripe webhook events reaching `stripe-webhook`, or
  - The post-checkout client “reconcile” call succeeding.
- You are still seeing `reconcile-stripe-checkout` returning **HTTP 401**, which blocks the fallback path. When reconcile fails, nothing applies `apply_stripe_subscription_state`, so the plan/credits stay unchanged.
- Current automated tests pass because they **mock Supabase function calls** and don’t hit the real Supabase Functions gateway / deployed Edge Function auth behavior.

## Immediate Diagnosis Improvement (So We Stop Guessing)
1. Update the Pricing reconcile error logging to always print a **stringified** decoded body, so the console shows the actual `{ error, details }` from the 401 response.
2. Expand the UI error summarizer to also extract `message` fields (not only `error/details`) so the toast shows the true cause.

## Fix the 401 Reliably (Client + Server)
1. **Client-side call hardening**
   - Keep adding `apikey` along with `Authorization` for all Edge Function calls (Supabase gateway commonly 401s if apikey is missing/overridden).
   - Add a fallback: if `supabase.functions.invoke()` returns 401, retry the reconcile call via **direct fetch** to `SUPABASE_URL/functions/v1/reconcile-stripe-checkout` with headers `{ Authorization, apikey, Content-Type }`. This bypasses any SDK header merging issues.

2. **Server-side auth hardening**
   - Ensure `reconcile-stripe-checkout` always returns a descriptive 401 payload (`{ error, details }`) from `admin.auth.getUser(token)` failures.
   - Add safe diagnostics (no secrets): include whether an Authorization header was present, and whether token parsing succeeded.

## Ensure Atomic Plan + Credits Update
- `apply_stripe_subscription_state` is already atomic at the DB layer (single RPC updates `user_credits` and `profiles`).
- The remaining work is ensuring that either reconcile or webhook successfully calls that RPC for *every* successful payment.

## Thorough End-to-End Tests (Real Integration, Not Mocks)
1. Add a new Node integration test script that:
   - Creates a real Supabase test user via service-role.
   - Signs in via anon key to obtain a real JWT.
   - Calls the deployed `reconcile-stripe-checkout` endpoint with:
     - an invalid `session_id` → expects **400** (not 401).
     - a valid auth token → confirms auth is accepted.
2. Add a second integration check that calls the deployed `credits` endpoint with the same token → expects success.
3. Run `npm run typecheck` and `npm test` in CI-style mode after changes.

## Deployment + Verification
1. Deploy updated Edge Functions (`reconcile-stripe-checkout` and `stripe-webhook`).
2. Confirm Supabase Edge Function secrets include:
   - `SB_SUPABASE_URL`, `SB_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, and (optionally) `SB_ANON_KEY`.
3. Perform a real Stripe test checkout and verify:
   - New rows in `stripe_webhook_events` for `checkout.session.completed` / `invoice.paid`.
   - `user_credits` tier + monthly_credits_per_cycle updated.
   - `profiles.subscription_tier` + `credits_balance` updated.

If you approve, I’ll implement the above (code changes + integration test script), redeploy the functions, and run the full test suite again before handing back.