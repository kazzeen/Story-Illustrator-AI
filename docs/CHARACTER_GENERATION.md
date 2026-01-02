# Character Reference Generation API

This Edge Function generates high-quality, consistent character reference sheets suitable for use as input in scene generation.

## Endpoint
`POST /generate-character-reference`

## Authentication
Requires a valid Supabase JWT (Bearer token).

## Input Parameters (JSON)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `characterId` | UUID | Yes | The ID of the character in the `characters` table. |
| `name` | String | No | Character Name (defaults to "Character"). |
| `description` | String | No | General description or bio. |
| `physicalAttributes` | String | No | Physical traits (hair, eyes, build, skin). |
| `clothing` | String | No | Outfit description. |
| `accessories` | String | No | Accessories (glasses, weapons, items). |
| `style` | String | No | Art style (e.g., "anime", "realistic", "digital_illustration"). Default: "digital_illustration". |
| `model` | String | No | Model ID (e.g., "venice-sd35", "lustify-sdxl"). Default: "venice-sd35". |
| `pose` | String | No | View type ("front", "side", "portrait"). Default: "character sheet layout". |
| `forceRegenerate` | Boolean | No | If true, bypasses cache. Default: false. |

## Output (JSON)

**Success (200 OK):**
```json
{
  "success": true,
  "requestId": "uuid...",
  "imageUrl": "https://...",
  "referenceSheetId": "uuid...",
  "cached": false
}
```

**Error (4xx/5xx):**
```json
{
  "error": "Error message",
  "details": "Detailed error info",
  "requestId": "uuid..."
}
```

## Features

1.  **High Consistency**: Uses specialized prompts ("character reference sheet", "multiple views") to create a comprehensive visual guide.
2.  **Smart Caching**: Hashes the input prompt and settings to check if a matching reference sheet already exists for this character, saving credits and time.
3.  **Automatic Integration**: Automatically creates a record in `character_reference_sheets` and updates the `characters` table to set the new image as the `active_reference_sheet_id`.
4.  **Style Awareness**: Adjusts prompts based on `style` input (e.g., adding "cel shaded" for anime).

## Usage Example (TypeScript)

```typescript
const response = await supabase.functions.invoke('generate-character-reference', {
  body: {
    characterId: "123e4567-e89b-12d3-a456-426614174000",
    name: "Aria",
    physicalAttributes: "Long silver hair, purple eyes, athletic build",
    clothing: "Cyberpunk tactical gear, neon blue accents",
    style: "anime",
    model: "wai-Illustrious"
  }
});

if (response.data.success) {
  console.log("New Reference:", response.data.imageUrl);
}
```

## Integration Guidelines

1.  **Frontend**: Call this function when the user saves a character profile or clicks "Generate Reference Sheet".
2.  **Display**: Show the returned `imageUrl` in the character editor.
3.  **Scene Generation**: The system automatically uses the `active_reference_sheet_id` from the character record. No further action needed; once this function completes, the character is "ready" for scenes.
