## Findings (Why credit packs don’t add credits)
- Credit-pack purchases (Buy 50/200/400) are created via [create-credit-pack-checkout](file:///d:/Projects/SIAI%20Lovable/supabase/functions/create-credit-pack-checkout/index.ts#L251-L262), which sets the success URL to `?credits_checkout=success&session_id={CHECKOUT_SESSION_ID}` and encodes the credit amount in Stripe session metadata (`metadata[credits]`, `metadata[user_id]`, `metadata[pack]`).
- After returning from Stripe for a credit-pack purchase, the UI currently **does not run any reconcile** step; it only polls `credits` and expects the **Stripe webhook** to have already applied the purchase.
- The webhook path that actually applies credit packs is [stripe-webhook](file:///d:/Projects/SIAI%20Lovable/supabase/functions/stripe-webhook/index.ts#L318-L379) → DB RPC [admin_apply_stripe_credit_pack_purchase](file:///d:/Projects/SIAI%20Lovable/supabase/migrations/20260104100000_credit_purchase_hardening.sql#L67-L171).
- If the webhook is delayed, misconfigured, or failing (common causes: wrong Stripe webhook signing secret, wrong endpoint, function env misconfigured), the credit-pack purchase completes in Stripe but **no credits are applied**, and polling `credits` never reflects the purchase.

## Root Cause Summary
- Credit packs have a single point of failure: **webhook-only credit application**.
- Subscriptions have a UI “reconcile” fallback; credit packs do not.
- Therefore, any webhook failure or delay produces the exact symptom: “purchase succeeded but credits were not added”.

## Plan to Fix (Robust, Idempotent, End-to-End)
### 1) Reproduce and Trace
- Add structured logs in the credit-pack return path:
  - capture `session_id`, whether reconcile ran, webhook/poll outcomes
- Add additional logging in the credit-pack webhook branch:
  - include `sessionId`, `userId`, `credits`, `paymentIntentId`, and RPC return shape

### 2) Add a Credit-Pack Reconcile Edge Function
- Implement a new Edge Function (e.g. `reconcile-stripe-credit-pack`) that:
  - Authenticates the current user using the bearer token
  - Fetches Stripe Checkout Session by `session_id`
  - Validates `mode=payment` and `payment_status=paid`
  - Validates session metadata `user_id` matches the authenticated user
  - Reads `credits`, `pack`, `payment_intent`, `customer`, `price_id`
  - Calls `admin_apply_stripe_credit_pack_purchase` with a deterministic `p_event_id = reconcile_credit_pack:<session_id>`
  - Returns `ok: true` plus updated remaining balances
- This is naturally idempotent due to the DB function’s dedupe on checkout session / payment intent.

### 3) Update the UI Return Flow
- In [Pricing.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/Pricing.tsx), when `credits_checkout=success`:
  - Call the new `reconcile-stripe-credit-pack` once using the `session_id`
  - Then poll `credits` like today to update the UI
  - On auth failures (`Invalid JWT`), redirect to re-auth while preserving `credits_checkout=success&session_id=...` so the reconcile can retry after login

### 4) Verify Data Integrity
- Add a small diagnostic query path (server-side only) that can confirm:
  - `credit_transactions` contains a `purchase` row with the given `stripe_checkout_session_id`
  - `user_credits.bonus_credits_total` increased accordingly

### 5) Tests
- Unit tests:
  - UI test: `credits_checkout=success` triggers reconcile-credit-pack and then refreshes credits
  - UI test: reconcile-credit-pack returns 401 Invalid JWT → redirects to auth preserving checkout params
- Function tests (Deno/unit):
  - Reconcile-credit-pack validates metadata, mode/payment_status, and calls RPC with correct args
- Integration script:
  - Exercise reconcile-credit-pack with an invalid session id (expect 400, not 500)

### 6) End-to-End Validation
- Manual: complete Buy 50/200/400 checkout; on return, credits increase immediately.
- Confirm webhook still works as primary path; reconcile exists as fallback.

## Expected Outcome
- Credit-pack purchases will reliably credit the account even if the Stripe webhook is delayed or misconfigured, because the checkout return will now reconcile the Stripe session and apply credits idempotently.
