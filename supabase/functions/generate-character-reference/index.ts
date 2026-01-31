import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";
import {
  buildStoryStyleGuideGuidance,
  buildStyleGuidance,
  clampNumber,
  computeStyleCfgScaleForStyle,
  computeStyleStepsForStyle,
  getStyleCategory,
  STYLE_CONFLICTS,
  validateStyleApplication,
} from "../_shared/style-prompts.ts";
import { assemblePrompt, sanitizePrompt } from "../_shared/prompt-assembly.ts";

import { type JsonObject, isRecord, asString, UUID_REGEX, jsonResponse } from "../_shared/helpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
type CharacterWithStoryRow = {
  id: string;
  story_id: string;
  name: string;
  description: string | null;
  physical_attributes: string | null;
  clothing: string | null;
  accessories: string | null;
  stories: { user_id: string | null; art_style?: string | null; consistency_settings?: unknown; active_style_guide_id?: string | null };
};

type CharacterReferenceSheetRow = {
  id: string;
  reference_image_url: string | null;
  version: number;
  status: string;
};

type StoryStyleGuideRow = {
  id: string;
  story_id: string;
  version: number;
  status: string;
  guide: unknown;
};

function json(status: number, data: JsonObject, headers?: Record<string, string>) {
  return jsonResponse(status, data, corsHeaders, headers);
}

function asNumber(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  return null;
}

function asJsonObject(value: unknown): JsonObject | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as JsonObject;
  return null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
  return out;
}

function normalizeArtStyleId(styleId: string): string {
  const s = String(styleId || "").trim();
  return s || "digital_illustration";
}

async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Reuse truncate from shared if possible, or inline
function truncateText(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

function errorToString(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

// Fetch with timeout helper
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectResponseHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((value, k) => {
    out[String(k).toLowerCase()] = String(value);
  });
  return out;
}

function stripDataUrlPrefix(base64OrDataUrl: string): string {
  const s = String(base64OrDataUrl || "");
  const idx = s.indexOf("base64,");
  if (idx >= 0) return s.slice(idx + "base64,".length);
  return s;
}

function extractFirstBase64Image(aiData: unknown): string | null {
  const obj = asJsonObject(aiData);
  if (!obj) return null;
  const imagesRaw = obj.images;
  if (Array.isArray(imagesRaw) && imagesRaw.length > 0) {
    const first = imagesRaw[0];
    if (typeof first === "string") return stripDataUrlPrefix(first);
  }
  if (typeof obj.image === "string") return stripDataUrlPrefix(obj.image);
  return null;
}

function detectImageMime(bytes: Uint8Array): "image/webp" | "image/png" | "image/jpeg" {
  if (bytes.length >= 12) {
    const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    if (riff && webp) return "image/webp";
  }
  if (bytes.length >= 8) {
    const png =
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a;
    if (png) return "image/png";
  }
  if (bytes.length >= 2) {
    const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (jpg) return "image/jpeg";
  }
  return "image/png";
}

function extFromMime(mime: "image/webp" | "image/png" | "image/jpeg"): string {
  if (mime === "image/webp") return "webp";
  if (mime === "image/jpeg") return "jpg";
  return "png";
}

function indicatesContentViolation(args: { status: number; headers: Record<string, string>; bodyText: string }) {
  const h = args.headers;
  const v1 = (h["x-venice-is-content-violation"] ?? "").toLowerCase() === "true";
  const v2 = (h["x-venice-contains-minor"] ?? "").toLowerCase() === "true";
  const lower = args.bodyText.toLowerCase();
  const v3 = lower.includes("content policy") || lower.includes("content violation") || lower.includes("nsfw") || lower.includes("contains minor");
  return (args.status >= 400 && args.status < 500) && (v1 || v2 || v3);
}

function computeVeniceParams(model: string) {
  const m = String(model || "").trim();
  if (m === "z-image-turbo") return { steps: 4, cfgScale: 1.8 };
  if (m === "qwen-image") return { steps: 8, cfgScale: 6.0 };
  return { steps: 30, cfgScale: 7.5 };
}

function computeEffectiveGenerationParams(args: {
  model: string;
  styleId: string;
  styleIntensity: number;
  strictStyle: boolean;
}) {
  const base = computeVeniceParams(args.model);
  const m = String(args.model || "").trim();
  if (m === "z-image-turbo" || m === "qwen-image") return base;
  const computedSteps = computeStyleStepsForStyle({ styleId: args.styleId, intensity: args.styleIntensity, strict: args.strictStyle });
  const stepsCap = args.strictStyle && args.styleIntensity >= 90 ? 40 : 34;
  return {
    steps: Math.min(stepsCap, Math.max(10, computedSteps)),
    cfgScale: computeStyleCfgScaleForStyle({ styleId: args.styleId, intensity: args.styleIntensity, strict: args.strictStyle }),
  };
}

function findConflictTermsInPrompt(args: { prompt: string; styleId: string }): string[] {
  const category = getStyleCategory(args.styleId);
  if (!category) return [];
  const conflicts = STYLE_CONFLICTS[category] || [];
  const hay = String(args.prompt || "").toLowerCase();
  const found: string[] = [];
  for (const term of conflicts) {
    const t = String(term || "").trim().toLowerCase();
    if (!t) continue;
    const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(hay)) found.push(term);
  }
  return found;
}

