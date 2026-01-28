Based on the investigation, the root cause of the "stale admin panel" on the hosted site is highly likely a **lockfile conflict** causing Vercel to install outdated dependencies, effectively ignoring the latest code changes during the build process.

**Diagnosis:**
1.  **Conflict:** The project contains both `bun.lockb` and `package-lock.json`.
2.  **Local vs. Hosted:**
    *   **Localhost:** You are likely using `bun` (implied by `bun.lockb` presence), so your local builds use the latest dependencies and code logic.
    *   **Vercel:** Vercel detects `package-lock.json` and defaults to `npm ci`, installing dependencies frozen in that file. If `package-lock.json` is outdated (because you've been updating `bun.lockb` locally), Vercel builds the app with old libraries or state, leading to the "stale" behavior you observe.

**Plan to Resolve:**

1.  **Eliminate Conflict:** I will delete `package-lock.json`. This forces Vercel to look for `bun.lockb` (or `yarn.lock`/`pnpm-lock.yaml`, but essentially it breaks the preference for the stale npm lockfile).
    *   *Note:* Vercel supports Bun. If it doesn't auto-detect, removing the npm lockfile is the first step to clearing the confusion.

2.  **Force Rebuild:** I will commit this deletion and push to `master`. This triggers a new deployment.

3.  **Verify:** This ensures that Vercel installs the *exact* same dependency tree as your local environment, guaranteeing that the build output matches your localhost.

**Action Item:**
I will delete `package-lock.json` and push the change immediately. This is the definitive fix for "works on localhost, old version on Vercel" in this context.

