## Root Cause (confirmed)
- Your checkout functions can create subscriptions using `price_data` (inline pricing) when `priceId` is null (see [create-creator-membership-checkout](file:///d:/Projects/SIAI%20Lovable/supabase/functions/create-creator-membership-checkout/index.ts#L110-L120)). Stripe will then use a generated `price_...` that will **not match** your configured `STRIPE_PRICE_*` env IDs.
- In `stripe-webhook`, only the `checkout.session.completed` “metadata tier fast-path” handles this correctly; other common subscription fulfillment events (`customer.subscription.updated/created`, `invoice.paid`) still resolve tier **only via price-id mapping** and ignore subscription metadata, causing `unknown_price` → ignored → no credits and no plan update.

## Fix Strategy
### 1) Make webhook tier resolution metadata-first everywhere
- Update [stripe-webhook](file:///d:/Projects/SIAI%20Lovable/supabase/functions/stripe-webhook/index.ts) to use a single metadata-first resolver for **all** subscription-related events:
  - Prefer `subscription.metadata.tier` and/or `event.data.object.metadata.tier`
  - Fall back to `price.id` mapping only if metadata is missing
- Reuse the existing shared helper by importing `resolveSubscriptionTier` from [stripe-tier.ts](file:///d:/Projects/SIAI%20Lovable/supabase/functions/_shared/stripe-tier.ts).
- Apply this change in:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `invoice.paid`
  - and the “fetch subscription” fallback inside `checkout.session.completed`

### 2) Improve logging at critical steps
- Add structured logs and webhook DB `details` fields that explicitly capture:
  - `tier_source: "metadata" | "price_id" | "unknown"`
  - `metadataTier`, `subscriptionMetadataTier`, `priceId`, `subscriptionId`, `invoiceId`, `checkoutSessionId`, `userId`
- When an event is ignored, log the exact reason and these identifiers to make diagnosis deterministic.

### 3) Ensure atomic plan+credits update (already implemented)
- Keep the atomic behavior in `apply_stripe_subscription_state` (updates `user_credits` and `profiles` together) so the UI always reflects the new plan and credits immediately.
- Keep tier quotas:
  - Starter = 100
  - Creator = 200
  - Professional = 1000

### 4) Tests
- Unit tests:
  - Add tests for metadata-first resolution for subscription objects and invoice objects.
  - Add tests that cover “inline price_data → unknown price id” but metadata tier exists.
- Integration-style test (mocked):
  - Add a test that feeds a representative `customer.subscription.updated` and `invoice.paid` event payload into the webhook handler logic (using mocked Stripe fetch + mocked DB RPC) and asserts:
    - correct tier chosen
    - DB RPC called once
    - idempotency behavior for duplicate event id

### 5) Deploy + staging validation
- Redeploy `stripe-webhook` after changes.
- In Stripe test mode, run a purchase where checkout uses inline pricing and confirm:
  - `profiles.subscription_tier` updates to purchased tier
  - `profiles.credits_balance` equals expected credits
  - `user_credits.monthly_credits_per_cycle` equals 100/200/1000
  - duplicate webhooks do not double-apply

If you approve this plan, I’ll implement the webhook tier-resolution fix, add the tests, redeploy the function, and provide a concrete staging validation checklist with the exact DB fields to verify.