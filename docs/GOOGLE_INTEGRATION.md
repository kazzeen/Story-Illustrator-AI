# Google Gemini & Imagen Integration

This project integrates Google's Generative AI models for image generation, specifically leveraging the Imagen family of models via the Gemini API.

## Configuration

The integration requires a valid Google API Key with access to the Generative Language API.

1.  **Environment Variable**:
    Ensure `GEMINI_API_KEY` is set in your `.env` file or environment configuration.
    ```env
    GEMINI_API_KEY="AIza..."
    ```

## Supported Models

The system maps the following internal model identifiers to Google's specific models:

| Internal ID | Google Model ID | Description |
| :--- | :--- | :--- |
| `gemini-2.5-flash` | `imagen-4.0-fast-generate-001` | High-speed generation optimized for rapid iteration. |
| `gemini-3-pro` | `imagen-4.0-generate-001` | Professional quality generation with higher detail. |

## Integration Details

The integration is handled in `supabase/functions/generate-scene-image/index.ts`.

-   **Endpoint**: Uses the `predict` method of the Generative Language API.
    -   `https://generativelanguage.googleapis.com/v1beta/models/{model}:predict`
-   **Payload**:
    ```json
    {
      "instances": [{ "prompt": "..." }],
      "parameters": {
        "sampleCount": 1,
        "aspectRatio": "1:1" // Calculated dynamically
      }
    }
    ```
-   **Response Handling**:
    The system transforms the Google API response (Base64 encoded predictions) into a standardized format compatible with the existing image processing pipeline.

## Troubleshooting

### Common Errors

-   **400 Billed Users Only**:
    The Imagen API (specifically `imagen-4.0-*`) often requires a billing-enabled Google Cloud project or a paid tier on Google AI Studio. Free tier keys may not have access to these specific models.
    
-   **429 Resource Exhausted**:
    The API key has exceeded its rate limit or quota. Check your Google AI Studio dashboard.

-   **403 Permission Denied**:
    The API key is invalid or does not have the `generativelanguage.googleapis.com` API enabled.

### Verification

To verify the integration, use the provided test scripts in the `test/` directory (e.g., `test/test_google_gen.js`).
