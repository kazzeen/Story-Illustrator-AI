# Supported Venice Image Models

The system currently supports the following Venice AI image generation models. These models replace all legacy models.

## 1. Venice SD3.5 (Private)
*   **Identifier**: `venice-sd35`
*   **Description**: Private implementation of Stable Diffusion 3.5. Balanced performance with excellent prompt adherence.
*   **Strengths**: General Purpose, Prompt Adherence.

## 2. HiDream (Private)
*   **Identifier**: `hidream`
*   **Description**: High-quality generation with validated output standards.
*   **Strengths**: General Purpose, Quality.

## 3. Lustify SDXL (Private | Uncensored)
*   **Identifier**: `lustify-sdxl`
*   **Description**: Uncensored model optimized for character portraits.
*   **Strengths**: Uncensored, Characters.
*   **Notes**: Prompts are truncated to 1400 characters for compatibility.

## 4. Lustify v7 (Private | Uncensored)
*   **Identifier**: `lustify-v7`
*   **Description**: Latest uncensored model with improved parameter tuning.
*   **Strengths**: Uncensored, Advanced.
*   **Notes**: Prompts are truncated to 1400 characters for compatibility.

## 5. Qwen (Private)
*   **Identifier**: `qwen-image`
*   **Description**: Optimized for cultural context and diverse language prompts.
*   **Strengths**: Cultural Context, Multi-language.

## 6. Anime (WAI) (Private)
*   **Identifier**: `wai-Illustrious`
*   **Description**: Specialized for anime style and character consistency.
*   **Strengths**: Anime, Manga.

## 7. Z-Image Turbo (Private)
*   **Identifier**: `z-image-turbo`
*   **Description**: High-speed generation optimized for rapid iteration.
*   **Strengths**: Speed, Iteration.

## Implementation Details
*   All models support `safe_mode: false` and `hide_watermark: true`.
*   Fallback mechanism defaults to `lustify-sdxl` if the primary model fails.
*   Prompt truncation is automatically applied to `lustify-*` models.
