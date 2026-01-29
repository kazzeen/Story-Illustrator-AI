The "Explicit Override" strategy failed, likely because Vercel's build environment (Linux) didn't like our `bash` script or permissions. We are going to pivot to a **Directory Rename Strategy**.

By changing the output folder from `dist` to `build`, we force Vercel to look in a completely new location. It cannot serve "stale" files from a folder that didn't exist before.

### The Plan: "Fresh Folder" Strategy (v5.8-FRESH)

1.  **Rename Output Directory:**
    *   Update `vite.config.ts` to output to `build` instead of `dist`.
    *   Update `vercel.json` to look for `build`.
    *   Update `package.json` scripts to match.

2.  **Add Connectivity Probe:**
    *   Create `public/probe-[timestamp].txt`.
    *   If you can load this file after deployment, we know Vercel is connected. If not, Vercel is disconnected.

3.  **Simplify `vercel.json` (Again):**
    *   Remove the `bash` script command. It adds too much risk of failure.
    *   We will rely on the standard `npm run build` but pointing to the new `build` folder.

4.  **Visual Proof:**
    *   Bump version to `v5.8-FRESH`.

### Why this works
If Vercel has a "stale cache" of the `dist` folder, we bypass it entirely by using `build`. It's like moving to a new house instead of trying to clean the old one.
