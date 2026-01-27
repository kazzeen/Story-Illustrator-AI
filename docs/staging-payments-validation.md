# Staging: Payments → Plan + Credits Validation

## Preconditions
- Stripe webhooks are configured to call the Supabase `stripe-webhook` function endpoint.
- Supabase Edge Function secrets are set:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `SB_SUPABASE_URL`
  - `SB_SERVICE_ROLE_KEY`
- Stripe Checkout sessions include metadata:
  - `tier` (`starter` | `creator` | `professional`)
  - `user_id` (Supabase user id)

## Expected Credits Per Plan
- Starter: 100 monthly + 20 one-time bonus on first subscription
- Creator: 200 monthly + 100 one-time bonus on first subscription
- Professional: 1000 monthly, no one-time bonus

## Test Matrix
### Subscription purchase
Run each plan once:
- Starter (monthly)
- Creator (monthly)
- Professional (monthly)

Optional:
- Repeat the same plan purchase to ensure the one-time bonus does not reapply.

### Duplicate webhook delivery
- In Stripe dashboard, resend the same webhook event (same `event_id`) at least once.
- Confirm no additional bonus/credits are applied beyond the first processing.

## What To Verify (Database)
### Profiles (UI-facing)
For the purchasing user, verify:
- `profiles.subscription_tier` equals the purchased tier
- `profiles.subscription_status` is `active`
- `profiles.credits_balance` equals remaining monthly + remaining bonus
- `profiles.next_billing_date` is set

### User Credits (canonical)
For the purchasing user, verify:
- `user_credits.tier` equals the purchased tier
- `user_credits.monthly_credits_per_cycle` equals 100 / 200 / 1000
- `user_credits.monthly_credits_used` is 0 after a fresh grant
- `user_credits.bonus_granted` is true only after the first Starter/Creator subscription

### Credit Transactions (audit)
Verify:
- One `subscription_grant` transaction exists per successful grant cycle
- For Starter/Creator first-time subscription, one `bonus` transaction exists
- Duplicate webhook resends do not create extra `subscription_grant` / `bonus` rows

### Webhook Outcomes (diagnostics)
Inspect:
- `stripe_webhook_events.status` is `ok` for the relevant events
- `stripe_webhook_events.reason` indicates which path ran (for example, `subscription_grant_applied_metadata`, `invoice_grant_applied`)
- `stripe_webhook_events.details` contains identifiers (`subscriptionId`, `invoiceId`, `priceId`) and `tierSource`

## Fast SQL Checks (Supabase SQL Editor)
Replace `<USER_ID>` with the purchasing user id.

```sql
select user_id, subscription_tier, subscription_status, credits_balance, next_billing_date
from public.profiles
where user_id = '<USER_ID>';
```

```sql
select user_id, tier, monthly_credits_per_cycle, monthly_credits_used, bonus_credits_total, bonus_credits_used, bonus_granted, cycle_start_at, cycle_end_at
from public.user_credits
where user_id = '<USER_ID>';
```

```sql
select transaction_type, pool, amount, stripe_event_id, stripe_invoice_id, stripe_subscription_id, stripe_checkout_session_id, created_at
from public.credit_transactions
where user_id = '<USER_ID>'
order by created_at desc
limit 50;
```

```sql
select status, reason, event_type, user_id, details, processed_at
from public.stripe_webhook_events
where user_id = '<USER_ID>'
order by processed_at desc
limit 50;
```

