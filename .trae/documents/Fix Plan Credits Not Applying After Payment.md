## Diagnosis (most likely root cause)
- Your Stripe payment succeeds, but the crediting step (Stripe webhook and/or `reconcile-stripe-checkout`) depends on a **Service Role key** to call `apply_stripe_subscription_state` (granted only to `service_role`).
- In this repo, secrets syncing via CLI skips env vars starting with `SUPABASE_` (“Env name cannot start with SUPABASE_…”), so the deployed Edge Functions can end up **missing `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`**.
- In the current frontend flow, reconciliation errors are logged to console but are not surfaced, so the user just sees “Checkout complete” but no plan/credits update.

## Plan (updated: Professional grants 1000 credits)
### 1) Make Edge Functions read deployable env vars
- Update `stripe-webhook` and `reconcile-stripe-checkout` to read keys from **non-reserved env names**, with fallback:
  - `SB_SERVICE_ROLE_KEY` → fallback `SUPABASE_SERVICE_ROLE_KEY`
  - `SB_ANON_KEY` → fallback `SUPABASE_ANON_KEY`
  - `SB_SUPABASE_URL` → fallback `SUPABASE_URL`
- This avoids the CLI restriction and guarantees the functions have the keys they need.

### 2) Ensure correct credits per plan (Professional = 1000)
- Keep tier quota mapping as:
  - Starter: 100
  - Creator: 200
  - Professional: 1000
- Confirm DB function `_credits_per_cycle_for_tier` matches this and is applied to existing users.

### 3) Improve robustness + user-facing error handling
- In [Pricing.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/Pricing.tsx), show a clear toast when `reconcile-stripe-checkout` fails (include HTTP status + details), instead of silently swallowing errors.
- Add extra structured logging in `reconcile-stripe-checkout` responses to make failures actionable (e.g., missing keys vs Stripe fetch failure vs RPC error).

### 4) Deploy + verify
- Set secrets on the remote Supabase project:
  - `SB_SUPABASE_URL`
  - `SB_ANON_KEY`
  - `SB_SERVICE_ROLE_KEY`
  - (already present) `STRIPE_SECRET_KEY` and price IDs
- Redeploy `stripe-webhook` + `reconcile-stripe-checkout`.
- Verification:
  - Perform a test purchase for Starter/Creator/Professional.
  - Confirm `profiles.subscription_tier` updates and `profiles.credits_balance` reflects the correct tier quota.
  - Confirm `user_credits.monthly_credits_per_cycle` is 100/200/1000 respectively.

If this still doesn’t credit after the above, the next step will be to add a small “diagnostics” admin-only edge function to query the latest `stripe_webhook_events` and `credit_transactions` for the current user so we can see exactly where it’s failing.