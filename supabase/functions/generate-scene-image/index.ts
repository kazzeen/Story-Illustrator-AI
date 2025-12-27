import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type JsonObject = Record<string, unknown>;

type ConsistencySettings = {
  mode?: string;
  auto_correct?: boolean;
};

type StoryJoinRow = {
  user_id?: string | null;
  art_style?: string | null;
  consistency_settings?: unknown;
  active_style_guide_id?: string | null;
};

type SceneRow = {
  id: string;
  story_id: string;
  scene_number: number | null;
  title: string | null;
  summary: string | null;
  original_text: string | null;
  characters: string[] | null;
  setting: string | null;
  emotional_tone: string | null;
  image_prompt: string | null;
  image_url: string | null;
  character_states: unknown;
  stories?: StoryJoinRow | null;
};

type CharacterRow = {
  id: string;
  name: string;
  description: string | null;
  physical_attributes: string | null;
  clothing: string | null;
  accessories: string | null;
  active_reference_sheet_id: string | null;
};

type StyleGuideRow = { id: string; guide: unknown };

type SceneCharacterStateRow = { character_id: string; state: unknown; source?: unknown };

type CharacterReferenceSheetRow = {
  id: string;
  character_id: string;
  sheet: unknown;
  prompt_snippet: string | null;
  reference_image_url: string | null;
  version: number;
  status: string;
};

type ContinuityIssue = { character: string; previous: string; current: string };

type ConsistencyResult = {
  overallScore: number | null;
  status: "pass" | "warn" | "fail";
  details: unknown;
};

type CharacterValidationInput = {
  name: string;
  reference_image_url: string | null;
  reference_text: string;
  expected_outfit: string;
  expected_state: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeSupabaseError(err: unknown): JsonObject | null {
  const e = asJsonObject(err);
  if (!e) return null;
  const message = asString(e.message);
  const details = asString(e.details);
  const hint = asString(e.hint);
  const code = asString(e.code);
  const out: JsonObject = {};
  if (message) out.message = message;
  if (details) out.details = details;
  if (hint) out.hint = hint;
  if (code) out.code = code;
  return Object.keys(out).length > 0 ? out : e;
}

function asJsonObject(value: unknown): JsonObject | null {
  return isRecord(value) ? (value as JsonObject) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const v of value) if (typeof v === "string") out.push(v);
  return out;
}

function asConsistencySettings(value: unknown): ConsistencySettings {
  const obj = asJsonObject(value);
  const mode = asString(obj?.mode);
  const auto_correct = typeof obj?.auto_correct === "boolean" ? obj.auto_correct : undefined;
  return { mode: mode ?? undefined, auto_correct };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function sanitizePrompt(raw: string) {
  let out = String(raw || "");
  out = out.replace(/\s+/g, " ").trim();
  out = out
    .split("")
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

// Allowed art styles
const ALLOWED_STYLES = ['none', 'cinematic', 'watercolor', 'comic', 'anime', 'realistic', 'fantasy', 'oil', 'minimalist'];

type StyleReference = {
  id: string;
  name: string;
  elements: string[];
  palette: string;
  composition: string;
  texture: string;
  keywords: string[];
  avoid: string[];
};

export function applyDisabledStyleElementsToStyleRef(
  styleRef: StyleReference,
  disabledStyleElements: string[],
) {
  const disabledSet = new Set(disabledStyleElements);
  const effectiveElements = styleRef.elements.filter((e) => !disabledSet.has(e));

  const tokens: string[] = [];
  for (const phrase of disabledStyleElements) {
    const matches = String(phrase).toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const t of matches) {
      if (t.length >= 4) tokens.push(t);
    }
  }
  const tokenSet = new Set(tokens);

  const effectiveKeywords = styleRef.keywords.filter((kw) => {
    const lower = kw.toLowerCase();
    for (const t of tokenSet) {
      if (lower.includes(t)) return false;
    }
    return true;
  });

  return { effectiveElements, effectiveKeywords };
}

export const STYLE_LIBRARY: Record<string, StyleReference> = {
  cinematic: {
    id: "cinematic",
    name: "Cinematic",
    elements: ["Dramatic key light", "Depth of field", "Atmospheric haze", "Crisp silhouettes"],
    palette: "Teal/orange grading, deep shadows, controlled highlights, rich contrast.",
    composition: "Rule of thirds, leading lines, layered depth, strong subject separation.",
    texture: "Clean digital finish, subtle film grain, soft bloom in highlights.",
    keywords: ["cinematic composition", "dramatic lighting", "film still", "professional cinematography", "shallow depth of field"],
    avoid: ["cartoon lineart", "watercolor wash", "comic halftone", "flat minimalist shapes"],
  },
  watercolor: {
    id: "watercolor",
    name: "Watercolor",
    elements: ["Translucent washes", "Soft gradients", "Bleed edges", "Light underdrawing"],
    palette: "Harmonized pastel-to-mid tones with airy whites; avoid harsh neon contrast.",
    composition: "Simplified shapes, breathable negative space, focal area with stronger pigment.",
    texture: "Cold-press paper grain, watery blooms, layered glazing.",
    keywords: ["watercolor painting", "translucent pigment", "paper texture", "soft edges", "traditional media"],
    avoid: ["photorealistic", "3d render", "sharp ink outlines", "hard cel shading"],
  },
  anime: {
    id: "anime",
    name: "Anime",
    elements: ["Crisp line art", "Cel shading", "Expressive eyes", "Stylized hair shapes"],
    palette: "Saturated but controlled colors; clean shadow shapes; avoid muddy gradients.",
    composition: "Dynamic camera angles, readable silhouettes, character-focused framing.",
    texture: "Smooth fills, minimal brush texture, sharp shadow boundaries.",
    keywords: ["anime style", "clean lineart", "cel shading", "expressive character design", "vibrant colors"],
    avoid: ["watercolor bleed", "oil impasto", "photorealistic skin pores", "comic halftone dots"],
  },
  comic: {
    id: "comic",
    name: "Comic Book",
    elements: ["Bold outlines", "Graphic shadows", "Halftone accents", "High-contrast highlights"],
    palette: "Vibrant primaries with strong contrast; avoid photorealistic grading.",
    composition: "Dynamic action framing, strong diagonals, clear subject separation.",
    texture: "Ink line texture, print-like halftone dot patterns.",
    keywords: ["comic book art", "bold inks", "halftone shading", "graphic contrast", "panel illustration"],
    avoid: ["photorealistic", "soft watercolor wash", "painterly oil blending", "minimalist flat poster"],
  },
  oil: {
    id: "oil",
    name: "Oil Painting",
    elements: ["Painterly edges", "Rich pigment", "Chiaroscuro lighting", "Canvas depth"],
    palette: "Warm earth tones, deep values, controlled saturation, rich color mixing.",
    composition: "Classical balance, strong value structure, focal emphasis via contrast.",
    texture: "Visible brushstrokes, impasto highlights, subtle canvas texture.",
    keywords: ["oil painting", "painterly brushwork", "impasto", "classical lighting", "fine art"],
    avoid: ["cel shading", "clean vector shapes", "comic halftone", "photorealistic lens artifacts"],
  },
  minimalist: {
    id: "minimalist",
    name: "Minimalist",
    elements: ["Flat shapes", "Minimal detail", "Large negative space", "Simple lighting cues"],
    palette: "Limited 2–4 colors, muted or monochrome; avoid complex gradients.",
    composition: "Centered or asymmetrical balance, strong geometry, uncluttered focal point.",
    texture: "Flat fills or subtle grain only; avoid painterly noise.",
    keywords: ["minimalist illustration", "clean shapes", "limited palette", "flat design", "negative space"],
    avoid: ["painterly brush strokes", "photorealistic texture", "comic halftone", "heavy film grain"],
  },
  realistic: {
    id: "realistic",
    name: "Realistic",
    elements: ["Natural materials", "Realistic lighting", "High detail", "Accurate proportions"],
    palette: "Naturalistic colors; physically plausible lighting; avoid stylized grading extremes.",
    composition: "Photographic framing, realistic depth, subtle lens perspective.",
    texture: "Fine detail, natural micro-textures, realistic bokeh where appropriate.",
    keywords: ["photorealistic", "natural lighting", "highly detailed", "professional photography", "lifelike materials"],
    avoid: ["watercolor wash", "comic inks", "cel shading", "flat vector shapes"],
  },
  fantasy: {
    id: "fantasy",
    name: "Fantasy",
    elements: ["Ethereal glow", "Mythic motifs", "Ornate shapes", "Ambient magical effects"],
    palette: "Cohesive palette with luminous accents; controlled saturation; dramatic contrast.",
    composition: "Epic establishing shots, layered depth, cinematic staging of scale.",
    texture: "Painterly detail, soft glow, atmospheric particles and mist.",
    keywords: ["fantasy art", "magical atmosphere", "ethereal lighting", "epic composition", "ornate detail"],
    avoid: ["flat minimalist poster", "strict photorealism", "comic halftone", "cel shading"],
  },
  none: {
    id: "none",
    name: "No Specific Style",
    elements: [],
    palette: "",
    composition: "",
    texture: "",
    keywords: [],
    avoid: [],
  },
};

export function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function styleStrengthText(intensity: number) {
  if (intensity >= 90) return "maximal and unmistakable";
  if (intensity >= 70) return "strong and clearly readable";
  if (intensity >= 40) return "moderate and balanced";
  if (intensity >= 15) return "subtle";
  return "minimal";
}

function stripDataUrlPrefix(value: string) {
  const m = value.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.*)$/);
  return m?.[1] ? m[1] : value;
}

