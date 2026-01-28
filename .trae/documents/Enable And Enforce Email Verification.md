## Why You’re Not Getting An “Activate Account” Email
Right now, your Supabase project is still configured to **auto-activate** users on signup (no email confirmation). When that setting is off, Supabase:
- will return a valid session immediately from `signUp` (meaning the user is already active)
- will not reliably send a confirmation email because there’s nothing to confirm

Your frontend already supplies `emailRedirectTo` on signup ([auth-provider.tsx](file:///D:/Projects/SIAI%20Lovable/src/hooks/auth-provider.tsx#L139-L164)), but that only controls *where the link goes*—it does not turn on enforcement.

## Fix (Supabase Dashboard — Required)
1. Supabase Dashboard → **Authentication → Providers → Email**
   - Turn ON **Confirm email**
2. Supabase Dashboard → **Authentication → URL Configuration**
   - Set **Site URL** to your real app URL (local: `http://localhost:5173`, prod: your domain)
   - Add Redirect URL(s):
     - `http://localhost:5173/auth?mode=signin`
     - `https://<your-domain>/auth?mode=signin`
3. Supabase Dashboard → **Authentication → Emails**
   - Confirm email templates are enabled (and not blank)
   - If deliverability is poor, configure a custom SMTP provider (SendGrid/Mailgun/Postmark)

## Fix (Code — To Make It Behave Correctly Even If Settings Are Wrong)
1. Update signup UX to show a clear warning if Supabase returns a session (which indicates confirmations are OFF) and guide the admin to enable Confirm Email.
2. Stop swallowing resend failures after signup; surface `supabase.auth.resend({ type: 'signup', ... })` errors in the UI.
3. Add a “Resend activation email” action on the post-signup success toast (not only on sign-in).

## Verification
1. Run a scripted signup against your project:
   - Expect `signUp` to succeed with `data.session === null` when confirmations are ON.
   - Attempt `signInWithPassword` before clicking the link should fail with “Email not confirmed”.
2. Confirm the email arrives (inbox/spam). If not, check Supabase Auth email logs for mailer errors.
