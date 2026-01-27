## Root Cause
- The red “Checkout complete – HTTP 401” toast is produced when the frontend calls the `credits` Edge Function after returning from Stripe and Supabase responds with a non‑2xx.
- The `credits` function itself is coded to return `200` even when the session is missing/expired for `action: "status"` ([credits/index.ts](file:///d:/Projects/SIAI%20Lovable/supabase/functions/credits/index.ts#L166-L194)). Therefore a raw `401` strongly indicates the request is being rejected before the function code runs (gateway JWT enforcement).
- `supabase/config.toml` currently sets `verify_jwt = false` for `stripe-webhook` but does not configure `credits` (or the checkout functions) ([config.toml](file:///d:/Projects/SIAI%20Lovable/supabase/config.toml#L1-L16)). This allows the gateway to keep enforcing JWT on `credits`, producing the persistent 401 after Stripe redirects.
- Separately, “not crediting” after payment can occur if the Stripe webhook is delayed/misconfigured or if the webhook can’t map the checkout session back to the user. While the webhook code supports applying subscription credits via `apply_stripe_subscription_state` ([stripe-webhook/index.ts](file:///d:/Projects/SIAI%20Lovable/supabase/functions/stripe-webhook/index.ts#L319-L477)) and the SQL function correctly updates credits ([comprehensive_credit_system_v2.sql](file:///d:/Projects/SIAI%20Lovable/supabase/migrations/20260102090000_comprehensive_credit_system_v2.sql#L428-L533)), relying on webhook timing alone makes the client experience brittle.

## Changes
### 1) Stop the persistent 401 after checkout
- Update `supabase/config.toml` to explicitly set `verify_jwt = false` for:
  - `credits`
  - `create-starter-membership-checkout`
  - `create-creator-membership-checkout`
  - (optional but recommended for parity) `create-credit-pack-checkout`
- Redeploy those functions so the gateway no longer blocks them.

### 2) Make credit allocation robust (webhook + fallback)
- Add a new Edge Function (e.g. `reconcile-stripe-checkout`) that:
  - Requires a valid user session (handled inside the function).
  - Accepts `{ session_id }` from the return URL.
  - Fetches the Stripe Checkout Session + Subscription using `STRIPE_SECRET_KEY`.
  - Determines tier from the Stripe price ID (reuse the same mapping logic as in `stripe-webhook`).
  - Calls the existing DB RPC `apply_stripe_subscription_state` with Stripe’s real `current_period_start/end` and `reset_usage=true`.
  - Returns a clear JSON result; on failure returns structured errors.

### 3) Improve frontend post-checkout flow
- Update [Pricing.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/Pricing.tsx) so that on `?checkout=success&session_id=...` it:
  - Calls `reconcile-stripe-checkout` once (best-effort) before requesting `credits` status.
  - Treats temporary auth failures as non-fatal (“Payment received; syncing credits…”) instead of showing a hard red 401 toast.

### 4) Harden webhook observability
- Extend `stripe-webhook` error responses/logging (and `stripe_webhook_events.details`) to include more diagnostic fields (event type, derived user id, derived tier/price id) so failures are actionable.

## Verification
- Run a full Stripe test checkout for each plan (Starter / Creator / Professional).
- Confirm:
  - No red “HTTP 401” toast on return.
  - `user_credits.tier`, `monthly_credits_per_cycle`, and `bonus_credits_total` reflect the plan and any first-time bonuses.
  - Credits visible in UI after checkout completion.
- Add a small automated test for tier resolution from price IDs (to prevent regressions).
