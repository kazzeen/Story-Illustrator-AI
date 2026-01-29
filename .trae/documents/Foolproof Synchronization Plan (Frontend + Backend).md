The "Foolproof Plan" addresses the three distinct layers of your application that must be synchronized independently. Pushing to GitHub **only updates the Frontend (Layer 1)**. If you have made changes to how images are generated or how data is processed, you must manually update Layer 2.

### Layer 1: The Frontend (Vercel)
**Status:** Ready for Deployment (v5.2-FORCE)
*   **What it is:** The React UI, Storyboard pages, and components.
*   **The Fix:** We have already configured "Nuclear" cache busting (`v5.2-FORCE`).
*   **Action:** We will commit and push the `v5.2` changes. Vercel will auto-deploy this.

### Layer 2: The Backend Logic (Supabase Edge Functions)
**Status:** Likely Stale
*   **What it is:** The code in `supabase/functions/` (e.g., `generate-scene-image`).
*   **The Trap:** Vercel **does not** deploy these. If you changed logic here, the live site is still running the old code.
*   **The Fix:** We must manually deploy these functions to Supabase.
*   **Action:** Run `npm run supabase:functions:deploy` in the terminal.

### Layer 3: The Environment (Secrets & Keys)
**Status:** Verified Local, Needs Vercel Match
*   **What it is:** `VITE_SUPABASE_URL`, `VENICE_API_KEY`, etc.
*   **The Trap:** Local `.env` has your keys, but Vercel might have old or missing ones.
*   **The Fix:** I have added a diagnostic tool in the console to verify connection.
*   **Action:** You will check the browser console after deployment to confirm keys are present.

### Execution Steps
1.  **Deploy Backend:** Run `supabase functions deploy` to update the server-side logic.
2.  **Deploy Frontend:** Commit and push the `v5.2-FORCE` changes to trigger Vercel.
3.  **Verify:** Open the live site.
    *   **Visual:** Look for the red **v5.2-FORCE** badge.
    *   **Functional:** Test the Storyboard generation (now running on updated Edge Functions).
