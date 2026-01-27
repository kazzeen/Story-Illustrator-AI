## What’s Broken
- The “success” toast is implemented in [Pricing.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/Pricing.tsx#L414-L523), but when a user returns from Stripe while signed out, the code navigates to `/auth` and then immediately clears the `checkout/credits_checkout` + `session_id` params in `finally`, which cancels the flow before it can reconcile credits/plan or show the success message.
- That same param-clearing also prevents the subscription reconcile call from running after the user signs in.

## Fix: Checkout Return Handling (Frontend)
1. Update [Pricing.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/Pricing.tsx#L414-L523) so that:
   - If `checkout=success|credits_checkout=success` and `session_id` exist but `user` is missing:
     - Navigate to `/auth?mode=signin&redirect=<FULL /pricing?... query preserved>`.
     - Do **not** set `handledCheckoutReturn.current` and do **not** clear the query params.
   - Only set `handledCheckoutReturn.current = true` after `user` exists.
   - Only remove `checkout/credits_checkout/session_id` after the success/cancel flow completes (or after a definitive terminal error), not on the unauthenticated redirect.
2. Make the return handler more robust:
   - After subscription success, call `reconcile-stripe-checkout` (already present) and then poll `credits {action:"status"}` a few times (e.g., 3–5 retries with short delays) before deciding “processing”.
   - Ensure the success toast fires as soon as `credits.status` reports the updated tier/balances.

## Fix: Auth Redirect Edge Case (Frontend)
- Patch [Auth.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/Auth.tsx#L28-L41) so that if it needs to append forwarded params to `redirect` and `redirect` already contains `?`, it uses `&` (or uses `URL`/`URLSearchParams` to merge cleanly). This prevents malformed redirects.

## Verify Backend Sync (No behavior change unless needed)
- Confirm the subscription reconcile path is correct:
  - [reconcile-stripe-checkout](file:///d:/Projects/SIAI%20Lovable/supabase/functions/reconcile-stripe-checkout/index.ts#L64-L181) applies `apply_stripe_subscription_state`.
- If credits still don’t update even after reconcile, add targeted logging/diagnostics in the webhook/reconcile responses (not secrets) to show tier/user resolution and RPC results.

## Validation
1. Local UI test:
   - Start checkout while signed out → complete Stripe payment → confirm app redirects to sign-in → after sign-in returns to `/pricing?checkout=success&session_id=...` → reconcile runs → credits refresh → success toast appears.
2. Signed-in flow:
   - Complete checkout while signed in → confirm success toast appears and profile tier/credits update.
3. Regression:
   - Cancel checkout → “Checkout canceled” toast still appears and params clear.
   - Verify no infinite loops on `/pricing?...` return.

If you confirm this plan, I’ll implement the code changes and run the relevant tests/build checks.