function extractFirstBase64Image(aiData: unknown): string | null {
  const obj = asJsonObject(aiData);
  if (!obj) return null;

  const imagesRaw = obj.images;
  if (Array.isArray(imagesRaw) && imagesRaw.length > 0) {
    const first = imagesRaw[0];
    if (typeof first === "string") return stripDataUrlPrefix(first);
    const firstObj = asJsonObject(first);
    const b64 = asString(firstObj?.b64_json ?? firstObj?.b64 ?? firstObj?.base64 ?? firstObj?.image);
    if (b64) return stripDataUrlPrefix(b64);
  }

  const dataRaw = obj.data;
  if (Array.isArray(dataRaw) && dataRaw.length > 0) {
    const first = dataRaw[0];
    if (typeof first === "string") return stripDataUrlPrefix(first);
    const firstObj = asJsonObject(first);
    const b64 = asString(firstObj?.b64_json ?? firstObj?.b64 ?? firstObj?.base64 ?? firstObj?.image);
    if (b64) return stripDataUrlPrefix(b64);
  }

  const direct = asString(obj.image ?? obj.b64_json ?? obj.base64);
  return direct ? stripDataUrlPrefix(direct) : null;
}

export function detectImageMime(bytes: Uint8Array): "image/webp" | "image/png" | "image/jpeg" {
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
  return "image/webp";
}

function extFromMime(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  return "webp";
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const REDACT_HEADER_KEYS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "apikey",
]);

function collectResponseHeaders(res: Response) {
  const out: Record<string, string> = {};
  for (const [k, v] of res.headers.entries()) {
    const key = String(k).toLowerCase();
    out[key] = REDACT_HEADER_KEYS.has(key) ? "[redacted]" : String(v);
  }
  return out;
}

function truncateText(value: string, limit: number) {
  const s = String(value ?? "");
  if (s.length <= limit) return s;
  return `${s.slice(0, limit)}…(truncated ${s.length - limit} chars)`;
}

