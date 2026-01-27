## What’s still broken (root cause)
- After Stripe redirects back to `/pricing?checkout=success&session_id=...`, the code only runs the “post-checkout” logic when `user` is already present:
  - Condition: `checkout === "success" && sessionId && user && ...` in [Pricing.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/Pricing.tsx#L413-L416)
- If the user’s session is missing/expired (or `useAuth` never resolves a user after redirect), the reconciliation never runs, so:
  - The account stays on the old plan.
  - Credits are not applied.

## Fix approach
### 1) Make checkout completion idempotent and resilient to missing sessions
- Update the “checkout success” handler in [Pricing.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/Pricing.tsx) to run when `session_id` is present even if `user` is null:
  - If `user` is missing, redirect to `/auth` while preserving `checkout=success&session_id=...` in the redirect URL.
  - After sign-in, the same handler runs and completes reconciliation.

### 2) Ensure the purchased plan’s credits match the product promises
- The database tier allocation function currently maps tiers to quotas that don’t match the plan copy shown on Pricing (e.g., Creator and Professional are different in migrations).
- Create a new Supabase migration that updates tier allocation to the intended values:
  - Starter: 100/month
  - Creator: 200/month
  - Professional: treated as “unlimited” (or a clearly defined high quota if you prefer)
- Update the relevant DB functions that compute/spend credits so Professional behaves correctly:
  - `consume_credits`
  - `reserve_credits`
  - `commit_reserved_credits`
  - `release_reserved_credits`
  - `refund_consumed_credits`
  - And the profile-sync trigger function that sets `profiles.credits_balance`

### 3) Improve user-facing behavior and observability
- If reconciliation fails, show a clear toast (non-2xx details) instead of silently swallowing errors.
- Keep the webhook improvements already in place, and ensure reconcile failures are logged with enough context.

## Verification steps
- End-to-end test (Stripe test mode): purchase Starter/Creator/Professional and confirm:
  - `profiles.subscription_tier` updates to the purchased tier.
  - `profiles.credits_balance` and `user_credits.monthly_credits_per_cycle` reflect correct plan values.
  - No “stuck on Free” after successful payment.
- Run `npm test` to ensure frontend and shared logic tests pass.
- Spot-check DB rows for the specific checkout session:
  - `stripe_webhook_events` (if webhook fired)
  - `credit_transactions` entries created by subscription grant
