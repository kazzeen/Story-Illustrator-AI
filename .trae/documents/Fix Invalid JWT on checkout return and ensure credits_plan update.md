## Root Cause (From the Logs + Code)
- Your checkout return flow calls `reconcile-stripe-checkout` and then `credits` using an `accessToken` fetched via `supabase.auth.refreshSession()`/`getSession()` in [Pricing.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/Pricing.tsx#L485-L569).
- The request is rejected by the Supabase Functions gateway with **401 `{ code: 401, message: "Invalid JWT" }`** (your console output). That error is produced **before** the Edge Function code runs, meaning the bearer token being sent is not a valid access JWT for the Supabase project that is serving the functions.
- Because reconcile can’t run, the fallback path that calls the atomic DB RPC (`apply_stripe_subscription_state`) never happens; and the UI also can’t fetch `credits` to show the updated tier/balance.
- Unit tests were not catching this originally because they mock function calls; I’ll add explicit tests that simulate “Invalid JWT” and verify we preserve the checkout params and force a re-auth retry.

## What “Robust” Means Here
- If we detect “Invalid JWT” during checkout return, we must:
  - Avoid clearing `checkout=success&session_id=...` (otherwise we lose the ability to reconcile).
  - Force a clean re-auth (sign out + clear session token) and redirect to `/auth` while **preserving the checkout params**.
  - After successful re-login, automatically retry reconcile + credits polling.

## Implementation Plan
### 1) Reproduce & Trace (Instrumented)
- Add structured logging (no secrets) around:
  - token acquisition outcome (present/absent, looks-like-JWT)
  - reconcile call status/body
  - credits polling status/body
- Ensure the logs clearly distinguish:
  - gateway 401 Invalid JWT
  - function-level 401 Authorization failed
  - webhook processing delays

### 2) Fix Checkout Return Flow (Stop losing state)
- In [Pricing.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/Pricing.tsx#L471-L625):
  - Introduce a `shouldClearCheckoutParams` flag.
  - If reconcile/credits returns 401 with body `{ message: "Invalid JWT" }` (or auth error indicating invalid signature), do:
    - `supabase.auth.signOut()`
    - clear the stored `sb-<ref>-auth-token`
    - redirect to `/auth?mode=signin&redirect=/pricing&checkout=success&session_id=...` (preserve params)
    - set `shouldClearCheckoutParams = false`.
  - Only remove `checkout/credits_checkout/session_id` in `finally` when `shouldClearCheckoutParams` is true.

### 3) Fix Token Acquisition Logic (Don’t use a poisoned session)
- Update `refreshAccessToken()` to validate the session:
  - If refresh/getSession yields a token but subsequent authenticated call indicates invalid JWT, treat as unauthenticated and trigger the re-auth redirect path.

### 4) Ensure Atomic Updates Once Auth Works
- Keep using existing atomic DB functions:
  - `apply_stripe_subscription_state` (subscriptions)
  - `admin_apply_stripe_credit_pack_purchase` (credit packs)
- Ensure reconcile continues to call `apply_stripe_subscription_state` with deterministic `p_event_id=reconcile:<session_id>` so it stays idempotent.

### 5) Add Comprehensive Tests
- Update [Pricing.toggle.test.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/Pricing.toggle.test.tsx) to cover:
  - checkout return reconcile -> 401 Invalid JWT triggers redirect to auth and **does not clear checkout params**
  - checkout return reconcile -> 500 configuration error shows “Missing configuration” toast
  - credits polling 401 Invalid JWT triggers re-auth retry path
- Add/extend an integration script (node) that:
  - creates a test user
  - signs in to get a real JWT
  - calls deployed `credits` and expects non-401
  - calls reconcile with an invalid session id and expects 400 (not 401)

### 6) End-to-End Validation
- Run:
  - `npm run typecheck`
  - `npm test`
  - integration script
- Manual E2E (Stripe test checkout):
  - Complete a subscription checkout
  - Confirm webhook event rows appear and/or reconcile successfully applies credits
  - Confirm `credits` shows updated tier and balance

## Deliverables
- A checkout return flow that reliably recovers from “Invalid JWT” by forcing re-auth and retrying reconcile.
- No loss of `session_id` during transient failures.
- Tests that explicitly cover this failure mode.
- Clear, safe logs to pinpoint whether remaining issues are webhook delivery vs client auth.
