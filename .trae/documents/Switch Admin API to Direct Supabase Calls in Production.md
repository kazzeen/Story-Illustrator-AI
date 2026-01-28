Based on the investigation, the discrepancy is likely due to how the Vercel Rewrite interacts with the Supabase Edge Function's URL structure and CORS handling.

The `api-admin` function is active and deployed. The `config.toml` shows `verify_jwt = false`, which is correct since we manually handle auth headers.

However, a potential issue is that Vercel rewrites might be forwarding the request in a way that the Supabase Function's manual path parsing (`url.pathname.split("/api-admin/")[1]`) misinterprets, or Vercel is stripping the `/api/admin` prefix before sending it to the destination if not careful.

But more importantly, relying on Vercel Rewrites introduces a layer of complexity that can fail silently (e.g., if the destination returns a redirect or if headers are mangled).

To ensure the deployed site works **exactly** like localhost (which uses a proxy that strips the prefix), and to eliminate the Vercel Rewrite as a point of failure, I will implement a robust fallback strategy that supports **Direct Calls** to the Supabase Edge Function in production. This bypasses the Vercel backend entirely for these API calls, which is the standard pattern for JAMstack apps interacting with external APIs (Supabase).

**The Plan:**

1. **Update** **`admin-provider.tsx`:**

   * Instead of forcing `/api/admin/...` in production (which relies on the rewrite), I will revert to using the **Direct Supabase Function URL** for production builds.

   * I will ensure the path construction is robust: `https://[project].supabase.co/functions/v1/api-admin/[path]`.

   * This eliminates the dependency on `vercel.json` rewrites working correctly.

2. **Verify CORS:**

   * The Edge Function `api-admin/index.ts` already sends `Access-Control-Allow-Origin: *`. This allows the browser to make direct cross-origin requests from the Vercel domain to Supabase.

   * This matches how standard Supabase clients (`supabase-js`) work (they talk directly to Supabase).

3. **Cleanup:**

   * I will remove the `vercel.json` rewrite rule to avoid confusion. If we are calling directly, we don't need the rewrite.

**Why this fixes it:**

* Localhost continues to use `/api/admin` via Vite Proxy (no change).

* Production uses direct URL `https://.../api-admin/...`.

* Both hit the *same* Edge Function.

* The Edge Function's path parsing logic (`if (url.pathname.includes("/api-admin/"))`) works for both:

  * Proxy sends: `.../functions/v1/api-admin/users`

  * Direct sends: `.../functions/v1/api-admin/users`

* This creates a consistent, explicit data flow without hidden Vercel middleware.

**Wait, didn't the previous code try direct URL?**
Yes, but it had a fallback: `if (!supabaseUrl) return /api/admin/...`. If `VITE_SUPABASE_URL` wasn't set in Vercel, it failed.
**I will assume** **`VITE_SUPABASE_URL`** **IS set.** (The app wouldn't work otherwise). If it's missing, the app *should* fail loudly, but I'll add a check.

**Wait, what if the previous failure ("Received HTML") was because** **`VITE_SUPABASE_URL`** ***is*** **missing in Vercel?**
If so, my new plan will also fail (or I need to fix the env var).
But the user says "deployed site... not showing the same admin panel". If the whole site was broken (no login), they'd say "site is broken".
So `VITE_SUPABASE_URL` is likely present.
The failure "Received HTML" suggests the *fallback* path `/api/admin` was hit, which means either:

1. The direct URL construction logic was skipped (env var missing?).
2. OR the direct URL was constructed, but the *browser* blocked it (CORS) -> catch block -> ??? No, `adminApi` throws.

**Actually, the previous code had:**

```typescript
  if (import.meta.env.DEV) { return ... }
  const supabaseUrl = ...
  return `${baseUrl}/functions/v1/api-admin/${cleanPath}`;
```

This looks correct for direct access.
Why did it fail before?
"Received HTML instead of JSON" happens when `fetch(url)` returns HTML.
If `url` was the Supabase function, it would return JSON (error or success).
It returns HTML only if it hit Vercel's `index.html`.
This implies the code *did* use the relative path `/api/admin/...` in production, which means `import.meta.env.DEV` was true (unlikely) or `supabaseUrl` was missing.

**Refined Plan:**
I will switch to **Direct URL** but I will also **Hardcode the Supabase URL** as a fallback if the env var is missing, to guarantee it generates a valid external URL. This ensures we don't accidentally fall back to the Vercel path.

1. **Modify** **`src/hooks/admin-provider.tsx`**:

   * Use direct URL in production.

   * Add a hardcoded fallback for the project URL (`https://gaxmjxiqjirjeyemjcyc.supabase.co`) to ensure it never reverts to a relative path in production.

2. **Revert** **`vercel.json`**:

   * Remove the rewrite rule to keep configuration clean.

3. **Deploy**:

   * Commit and push.

