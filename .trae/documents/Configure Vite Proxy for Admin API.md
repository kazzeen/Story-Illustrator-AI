The error "Received HTML instead of JSON" confirms that your local development environment is trying to call the Admin API at `/api/admin/...`, but the Vite server doesn't know how to handle that request, so it returns the `index.html` page instead.

This happens because there is no **proxy configuration** in your `vite.config.ts` to forward these requests to the actual backend (Supabase Edge Functions).

Here is the plan to fix this:

1.  **Modify `vite.config.ts`**:
    *   Load environment variables using `loadEnv`.
    *   Add a `server.proxy` configuration.
    *   Direct all requests starting with `/api/admin` to your deployed Supabase Edge Function URL (`https://gaxmjxiqjirjeyemjcyc.supabase.co/functions/v1/api-admin`).
    *   This ensures that when your local app asks for `/api/admin/users`, it actually fetches data from the live backend.

2.  **Verify the Fix**:
    *   Restart the development server.
    *   Check the Admin Dashboard again. It should now successfully load the user list.

This change only affects your local development environment and fixes the issue where you can't test the admin dashboard locally.
