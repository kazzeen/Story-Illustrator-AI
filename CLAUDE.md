# Story Illustrator AI

AI-powered story illustration app that analyzes stories into scenes and generates images for each scene using multiple AI image generation models.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite (SWC plugin)
- **UI**: shadcn/ui (Radix UI) + Tailwind CSS 3 + next-themes (dark mode)
- **State**: TanStack React Query + custom hooks (no Redux)
- **Routing**: React Router DOM v6
- **Auth**: Supabase Auth (email/password)
- **Database**: Supabase (PostgreSQL) with RLS
- **Backend**: Supabase Edge Functions (Deno runtime)
- **Image Generation**: Venice AI, Google Imagen
- **Payments**: Stripe (checkout sessions + webhooks)
- **Testing**: Vitest + Testing Library (jsdom/node environments)
- **Deployment**: Vercel (static SPA with API rewrites)

## Commands

```bash
npm run dev          # Start dev server (port 5173)
npm run build        # Type-check + production build
npm run typecheck    # TypeScript check only (both app and node configs)
npm run lint         # ESLint
npm run test         # Vitest (run once)
npm run test:watch   # Vitest (watch mode)
npm run preview      # Preview production build
```

### Supabase

```bash
npx supabase functions deploy                           # Deploy all edge functions
npx supabase functions deploy generate-scene-image      # Deploy single function
```

## Project Structure

```
src/
  pages/              # Route-level page components
    admin/            # Admin-only pages (user management)
  components/
    ui/               # shadcn/ui primitives (do not edit manually)
    layout/           # Navbar, Layout wrapper
    create-story/     # Story creation form + LLM model selector
    storyboard/       # Scene grid, scene cards, style/model selectors, character list
    credits/          # Credit balance monitor, zero credits dialog
    dashboard/        # Story cards, stats, quick actions
    import/           # File upload for story import
  hooks/              # Custom React hooks
    auth-provider.tsx # AuthProvider context (wraps Supabase auth)
    auth-context.ts   # Auth context type definitions
    useAuth.tsx       # useAuth() hook
    useStories.tsx    # useStories() + useScenes() hooks with realtime subscriptions
    useCharacters.tsx # Character CRUD + compliance enforcement
    admin-provider.tsx# Admin API gateway helper
  integrations/
    supabase/
      client.ts       # Supabase client singleton (auto-generated, do not edit)
      types.ts         # Database types (auto-generated from Supabase schema)
  lib/                # Utilities and business logic
    utils.ts          # cn() tailwind merge helper
    type-guards.ts    # isRecord, parseJsonIfString, isAbortedError
    character-compliance.ts   # Age compliance enforcement
    clothing-colors.ts        # Clothing color validation
    scene-character-appearance.ts # Prompt attribute injection
    venice-image-edit.ts      # Venice image edit API helpers
    image-validation.ts       # Blank image detection
    credit-notifications.ts   # Credit-related toast notifications
    credit-reconciliation.ts  # Credit reconciliation logic
    story-html.ts             # HTML export for stories
    reference-images.ts       # Reference image utilities
    error-reporting.ts        # Error reporting utilities
    ui-preferences.ts         # User UI preference persistence

supabase/
  config.toml         # Supabase project config (project_id, function JWT settings)
  functions/
    _shared/          # Shared Deno modules used across edge functions
      helpers.ts      # isRecord, jsonResponse, UUID_REGEX, etc.
      credits.ts      # Credit type parsers (reserve/commit/release/consume)
      style-prompts.ts# Art style definitions, style guidance builders
      prompt-assembly.ts  # Prompt sanitization and assembly
      clothing-colors.ts  # Server-side clothing color logic
      stripe-helpers.ts   # Stripe webhook helpers
    generate-scene-image/ # Image generation (Venice AI, Google Imagen)
    generate-story/       # LLM story generation
    analyze-story/        # Story analysis into scenes
    edit-scene-image/     # Image editing/inpainting
    generate-character-reference/ # Character reference sheet generation
    upload-reference-image/       # Reference image upload
    credits/              # Credit balance/status endpoint
    stripe-webhook/       # Stripe webhook handler
    api-admin/            # Admin API gateway
    create-creator-membership-checkout/   # Stripe checkout for Creator tier
    create-starter-membership-checkout/   # Stripe checkout for Starter tier
    create-credit-pack-checkout/          # Stripe checkout for credit packs
  migrations/         # SQL migrations (chronological, applied via Supabase CLI)
```

