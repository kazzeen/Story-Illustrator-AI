# Checkout Authorization Failures (Pricing Buttons)

## Summary

Pricing purchase buttons initiate Stripe checkout by calling Supabase Edge Functions:

- `create-starter-membership-checkout`
- `create-creator-membership-checkout` (Creator + Professional)
- `create-credit-pack-checkout`

Each function requires a valid Supabase user JWT in `Authorization: Bearer <access_token>` and returns a Stripe Checkout URL.

## Root Cause

The Pricing page was calling Edge Functions via a hand-rolled `fetch` implementation and could send stale/expired access tokens. When the token was expired (or when the app’s auth state hadn’t hydrated yet), the Edge Function auth check (`admin.auth.getUser(token)`) returned `401 Invalid or expired session`.

This manifested as authorization failures across all purchase buttons (Starter, Creator, Professional, and credit packs).

## Fix

Changes made in [Pricing.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/Pricing.tsx):

- Switched Edge Function calls to `supabase.functions.invoke(...)` so the request uses Supabase’s standard client transport (stable headers, correct endpoint, consistent behavior across browsers).
- Added `refreshAccessToken()` that attempts `getSession()` first and then `refreshSession()` to proactively obtain a fresh access token before starting checkout.
- Improved invalid-session UX by showing a clear toast (“Sign in required”) before redirecting to the auth page, rather than failing silently or appearing like a forced sign-out.
- Removed the hard dependency on in-memory `user` state for button clicks (token presence is the source of truth), preventing false negatives during auth hydration.

## Verification

Automated coverage in [Pricing.toggle.test.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/Pricing.toggle.test.tsx):

- Validates each purchase button calls the correct Edge Function with the correct payload:
  - Starter → `create-starter-membership-checkout` (`interval`)
  - Creator/Professional → `create-creator-membership-checkout` (`tier`, `interval`)
  - Credit pack → `create-credit-pack-checkout` (`pack`)
- Confirms successful responses redirect to the returned checkout URL.
- Confirms missing-session behavior produces clear user feedback and redirects to auth.
- Confirms 401 responses from the function produce a clear “Checkout failed” error and do not redirect to Stripe.

## Notes

If you still see failures after this fix, check Edge Function environment variables (e.g. `STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) because those issues surface as `500 Configuration error` rather than `401`.