function isRetryableUpstreamStatus(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const requestId = crypto.randomUUID();
  
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const veniceApiKey = Deno.env.get("VENICE_API_KEY");

    if (!supabaseUrl || !supabaseServiceKey || !veniceApiKey) {
      console.error("Missing environment variables");
      return json(500, { error: "Configuration error", requestId }, { "x-request-id": requestId });
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.warn("[Auth] Missing authorization header", { requestId });
      return json(401, { error: "Missing authorization header", requestId }, { "x-request-id": requestId });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) {
      console.warn("[Auth] Invalid token", { requestId, authError: authError?.message });
      return json(
        401,
        { error: authError?.message ? `Invalid token: ${authError.message}` : "Invalid token", requestId },
        { "x-request-id": requestId },
      );
    }

    // Parse Input
    const {
      characterId,
      style, // e.g., "anime", "realistic"
      styleIntensity,
      strictStyle,
      disabledStyleElements,
      styleGuideId,
      model, // e.g., "venice-sd35", "lustify-sdxl"
      pose, // "front", "three-quarter", "portrait"
      forceRegenerate,
    } = await req.json();

    if (!characterId || !UUID_REGEX.test(characterId)) {
      return json(400, { error: "Valid characterId is required", requestId }, { "x-request-id": requestId });
    }

    const selectedModel = (asString(model) || "venice-sd35").trim();
    const selectedStyle = normalizeArtStyleId(asString(style) || "digital_illustration");
    const selectedPose = (asString(pose) || "character portrait, front view, simple background").trim();
    const shouldForce = typeof forceRegenerate === "boolean" ? forceRegenerate : false;
    
    const { data: characterRow, error: characterError } = await admin
      .from("characters")
      .select("id, story_id, name, description, physical_attributes, clothing, accessories, stories!inner(user_id, art_style, consistency_settings, active_style_guide_id)")
      .eq("id", characterId)
      .maybeSingle();

    if (characterError) {
      console.error("Character fetch error:", characterError);
      return json(500, { error: "Failed to load character", requestId }, { "x-request-id": requestId });
    }

    if (!characterRow) {
      return json(404, { error: "Character not found", requestId }, { "x-request-id": requestId });
    }

    const character = characterRow as unknown as CharacterWithStoryRow;
    const storyOwnerId = character.stories?.user_id;
    if (!storyOwnerId || String(storyOwnerId) !== String(user.id)) {
      return json(403, { error: "Not allowed", requestId }, { "x-request-id": requestId });
    }

    const storyId = String(character.story_id);
    const characterName = String(character.name || "Character");
    const desc = String(character.description || "");
    const physical = String(character.physical_attributes || "");
    const clothes = String(character.clothing || "");
    const acc = String(character.accessories || "");

    const consistencySettings = asJsonObject(character.stories?.consistency_settings) || {};
    const storyStyle = normalizeArtStyleId(asString(character.stories?.art_style) || "digital_illustration");
    const effectiveStyle = normalizeArtStyleId(selectedStyle || storyStyle);
    const effectiveIntensity = clampNumber(
      typeof styleIntensity === "number" ? styleIntensity : (consistencySettings.style_intensity as unknown),
      0,
      100,
      70,
    );
    const effectiveStrict =
      typeof strictStyle === "boolean"
        ? strictStyle
        : typeof consistencySettings.mode === "string"
          ? String(consistencySettings.mode) === "strict"
          : true;
    const effectiveDisabledElements = asStringArray(disabledStyleElements) || [];

    const storyActiveGuideId =
      typeof character.stories?.active_style_guide_id === "string" ? String(character.stories.active_style_guide_id || "") : "";
    const requestedGuideId = typeof styleGuideId === "string" ? String(styleGuideId || "").trim() : "";
    const activeGuideId = requestedGuideId || storyActiveGuideId;

    const styleGuidance = buildStyleGuidance({
      styleId: effectiveStyle,
      intensity: effectiveIntensity,
      strict: effectiveStrict,
      disabledElements: effectiveDisabledElements,
    });
    const styleValidation = validateStyleApplication({
      styleId: effectiveStyle,
      strict: effectiveStrict,
      guidance: styleGuidance,
      disabledElements: effectiveDisabledElements,
    });
    if (!styleValidation.ok) {
      return json(
        422,
        { error: "Style application failed", requestId, details: { issues: styleValidation.issues, styleId: effectiveStyle } },
        { "x-request-id": requestId },
      );
    }

    let activeStyleGuideRow: StoryStyleGuideRow | null = null;
    if (activeGuideId) {
      if (UUID_REGEX.test(activeGuideId)) {
        const { data: guideRow } = await admin
          .from("story_style_guides")
          .select("id, story_id, version, status, guide")
          .eq("id", activeGuideId)
          .maybeSingle();
        const typed = guideRow as unknown as StoryStyleGuideRow | null;
        if (typed && String(typed.story_id || "") === storyId) activeStyleGuideRow = typed;
      }
    }

    const styleGuideGuidance = activeStyleGuideRow
      ? buildStoryStyleGuideGuidance({
          guide: activeStyleGuideRow.guide,
          intensity: effectiveIntensity,
          strict: effectiveStrict,
        })
      : { positive: "", used: false, issues: [] as string[] };

    const definitionParts = [];
    if (physical) definitionParts.push(`Physical: ${physical}`);
    if (clothes) definitionParts.push(`Clothing: ${clothes}`);
    if (acc) definitionParts.push(`Accessories: ${acc}`);
    if (desc) definitionParts.push(`Description: ${desc}`);
    const fullDefinition = definitionParts.join("\n");

    let contentPrompt = `${characterName}`;
    if (physical) contentPrompt += `, ${physical}`;
    if (clothes) contentPrompt += `, wearing ${clothes}`;
    if (acc) contentPrompt += `, with ${acc}`;

    const backgroundPrompt = "simple white background, clean background";
    const promptCore = sanitizePrompt(`${contentPrompt}, ${selectedPose}, ${backgroundPrompt}, no text, no watermark`);
    const promptSanitizedCore = sanitizePrompt(
      `adult character portrait, ${selectedPose}, ${backgroundPrompt}, no text, no watermark`,
    );

    const assembled = assemblePrompt({
      basePrompt: promptCore,
      stylePrefix: styleGuidance.prefix,
      stylePositive: styleGuidance.positive,
      styleGuidePositive: styleGuideGuidance.positive,
      model: selectedModel,
      maxLength: 1400,
      selectedStyleId: effectiveStyle,
      requiredSubjects: [characterName],
    });

    const assembledSanitized = assemblePrompt({
      basePrompt: promptSanitizedCore,
      stylePrefix: styleGuidance.prefix,
      stylePositive: styleGuidance.positive,
      styleGuidePositive: styleGuideGuidance.positive,
      model: selectedModel,
      maxLength: 1400,
      selectedStyleId: effectiveStyle,
    });

    const conflictTerms = findConflictTermsInPrompt({ prompt: assembled.fullPrompt, styleId: effectiveStyle });
    if (effectiveStrict && conflictTerms.length > 0) {
      return json(
        422,
        {
          error: "Style application failed",
          requestId,
          details: {
            issues: conflictTerms.map((t) => `style_conflict_term_present:${t}`),
            styleId: effectiveStyle,
          },
        },
        { "x-request-id": requestId },
      );
    }

    const detailedPrompt = assembled.fullPrompt;
    const sanitizedPrompt = assembledSanitized.fullPrompt;

    const { steps, cfgScale } = computeEffectiveGenerationParams({
      model: selectedModel,
      styleId: effectiveStyle,
      styleIntensity: effectiveIntensity,
      strictStyle: effectiveStrict,
    });
    const width = 1024;
    const height = 1024;

    const promptHash = await sha256Hex(
      JSON.stringify({
        prompt: detailedPrompt,
        model: selectedModel,
        steps,
        cfgScale,
        width,
        height,
      }),
    );
    
    if (!shouldForce) {
      const { data: existing } = await admin
        .from("character_reference_sheets")
        .select("id, reference_image_url, version, status")
        .eq("character_id", characterId)
        .contains("sheet", { prompt_hash: promptHash })
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      const existingTyped = existing as unknown as CharacterReferenceSheetRow | null;
      if (existingTyped && existingTyped.reference_image_url) {
        return json(
          200,
          {
            success: true,
            requestId,
            imageUrl: existingTyped.reference_image_url,
            cached: true,
            referenceSheetId: existingTyped.id,
            style: {
              id: effectiveStyle,
              intensity: effectiveIntensity,
              strict: effectiveStrict,
              disabledElements: effectiveDisabledElements,
            },
          },
          { "x-request-id": requestId },
        );
      }
    }

    // --- GENERATION ---
    console.log(`[Generate] Creating reference for ${characterName} (${characterId})`);

    const attemptPrompts = [detailedPrompt, sanitizedPrompt];
    let usedPrompt = detailedPrompt;
    let upstreamStatus: number | null = null;
    let upstreamHeaders: Record<string, string> = {};
    let upstreamBodyText: string | null = null;
    let attempts = 0;

    const generateWithPrompt = async (prompt: string) => {
      const payload = {
        model: selectedModel,
        prompt: prompt.length > 2000 ? prompt.slice(0, 2000) : prompt,
        width,
        height,
        steps,
        cfg_scale: cfgScale,
        safe_mode: false,
        hide_watermark: true,
        embed_exif_metadata: false,
      };

      return await fetchWithTimeout(
        "https://api.venice.ai/api/v1/image/generate",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${veniceApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
        60000,
      );
    };

    let aiData: unknown | null = null;
    for (let promptIndex = 0; promptIndex < attemptPrompts.length; promptIndex++) {
      usedPrompt = attemptPrompts[promptIndex];

      for (let tryIndex = 0; tryIndex < 4; tryIndex++) {
        attempts++;
        let veniceRes: Response;
        try {
          veniceRes = await generateWithPrompt(usedPrompt);
        } catch (e) {
          const isAbort = e instanceof DOMException && e.name === "AbortError";
          if (tryIndex < 3) {
            const delay = Math.min(8000, 500 * 2 ** tryIndex) + Math.floor(Math.random() * 250);
            console.warn(`[Retry] Venice request failed (${isAbort ? "timeout" : "fetch error"}). Retrying in ${delay}ms...`, {
              requestId,
              characterId,
              tryIndex,
            });
            await sleep(delay);
            continue;
          }
          return json(
            502,
            { error: "Failed to reach image generation provider", requestId, details: String(e) },
            { "x-request-id": requestId },
          );
        }

        upstreamStatus = veniceRes.status;
        upstreamHeaders = collectResponseHeaders(veniceRes);
        if (!veniceRes.ok) {
          const errText = await veniceRes.text().catch(() => "");
          upstreamBodyText = truncateText(errText || "", 4000);
          const isViolation = indicatesContentViolation({
            status: veniceRes.status,
            headers: upstreamHeaders,
            bodyText: upstreamBodyText,
          });

          if (isViolation && promptIndex === 0) {
            console.warn("[Violation] Switching to sanitized prompt", { requestId, characterId });
            break;
          }

          if (!isViolation && isRetryableUpstreamStatus(veniceRes.status) && tryIndex < 3) {
            const delay = Math.min(8000, 700 * 2 ** tryIndex) + Math.floor(Math.random() * 250);
            console.warn(`[Retry] Upstream returned ${veniceRes.status}. Retrying in ${delay}ms...`, {
              requestId,
              characterId,
              tryIndex,
            });
            await sleep(delay);
            continue;
          }

          return json(
            502,
            {
              error: `Image generation failed (${veniceRes.status})`,
              requestId,
              details: {
                upstream_status: veniceRes.status,
                upstream_status_text: veniceRes.statusText,
                upstream_error: upstreamBodyText || "No error details provided",
                headers: upstreamHeaders,
              },
            },
            { "x-request-id": requestId },
          );
        }

        try {
          aiData = await veniceRes.json();
        } catch (e) {
          const raw = await veniceRes.text().catch(() => "");
          return json(
            502,
            {
              error: "Invalid JSON from image generation provider",
              requestId,
              details: { parse_error: String(e), body: truncateText(raw, 2000) },
            },
            { "x-request-id": requestId },
          );
        }
        break;
      }

      if (aiData) break;
    }

    if (!aiData) {
      return json(
        502,
        {
          error: "Image generation failed after retries",
          requestId,
          details: {
            upstream_status: upstreamStatus,
            upstream_error: upstreamBodyText || "No error details provided",
            headers: upstreamHeaders,
          },
        },
        { "x-request-id": requestId },
      );
    }

    const b64 = extractFirstBase64Image(aiData);
    if (!b64) return json(500, { error: "No image data returned", requestId }, { "x-request-id": requestId });

    // --- STORAGE ---
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    } catch (e) {
      return json(500, { error: "Failed to decode image data", requestId, details: String(e) }, { "x-request-id": requestId });
    }

    const mime = detectImageMime(bytes);
    const ext = extFromMime(mime);
    const fileName = `references/${user.id}/${characterId}/${Date.now()}-ref.${ext}`;
    const file = new Blob([bytes], { type: mime });

    const tryUpload = async (bucket: string) => {
      try {
        const { error } = await admin.storage.from(bucket).upload(fileName, file, { contentType: mime, upsert: true });
        if (error) return { ok: false as const, error };
        return { ok: true as const, bucket };
      } catch (e) {
        return { ok: false as const, error: e };
      }
    };

    const primary = await tryUpload("scene-images");
    const targetBucket = primary.ok ? primary.bucket : "reference-images";
    if (!primary.ok) {
      const fallback = await tryUpload(targetBucket);
      if (!fallback.ok) {
        console.error("Upload error:", { primary: primary.error, fallback: fallback.error });
        return json(
          500,
          {
            error: "Failed to upload image",
            details: { primary: errorToString(primary.error), fallback: errorToString(fallback.error) },
            requestId,
          },
          { "x-request-id": requestId },
        );
      }
    }

    const { data: urlData } = admin.storage.from(targetBucket).getPublicUrl(fileName);
    const publicUrl = urlData.publicUrl;

    // --- DB UPDATE ---
    const { data: maxVersionRow } = await admin
      .from("character_reference_sheets")
      .select("version, id")
      .eq("character_id", characterId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const maxTyped = maxVersionRow as unknown as { version: number | null; id: string } | null;
    const prevVersion = asNumber(maxTyped?.version) ?? 0;
    const nextVersion = prevVersion + 1;
    const parentId = asString(maxTyped?.id);

    const sheetInsertPayload = {
      story_id: storyId,
      character_id: characterId,
      version: nextVersion,
      status: "approved",
      reference_image_url: publicUrl,
      prompt_snippet: truncateText(usedPrompt, 200),
      created_by: user.id,
      parent_id: parentId || undefined,
      sheet: {
        prompt_hash: promptHash,
        model: selectedModel,
        full_prompt: usedPrompt,
        style: {
          id: effectiveStyle,
          intensity: effectiveIntensity,
          strict: effectiveStrict,
          disabled_elements: effectiveDisabledElements,
          validation_issues: styleValidation.issues,
          guide_id: activeStyleGuideRow?.id ?? null,
          guide_version: typeof activeStyleGuideRow?.version === "number" ? activeStyleGuideRow.version : null,
          guide_status: typeof activeStyleGuideRow?.status === "string" ? activeStyleGuideRow.status : null,
          guide_issues: styleGuideGuidance.issues,
        },
        definition: fullDefinition,
        width,
        height,
        steps,
        cfg_scale: cfgScale,
      },
    };

    const { data: newSheet, error: dbError } = await admin
      .from("character_reference_sheets")
      .insert(sheetInsertPayload)
      .select("id")
      .single();

    const activeSheetId = newSheet?.id ? String(newSheet.id) : null;
    if (dbError) {
      console.error("DB Insert Error:", dbError);
    }

    const updatePayload: Record<string, unknown> = { image_url: publicUrl };
    if (activeSheetId) updatePayload.active_reference_sheet_id = activeSheetId;

    let { error: characterUpdateError } = await admin.from("characters").update(updatePayload).eq("id", characterId);

    if (characterUpdateError) {
      const msg = errorToString(characterUpdateError).toLowerCase();
      const missingActiveRefColumn =
        msg.includes("active_reference_sheet_id") && (msg.includes("column") || msg.includes("does not exist"));

      if (missingActiveRefColumn) {
        const { error: retryError } = await admin.from("characters").update({ image_url: publicUrl }).eq("id", characterId);
        characterUpdateError = retryError ?? null;
      }
    }

    if (characterUpdateError) {
      console.error("Character update error:", characterUpdateError);
      return json(
        500,
        { error: "Failed to update character with generated image", requestId, details: characterUpdateError },
        { "x-request-id": requestId },
      );
    }

    return json(
      200,
      {
        success: true,
        requestId,
        imageUrl: publicUrl,
        referenceSheetId: activeSheetId,
        cached: false,
        attempts,
        model: selectedModel,
        promptHash,
        style: {
          id: effectiveStyle,
          intensity: effectiveIntensity,
          strict: effectiveStrict,
          disabledElements: effectiveDisabledElements,
          validation: styleValidation,
          guideId: activeStyleGuideRow?.id ?? null,
          guideIssues: styleGuideGuidance.issues,
        },
      },
      { "x-request-id": requestId },
    );

  } catch (e) {
    console.error("Unexpected error:", e);
    return json(500, { error: "Internal Server Error", details: String(e), requestId }, { "x-request-id": requestId });
  }
});
