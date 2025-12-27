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
