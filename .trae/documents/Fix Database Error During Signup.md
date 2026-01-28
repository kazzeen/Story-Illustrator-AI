I will create a new Supabase migration to fix the "Database error saving new user" issue.

The error is caused by a legacy database trigger (`ensure_user_credits_on_signup`) that tries to insert incomplete data into the `user_credits` table (missing required `cycle_start_at`/`cycle_end_at` fields). This trigger conflicts with the modern schema.

I will create a migration file `supabase/migrations/20260127180000_fix_signup_database_error.sql` that:
1.  Explicitly drops the conflicting legacy trigger `ensure_user_credits_on_signup`.
2.  Drops the associated legacy function `public.ensure_user_credits_record()`.
3.  Ensures the correct, modern trigger `on_auth_user_created` is active and linked to the safe `handle_new_user()` function.

After creating the file, I will run `npx supabase db push` to apply the fix to your remote database.

### Implementation Steps
1.  Create `d:\Projects\SIAI Lovable\supabase\migrations\20260127180000_fix_signup_database_error.sql` with the cleanup SQL.
2.  Execute `npx supabase db push` to apply the changes.
