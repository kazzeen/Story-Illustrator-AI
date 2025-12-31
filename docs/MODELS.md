# Supported Image Models

The system supports a variety of image generation models from different providers.

## Venice AI Models
(See existing documentation for Venice models)

## Google Gemini / Imagen Models

The system integrates Google's latest image generation models.

### 1. Gemini 2.5 Flash (Imagen 4.0 Fast)
*   **Identifier**: `gemini-2.5-flash`
*   **Provider**: Google
*   **Description**: High-speed generation optimized for rapid iteration. Maps to `imagen-4.0-fast-generate-001`.
*   **Strengths**: Speed, Efficiency.

### 2. Gemini 3 Pro (Imagen 4.0)
*   **Identifier**: `gemini-3-pro`
*   **Provider**: Google
*   **Description**: Professional asset production with high detail. Maps to `imagen-4.0-generate-001`.
*   **Strengths**: Quality, Photorealism.

## Venice SD3.5 (Private)
*   **Identifier**: `venice-sd35`
*   **Description**: Private implementation of Stable Diffusion 3.5. Balanced performance with excellent prompt adherence.
*   **Strengths**: General Purpose, Prompt Adherence.

## HiDream (Private)
*   **Identifier**: `hidream`
*   **Description**: High-quality generation with validated output standards.
*   **Strengths**: General Purpose, Quality.

## Lustify SDXL (Private | Uncensored)
*   **Identifier**: `lustify-sdxl`
*   **Description**: Uncensored model optimized for character portraits.
*   **Strengths**: Uncensored, Characters.
*   **Notes**: Prompts are truncated to 1400 characters for compatibility.

## Lustify v7 (Private | Uncensored)
*   **Identifier**: `lustify-v7`
*   **Description**: Latest uncensored model with improved parameter tuning.
*   **Strengths**: Uncensored, Advanced.
*   **Notes**: Prompts are truncated to 1400 characters for compatibility.

## Qwen (Private)
*   **Identifier**: `qwen-image`
*   **Description**: Optimized for cultural context and diverse language prompts.
*   **Strengths**: Cultural Context, Multi-language.

## Anime (WAI) (Private)
*   **Identifier**: `wai-Illustrious`
*   **Description**: Specialized for anime style and character consistency.
*   **Strengths**: Anime, Manga.

## Z-Image Turbo (Private)
*   **Identifier**: `z-image-turbo`
*   **Description**: High-speed generation optimized for rapid iteration.
*   **Strengths**: Speed, Iteration.

## Implementation Details
*   All models support `safe_mode: false` and `hide_watermark: true`.
*   Fallback mechanism defaults to `lustify-sdxl` if the primary model fails.
*   Prompt truncation is automatically applied to `lustify-*` models.
