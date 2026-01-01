# Style Handling

## Scope

This document describes how the selected Art Style is carried from the UI into image generation, how it is applied to prompts, and how to debug style-related issues.

## Root Cause (2026-01)

Art styles were not consistently reflected in output because the image generation Edge Function was not actually embedding the selected style into the generation prompt. The request included `artStyle`, `styleIntensity`, and `strictStyle`, but prompt construction treated style prompts as a placeholder and did not apply them reliably. As a result, different style selections often produced the same effective prompt.

## Current Pipeline

1. UI selects a style id (e.g. `cinematic`, `watercolor`) in [StyleSelector.tsx](file:///d:/Projects/SIAI%20Lovable/src/components/storyboard/StyleSelector.tsx).
2. The storyboard page sends `artStyle`, `styleIntensity`, `strictStyle`, and `disabledStyleElements` to `generate-scene-image` ([Storyboard.tsx](file:///d:/Projects/SIAI%20Lovable/src/pages/Storyboard.tsx)).
3. The Edge Function normalizes/validates the style id and applies:
   - A positive style guidance suffix to the prompt
   - A negative style guidance suffix (plus disabled style elements)
   - Style-weighted `cfg_scale` and `steps` (Venice-backed models)

Style guidance templates and weighting helpers live in [style-prompts.ts](file:///d:/Projects/SIAI%20Lovable/supabase/functions/_shared/style-prompts.ts).

## Style Application Rules

- `styleIntensity` (0–100) controls how strongly style tokens are embedded:
  - Lower intensity uses a reduced style token subset
  - Higher intensity adds stronger stylization cues
- `strictStyle` increases the likelihood that the output remains within the requested style by emphasizing consistency terms and slightly increasing generation effort.
- `disabledStyleElements` are appended to negative guidance to actively avoid specific stylistic traits.
- If a style id is allowed but lacks an explicit template, a safe fallback embeds the style name as a token and records a warning.

## Debugging and Error Reporting

The Edge Function persists `generation_debug` inside `scenes.consistency_details`, including:
- `prompt`, `prompt_full`, `preprocessingSteps`
- `requestParams` (model/style/intensity/strict/disabled)
- `warnings` for style fallbacks or invalid style requests

In the UI, these fields can be inspected via the scene debug details in the storyboard modal.

