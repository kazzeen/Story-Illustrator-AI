# SIAI

![SIAI logo](public/placeholder.svg)

## 1. Project Title and Logo

SIAI (Story Illustrator AI)

## 2. Brief Description

SIAI is a storyboarding web app that turns long-form text into structured scenes and then generates scene illustrations. It combines a React + Vite frontend with Supabase (database, auth, storage, and Edge Functions) to run story analysis, image generation, image editing, and reference-image uploads.

The project includes compliance and quality controls around character age requirements, prompt construction, and generation diagnostics. See [AGE_COMPLIANCE.md](docs/AGE_COMPLIANCE.md) and [API_COMPLIANCE.md](API_COMPLIANCE.md) for details.

## 3. Key Features

- Import stories (PDF/DOCX/ePub/TXT) and create a storyboard from text
- Analyze story text into scenes + characters via Edge Function
- Generate scene images with selectable models and style intensity controls
- Edit generated images with an in-app editor backed by an Edge Function
- Upload per-scene reference images with resizing, thumbnails, and signed URLs
- Scene continuity and consistency checks with debug metadata for failures

## 4. Installation Instructions

### Prerequisites

- Node.js + npm
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
VITE_SUPABASE_PUBLISHABLE_KEY=<YOUR_SUPABASE_ANON_KEY>
```

Start the dev server:

```sh
npm run dev
```

### Supabase (database + functions)

- Migrations live in [supabase/migrations](supabase/migrations).
- Edge Functions live in [supabase/functions](supabase/functions).

To deploy migrations and functions, use the Supabase CLI for your target environment.

## 5. Usage Examples

### Local development

```sh
npm run dev
```

### Build for production

```sh
npm run build
```

### Run checks

```sh
npm run lint
npm run typecheck
npm test
```

### UI behavior notes

- `SceneDetailModal` default sizing targets wide storyboards: `max-width: 78.5rem`, `max-height: 95vh`.
- Scene insertion into story text uses exact-slice matching first, then paragraph-overlap fallback; unplaceable scenes render at the end.

## 6. Configuration Options

### Frontend environment variables

Defined in `.env` and read via `import.meta.env`:

- `VITE_SUPABASE_URL` (required): your Supabase project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` (required): your Supabase anon/publishable key

### Edge Function environment variables

Set these as Supabase Function secrets/environment variables (not in the frontend `.env`):

- `SUPABASE_URL` (required)
- `SUPABASE_SERVICE_ROLE_KEY` (required)
- `SUPABASE_ANON_KEY` (required for user validation in some functions)
- `VENICE_API_KEY` (required for Venice-backed image generation/editing)
- `GEMINI_API_KEY` (required for Gemini-backed image generation, depending on model)

Upload/reference controls used by `upload-reference-image`:

- `ALLOWED_ORIGINS` (optional): comma-separated allowed origins; empty allows all
- `UPLOAD_RATE_MAX` (default `12`), `UPLOAD_RATE_WINDOW_MS` (default `60000`)
- `REFERENCE_MAX_DIM` (default `2048`), `REFERENCE_THUMB_MAX_DIM` (default `384`), `REFERENCE_WEBP_QUALITY` (default `85`)
- `REFERENCE_SIGNED_URL_TTL_SECONDS` (default `604800`)
- `VIRUS_SCAN_REQUIRED` (default `false`)
- `VIRUS_SCAN_URL`, `VIRUS_SCAN_TIMEOUT_MS`
- `VIRUS_SCAN_API_KEY`, `VIRUS_SCAN_API_KEY_HEADER`, `VIRUS_SCAN_AUTH_BEARER`

## 7. API Documentation

SIAI uses Supabase Edge Functions. The HTTP base is:

```txt
<SUPABASE_URL>/functions/v1/<function-name>
```

Frontend calls include:

- `Authorization: Bearer <user_access_token>`
- `apikey: <supabase_anon_key>`

### `analyze-story`

- Auth: required (manual JWT validation in function)
- Body:

```json
{ "storyId": "<uuid>" }
```

- Response: `{ "success": true, "sceneCount": <number>, ... }` (plus additional fields)

### `generate-scene-image`

- Auth: required
- Body (typical):

```json
{
  "sceneId": "<uuid>",
  "artStyle": "digital_illustration",
  "styleIntensity": 50,
  "strictStyle": false,
  "model": "venice-sd35"
}
```

- Response (typical):

```json
{
  "success": true,
  "imageUrl": "https://...",
  "requestId": "..."
}
```

The function also supports resetting all scenes for a story:

```json
{ "reset": true, "storyId": "<uuid>" }
```

### `edit-scene-image`

- Auth: required
- Two modes:
  - `preview`: runs an edit and returns an edited image payload
  - `commit`: stores an edited image to storage and updates the scene

Preview request:

```json
{
  "mode": "preview",
  "prompt": "Replace the background with a rainy night street.",
  "image_url": "https://..."
}
```

Commit request:

```json
{
  "mode": "commit",
  "sceneId": "<uuid>",
  "edited_image_base64": "<base64 or data: URL>",
  "edited_mime": "image/png"
}
```

### `upload-reference-image`

- Auth: required
- Content-Type: `multipart/form-data`
- Form fields:
  - `file` (required): image file
  - `sceneId` (optional): used to group references under a scene
  - `bucket` (optional): `reference-images` (default) or `scene-images`
  - `action` (optional): `upload` (default), `sign`, `delete`

Example upload response includes signed URLs (`url`, `thumbUrl`) plus `objectPath` and `thumbPath`.

## 8. Contribution Guidelines

- Create a feature branch from `main`
- Keep changes scoped and add/adjust tests when behavior changes
- Ensure checks pass before opening a PR:

```sh
npm run lint
npm run typecheck
npm test
```

## 9. License Information

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 10. Badges

![Build](https://img.shields.io/badge/build-not_configured-lightgrey)
![Coverage](https://img.shields.io/badge/coverage-not_configured-lightgrey)
