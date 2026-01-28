I will fix the persistent "Database error saving new user" by removing a redundant and conflicting database trigger on the `public.profiles` table.

My analysis reveals that:
1.  There is a trigger `ensure_profile_credits_initialized_on_insert` on `public.profiles`.
2.  This trigger fires when the `handle_new_user` function inserts a new profile.
3.  The trigger attempts to initialize credits *again*, potentially using an older/incompatible function or causing a race condition/conflict with the new `v2` credit system.
4.  Even though `handle_new_user` has error handling, complex nested trigger failures can sometimes propagate or cause side effects that fail the transaction.

By removing this trigger, I simplify the signup flow to:
1.  `handle_new_user` inserts the profile (safely).
2.  `handle_new_user` explicitly initializes credits using the correct `v2` function.

This removes the circular dependency and failure point.

### Implementation Steps
1.  Create `d:\Projects\SIAI Lovable\supabase\migrations\20260127181000_remove_profile_trigger.sql` to drop `ensure_profile_credits_initialized_on_insert`.
2.  Execute `npx supabase db push` to apply the fix.