## Key Patterns

### Path Alias
`@/` resolves to `./src/` (configured in tsconfig.json and vite.config.ts).

### shadcn/ui
Components in `src/components/ui/` are shadcn/ui primitives. They follow the default style with slate base color and CSS variables for theming. Do not manually edit these files; use `npx shadcn-ui add <component>` to add new ones.

### Authentication
- `AuthProvider` wraps the app, provides `useAuth()` hook
- Auth state managed via Supabase `onAuthStateChange` listener
- Profile data (display_name, credits_balance, subscription_tier, is_admin) fetched on auth state change
- Admin routes check `profile.is_admin`

### Realtime Subscriptions
- `useStories()` subscribes to `stories` and `scenes` table changes for live dashboard updates
- `useScenes(storyId)` subscribes to scene and character changes for the active storyboard
- Character attribute changes automatically update scene image prompts via realtime listeners

### Credit System
- Reserve/commit/release pattern for credit transactions
- Credits managed via `user_credits` table and `credit_transactions` log
- Edge functions call RPC functions for atomic credit operations
- Profiles table mirrors credit balance for quick reads
- Tiers: free, starter, creator (with monthly quotas)

### Image Generation Flow
1. Scene gets `image_prompt` from story analysis
2. Character attributes are injected into prompts via `updateImagePromptWithAttributes()`
3. Edge function `generate-scene-image` calls Venice AI or Google Imagen
4. Blank image detection validates results
5. Credits are reserved before generation, committed on success, released on failure

### Style System
Art styles defined in `supabase/functions/_shared/style-prompts.ts` with categories (anime, realistic, artistic, 3d, pixel). Each style has prefix text, visual elements, color palettes, and composition guidelines that get injected into prompts.

## Database Tables

Core tables: `stories`, `scenes`, `characters`, `profiles`
Character system: `character_reference_sheets`, `character_asset_versions`, `character_change_events`, `scene_character_states`
Credits: `credit_transactions`, `image_generation_attempts`
Quality: `consistency_logs`, `scene_consistency_metrics`, `prompt_optimizations`, `story_style_guides`

## Environment Variables

### Frontend (VITE_ prefix, exposed to browser)
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous/publishable key

### Edge Functions (Deno.env)
- `SUPABASE_URL` - Supabase URL (auto-injected)
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (auto-injected)
- `VENICE_API_KEY` - Venice AI API key
- `GOOGLE_API_KEY` - Google API key (for Imagen)
- `STRIPE_SECRET_KEY` - Stripe secret key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret

## Testing

Tests are colocated with source files using `.test.ts` / `.test.tsx` suffix. Test environment is `node` by default (configured in vite.config.ts). Component tests use `jsdom` via `@testing-library/react`.

```bash
npm run test           # Run all tests once
npm run test:watch     # Watch mode
```

Edge function tests live in `supabase/functions/<fn>/tests/` and `supabase/functions/_shared/`.

## Deployment

- Deployed to **Vercel** as a static SPA
- `vercel.json` configures rewrites: `/api/admin/*` proxies to Supabase edge function, all other routes rewrite to `/index.html`
- Dev server proxies `/api/admin` to Supabase edge function URL
- Build injects `__BUILD_TIME__` and `__COMMIT_HASH__` for debugging stale deploys
- Static assets get immutable cache headers; `index.html` is never cached

## TypeScript Config

- `strictNullChecks: false`, `noImplicitAny: false` (relaxed strictness)
- `noUnusedLocals: false`, `noUnusedParameters: false`
- Two project references: `tsconfig.app.json` (src) and `tsconfig.node.json` (config files)