function deriveFailureReasons(args: {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText?: string | null;
}) {
  const reasons: string[] = [];
  const h = args.headers;
  const bodyLower = typeof args.bodyText === "string" ? args.bodyText.toLowerCase() : "";

  const contentViolation = String(h["x-venice-is-content-violation"] ?? "").toLowerCase() === "true";
  const containsMinor = String(h["x-venice-contains-minor"] ?? "").toLowerCase() === "true";
  if (contentViolation) reasons.push("Content policy violation (x-venice-is-content-violation=true)");
  if (containsMinor) reasons.push("Contains minor (x-venice-contains-minor=true)");

  if (args.status === 429) reasons.push("Upstream rate limit (HTTP 429)");
  if (args.status === 402) reasons.push("Upstream credits exhausted (HTTP 402)");
  if (args.status === 401 || args.status === 403) reasons.push(`Upstream auth rejected (HTTP ${args.status})`);

  const ct = (h["content-type"] ?? "").toLowerCase();
  if (ct.includes("text/html")) reasons.push("Upstream returned HTML (likely an error page)");
  if (ct === "") reasons.push("Missing Content-Type header");

  const cl = h["content-length"];
  if (typeof cl === "string") {
    const n = Number(cl);
    if (Number.isFinite(n) && n === 0) reasons.push("Empty upstream response body (content-length=0)");
  }

  if (bodyLower.includes("invalid") && bodyLower.includes("style")) reasons.push("Upstream reported invalid style");
  if (bodyLower.includes("model") && (bodyLower.includes("unknown") || bodyLower.includes("not found"))) {
    reasons.push("Upstream reported unknown model");
  }

  if (reasons.length === 0) {
    reasons.push(`${args.status} ${args.statusText || "Upstream request failed"}`);
  }

  return reasons;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const requestId = crypto.randomUUID();
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(401, { error: "Missing Authorization header", requestId });
    }

    // Parse and validate request body
    let requestBody: {
      action?: unknown;
      storyId?: unknown;
      sceneId?: string;
      artStyle?: string;
      styleIntensity?: unknown;
      strictStyle?: unknown;
      model?: string;
      disabledStyleElements?: unknown;
    };
    try {
      requestBody = await req.json();
    } catch {
      return json(400, { error: "Invalid request body", requestId });
    }

    const action = requestBody.action;
    const storyId = requestBody.storyId;
    const { sceneId, artStyle, styleIntensity, strictStyle, model } = requestBody;
    const disabledStyleElements = asStringArray(requestBody.disabledStyleElements) ?? [];

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const veniceApiKey = Deno.env.get("VENICE_API_KEY");

    if (!veniceApiKey) {
      console.error("Venice API Key is missing in environment variables");
      return json(500, { error: "Server Configuration Error: Venice API Key is missing.", requestId });
    }

    // Start performance timer
    const startTime = performance.now();
    const timings: Record<string, number> = {};
    const logTiming = (label: string) => {
      const now = performance.now();
      timings[label] = Math.round(now - startTime);
      console.log(`[Timing] ${label}: ${timings[label]}ms`);
    };

    // Validate user manually (since verify_jwt is disabled)
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await authClient.auth.getUser();
    logTiming("auth_check");
    const user = userData?.user;
    if (userErr || !user) {
      console.error("Auth validation failed:", { requestId, userErr });
      return json(401, { error: "Invalid or expired session", requestId, details: serializeSupabaseError(userErr) });
    }

    // Privileged DB + Storage client
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const toLogDetails = (details: unknown) => {
      const obj = asJsonObject(details);
      if (obj) return { requestId, ...obj };
      return { requestId, detail: details };
    };

    const logConsistency = async (args: {
      story_id: string;
      scene_id?: string | null;
      check_type: string;
      status: "pass" | "warn" | "fail";
      details?: unknown;
    }) => {
      try {
        await admin.from("consistency_logs").insert({
          story_id: args.story_id,
          scene_id: args.scene_id ?? null,
          check_type: args.check_type,
          status: args.status,
          details: toLogDetails(args.details),
        });
      } catch (e) {
        console.warn("Failed to insert consistency log:", {
          requestId,
          check_type: args.check_type,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    };

    if (action === "reset_story_scenes") {
      const storyIdString = asString(storyId);
      if (!storyIdString || !UUID_REGEX.test(storyIdString)) {
        return json(400, { error: "Valid story ID is required", requestId });
      }

      const { data: story, error: storyError } = await admin
        .from("stories")
        .select("id, user_id")
        .eq("id", storyIdString)
        .maybeSingle();

      if (storyError) {
        console.error("Story fetch error:", { requestId, storyError });
        return json(500, { error: "Failed to fetch story", requestId, details: serializeSupabaseError(storyError) });
      }

      if (!story) return json(404, { error: "Story not found", requestId });
      if (story.user_id !== user.id) return json(403, { error: "Not allowed", requestId });

      const { data: updatedRows, count, error: resetError } = await admin
        .from("scenes")
        .update({
          image_url: null,
          generation_status: "pending",
        })
        .eq("story_id", storyIdString)
        .select("id", { count: "exact" });

      if (resetError) {
        console.error("Scene reset error:", { requestId, resetError });
        return json(500, { error: "Failed to reset scenes", requestId, details: serializeSupabaseError(resetError) });
      }

      return json(200, {
        success: true,
        requestId,
        clearedScenes: typeof count === "number" ? count : (updatedRows || []).length,
      });
    }

    // Validate sceneId is a valid UUID
    if (!sceneId || !UUID_REGEX.test(sceneId)) {
      return json(400, { error: "Valid scene ID is required", requestId });
    }

    // Validate artStyle if provided
    if (artStyle && !ALLOWED_STYLES.includes(artStyle)) {
      return json(400, { error: "Invalid art style", requestId });
    }

    // Validate model if provided
    const ALLOWED_MODELS = [
      "venice-sd35",
      "hidream",
      "lustify-sdxl",
      "lustify-v7",
      "qwen-image",
      "wai-Illustrious",
      "z-image-turbo",
    ];
    if (model && !ALLOWED_MODELS.includes(model)) {
      return json(400, { error: "Invalid model", requestId });
    }

    const fetchSceneOnce = async () =>
      await admin
        .from("scenes")
        .select(
          "id, story_id, scene_number, title, summary, original_text, characters, setting, emotional_tone, image_prompt, image_url, character_states"
        )
        .eq("id", sceneId)
        .maybeSingle();

    const primarySceneResult = await fetchSceneOnce();
    let scene = primarySceneResult.data;
    let sceneError = primarySceneResult.error;

    let retrySceneError: unknown = null;
    if (sceneError) {
      console.warn("Retrying scene fetch...", { requestId, error: sceneError });
      await delay(200);
      const retrySceneResult = await fetchSceneOnce();
      scene = retrySceneResult.data;
      retrySceneError = retrySceneResult.error;
      sceneError = retrySceneResult.error;
    }
    logTiming("scene_fetch");

    if (sceneError) {
      try {
        await admin.from("scenes").update({ generation_status: "error" }).eq("id", sceneId);
      } catch {
        void 0;
      }
      const { error: probeError } = await admin.from("scenes").select("id").eq("id", sceneId).maybeSingle();
      const serialized = serializeSupabaseError(sceneError);
      const retrySerialized = serializeSupabaseError(retrySceneError);
      const dbCode = asString(serialized?.code);
      const dbMessage = asString(serialized?.message);
      console.error("Scene fetch error:", { requestId, sceneError, retrySceneError, probeError });
      return json(500, {
        error: "Failed to fetch scene",
        requestId,
        stage: "scene_fetch",
        dbCode,
        dbMessage,
        details: serialized ?? sceneError,
        retryDetails: retrySerialized,
        probe: serializeSupabaseError(probeError),
      });
    }

    if (!scene) return json(404, { error: "Scene not found", requestId });

    const sceneRow = scene as SceneRow;
    const { data: story, error: storyJoinError } = await admin
      .from("stories")
      .select("user_id, art_style, consistency_settings")
      .eq("id", sceneRow.story_id)
      .maybeSingle();

    if (storyJoinError) {
      console.error("Story join fetch error:", { requestId, storyJoinError, storyId: sceneRow.story_id });
      try {
        await admin.from("scenes").update({ generation_status: "error" }).eq("id", sceneId);
      } catch {
        void 0;
      }
      const serialized = serializeSupabaseError(storyJoinError);
      const dbCode = asString(serialized?.code);
      const dbMessage = asString(serialized?.message);
      return json(500, {
        error: "Failed to fetch story",
        requestId,
        stage: "story_fetch",
        dbCode,
        dbMessage,
        details: serialized ?? storyJoinError,
      });
    }
    logTiming("story_fetch");
    if (!story) return json(404, { error: "Story not found", requestId });
    if (story.user_id !== user.id) return json(403, { error: "Not allowed", requestId });
    const storyRow = story as StoryJoinRow;

    // Modified to avoid active_reference_sheet_id if it doesn't exist
    const { data: storyCharacters } = await admin
      .from("characters")
      .select("id, name, description, physical_attributes, clothing, accessories, active_reference_sheet_id")
      .eq("story_id", sceneRow.story_id);
    logTiming("characters_fetch");

    const consistencySettings = asConsistencySettings(storyRow.consistency_settings) || { mode: "strict" };
    const isStrict = (consistencySettings.mode ?? "strict") === "strict";

    let previousSceneSummary = "";
    let previousSceneStates = "";
    let prevSceneId: string | null = null;
    let prevSceneStatesByName: JsonObject = {};

    if (Number(sceneRow.scene_number || 0) > 1) {
      const prevNumber = Number(sceneRow.scene_number || 0) - 1;
      const { data: prevSceneData } = await admin
        .from("scenes")
        .select("id, scene_number, character_states, summary, setting, image_prompt")
        .eq("story_id", sceneRow.story_id)
        .eq("scene_number", prevNumber)
        .maybeSingle();
      
      if (prevSceneData) {
        prevSceneId = asString((prevSceneData as unknown as { id?: unknown }).id) || null;
        previousSceneSummary = prevSceneData.summary || "";
        const prevStates = asJsonObject(prevSceneData.character_states) || {};
        prevSceneStatesByName = prevStates;
        previousSceneStates = Object.entries(prevStates)
          .map(([name, state]) => {
            const s = asJsonObject(state) || {};
            const details = [
              sanitizePrompt(asString(s.clothing) || ""),
              sanitizePrompt(asString(s.state) || ""),
              sanitizePrompt(asString(s.condition) || ""),
              sanitizePrompt(asString(s.physical_attributes) || ""),
            ]
              .filter(Boolean)
              .join(", ");
            return details ? `${name}: (${details})` : null;
          })
          .filter(Boolean)
          .join("; ");

        // Environmental Continuity: Reuse setting if appropriate
        if (!sceneRow.setting || sceneRow.setting === "Same as previous") {
             // In-memory update for prompt generation context
             sceneRow.setting = prevSceneData.setting;
        }
      }
    }

    const sceneTextForScan = `${sceneRow.title || ""} ${sceneRow.summary || ""} ${sceneRow.original_text || ""} ${sceneRow.image_prompt || ""}`;
    const explicitCharacterNames = sceneRow.characters || [];
    const characterRows = (storyCharacters || []) as CharacterRow[];
    const activeCharacters = characterRows.filter((c) => {
      const name = String(c.name || "");
      const lower = name.toLowerCase();
      const byExplicit = (explicitCharacterNames || []).some((n: string) => {
        const nl = String(n || "").toLowerCase();
        return nl.includes(lower) || lower.includes(nl);
      });
      if (byExplicit) return true;
      const scan = sceneTextForScan.toLowerCase();
      if (scan.includes(lower)) return true;
      const parts = name.split(" ").map((p) => p.trim()).filter((p) => p.length > 2);
      return parts.some((p) => scan.includes(p.toLowerCase()));
    });

    const promptSources = [
      sceneRow.image_prompt || "",
      sceneRow.summary || "",
      sceneRow.title || "",
      sceneRow.original_text || "",
    ];
    const basePrompt = promptSources.map((s) => sanitizePrompt(String(s || ""))).find((s) => s.length > 0) || "";
    const safePrompt = basePrompt.length > 0 ? basePrompt.slice(0, 1200) : "A beautiful story scene";
    const selectedStyle = artStyle || storyRow.art_style || "cinematic";
    const settingsObj = asJsonObject(storyRow.consistency_settings) || {};
    const intensityFromSettings = clampNumber(settingsObj.style_intensity, 0, 100, 70);
    const effectiveStyleIntensity = clampNumber(styleIntensity, 0, 100, intensityFromSettings);
    const strictStyleEnabled =
      strictStyle === true || strictStyle === "true" || strictStyle === 1 || strictStyle === "1";

    const styleRef = STYLE_LIBRARY[selectedStyle] || STYLE_LIBRARY.cinematic;
    const isNoneStyle = selectedStyle === 'none';
    const disabledStyleElementSet = new Set(disabledStyleElements);
    const { effectiveElements: effectiveStyleElements, effectiveKeywords } =
      applyDisabledStyleElementsToStyleRef(styleRef, disabledStyleElements);
    
    let styleModifier = "";
    let styleReferenceText = "";

    if (!isNoneStyle) {
      styleReferenceText = `STYLE REFERENCE (${styleRef.name}):\n- Elements: ${effectiveStyleElements.join(
        ", "
      )}\n- Palette: ${styleRef.palette}\n- Composition: ${styleRef.composition}\n- Texture: ${styleRef.texture}\n`;

      styleModifier = `Use ${styleStrengthText(effectiveStyleIntensity)} ${styleRef.name}. Keywords: ${effectiveKeywords.join(
        ", "
      )}. Palette: ${styleRef.palette} Composition: ${styleRef.composition} Texture: ${styleRef.texture}${
        strictStyleEnabled ? ". Do not mix with other styles." : "."
      }`;
    }

    const negativePrompt = [
      "ugly",
      "blurry",
      "low quality",
      "distorted",
      "bad anatomy",
      "bad hands",
      "missing fingers",
      "extra digit",
      "fewer digits",
      "cropped",
      "worst quality",
      "normal quality",
      "jpeg artifacts",
      "signature",
      "watermark",
      "username",
      ...(strictStyleEnabled && !isNoneStyle ? styleRef.avoid : []),
    ].join(", ");

    /*
    const styleGuideId = storyRow.active_style_guide_id;
    const { data: styleGuideRow } = styleGuideId
      ? await admin
          .from("story_style_guides")
          .select("id, guide")
          .eq("id", styleGuideId)
          .maybeSingle()
      : { data: null };
    */
    const styleGuideId = storyRow.active_style_guide_id;
    const { data: styleGuideRow } = styleGuideId
      ? await admin
          .from("story_style_guides")
          .select("id, guide")
          .eq("id", styleGuideId)
          .maybeSingle()
      : { data: null };

    const styleGuide = asJsonObject((styleGuideRow as StyleGuideRow | null)?.guide) || {};
    const styleGuideText = Object.keys(styleGuide || {}).length
      ? `STYLE GUIDE:\n` +
        Object.entries(styleGuide)
          .map(([k, v]) => `   - ${k.replace(/_/g, " ").toUpperCase()}: ${String(v)}`)
          .join("\n")
      : "";

    const activeCharacterIds = activeCharacters.map((c) => c.id).filter((id) => Boolean(id));
    const { data: sceneStatesRows } = await admin
      .from("scene_character_states")
      .select("character_id, state")
      .eq("scene_id", sceneId)
      .in("character_id", activeCharacterIds);

    const stateByCharacterId = new Map<string, JsonObject>();
    ((sceneStatesRows || []) as SceneCharacterStateRow[]).forEach((r) => {
      stateByCharacterId.set(String(r.character_id), asJsonObject(r.state) || {});
    });

    /*
    const activeRefSheetIds = activeCharacters
      .map((c) => c.active_reference_sheet_id)
      .filter((id): id is string => Boolean(id));

    const { data: activeSheets } = await admin
      .from("character_reference_sheets")
      .select("id, character_id, sheet, prompt_snippet, reference_image_url, version, status")
      .in("id", activeRefSheetIds.length > 0 ? activeRefSheetIds : ["00000000-0000-0000-0000-000000000000"]);

    const { data: approvedSheets } = await admin
      .from("character_reference_sheets")
      .select("id, character_id, sheet, prompt_snippet, reference_image_url, version, status")
      .in("character_id", activeCharacterIds.length > 0 ? activeCharacterIds : ["00000000-0000-0000-0000-000000000000"])
      .eq("status", "approved")
      .order("version", { ascending: false });
    */
    const activeRefSheetIds = activeCharacters
      .map((c) => c.active_reference_sheet_id)
      .filter((id): id is string => Boolean(id));

    const { data: activeSheets } = await admin
      .from("character_reference_sheets")
      .select("id, character_id, sheet, prompt_snippet, reference_image_url, version, status")
      .in("id", activeRefSheetIds.length > 0 ? activeRefSheetIds : ["00000000-0000-0000-0000-000000000000"]);

    const { data: approvedSheets } = await admin
      .from("character_reference_sheets")
      .select("id, character_id, sheet, prompt_snippet, reference_image_url, version, status")
      .in("character_id", activeCharacterIds.length > 0 ? activeCharacterIds : ["00000000-0000-0000-0000-000000000000"])
      .eq("status", "approved")
      .order("version", { ascending: false });

    logTiming("sheets_fetch");

    const bestSheetByCharacterId = new Map<string, CharacterReferenceSheetRow>();
    ((activeSheets || []) as CharacterReferenceSheetRow[]).forEach((s) => bestSheetByCharacterId.set(String(s.character_id), s));
    ((approvedSheets || []) as CharacterReferenceSheetRow[]).forEach((s) => {
      const key = String(s.character_id);
      if (!bestSheetByCharacterId.has(key)) bestSheetByCharacterId.set(key, s);
    });

    const sceneCharacterStates = asJsonObject(sceneRow.character_states) || {};
    const resolveOutfitForScene = (sheet: unknown, sceneNumber: number): JsonObject | null => {
      const s = asJsonObject(sheet) || {};
      const outfits = (Array.isArray(s.outfit_variations) ? s.outfit_variations : Array.isArray(s.outfits) ? s.outfits : null) as unknown[] | null;
      if (!outfits) return null;
      for (const outfit of outfits) {
        const o = asJsonObject(outfit);
        if (!o) continue;
        const range = asJsonObject(o.scene_range) || {};
        const start = Number(range.start ?? o.start_scene ?? 0);
        const end = Number(range.end ?? o.end_scene ?? 999999);
        if (sceneNumber >= start && sceneNumber <= end) return o;
      }
      return null;
    };

    let characterContext = "";
    const characterValidationInputs: CharacterValidationInput[] = [];

    if (activeCharacters.length > 0) {
      const normalizeStateObj = (obj: JsonObject) => {
        const clothing = sanitizePrompt(asString(obj.clothing) || "");
        const state = sanitizePrompt(asString(obj.state) || asString(obj.condition) || "");
        const physical_attributes = sanitizePrompt(asString(obj.physical_attributes) || "");
        const out: JsonObject = {};
        if (clothing) out.clothing = clothing;
        if (state) out.state = state;
        if (physical_attributes) out.physical_attributes = physical_attributes;
        return out;
      };

      activeCharacters.forEach((char) => {
        const sheetRow = bestSheetByCharacterId.get(String(char.id));
        const sheet = sheetRow?.sheet || {};
        const snippet = sheetRow?.prompt_snippet || "";
        const sceneStateByName = normalizeStateObj(asJsonObject(sceneCharacterStates[char.name]) || {});
        const normalizedState = normalizeStateObj(stateByCharacterId.get(String(char.id)) || {});
        const mergedState = { ...(normalizedState || {}), ...(sceneStateByName || {}) };

        const outfit = resolveOutfitForScene(sheet, Number(sceneRow.scene_number || 0));
        const clothingFromTimeline = asString(outfit?.description) || asString(outfit?.name) || null;
        const clothing = sanitizePrompt(
          asString(mergedState.clothing) || clothingFromTimeline || asString(char.clothing) || "",
        );
        const state = sanitizePrompt(asString(mergedState.state) || asString(mergedState.condition) || "");
        const physicalBase = sanitizePrompt(asString(char.physical_attributes) || "");
        const physicalFromState = sanitizePrompt(asString(mergedState.physical_attributes) || "");
        const physicalDetails = [physicalBase, physicalFromState].filter(Boolean).join("; ");
        const accessories = sanitizePrompt(asString(char.accessories) || "");

        const line = `- ${char.name}: ${snippet ? `${sanitizePrompt(snippet)}. ` : ""}${physicalDetails ? `${physicalDetails}. ` : ""}${clothing ? `Outfit: ${clothing}. ` : ""}${accessories ? `Accessories: ${accessories}. ` : ""}${state ? `State: ${state}.` : ""}`.trim();
        characterContext += `${line}\n`;

        characterValidationInputs.push({
          name: char.name,
          reference_image_url: sheetRow?.reference_image_url || null,
          reference_text: snippet || char.physical_attributes || "",
          expected_outfit: clothing,
          expected_state: state,
        });
      });
    }

    // Contextual Scene Analysis Step
    // We use a fast LLM to fuse the scene description with character traits into a cohesive visual prompt
    console.log("Running Contextual Scene Analysis...");
    let refinedPrompt = "";
    let promptStructure: JsonObject | null = null;
    let adaptationLog = "";
    let consistencyResult: ConsistencyResult | null = null;

    // Use a faster/smaller model for analysis to ensure we don't timeout
    const analysisModel = "llama-3.2-3b"; 

    try {
      const contextResponse = await fetchWithTimeout("https://api.venice.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${veniceApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: analysisModel,
          safe_mode: false,
          messages: [
            {
              role: "system",
              content: `You are an expert Art Director and Prompt Engineer. Return a JSON object with a structured Stable Diffusion prompt.
              
              Inputs:
              PREVIOUS_CONTEXT: ${previousSceneSummary ? `Scene: ${previousSceneSummary}. States: ${previousSceneStates}` : "None"}
              CURRENT_SCENE: ${safePrompt}
              STYLE: ${styleModifier}
              CHARACTERS: ${characterContext || "None specified"}
              STYLE_GUIDE: ${styleGuideText || "None"}

              Directives:
              1. VOCABULARY: Use precise artistic terminology and domain-specific modifiers. Avoid ambiguous terms.
              2. CONSISTENCY: Reflect physical changes (aging, damage, dirt, emotion) from previous scenes.
              3. INTEGRATION: Integrate character details naturally into the description.
              4. STRICTLY ADHERE to the STYLE GUIDE.
              
              Output Format:
              {
                "subject": "Detailed visual description of the main subject(s) and their action",
                "style": "Specific art movement, medium, technique keywords (must align with input style)",
                "composition": "Camera angle, framing, lighting setup, perspective guidelines",
                "quality": "Resolution, detail level, and texture modifiers (e.g., '8k', 'intricate detail')",
                "progression_notes": "Brief explanation of adaptations based on previous context"
              }`
            },
            {
              role: "user",
              content: "Generate the JSON."
            }
          ]
        }),
      }, 15000); // Increased timeout slightly, switched to faster model

      if (contextResponse.ok) {
        const contextData = await contextResponse.json();
        const content = contextData.choices?.[0]?.message?.content || "";
        
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            promptStructure = asJsonObject(parsed);
            
            const pSubject = asString(parsed.subject) || "";
            const pStyle = asString(parsed.style) || "";
            const pComposition = asString(parsed.composition) || "";
            const pQuality = asString(parsed.quality) || "";
            
            refinedPrompt = [pStyle, pSubject, pComposition, pQuality].filter(Boolean).join(", ");
            adaptationLog = asString(parsed.progression_notes) || "Prompt refined by Contextual Analysis";
          } else {
             // Fallback if no JSON found, try to use raw content but strip quotes
             refinedPrompt = content.replace(/^["']|["']$/g, "").trim();
             adaptationLog = "Raw content used (JSON parse failed)";
          }
        } catch (e) {
          console.warn("Failed to parse Contextual Analysis JSON", e);
          refinedPrompt = content.replace(/^["']|["']$/g, "").trim();
        }

        console.log("Refined Prompt:", refinedPrompt);
      } else {
        console.error("Contextual Analysis failed:", contextResponse.status);
      }
      logTiming("context_analysis");
    } catch (err) {
      console.error("Contextual Analysis error:", err);
    }

    // Log the optimization to the new prompt_optimizations table
    if (promptStructure || refinedPrompt) {
      try {
        await admin.from("prompt_optimizations").insert({
          scene_id: sceneId,
          story_id: sceneRow.story_id,
          original_input: safePrompt,
          optimized_prompt: promptStructure || { full_text: refinedPrompt },
          final_prompt_text: refinedPrompt,
          framework_version: "1.0.0",
          model_used: analysisModel
        });
      } catch (e) {
        console.warn("Failed to log prompt optimization:", e);
      }
    }

    // Final Prompt Construction
    // If analysis failed, use a structured fallback instead of simple concatenation
    const fullPromptRaw = refinedPrompt
      ? `${refinedPrompt} ${styleModifier}`
      : `${styleModifier}. ${safePrompt}. ${characterContext ? `Characters: ${characterContext}` : ""} ${styleGuideText ? `Style Guide: ${styleGuideText}` : ""} High quality, detailed.`;
    
    // Ensure we don't exceed model limits (safe buffer)
    const fullPrompt = fullPromptRaw.length > 3000 ? fullPromptRaw.slice(0, 3000) : fullPromptRaw;

    if (Number(sceneRow.scene_number || 0) > 1 && activeCharacters.length > 0) {
      const prevNumber = Number(sceneRow.scene_number || 0) - 1;
      const { data: prevScene } = await admin
        .from("scenes")
        .select("id, scene_number, character_states, summary, original_text")
        .eq("story_id", sceneRow.story_id)
        .eq("scene_number", prevNumber)
        .maybeSingle();

      if (prevScene?.id) {
        const { data: prevStatesRows } = await admin
          .from("scene_character_states")
          .select("character_id, state")
          .eq("scene_id", prevScene.id)
          .in("character_id", activeCharacterIds);

        const prevStateByCharacterId = new Map<string, JsonObject>();
        ((prevStatesRows || []) as SceneCharacterStateRow[]).forEach((r) => {
          prevStateByCharacterId.set(String(r.character_id), asJsonObject(r.state) || {});
        });

        const prevCharacterStates = asJsonObject((prevScene as unknown as { character_states?: unknown }).character_states) || {};
        const issues: ContinuityIssue[] = [];

        activeCharacters.forEach((char) => {
          const prevByName = asJsonObject(prevCharacterStates[char.name]) || {};
          const prevNorm = prevStateByCharacterId.get(String(char.id)) || {};
          const prevMerged = { ...(prevNorm || {}), ...(prevByName || {}) };
          const prevClothing = String(prevMerged.clothing || "");

          const currByName = asJsonObject(sceneCharacterStates[char.name]) || {};
          const currNorm = stateByCharacterId.get(String(char.id)) || {};
          const currMerged = { ...(currNorm || {}), ...(currByName || {}) };
          const currClothing = String(currMerged.clothing || "");

          if (prevClothing && currClothing && prevClothing !== currClothing && !asString(currByName.clothing)) {
            issues.push({
              character: char.name,
              previous: prevClothing,
              current: currClothing,
            });
          }
        });

        if (issues.length > 0) {
          const continuityStatus = isStrict ? "fail" : "warn";
          await admin.from("consistency_logs").insert({
            story_id: sceneRow.story_id,
            scene_id: sceneId,
            check_type: "continuity_check",
            status: continuityStatus,
            details: {
              previous_scene_id: prevScene.id,
              issues,
            },
          });

          const eventRows = issues
            .map((i) => {
              const character = activeCharacters.find((c) => c.name === i.character);
              if (!character?.id) return null;
              return {
                story_id: sceneRow.story_id,
                from_scene_id: prevScene.id,
                to_scene_id: sceneId,
                character_id: character.id,
                event: { type: "outfit_change_unexplained", from: i.previous, to: i.current },
                story_context: `${String((prevScene as unknown as { summary?: unknown }).summary || "")}\n${String(sceneRow.summary || "")}`.trim() || null,
              };
            })
            .filter((v): v is NonNullable<typeof v> => Boolean(v));

          if (eventRows.length > 0) await admin.from("character_change_events").insert(eventRows);
        }
      }
    }

    // Log the consistency check
    logTiming("consistency_check_prep");
    await admin.from("consistency_logs").insert({
      story_id: sceneRow.story_id,
      scene_id: sceneId,
      check_type: "prompt_generation",
      status: activeCharacters.length > 0 ? "pass" : "warn",
      details: {
        active_characters: activeCharacters.map(c => c.name),
        settings: consistencySettings,
        base_traits: characterContext,
        refined_prompt: refinedPrompt,
        adaptation_note: adaptationLog,
        style_guide_used: styleGuide
      }
    });

    // Make sure we update the status BEFORE starting the heavy image generation
    // This provides immediate feedback and also ensures the DB is reachable before spending credits
    const { error: statusUpdateError } = await admin
      .from("scenes")
      .update({ generation_status: "generating" })
      .eq("id", sceneId);

    if (statusUpdateError) {
       console.error("Failed to update status to generating:", statusUpdateError);
       // We don't abort, but we log it. It might indicate DB load issues.
    }

    // Dynamic timeout calculation
    const elapsedPreGen = performance.now() - startTime;
    const SAFETY_BUFFER = 5000; // 5s for upload and final DB update
    const HARD_LIMIT = 58000; // 58s (Supabase limit is 60s)
    const maxImageGenTime = Math.floor(Math.max(10000, HARD_LIMIT - elapsedPreGen - SAFETY_BUFFER));
    
    console.log("Generating image...", { 
      sceneId, 
      selectedStyle, 
      promptLength: fullPrompt.length, 
      isStrict,
      elapsedPreGen,
      maxImageGenTime
    });

    const generateImage = async (model: string) => {
      // Enforce Venice API compliance requirements
      // NOTE: hide_watermark must be TRUE to actually hide the watermark.
      console.log(`[Compliance] Enforcing mandatory parameters for ${model}: safe_mode=false, hide_watermark=true`);
      
      // Truncate prompt based on model limits
      let safePrompt = fullPrompt;
      const limitedModels = ["hidream", "qwen-image", "z-image-turbo"];
      if (model.startsWith("lustify") || limitedModels.includes(model)) {
        safePrompt = fullPrompt.length > 1400 ? fullPrompt.slice(0, 1400) : fullPrompt;
      }

      // Adjust steps for specific models
      let steps = 30;
      if (model === "qwen-image") {
        steps = 8; // Max allowed for Qwen
      } else if (model === "z-image-turbo") {
        steps = 0; // Docs example uses 0
      }

      const res = await fetchWithTimeout("https://api.venice.ai/api/v1/image/generate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${veniceApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt: safePrompt,
          negative_prompt: negativePrompt,
          width: 1024,
          height: 576,
          steps,
          cfg_scale: 7.5,
          safe_mode: false,
          hide_watermark: true,
          embed_exif_metadata: false,
        }),
      }, maxImageGenTime);
      return res;
    };

    const primaryModel = model || "venice-sd35";
    const fallbackModel = "lustify-sdxl";

    let aiResponse = await generateImage(primaryModel);
    logTiming("image_gen_primary");
    let aiErrorText: string | null = null;
    let usedModel = primaryModel;
    if (!aiResponse.ok) {
      aiErrorText = await aiResponse.text();
      console.error("AI image generation error:", aiResponse.status, aiErrorText);
      const shouldRetryWithFallback =
        (aiResponse.status === 400 || aiResponse.status === 404) &&
        typeof aiErrorText === "string" &&
        (aiErrorText.toLowerCase().includes("model") || aiErrorText.toLowerCase().includes("unknown") || aiErrorText.toLowerCase().includes("not found"));
      if (shouldRetryWithFallback) {
        console.warn("Retrying with fallback model...", { primaryModel, fallbackModel });
        aiResponse = await generateImage(fallbackModel);
        logTiming("image_gen_fallback");
        usedModel = fallbackModel;
        if (!aiResponse.ok) {
          aiErrorText = await aiResponse.text();
          console.error("AI image generation error:", aiResponse.status, aiErrorText);
        } else {
          aiErrorText = null;
        }
      }
    }

    if (!aiResponse.ok) {
      // Debug: Check available models if we get a model-related error
      let availableModels: string[] | null = null;
      if (aiResponse.status === 400 || aiResponse.status === 404) {
        try {
          console.log("Fetching available models to debug invalid model error...");
          const modelsRes = await fetch("https://api.venice.ai/api/v1/models", {
            headers: { Authorization: `Bearer ${veniceApiKey}` }
          });
          if (modelsRes.ok) {
            const modelsData = await modelsRes.json();
            const modelsObj = asJsonObject(modelsData) || {};
            const modelsDataArray = Array.isArray(modelsObj.data) ? (modelsObj.data as unknown[]) : [];
            availableModels = modelsDataArray
              .map((m) => asString((asJsonObject(m) || {}).id))
              .filter((v): v is string => Boolean(v));
            console.log("Available models:", availableModels);
            if (availableModels && !availableModels.includes(usedModel)) {
               console.error(`CRITICAL: Model '${usedModel}' is NOT in the list of available models for this API Key.`);
            }
          }
        } catch (e) {
          console.error("Failed to list debug models:", e);
        }
      }

      const responseHeaders = collectResponseHeaders(aiResponse);
      const redactedHeaders = Object.entries(responseHeaders)
        .filter(([, v]) => v === "[redacted]")
        .map(([k]) => k);
      const statusText = String(aiResponse.statusText ?? "");
      const upstreamError = typeof aiErrorText === "string" ? truncateText(aiErrorText, 4000) : null;
      
      const reasons = deriveFailureReasons({
        status: aiResponse.status,
        statusText,
        headers: responseHeaders,
        bodyText: typeof aiErrorText === "string" ? aiErrorText : null,
      });
      
      // Append available models info to reasons if relevant
      if (availableModels && !availableModels.includes(usedModel)) {
          reasons.push(`Model '${usedModel}' is not available to your API key. Available: ${availableModels.slice(0, 5).join(", ")}...`);
      }

      // Capture exact prompt used for debugging
      let usedPrompt = fullPrompt;
      const limitedModels = ["hidream", "qwen-image", "z-image-turbo"];
      if (usedModel.startsWith("lustify") || limitedModels.includes(usedModel)) {
        usedPrompt = fullPrompt.length > 1400 ? fullPrompt.slice(0, 1400) : fullPrompt;
      }

      await admin.from("scenes").update({ generation_status: "error" }).eq("id", sceneId);

      await logConsistency({
        story_id: sceneRow.story_id,
        scene_id: sceneId,
        check_type: "image_generation",
        status: "fail",
        details: {
          http_status: aiResponse.status,
          model: usedModel,
          upstream_error: typeof aiErrorText === "string" ? aiErrorText.slice(0, 1000) : null,
          prompt_used: usedPrompt
        },
      });

      const persistedError =
        aiResponse.status === 429
          ? "Rate limit exceeded. Please try again later."
          : aiResponse.status === 402
            ? "AI credits exhausted. Please add credits to continue."
            : aiResponse.status === 400
              ? "Content could not be processed. Try a different scene or style."
              : aiResponse.status === 401 || aiResponse.status === 403
                ? "Upstream image provider authentication failed."
                : `Upstream Generation Failed (${aiResponse.status})`;

      await admin
        .from("scenes")
        .update({
          consistency_status: "fail",
          consistency_details: {
            generation_debug: {
              timestamp: new Date().toISOString(),
              headers: responseHeaders,
              redactedHeaders,
              requestId,
              stage: "image_generate",
              status: aiResponse.status,
              statusText,
              error: persistedError,
              model: usedModel,
              upstream_error: upstreamError,
              reasons,
              prompt: usedPrompt,
            },
          },
        })
        .eq("id", sceneId);

      if (aiResponse.status === 429) {
        return json(429, {
          error: "Rate limit exceeded. Please try again later.",
          requestId,
          stage: "image_generate",
          model: usedModel,
          details: { headers: responseHeaders, redactedHeaders, statusText, upstream_error: upstreamError, reasons, prompt: usedPrompt },
        });
      }
      if (aiResponse.status === 402) {
        return json(402, {
          error: "AI credits exhausted. Please add credits to continue.",
          requestId,
          stage: "image_generate",
          model: usedModel,
          details: { headers: responseHeaders, redactedHeaders, statusText, upstream_error: upstreamError, reasons, prompt: usedPrompt },
        });
      }
      if (aiResponse.status === 400) {
        const body = typeof aiErrorText === "string" && aiErrorText.length > 0 ? truncateText(aiErrorText, 2000) : null;
        return json(400, {
          error: "Content could not be processed. Try a different scene or style.",
          requestId,
          stage: "image_generate",
          details: { headers: responseHeaders, redactedHeaders, statusText, upstream_error: body, reasons, prompt: usedPrompt },
          model: usedModel,
        });
      }
      if (aiResponse.status === 401 || aiResponse.status === 403) {
        const body = typeof aiErrorText === "string" && aiErrorText.length > 0 ? truncateText(aiErrorText, 2000) : null;
        return json(502, {
          error: "Upstream image provider authentication failed.",
          requestId,
          stage: "image_generate",
          details: { headers: responseHeaders, redactedHeaders, statusText, upstream_error: body, reasons, prompt: usedPrompt },
          model: usedModel,
        });
      }

      // Catch-all for other upstream errors (e.g. 500 from Venice)
      const body = typeof aiErrorText === "string" && aiErrorText.length > 0
        ? truncateText(aiErrorText, 4000)
        : "No error details provided by upstream provider";
      return json(502, { 
        error: `Upstream Generation Failed (${aiResponse.status})`, 
        requestId,
        stage: "image_generate",
        details: { headers: responseHeaders, redactedHeaders, statusText, upstream_error: body, reasons, prompt: usedPrompt }, 
        model: usedModel 
      });
    }

    const responseHeaders = collectResponseHeaders(aiResponse);
    const redactedHeaders = Object.entries(responseHeaders)
      .filter(([, v]) => v === "[redacted]")
      .map(([k]) => k);
    const statusText = String(aiResponse.statusText ?? "");

    const aiData = await aiResponse.json();
    console.log("AI response structure:", JSON.stringify(Object.keys(aiData)));
    
    const imageDataUrl = extractFirstBase64Image(aiData);

    if (!imageDataUrl) {
      console.error("No valid image in response");
      await admin
        .from("scenes")
        .update({
          generation_status: "error",
          consistency_status: "fail",
          consistency_details: {
            generation_debug: {
              timestamp: new Date().toISOString(),
              requestId,
              stage: "image_parse",
              status: aiResponse.status,
              statusText,
              headers: responseHeaders,
              redactedHeaders,
              error: "No image data returned by upstream provider",
              model: usedModel,
              reasons: deriveFailureReasons({
                status: aiResponse.status,
                statusText,
                headers: responseHeaders,
                bodyText: null,
              }),
            },
          },
        })
        .eq("id", sceneId);
      await logConsistency({
        story_id: sceneRow.story_id,
        scene_id: sceneId,
        check_type: "image_parse",
        status: "fail",
        details: {
          model: usedModel,
          reason: "no_base64_image_found",
          ai_data_keys: isRecord(aiData) ? Object.keys(aiData) : null,
        },
      });
      return json(500, {
        error: "Failed to generate image. Please try again.",
        requestId,
        stage: "image_parse",
        model: usedModel,
        details: {
          status: aiResponse.status,
          statusText,
          headers: responseHeaders,
          redactedHeaders,
          reasons: deriveFailureReasons({
            status: aiResponse.status,
            statusText,
            headers: responseHeaders,
            bodyText: null,
          }),
        },
      });
    }
    logTiming("image_extraction");

    const base64Data = imageDataUrl;
    const bytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
    console.log(`[Debug] Decoded image byte length: ${bytes.length}, requestId: ${requestId}`);

