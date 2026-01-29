We've tried technical fixes, but the deployment remains "stale" despite successful builds. This points to a **Build Pipeline Failure**. Specifically, Vercel might be successfully running the *wrong* command or serving the *wrong* folder, ignoring our code changes entirely.

### The New Strategy: "Explicit Override" (v5.7-OVERRIDE)

We will stop relying on Vercel's "auto-detection" and explicitly force every step of the deployment process via a custom script.

1.  **Create `vercel-build.sh`:**
    *   We will create a dedicated shell script that handles the entire build process:
        1.  Runs `node ./update-version.js` (Critical for the Version Checker).
        2.  Runs `npm run build` (Standard Vite build).
    *   **Why:** This ensures no step is skipped by Vercel's default behavior.

2.  **Update `vercel.json` to Use Custom Builder:**
    *   We will re-add the `buildCommand` to `vercel.json`, but point it to our new script: `bash vercel-build.sh`.
    *   We will explicitly set `outputDirectory` to `dist` again to leave zero ambiguity.

3.  **Disable "Clean URLs" for Assets:**
    *   We will modify `vite.config.ts` to disable `emptyOutDir` during the build to prevent race conditions, and ensure the output is strictly `dist`.

4.  **Visual Proof (v5.7-OVERRIDE):**
    *   Bump version to `v5.7-OVERRIDE` in `Navbar` and `package.json`.

### Why this works
Instead of hoping Vercel runs `npm run build` correctly (which includes `prebuild`), we give it a single script file. If Vercel runs the script, it *must* execute our version update and our build. It cannot "optimize" it away.
