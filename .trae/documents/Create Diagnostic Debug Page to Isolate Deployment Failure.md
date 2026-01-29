We've tried technical fixes, but the issue persists. This suggests the problem isn't "caching" in the traditional sense, but rather **Deployment Ambiguity**. We need to verify exactly *what* is running on Vercel.

### The Diagnostic Plan: "The Debug Page"

Instead of hidden logs, we will build a visible **`/debug`** page that exposes the raw internal state of the deployed application.

1.  **Inject Build Metadata:**
    *   We will update `vite.config.ts` to inject the **exact Git Commit Hash** and **Build Timestamp** into the app as global constants (`__COMMIT_HASH__`, `__BUILD_TIME__`).
    *   This is irrefutable proof of which version is running.

2.  **Create `/debug` Route:**
    *   A new page at `https://your-site.com/debug` that displays:
        *   **App Version:** (e.g., v5.3.0)
        *   **Commit Hash:** (e.g., `81dbb0c`)
        *   **Build Time:** (e.g., 2026-01-29T13:53:18Z)
        *   **Environment Variables:** Status of `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (first 5 chars).
        *   **Supabase Connection:** A live "Ping" test to the database to verify it can actually talk to Supabase.

3.  **Visual Version Bump (v5.4-DEBUG):**
    *   We will bump the version to `v5.4-DEBUG` in the Navbar and `package.json`.

### Why this works
*   If you go to `/debug` and get a 404, **Vercel is not deploying the new code**.
*   If you go to `/debug` and see an old Commit Hash, **Vercel is deploying an old commit**.
*   If you go to `/debug` and the "Supabase Ping" fails, **Vercel has the wrong environment keys**.

This removes all guessing. We will know exactly where the chain is broken.
