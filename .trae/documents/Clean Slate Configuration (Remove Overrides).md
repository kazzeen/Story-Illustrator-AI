The fact that Vercel reports "Success" but serves old content—combined with the 404 on `/debug`—indicates a **Configuration Conflict**. Specifically, `vercel.json` is hardcoding `buildCommand` and `outputDirectory`, which often overrides or conflicts with Vercel's internal auto-detection for Vite projects.

We will switch to a **"Clean Slate" Configuration**.

### The Plan: v5.6-CLEAN

1.  **Strip `vercel.json`:**
    *   Remove `buildCommand`, `outputDirectory`, `installCommand`, and `framework`.
    *   **Why:** We want Vercel's dashboard defaults (which are optimized for Vite) to take over. Hardcoding these in JSON is error-prone.
    *   **Keep:** Only `rewrites` (essential for routing) and `headers` (essential for cache busting).

2.  **Simplify `vite.config.ts`:**
    *   Remove the manual `v5.3` filename hashing.
    *   **Why:** Vite handles hashing automatically (`index.[hash].js`). Manually forcing version numbers into filenames (`v5.3-[name]`) is non-standard and might be confusing Vercel's asset optimization pipeline.

3.  **Bump Version to `v5.6-CLEAN`:**
    *   This visual indicator will prove if the new "clean" pipeline is working.

4.  **Action:**
    *   Deploy this simplified configuration. Vercel will auto-detect "Vite", run `npm run build`, and find the `dist` folder automatically without us forcing it.

### Expected Outcome
This removes the "human error" from the configuration. Vercel knows how to deploy Vite apps better than we do manually. By removing the overrides, we let the platform work as intended.
