# Venice API Compliance Requirements

## Watermark and Safety Settings

To ensure compliance with project requirements, all image generation requests sent to the Venice API must strictly adhere to the following parameter settings:

- **`safe_mode`**: Must be explicitly set to `false`.
- **`hide_watermark`**: Must be explicitly set to `true`.

### Rationale

These settings are mandatory to ensure consistent output quality and to meet verification standards. 
- `safe_mode: false` ensures that the generation is not restricted by aggressive safety filters which might block legitimate content.
- `hide_watermark: true` is required to disable (hide) the default watermark. Setting this to `false` will result in visible watermarks.

### Implementation Details

The compliance logic is enforced in `supabase/functions/generate-scene-image/index.ts`.
All requests to `https://api.venice.ai/api/v1/image/generate` are wrapped with enforcement logic that hardcodes these parameters.

### Example Request Payload

```json
{
  "model": "venice-sd35",
  "prompt": "Example prompt",
  "safe_mode": false,
  "hide_watermark": true,
  "width": 1024,
  "height": 576,
  "steps": 30,
  "cfg_scale": 7.5
}
```

### Consequences of Non-Compliance

Failure to adhere to these settings may result in:
1.  Inconsistent image outputs.
2.  Unexpected content blocking.
3.  Audit failures during automated testing.

### Automated Verification

The `test/test_venice.js` script includes automated checks to verify that these parameters are correctly included in the request payload.
Logs are generated with the prefix `[Compliance]` for every generation attempt to facilitate auditing.

## Clothing Color Assignment Rules

All future scene prompt generations must ensure that clothing descriptions include explicit color attributes for every garment mentioned.

### Rules

- Every clothing item must include a color adjective (e.g., `red shirt`, `navy trousers`, `lavender dress`).
- If a clothing item already contains an explicit color, it is preserved as-is.
- When multiple clothing items are present, assigned colors should be visually distinct between items.
- When no specific color is provided, the system assigns a deterministic color from a predefined palette based on a stable seed (story/scene/character context), to avoid random flicker between retries.
- Scene context (formal/professional/somber/warm/cold) biases palette selection toward more appropriate colors.

### Palettes

- Feminine-coded garments (e.g., dress, skirt, blouse, heels, lingerie): `pink`, `rose pink`, `hot pink`, `blush`, `magenta`, `fuchsia`, `lavender`, `lilac`, `purple`, `violet`, `plum`
- Masculine-coded garments (e.g., suit, tuxedo, tie): `black`, `charcoal`, `slate gray`, `navy`, `midnight blue`, `white`, `cream`, `brown`, `tan`, `olive`, `forest green`, `burgundy`
- Neutral/default garments: `black`, `white`, `gray`, `navy`, `denim blue`, `olive`, `tan`, `brown`, `beige`, `teal`, `maroon`

### Validation

After color assignment, the system validates that each recognized clothing segment contains at least one color token. Missing colors are treated as quality-control issues and must be corrected before final prompt submission.

## Credits Initialization Rules

All new accounts and all active accounts must be initialized with 5 free monthly credits (basic tier).

### Source of Truth

- Credits are tracked in `public.user_credits` (monthly + bonus pools).
- The client displays the current credits using the `credits` Edge Function, which computes `remaining_monthly + remaining_bonus`.

### Required Behavior

- New account creation must create a `public.user_credits` row with `tier = basic` and `monthly_credits_per_cycle = 5`.
- Activating an account (`profiles.subscription_status = active`) must ensure credits exist for that user.
- Initialization must be idempotent (do not overwrite users who have already used credits).

### Enforcement

- Database-level: `user_credits_monthly_per_cycle_matches_tier` constraint enforces the tier-to-default mapping.
- Database-level: `ensure_profile_credits_initialized` trigger ensures `user_credits` exists on profile insert/activation.
- Admin tooling: `admin_init_active_accounts_free_5` and `admin_verify_active_accounts_free_5` support backfill and verification.