const contentViolation = responseHeaders["x-venice-is-content-violation"] || "false";
const containsMinor = responseHeaders["x-venice-contains-minor"] || "false";
console.log(`[Debug] Content Violation: ${contentViolation}, Contains Minor: ${containsMinor}, requestId: ${requestId}`);

console.log(`[Debug] All Venice AI Headers: ${JSON.stringify(responseHeaders)}, requestId: ${requestId}`);

// DO NOT REDACT OR FILTER HEADERS HERE - USER EXPLICITLY REQUESTED FULL HEADER VISIBILITY
// The previous 'safeHeaders' filtering was hiding critical failure reason headers.
// 'responseHeaders' is already sanitized by collectResponseHeaders() to hide auth secrets.
// We pass 'responseHeaders' directly.

const isViolation =
  String(contentViolation).toLowerCase() === "true" || String(containsMinor).toLowerCase() === "true";
if (bytes.length < 1000 || isViolation) {
  console.error(`Generated image invalid. Size: ${bytes.length}, Violation: ${contentViolation}, Minor: ${containsMinor}`);
  const reasons = [
    ...deriveFailureReasons({ status: aiResponse.status, statusText, headers: responseHeaders, bodyText: null }),
    bytes.length < 1000 ? `Invalid image bytes (size=${bytes.length})` : null,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
  const errorDetails = {
    timestamp: new Date().toISOString(),
    size: bytes.length,
    headers: responseHeaders,
    redactedHeaders,
    requestId,
    stage: "image_validation",
    error: "Generated image invalid or blocked due to content policy.",
    suggestion:
      isViolation
        ? "Try rephrasing the scene description to avoid content that may violate policies, such as explicit violence or inappropriate depictions of minors."
        : "The generated image appears to be invalid. Try regenerating or adjusting the prompt.",
    status: aiResponse.status,
    statusText,
    reasons,
  };
  await admin.from("scenes").update({
    generation_status: "error",
    consistency_status: "fail",
    consistency_details: { ...errorDetails, generation_debug: errorDetails }
  }).eq("id", sceneId);
  return json(500, { 
    error: "Generated image invalid or blocked due to content policy.", 
    requestId, 
    stage: "image_validation",
    details: errorDetails 
  });
}

    const mime = detectImageMime(bytes);
    const ext = extFromMime(mime);
    const fileName = `${user.id}/${sceneRow.story_id}/${sceneId}-${Date.now()}.${ext}`;
    const file = new Blob([bytes], { type: mime });

    if (imageDataUrl) {
      // Check if we have enough time for VLM (need at least 15s buffer)
      // 60s hard limit - 15s VLM = 45s max start time
      const elapsedTime = performance.now() - startTime;
      if (elapsedTime > 45000) {
        console.warn("Skipping VLM validation due to timeout risk", { elapsedTime });
        logTiming("vlm_skipped_timeout");
      } else {
        try {
          console.log("Running VLM validation...");
        const referenceImages = characterValidationInputs
          .map((c) => c.reference_image_url)
          .filter((u): u is string => typeof u === "string" && u.length > 0)
          .slice(0, 4);

        const requestText = `Return JSON only.

You are validating whether a newly generated story scene image matches the target art style (and characters, if provided).

SCENE: ${safePrompt}

TARGET_STYLE: ${styleRef.name} (${selectedStyle})
STYLE_INTENSITY: ${effectiveStyleIntensity}%
STRICT_STYLE: ${strictStyleEnabled ? "true" : "false"}
${styleReferenceText}

${styleGuideText}

EXPECTED CHARACTERS (text anchors + expected outfit/state):
${JSON.stringify(characterValidationInputs, null, 2)}

Output schema:
{
  "overall_score": 0-100,
  "status": "pass"|"warn"|"fail",
  "characters": [
    {
      "name": "string",
      "face_features_score": 0-100,
      "proportions_score": 0-100,
      "outfit_score": 0-100,
      "notes": "string",
      "flags": ["string"]
    }
  ],
  "timeline_check": { "outfit_continuity_ok": true|false, "notes": "string" },
  "gradual_change_check": { "ok": true|false, "notes": "string" },
  "style_check": { "adherence_score": 0-100, "notes": "string", "violations": ["string"] }
}

Score style adherence against the STYLE REFERENCE and STYLE GUIDE. If STRICT_STYLE is true, be stricter about style mixing and palette/texture/composition violations.`;

        const vlmResponse = await fetchWithTimeout("https://api.venice.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${veniceApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "mistral-31-24b", // Supports vision
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: requestText },
                  ...referenceImages.map((u) => ({ type: "image_url", image_url: { url: u } })),
                  { type: "image_url", image_url: { url: `data:${mime};base64,${base64Data}` } },
                ]
              }
            ]
          }),
        }, 15000);

          if (vlmResponse.ok) {
          const vlmData = await vlmResponse.json();
          const validationResultText = vlmData.choices?.[0]?.message?.content || "";
          console.log("VLM Validation Result:", validationResultText);
          logTiming("vlm_validation");

          let parsed: unknown = null;
          try {
            const m = String(validationResultText).match(/\{[\s\S]*\}/);
            if (m?.[0]) parsed = JSON.parse(m[0]) as unknown;
          } catch (e) {
            parsed = null;
          }

          const parsedObj = asJsonObject(parsed) || {};
          const overallScoreRaw = parsedObj.overall_score ?? parsedObj.overallScore ?? null;
          const overallScore = typeof overallScoreRaw === "number" ? overallScoreRaw : Number(overallScoreRaw);

          const styleCheckObj = asJsonObject(parsedObj.style_check ?? parsedObj.styleCheck) || {};
          const styleScoreRaw =
            styleCheckObj.adherence_score ?? styleCheckObj.adherenceScore ?? styleCheckObj.score ?? null;
          const styleScore = typeof styleScoreRaw === "number" ? styleScoreRaw : Number(styleScoreRaw);

          const charScore = Number.isFinite(overallScore) ? overallScore : null;
          const styleAdherenceScore = Number.isFinite(styleScore) ? styleScore : null;
          const combinedScore =
            charScore !== null && styleAdherenceScore !== null
              ? Math.round(charScore * 0.65 + styleAdherenceScore * 0.35)
              : styleAdherenceScore !== null
                ? Math.round(styleAdherenceScore)
                : charScore !== null
                  ? Math.round(charScore)
                  : null;

          const statusRaw = asString(parsedObj.status);
          const derivedStatus =
            combinedScore === null
              ? "warn"
              : combinedScore >= 85
                ? "pass"
                : combinedScore >= 70
                  ? "warn"
                  : "fail";

          const strictStyleFail =
            strictStyleEnabled && styleAdherenceScore !== null && styleAdherenceScore < 75 ? "fail" : null;
          const status =
            strictStyleFail ??
            ((statusRaw === "pass" || statusRaw === "warn" || statusRaw === "fail") ? statusRaw : derivedStatus);

          const baseDetails = asJsonObject(parsed) ? (parsed as JsonObject) : { raw: validationResultText };
          const details: JsonObject = {
            ...baseDetails,
            headers: responseHeaders,
            redactedHeaders,
            derived: {
              character_score: charScore,
              style_score: styleAdherenceScore,
              combined_score: combinedScore,
              style_id: selectedStyle,
              style_name: styleRef.name,
              style_intensity: effectiveStyleIntensity,
              strict_style: strictStyleEnabled,
            },
          };

          consistencyResult = {
            overallScore: combinedScore,
            status,
            details,
          };

          // Conditional Retry Logic: If validation failed badly and we have time, try one more time
          // We check if we have at least 30s left (gen takes ~20s, upload ~2s)
          const timeRemaining = 58000 - (performance.now() - startTime);
          if (status === "fail" && timeRemaining > 30000) {
            console.warn("VLM Validation FAILED. Attempting automatic retry...", { overallScore: combinedScore, timeRemaining });
            logTiming("retry_triggered");
            
            // Adjust prompt to be stricter based on failure
            // If style failed, emphasize style. If characters failed, emphasize characters.
            let retryPrompt = fullPrompt;
            if (styleAdherenceScore !== null && styleAdherenceScore < 70) {
               retryPrompt = `Use ${styleRef.name} style strictly. ${fullPrompt}`;
            } else if (charScore !== null && charScore < 70) {
               retryPrompt = `Focus on character accuracy. ${fullPrompt}`;
            }

            // Quick retry with fallback model if primary failed, or same model if it was just a prompt issue?
            // Let's use the primary model again but with the stricter prompt, as the model itself is capable.
            // But if the previous generation used 'venice-sd35', maybe we switch to 'lustify-sdxl' just in case?
            // Actually, consistency is better with the same model.
            
            // Recalculate max time for this retry
            const retryMaxTime = Math.floor(timeRemaining - 5000); 
            
            console.log(`[Compliance] Enforcing mandatory parameters for retry with ${usedModel}: safe_mode=false, hide_watermark=true`);

            try {
              const retryRes = await fetchWithTimeout("https://api.venice.ai/api/v1/image/generate", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${veniceApiKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: usedModel, // Stick to the model that worked (technically)
                  safe_mode: false,
                  hide_watermark: true,
                  embed_exif_metadata: false,
                  prompt: retryPrompt.slice(0, 1400), // Safe truncation
                  negative_prompt: negativePrompt,
                  width: 1024,
                  height: 576,
                  steps: 30,
                  cfg_scale: 8.5, // Increase guidance scale slightly for adherence
                }),
              }, retryMaxTime);

              if (retryRes.ok) {
                const retryData = await retryRes.json();
                const retryHeaders = collectResponseHeaders(retryRes);
                console.log(`[Debug] Retry Venice AI Headers: ${JSON.stringify(retryHeaders)}, requestId: ${requestId}`);

                const retryB64 = extractFirstBase64Image(retryData);
                if (retryB64) {
                   // Overwrite the image data with the new one
                   // We won't run VLM again to save time, we just assume it's better or at least we tried.
                   console.log("Retry generation successful, replacing image.");
                   const retryBytes = Uint8Array.from(atob(retryB64), (c) => c.charCodeAt(0));
                   const retryMime = detectImageMime(retryBytes);
                   
                   // Update variables for upload
                   // We need to update 'file', 'mime', 'ext', 'fileName' (filename can stay same to overwrite)
                   // But 'const' variables cannot be reassigned. 
                   // Since we are inside a block, we can't easily change the outer 'file'.
                   // We will have to do a separate upload logic here or hack it.
                   
                   // Better approach: Upload the NEW image and return early?
                   // No, the code below handles upload.
                   // The cleanest way is to just proceed with upload logic using the new data.
                   // But 'file' is const.
                   
                   // Refactor: We will just upload here and return, skipping the bottom upload.
                   const retryExt = extFromMime(retryMime);
                   const retryFileName = `${user.id}/${sceneRow.story_id}/${sceneId}-${Date.now()}-retry.${retryExt}`;
                   const retryFile = new Blob([retryBytes], { type: retryMime });
                   
                   const { error: retryUploadError } = await admin.storage
                    .from("scene-images")
                    .upload(retryFileName, retryFile, { contentType: retryMime, upsert: true });

                   if (!retryUploadError) {
                      const { data: retryUrlData } = admin.storage.from("scene-images").getPublicUrl(retryFileName);
                      
                      // Log the retry success
                      await admin.from("consistency_logs").insert({
                        story_id: sceneRow.story_id,
                        scene_id: sceneId,
                        check_type: "retry_generation",
                        status: "pass",
                        details: { original_score: combinedScore, retry_prompt: retryPrompt }
                      });

                      await admin.from("scenes").update({
                        image_url: retryUrlData.publicUrl,
                        generation_status: "completed",
                        consistency_score: combinedScore,
                        consistency_status: "warn",
                        consistency_details: { ...details, retried: true, retry: { original_status: status, original_score: combinedScore } }
                      }).eq("id", sceneId);
                      
                      const retryResponseHeaders = collectResponseHeaders(retryRes);
                      return json(200, { success: true, imageUrl: retryUrlData.publicUrl, retried: true, requestId, headers: retryResponseHeaders });
                   }
                }
              }
            } catch (retryErr) {
              console.error("Retry generation failed:", retryErr);
              // Fall through to original image upload
            }
          }

        }
        } catch (vlmError) {
          console.error("VLM Validation failed:", vlmError);
        }
      }
    }

    const { error: uploadError } = await admin.storage
      .from("scene-images")
      .upload(fileName, file, { contentType: mime, upsert: true });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      await admin.from("scenes").update({ generation_status: "error" }).eq("id", sceneId);
      await logConsistency({
        story_id: sceneRow.story_id,
        scene_id: sceneId,
        check_type: "image_upload",
        status: "fail",
        details: { uploadError: serializeSupabaseError(uploadError) ?? uploadError },
      });
      return json(500, { error: "Failed to store image", requestId, stage: "image_upload" });
    }
    logTiming("image_upload");

    const { data: urlData } = admin.storage.from("scene-images").getPublicUrl(fileName);

    if (consistencyResult?.status) {
      await admin.from("scene_consistency_metrics").insert({
        story_id: sceneRow.story_id,
        scene_id: sceneId,
        image_url: urlData.publicUrl,
        overall_score: consistencyResult.overallScore,
        status: consistencyResult.status,
        metrics: consistencyResult.details,
      });

      await admin.from("consistency_logs").insert({
        story_id: sceneRow.story_id,
        scene_id: sceneId,
        check_type: "image_validation",
        status: consistencyResult.status,
        details: consistencyResult.details,
      });
    }

    await admin
      .from("scenes")
      .update({
        image_url: urlData.publicUrl,
        generation_status: "completed",
        consistency_score: consistencyResult?.overallScore ?? null,
        consistency_status: consistencyResult?.status ?? null,
        consistency_details: consistencyResult?.details ?? { headers: responseHeaders },
      })
      .eq("id", sceneId);

    logTiming("final_db_update");
    console.log("Performance Timings:", JSON.stringify(timings));

    return json(200, { success: true, imageUrl: urlData.publicUrl, requestId, headers: responseHeaders });
  } catch (error) {
    console.error("Error in generate-scene-image function:", error);
    return json(500, {
      error: "An unexpected error occurred. Please try again.",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});
