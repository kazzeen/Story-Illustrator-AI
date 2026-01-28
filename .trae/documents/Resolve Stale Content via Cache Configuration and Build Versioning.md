Based on the analysis, the root cause of the persistent "stale admin panel" is likely **aggressive caching** of the entry `index.html` file by Vercel or the browser. Even though the JavaScript files have new hashes, if the browser caches the old `index.html`, it will continue to request the old JavaScript files (which may still exist on the CDN), loading the old version of the app.

To fix this comprehensively and prevent recurrence:

### 1. **Configure Cache Headers (`vercel.json`)**
I will update `vercel.json` to explicitly disable caching for `index.html` (`Cache-Control: public, max-age=0, must-revalidate`). This forces the browser to check with the server for the latest version of the entry file every time, while still allowing long-term caching for hashed assets (JS/CSS/Images). This is the standard best practice for SPAs.

### 2. **Inject Build Timestamp (`vite.config.ts` & `main.tsx`)**
I will configure Vite to inject a `__BUILD_TIME__` constant into the application. This will be logged to the browser console on startup.
*   **Why:** This gives us undeniable proof of which version is running. If the user sees an old timestamp in the console, we know it's a caching issue. If they see the new timestamp but old UI, it's a code issue (unlikely given our previous checks).

### 3. **Force Fresh Build**
After applying these configuration changes, I will push them to `master`. This will trigger a new deployment which will now serve the correct cache headers.

**Implementation Plan:**
1.  Modify `vercel.json` to add cache control headers.
2.  Modify `vite.config.ts` to define `__BUILD_TIME__`.
3.  Modify `src/vite-env.d.ts` to add the type definition.
4.  Modify `src/main.tsx` to log the build timestamp.
5.  Commit and push.

**Testing:**
*   **Pre-fix:** You observed the old dashboard.
*   **Post-fix:**
    1.  Open the hosted site.
    2.  Open Chrome DevTools Console.
    3.  Check the "Build Time" log. It should match the current time (UTC).
    4.  Verify the "Admin Panel" button is present.
    5.  Check the Network tab for `index.html` response headers to verify `Cache-Control: public, max-age=0, must-revalidate`.

