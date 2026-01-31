# SIAI

![SIAI logo](public/placeholder.svg)

## 1. Project Title and Logo

SIAI (Story Illustrator AI) &mdash; v6.0.0

## 2. Brief Description

SIAI is a storyboarding web app that lets users create stories with AI or import existing text, break them into structured scenes, and generate illustrations for each scene. It combines a React + Vite + TypeScript frontend with Supabase (database, auth, storage, and Edge Functions) for story analysis, image generation, image editing, character reference management, and a credit-based billing system via Stripe.

The project includes compliance and quality controls around character age requirements, prompt construction, and generation diagnostics. See [AGE_COMPLIANCE.md](docs/AGE_COMPLIANCE.md) and [API_COMPLIANCE.md](API_COMPLIANCE.md) for details.

## 3. Key Features

- **AI Story Creation** &mdash; Generate stories from a prompt, genre, characters, and setting using selectable LLM models (Llama 3.3 70B, Venice Uncensored, Qwen 3 235B, Mistral 31 24B, Llama 3.2 3B)
- **Story Import** &mdash; Upload TXT files and analyze them into scenes and characters via an Edge Function
- **Multi-Model Image Generation** &mdash; Generate scene illustrations with 9 image models across Google (Gemini 2.5 Flash, Gemini 3 Pro), Venice (SD3.5, HiDream, Qwen), Lustify (SDXL, v7), WAI (Anime), and Z-Image Turbo
- **Art Style System** &mdash; Configurable art styles (digital illustration, anime, realistic, pixel art, etc.) with intensity controls and per-story style guides
- **Scene Image Editing** &mdash; In-app image editor backed by an Edge Function with preview and commit modes
- **Character Consistency** &mdash; Character reference sheet generation, asset versioning, and per-scene character state tracking for visual continuity
- **Reference Image Uploads** &mdash; Per-scene reference images with resizing, thumbnails, and signed URLs

## 4. Installation Instructions

### Prerequisites

- Node.js (v18+) and npm
- A Supabase project (or Supabase local dev via the Supabase CLI)

### Install and run the frontend

```sh
git clone https://github.com/kazzeen/Story-Illustrator-AI.git
cd Story-Illustrator-AI
npm install
```

Create a `.env` file in the repository root:

```sh
VITE_SUPABASE_URL=https://<YOUR_PROJECT_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<YOUR_SUPABASE_ANON_KEY>
```

Start the dev server:

```sh
npm run dev
```

The app runs at `http://localhost:5173`.

### Supabase (database + functions)

- Migrations live in [supabase/migrations](supabase/migrations).
- Edge Functions live in [supabase/functions](supabase/functions).
- Shared modules used across functions live in [supabase/functions/_shared](supabase/functions/_shared).

To deploy migrations and functions, use the Supabase CLI for your target environment.

```sh
npx supabase db push                                # Apply migrations
npx supabase functions deploy                       # Deploy all edge functions
npx supabase functions deploy generate-scene-image  # Deploy a single function
```

## 5. Usage

### Commands

```sh
npm run dev          # Start dev server (port 5173)
npm run build        # Type-check + production build
npm run typecheck    # TypeScript check only
npm run lint         # ESLint
npm test             # Run tests (Vitest, single run)
npm run test:watch   # Run tests (watch mode)
npm run preview      # Preview production build locally
```

### Application Routes

| Route | Description |
|-------|-------------|
| `/` | Dashboard &mdash; list of stories with progress |
| `/auth` | Sign up / sign in |
| `/create-story` | AI story generation with LLM model selection |
| `/import` | Upload TXT files for analysis |
| `/storyboard/:storyId` | Storyboard view with scenes, image generation, and editing |
| `/pricing` | Subscription plans and feature comparison |
| `/profile` | Credit balance, transaction history, generation attempts |
| `/admin/users` | Admin user management (admin only) |
| `/admin/users/:userId` | Admin user detail view (admin only) |

## 6. Configuration

### Frontend environment variables

Defined in `.env` and read via `import.meta.env`:

- `VITE_SUPABASE_URL` (required): Supabase project URL
- `VITE_SUPABASE_ANON_KEY` (required): Supabase anonymous key (falls back to `VITE_SUPABASE_PUBLISHABLE_KEY` if not set)

### Edge Function environment variables

Set these as Supabase Function secrets (not in the frontend `.env`):

| Variable | Required | Used By |
|----------|----------|---------|
| `SUPABASE_URL` | Yes (auto-injected) | All functions |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (auto-injected) | All functions |
| `VENICE_API_KEY` | Yes | `generate-scene-image`, `edit-scene-image`, `generate-story`, `generate-character-reference` |
| `GOOGLE_API_KEY` | For Google models | `generate-scene-image` (Gemini 2.5 Flash, Gemini 3 Pro) |
| `STRIPE_SECRET_KEY` | For payments | `create-*-checkout`, `stripe-webhook` |
| `STRIPE_WEBHOOK_SECRET` | For payments | `stripe-webhook` |

Upload/reference controls used by `upload-reference-image`:

- `ALLOWED_ORIGINS` (optional): comma-separated allowed origins; empty allows all
- `UPLOAD_RATE_MAX` (default `12`), `UPLOAD_RATE_WINDOW_MS` (default `60000`)
- `REFERENCE_MAX_DIM` (default `2048`), `REFERENCE_THUMB_MAX_DIM` (default `384`), `REFERENCE_WEBP_QUALITY` (default `85`)
- `REFERENCE_SIGNED_URL_TTL_SECONDS` (default `604800`)

