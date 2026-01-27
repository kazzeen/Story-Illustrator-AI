## Root Cause (most likely)
- The system’s “plan + credits applied” depends on the Stripe webhook and/or the `reconcile-stripe-checkout` fallback successfully calling the DB RPC `apply_stripe_subscription_state`.
- There are two brittle points that can make a successful Stripe payment still result in *no plan/credits change*:
  1) **Tier resolution fails** in reconciliation when price IDs don’t match env config (reconcile currently derives tier from `subscription.items[0].price.id`, and only maps known env price IDs). If Stripe is using different prices (test vs live or fallback hardcoded IDs), reconciliation returns “unknown price” and applies nothing.
  2) **UI reads from `profiles`**, but the canonical update happens in `user_credits`. If the `sync_user_credits_to_profile` trigger isn’t present or is out of sync in the target DB, the user can be credited in `user_credits` but still appear “not credited / not upgraded” in UI.

## Target Behavior (atomic + reliable)
- On confirmed payment, update both:
  - `user_credits` (tier + monthly quota + usage reset + bonus)
  - `profiles` (subscription_tier + credits_balance + next_billing_date)
- Do this in one DB transaction so it’s atomic.
- Ensure idempotency for duplicate webhooks.

## Implementation Plan (Professional grants 1000 credits)
### 1) Make reconciliation tier resolution robust
- Update [reconcile-stripe-checkout](file:///d:/Projects/SIAI%20Lovable/supabase/functions/reconcile-stripe-checkout/index.ts) to resolve tier in this order:
  1) Checkout session metadata `tier` (already present from the checkout creation functions)
  2) Subscription metadata `tier`
  3) Price-ID mapping (`resolveTierFromPriceId`) as a fallback
- This eliminates price-ID mismatch as a reason credits/plan aren’t applied.

### 2) Make DB apply step truly atomic and UI-consistent
- Create a new migration that updates `apply_stripe_subscription_state` to also update `profiles` directly (not only via trigger):
  - Set `profiles.subscription_tier` from the applied tier
  - Set `profiles.credits_balance` from remaining monthly+bonus
  - Set `profiles.next_billing_date` from `cycle_end_at`
- Add idempotency inside `apply_stripe_subscription_state` using `(stripe_event_id, stripe_subscription_id, stripe_invoice_id)` so retries/duplicates don’t double-apply bonuses or churn.
- Keep tier credit quotas exactly:
  - Starter = 100
  - Creator = 200
  - Professional = 1000
  - (already in `_credits_per_cycle_for_tier` via [20260127000100_align_plan_credits.sql](file:///d:/Projects/SIAI%20Lovable/supabase/migrations/20260127000100_align_plan_credits.sql))

### 3) Webhook hardening + logging
- In [stripe-webhook](file:///d:/Projects/SIAI%20Lovable/supabase/functions/stripe-webhook/index.ts), ensure each processed payment event logs:
  - event type + ids (event_id, subscription_id, invoice_id, session_id)
  - derived user_id and tier
  - final DB RPC result
- Ensure “ignored” outcomes always record a reason (unknown price, user not found, not paid, etc.).

### 4) Tests
- **Unit tests**:
  - Add tests for tier resolution from metadata vs price-id mapping (reconcile function helper).
- **Integration tests**:
  - Add a test that simulates a successful subscription checkout return by mocking Stripe session/subscription fetch and asserting:
    - DB RPC called with expected tier and cycle window
    - `profiles.subscription_tier` and `credits_balance` update (using local supabase test DB or existing integration harness).
  - Add failure-path tests (unknown tier, Stripe fetch failure, DB RPC failure) and assert errors are logged and surfaced.

### 5) Validation
- Run Stripe test payments for Starter/Creator/Professional.
- Verify in DB:
  - `user_credits.tier` and `monthly_credits_per_cycle` are correct
  - `profiles.subscription_tier` and `credits_balance` match
  - Duplicate webhook deliveries do not double-apply bonuses.

If you confirm, I will implement this end-to-end (SQL migration + function updates + new tests) and then redeploy the updated Edge Functions.