## 7. API Documentation

SIAI uses Supabase Edge Functions. The HTTP base is:

```
<SUPABASE_URL>/functions/v1/<function-name>
```

Frontend calls include:

- `Authorization: Bearer <user_access_token>`
- `apikey: <supabase_anon_key>`

### `generate-story`

- Auth: required
- Body:

```json
{
  "genre": "Fantasy",
  "prompt": "A young wizard discovers...",
  "characters": "Arin, Mira",
  "setting": "Medieval kingdom",
  "plotPoints": "Discovery, betrayal, redemption",
  "model": "llama-3.3-70b"
}
```

- Available models: `llama-3.3-70b`, `venice-uncensored`, `qwen3-235b`, `mistral-31-24b`, `llama-3.2-3b`
- Response: `{ "success": true, "story": { "id": "...", "title": "...", "content": "..." } }`

### `analyze-story`

- Auth: required
- Body:

```json
{ "storyId": "<uuid>" }
```

- Response: `{ "success": true, "sceneCount": <number>, ... }`

### `generate-scene-image`

- Auth: required
- Body:

```json
{
  "sceneId": "<uuid>",
  "artStyle": "digital_illustration",
  "styleIntensity": 50,
  "strictStyle": false,
  "model": "venice-sd35"
}
```

- Available models: `gemini-2.5-flash`, `gemini-3-pro`, `venice-sd35`, `hidream`, `lustify-sdxl`, `lustify-v7`, `qwen-image`, `wai-Illustrious`, `z-image-turbo`
- Response: `{ "success": true, "imageUrl": "https://...", "requestId": "..." }`
- Reset all scenes: `{ "reset": true, "storyId": "<uuid>" }`

### `edit-scene-image`

- Auth: required
- Preview mode:

```json
{
  "mode": "preview",
  "prompt": "Replace the background with a rainy night street.",
  "image_url": "https://..."
}
```

- Commit mode:

```json
{
  "mode": "commit",
  "sceneId": "<uuid>",
  "edited_image_base64": "<base64 or data: URL>",
  "edited_mime": "image/png"
}
```

### `generate-character-reference`

- Auth: required
- Generates a character reference sheet image based on character attributes and story style

### `credits`

- Auth: required
- Body: `{ "action": "status", "limit": 10 }`
- Returns credit balance, tier info, remaining monthly/bonus credits, and recent transactions

### `upload-reference-image`

- Auth: required
- Content-Type: `multipart/form-data`
- Form fields:
  - `file` (required): image file
  - `sceneId` (optional): group reference under a scene
  - `bucket` (optional): `reference-images` (default) or `scene-images`
  - `action` (optional): `upload` (default), `sign`, `delete`
- Response includes signed URLs (`url`, `thumbUrl`) plus `objectPath` and `thumbPath`

### Stripe Checkout Functions

- `create-starter-membership-checkout` &mdash; Creates a Stripe checkout session for the Starter plan
- `create-creator-membership-checkout` &mdash; Creates a Stripe checkout session for the Creator plan
- `create-credit-pack-checkout` &mdash; Creates a Stripe checkout session for bonus credit packs

### `stripe-webhook`

- Handles Stripe webhook events (checkout completion, subscription changes)
- Verifies webhook signatures using `STRIPE_WEBHOOK_SECRET`

### `api-admin`

- Auth: required (must have `is_admin` flag on profile)
- RESTful gateway for admin operations (user listing, user detail, credit adjustments)
- In development, proxied via Vite at `/api/admin`; in production, proxied via Vercel rewrites

## 8. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite (SWC) |
| UI Components | shadcn/ui (Radix UI), Tailwind CSS 3, next-themes |
| State Management | TanStack React Query, custom hooks |
| Routing | React Router DOM v6 |
| Auth | Supabase Auth (email/password) |
| Database | Supabase (PostgreSQL) with RLS |
| Backend | Supabase Edge Functions (Deno) |
| Image Generation | Venice AI, Google Imagen 4.0 |
| Payments | Stripe (Checkout Sessions + Webhooks) |
| Testing | Vitest, Testing Library |
| Deployment | Vercel (static SPA) |

## 9. Contribution Guidelines

- Create a feature branch from `main`
- Keep changes scoped and add/adjust tests when behavior changes
- Ensure checks pass before opening a PR:

```sh
npm run lint
npm run typecheck
npm test
```

## 10. License Information

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 11. Additional Documentation

- [AGE_COMPLIANCE.md](docs/AGE_COMPLIANCE.md) &mdash; Character age compliance rules
- [API_COMPLIANCE.md](API_COMPLIANCE.md) &mdash; API compliance details
- [CHARACTER_GENERATION.md](docs/CHARACTER_GENERATION.md) &mdash; Character generation pipeline
- [CHECKOUT_AUTHORIZATION.md](docs/CHECKOUT_AUTHORIZATION.md) &mdash; Stripe checkout flow
- [GOOGLE_INTEGRATION.md](docs/GOOGLE_INTEGRATION.md) &mdash; Google Imagen integration
- [MODELS.md](docs/MODELS.md) &mdash; Image model details
- [PROMPT_PIPELINE.md](docs/PROMPT_PIPELINE.md) &mdash; Prompt construction pipeline
- [STYLE_HANDLING.md](docs/STYLE_HANDLING.md) &mdash; Art style system
- [VERCEL_RESET_GUIDE.md](VERCEL_RESET_GUIDE.md) &mdash; Vercel deployment troubleshooting
