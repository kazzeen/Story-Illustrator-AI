import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";
import { ensureClothingColors, validateClothingColorCoverage } from "../_shared/clothing-colors.ts";
import {
  buildCharacterAppearanceAppendix,
  buildStoryStyleGuideGuidance,
  buildStyleGuidance,
  clampNumber,
  coerceRequestedResolution,
  computeStyleCfgScaleForStyle,
  computeStyleStepsForStyle,
  getStyleCategory,
  getAspectRatioLabel,
  splitCommaParts,
  stripKnownStylePhrases,
  STYLE_CONFLICTS,
  validateStyleApplication,
} from "../_shared/style-prompts.ts";
import { assemblePrompt, sanitizePrompt } from "../_shared/prompt-assembly.ts";

const GOOGLE_MODELS: Record<string, string> = {
  "gemini-2.5-flash": "imagen-4.0-generate-001",
  "gemini-3-pro": "imagen-4.0-generate-001",
};

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
  character_identity_lock?: boolean;
  character_anchor_strength?: number;
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
  consistency_details?: unknown;
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

type StyleGuideRow = {
  id: string;
  story_id: string;
  version: number;
  status: string;
  guide: unknown;
};

type SceneCharacterStateRow = { character_id: string; state: unknown; source?: unknown };

type CharacterReferenceSheetRow = {
  id: string;
  character_id: string;
  sheet: unknown;
  prompt_snippet: string | null;
  reference_image_url: string | null;
  version: number;
  status: string;
  character?: { name: string };
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
  return out;
}

function asJsonObject(val: unknown): JsonObject | null {
  return isRecord(val) ? val : null;
}

function asString(val: unknown): string | null {
  return typeof val === "string" ? val : null;
}

const ART_STYLE_ALIASES: Record<string, string> = {
  "no_specific_style": "none",
  "nospecificstyle": "none",
  "no_style": "none",
  "nostyle": "none",
  "comic_book": "comic",
  "comicbook": "comic",
  "oil_painting": "oil",
  "oilpainting": "oil",
  "digitalillustration": "digital_illustration",
  "realisticcinematic": "realistic_cinematic",
  "animemanga": "anime_manga",
  "manga": "anime_manga",
};

function normalizeArtStyleId(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_");
  return ART_STYLE_ALIASES[normalized] ?? normalized;
}

function asConsistencySettings(val: unknown): ConsistencySettings | null {
  const obj = asJsonObject(val);
  if (!obj) return null;
  return {
    mode: asString(obj.mode) ?? undefined,
    auto_correct: typeof obj.auto_correct === "boolean" ? obj.auto_correct : undefined,
    character_identity_lock: typeof obj.character_identity_lock === "boolean" ? obj.character_identity_lock : undefined,
    character_anchor_strength: typeof obj.character_anchor_strength === "number" ? obj.character_anchor_strength : undefined,
  };
}

async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}



type SceneCharacterAppearanceState = {
  clothing: string;
  state: string;
  physical_attributes: string;
  accessories?: string;
  extra?: Record<string, string>;
};

type SceneAppearanceHistoryRow = {
  id: string;
  scene_number: number | null;
  character_states: unknown;
};

function normalizeStateField(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > maxLen ? collapsed.slice(0, maxLen) : collapsed;
}

function normalizeExtraKey(key: string): string {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .slice(0, 64);
}

function collectExtraAttributes(rec: Record<string, unknown>): Record<string, string> | undefined {
  const reserved = new Set(["clothing", "state", "condition", "physical_attributes", "accessories"]);
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(rec)) {
    if (reserved.has(key)) continue;
    if (typeof raw !== "string") continue;
    const normalizedKey = normalizeExtraKey(key);
    if (!normalizedKey) continue;
    const v = normalizeStateField(raw, 400);
    if (!v) continue;
    out[normalizedKey] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseCharacterStatesByName(raw: unknown): Record<string, SceneCharacterAppearanceState> {
  const obj = asJsonObject(raw);
  if (!obj) return {};
  const out: Record<string, SceneCharacterAppearanceState> = {};
  for (const [name, rawState] of Object.entries(obj)) {
    const rec = asJsonObject(rawState);
    if (!rec) continue;
    out[String(name)] = {
      clothing: normalizeStateField(rec.clothing, 400),
      state: normalizeStateField(rec.state ?? rec.condition, 400),
      physical_attributes: normalizeStateField(rec.physical_attributes, 600),
      accessories: normalizeStateField(rec.accessories, 400) || undefined,
      extra: collectExtraAttributes(rec),
    };
  }
  return out;
}

function buildCharacterAppearanceAppendix(args: {
  characterNames: string[];
  effectiveStates: Record<string, SceneCharacterAppearanceState>;
}): string {
  const parts: string[] = [];
  for (const name of args.characterNames) {
    const st = args.effectiveStates[name];
    if (!st) continue;
    const segs: string[] = [];
    if (st.clothing) segs.push(`wearing ${st.clothing}`);
    if (st.accessories) segs.push(`accessories: ${st.accessories}`);
    if (st.state) segs.push(`condition: ${st.state}`);
    if (st.physical_attributes) segs.push(`physical: ${st.physical_attributes}`);
    if (st.extra && typeof st.extra === "object" && !Array.isArray(st.extra)) {
      const entries = Object.entries(st.extra)
        .filter(([k, v]) => typeof k === "string" && typeof v === "string" && k.trim() && v.trim())
        .sort(([a], [b]) => a.localeCompare(b));
      if (entries.length > 0) {
        const extraText = entries.map(([k, v]) => `${k}: ${v}`).join("; ");
        if (extraText.trim()) segs.push(`details: ${extraText}`);
      }
    }
    if (segs.length > 0) parts.push(`${name} (${segs.join("; ")})`);
  }
  if (parts.length === 0) return "";
  return `Character appearance: ${parts.join(" | ")}`;
}

function stableLowerName(name: string): string {
  return String(name || "").trim().toLowerCase();
}

/**
 * Robust filtering function to strictly control accessory inclusion.
 * Requirements:
 * 1. Remove accessories not explicitly in the current scene prompt.
 * 2. Cross-reference with explicit state (base).
 * 3. Ignore defaults for accessories to prevent "random" additions.
 */
function applyAccessoryConstraints(
  baseState: SceneCharacterAppearanceState,
  defaultState: Partial<SceneCharacterAppearanceState> | undefined
): string {
  // If the current scene (baseState) has explicitly defined accessories, use them.
  if (baseState.accessories && baseState.accessories.trim().length > 0) {
    return baseState.accessories.trim();
  }
  
  // Otherwise, return empty string. 
  // We explicitly DO NOT fall back to defaultState.accessories here, 
  // because the user requirement is to remove anything not explicitly in the scene prompt.
  return "";
}

function computeEffectiveAppearanceFromHistory(args: {
  historyScenes: SceneAppearanceHistoryRow[];
  characterNames: string[];
  defaultsByLowerName: Record<
    string,
    Pick<SceneCharacterAppearanceState, "clothing" | "physical_attributes"> & Partial<Pick<SceneCharacterAppearanceState, "accessories">>
  >;
}): {
  effectiveByName: Record<string, SceneCharacterAppearanceState>;
  missingClothing: string[];
} {
  const eligible = args.historyScenes
    .slice()
    .filter((s) => typeof s.scene_number === "number" && Number.isFinite(s.scene_number))
    .sort((a, b) => (a.scene_number as number) - (b.scene_number as number));

  const last: Record<string, SceneCharacterAppearanceState> = {};
  for (const s of eligible) {
    const byName = parseCharacterStatesByName(s.character_states);
    for (const [name, st] of Object.entries(byName)) {
      const key = stableLowerName(name);
      const prev = last[key] ?? { clothing: "", state: "", physical_attributes: "" };
      last[key] = {
        clothing: st.clothing ? st.clothing : prev.clothing,
        state: st.state ? st.state : prev.state,
        physical_attributes: st.physical_attributes ? st.physical_attributes : prev.physical_attributes,
        // Do not inherit accessories from previous scenes to prevent unwanted items persisting
        accessories: st.accessories ? st.accessories : undefined,
        extra: st.extra ? { ...(prev.extra ?? {}), ...st.extra } : prev.extra,
      };
    }
  }

  const effectiveByName: Record<string, SceneCharacterAppearanceState> = {};
  const missingClothing: string[] = [];
  for (const name of args.characterNames) {
    const key = stableLowerName(name);
    const base = last[key] ?? { clothing: "", state: "", physical_attributes: "" };
    const def = args.defaultsByLowerName[key];
    const merged: SceneCharacterAppearanceState = {
      clothing: base.clothing || def?.clothing || "",
      state: base.state || "",
      physical_attributes: base.physical_attributes || def?.physical_attributes || "",
      // Apply robust filtering to accessories: only explicit scene inputs are allowed
      accessories: applyAccessoryConstraints(base, def),
      extra: base.extra,
    };
    if (!merged.clothing) missingClothing.push(name);
    effectiveByName[name] = merged;
  }
  return { effectiveByName, missingClothing };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectResponseHeaders(res: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    // Redact sensitive headers
    if (k.toLowerCase().includes("auth") || k.toLowerCase().includes("key") || k.toLowerCase().includes("cookie")) {
      headers[k] = "[redacted]";
    } else {
      headers[k] = v;
    }
  });
  return headers;
}

// Allowed Styles
const ALLOWED_STYLES = [
  "none",
  "cinematic",
  "anime",
  "comic",
  "oil",
  "minimalist",
  "realistic",
  "fantasy",
  "digital_illustration",
  "realistic_cinematic",
  "anime_manga",
  "watercolor",
  "oil_painting",
  "pixel_art",
  "3d_render",
  "vintage_comic",
  "charcoal_sketch",
  "ukiyo_e",
  "abstract_expressionism",
  "pop_art",
  "film_noir",
  "cyberpunk",
  "steampunk",
  "art_nouveau",
  "gothic_fantasy",
  "impressionism",
  "low_poly",
  "paper_cutout",
  "claymation",
  "retro_80s_vaporwave",
  "storybook_illustration",
  "pencil_drawing",
  "ink_wash",
  "stained_glass",
  "graffiti_street_art",
  "flat_design",
  "isometric_3d",
  "vector_art",
  "renaissance_painting",
  "baroque",
  "surrealism",
  "minimalist",
  "line_art",
  "concept_art",
  "matte_painting",
  "fantasy_rpg",
  "sci_fi_concept",
  "horror_dark",
  "pastel_drawing",
  "chalk_art",
  "collage",
  "mosaic",
  "woodcut_print",
  "linocut",
  "scratchboard",
  "marker_sketch",
  "colored_pencil",
  "crayon_drawing",
  "childs_drawing",
  "technical_blueprint",
  "architectural_sketch",
  "fashion_illustration",
  "botanical_illustration",
  "medical_illustration",
  "scientific_diagram",
  "infographic",
  "typography_art",
  "calligraphy",
  "graffiti_tag",
  "tattoo_design",
  "logo_design",
  "icon_design",
  "ui_ux_design",
  "wireframe",
  "storyboard_sketch",
  "comic_strip",
  "graphic_novel",
  "manga_panel",
  "webtoon",
  "anime_screenshot",
  "cartoon_network_style",
  "disney_style",
  "pixar_style",
  "studio_ghibli_style",
  "simpsons_style",
  "south_park_style",
  "rick_and_morty_style",
  "adventure_time_style",
  "gravity_falls_style",
  "steven_universe_style",
  "family_guy_style",
  "futurama_style",
  "bob_burgers_style",
  "bojack_horseman_style",
  "archer_style",
  "big_mouth_style",
  "midnight_gospel_style",
  "love_death_robots_style",
  "arcane_style",
  "spider_verse_style",
  "stop_motion",
  "claymation_style",
  "lego_style",
  "minecraft_style",
  "roblox_style",
  "fortnite_style",
  "overwatch_style",
  "valorant_style",
  "league_of_legends_style",
  "dota_2_style",
  "world_of_warcraft_style",
  "hearthstone_style",
  "magic_the_gathering_style",
  "dungeons_and_dragons_style",
  "warhammer_40k_style",
  "cyberpunk_2077_style",
  "gta_style",
  "red_dead_redemption_style",
  "elden_ring_style",
  "dark_souls_style",
  "bloodborne_style",
  "sekiro_style",
  "final_fantasy_style",
  "persona_style",
  "pokemon_style",
  "zelda_breath_of_the_wild_style",
  "mario_style",
  "sonic_style",
  "street_fighter_style",
  "mortal_kombat_style",
  "tekken_style",
  "super_smash_bros_style",
  "animal_crossing_style",
  "stardew_valley_style",
  "terraria_style",
  "hollow_knight_style",
  "cuphead_style",
  "undertale_style",
  "celeste_style",
  "hades_style",
  "transistor_style",
  "bastion_style",
  "pyre_style",
  "journey_style",
  "abzu_style",
  "gris_style",
  "ori_and_the_blind_forest_style",
  "limbo_style",
  "inside_style",
  "little_nightmares_style",
  "among_us_style",
  "fall_guys_style",
  "rocket_league_style",
  "apex_legends_style",
  "call_of_duty_style",
  "battlefield_style",
  "halo_style",
  "destiny_style",
  "doom_style",
  "wolfenstein_style",
  "half_life_style",
  "portal_style",
  "left_4_dead_style",
  "team_fortress_2_style",
  "counter_strike_style",
  "rainbow_six_siege_style",
];

// Helper to sanitize inputs and prevent abuse
function json(status: number, data: JsonObject, headers?: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(headers || {}) },
  });
}

function extFromMime(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

export function truncateText(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

export { clampNumber };


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

function normalizeFullPromptText(text: string) {
  const raw = String(text || "");
  const normalizedNewlines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const withoutControls = Array.from(normalizedNewlines)
    .filter((ch) => {
      if (ch === "\n") return true;
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  const collapsedLines = withoutControls
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n");
  return collapsedLines.replace(/\n{3,}/g, "\n\n").trim();
}

function computeMissingSubjects(prompt: string, required: string[]) {
  const lower = String(prompt || "").toLowerCase();
  const missing: string[] = [];
  for (const sub of required) {
    const s = String(sub || "").trim();
    if (!s) continue;
    if (!lower.includes(s.toLowerCase())) missing.push(s);
  }
  return missing;
}

function extractFirstBase64Image(aiData: unknown): string | null {
  const obj = asJsonObject(aiData);
  if (!obj) return null;

  const imagesRaw = obj.images;
  if (Array.isArray(imagesRaw) && imagesRaw.length > 0) {
    const first = imagesRaw[0];
    if (typeof first === "string") return stripDataUrlPrefix(first);
    // Some APIs return objects in the array
    const firstObj = asJsonObject(first);
    if (firstObj && typeof firstObj.url === "string") return stripDataUrlPrefix(firstObj.url); // URL is not base64, but we handle base64 here usually.
    // Venice returns base64 strings in 'images' array.
  }

  // Fallback for single image response (some APIs)
  if (typeof obj.image === "string") return stripDataUrlPrefix(obj.image);
  
  return null;
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
  return "image/png"; // Fallback
}

export function extFromMimeTyped(mime: "image/webp" | "image/png" | "image/jpeg"): string {
  if (mime === "image/webp") return "webp";
  if (mime === "image/jpeg") return "jpg";
  return "png";
}

function deriveFailureReasons(args: {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string | null;
}): string[] {
  const reasons: string[] = [];
  const h = args.headers;
  
  const contentViolation = h["x-venice-is-content-violation"] || "false";
  const containsMinor = h["x-venice-contains-minor"] || "false";

  if (String(contentViolation).toLowerCase() === "true") reasons.push("Content policy violation (x-venice-is-content-violation=true)");
  if (String(containsMinor).toLowerCase() === "true") reasons.push("Contains minor (x-venice-contains-minor=true)");

  if (args.status === 429) reasons.push("Upstream rate limit (HTTP 429)");
  if (args.status === 402) reasons.push("Upstream credits exhausted (HTTP 402)");
  if (args.status === 401 || args.status === 403) reasons.push(`Upstream auth rejected (HTTP ${args.status})`);

  const ct = (h["content-type"] ?? "").toLowerCase();
  if (ct.includes("text/html")) reasons.push("Upstream returned HTML (likely an error page)");
  if (ct === "") reasons.push("Missing Content-Type header");

  if (args.bodyText) {
    const lower = args.bodyText.toLowerCase();
    if (lower.includes("content policy")) reasons.push("Body indicates content policy violation");
    if (lower.includes("nsfw")) reasons.push("Body indicates NSFW content detected");
    if (lower.includes("model not found")) reasons.push("Model not found or invalid");
    if (lower.includes("load balance")) reasons.push("Load balancing error");
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

  const requestId = crypto.randomUUID();
  let admin: ReturnType<typeof createClient> | null = null;
  let currentSceneRow: SceneRow | null = null;
  let requestedSceneId: string | null = null;
  let lastPromptDebug:
    | {
        model: string;
        prompt: string;
        promptFull: string;
        preprocessingSteps: string[];
        promptHash: string;
        requestParams: Record<string, unknown>;
        warnings?: string[];
      }
    | undefined;

  const timings: Record<string, number> = {};
  const startTotal = performance.now();
  const logTiming = (label: string) => {
    timings[label] = Math.round(performance.now() - startTotal);
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing Supabase environment variables");
      return json(500, { error: "Configuration error", requestId, details: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }

    const {
      sceneId,
      storyId,
      reset: resetFlag,
      artStyle,
      model,
      width: requestedWidth,
      height: requestedHeight,
      styleIntensity,
      strictStyle,
      disabledStyleElements,
      forcePrompt,
      forceFullPrompt,
      promptOnly,
    } = await req.json();
    requestedSceneId = sceneId;

    const warnings: string[] = [];
    const rawModel = asString(model);
    const usedModel = rawModel && rawModel.trim() ? rawModel.trim() : null;
    const usedStyleIntensity = clampNumber(styleIntensity, 0, 100, 70);
    const usedStrictStyle = typeof strictStyle === "boolean" ? strictStyle : true;
    const usedDisabledStyleElements = Array.isArray(disabledStyleElements)
      ? disabledStyleElements
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter(Boolean)
          .slice(0, 48)
      : [];
    const veniceApiKey = Deno.env.get("VENICE_API_KEY") ?? "";
    const geminiApiKeyRaw = Deno.env.get("GEMINI_API_KEY");
    const geminiApiKey = typeof geminiApiKeyRaw === "string" ? geminiApiKeyRaw.trim() : "";
    const isPromptOnly = typeof promptOnly === "boolean" ? promptOnly : false;
    const forceFullPromptText = asString(forceFullPrompt);

    if (!resetFlag) {
      if (!veniceApiKey.trim() && !geminiApiKey.trim()) {
        console.error("Missing upstream API keys");
        return json(500, { error: "Configuration error", requestId, details: "Missing VENICE_API_KEY and GEMINI_API_KEY" });
      }
    }

    admin = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing authorization header", requestId });

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await admin.auth.getUser(token);

    if (authError || !user) {
      return json(401, { error: "Invalid token", requestId });
    }

    // --- RESET LOGIC ---
    if (resetFlag) {
      // Validate storyId
      if (!storyId || !UUID_REGEX.test(storyId)) {
        return json(400, { error: "Valid story ID is required for reset", requestId });
      }
      const storyIdString = String(storyId);

      const { data: story, error: storyError } = await admin
        .from("stories")
        .select("user_id")
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
    const normalizedArtStyle = normalizeArtStyleId(artStyle);
    let validatedArtStyle = normalizedArtStyle ?? null;
    if (artStyle) {
      console.log(
        `[Debug] Received request for artStyle: '${String(artStyle)}' (normalized='${normalizedArtStyle ?? ""}')`,
      );
    }
    if (validatedArtStyle && !ALLOWED_STYLES.includes(validatedArtStyle)) {
      console.warn(
        `[Warning] Invalid art style requested: '${String(artStyle)}' (normalized='${validatedArtStyle}'). Falling back to 'digital_illustration'.`,
      );
      warnings.push(`invalid_art_style_fallback:${String(validatedArtStyle)}`);
      validatedArtStyle = "digital_illustration";
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
      "gemini-2.5-flash",
      "gemini-3-pro",
    ];
    if (usedModel) {
      console.log(`[Debug] Received request for model: '${usedModel}'`);
      if (!ALLOWED_MODELS.includes(usedModel)) {
        console.error(`[Error] Invalid model requested: '${usedModel}'. Allowed: ${ALLOWED_MODELS.join(", ")}`);
        return json(400, { error: "Invalid model", requestId, details: `Model '${usedModel}' not supported` });
      }
    }

    const fetchSceneOnce = async () =>
      await admin!
        .from("scenes")
        .select(
          "id, story_id, scene_number, title, summary, original_text, characters, setting, emotional_tone, image_prompt, image_url, character_states, consistency_details"
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
      });
    }

    if (!scene) return json(404, { error: "Scene not found", requestId });
    currentSceneRow = scene;

    const { data: storyRow, error: storyError } = await admin
      .from("stories")
      .select("user_id, art_style, consistency_settings, active_style_guide_id")
      .eq("id", scene.story_id)
      .single();

    if (storyError || !storyRow) {
      return json(500, { error: "Failed to fetch story", requestId });
    }

    if (storyRow.user_id !== user.id) return json(403, { error: "Not allowed", requestId });

    const activeStyleGuideId =
      typeof (storyRow as { active_style_guide_id?: unknown }).active_style_guide_id === "string"
        ? String((storyRow as { active_style_guide_id: string }).active_style_guide_id)
        : null;
    let activeStyleGuideRow: StyleGuideRow | null = null;

    if (activeStyleGuideId) {
      if (!UUID_REGEX.test(activeStyleGuideId)) {
        warnings.push("style_guide_id_invalid");
      } else {
        const { data: guideRow, error: guideError } = await admin
          .from("story_style_guides")
          .select("id, story_id, version, status, guide")
          .eq("id", activeStyleGuideId)
          .maybeSingle();

        if (guideError || !guideRow) {
          warnings.push("style_guide_missing");
        } else if (String((guideRow as { story_id?: unknown }).story_id || "") !== String(scene.story_id || "")) {
          warnings.push("style_guide_story_mismatch");
        } else {
          activeStyleGuideRow = guideRow as unknown as StyleGuideRow;
          const status = String((activeStyleGuideRow as { status?: unknown }).status || "");
          if (status && status !== "approved") warnings.push(`style_guide_status:${status}`);
        }
      }
    }

    if (!isPromptOnly) {
      await admin.from("scenes").update({ generation_status: "generating" }).eq("id", sceneId);
      logTiming("status_update_generating");
    }

    // --- PROMPT PREPARATION ---
    const preprocessingSteps: string[] = [];
    preprocessingSteps.push("build:style_enforcement_v2");
    const basePromptRaw = forcePrompt || scene.image_prompt || scene.original_text || scene.summary || "";
    const fullPromptRaw = basePromptRaw;
    let promptCore = basePromptRaw;
    let fullPrompt = basePromptRaw;
    let characterStatesUsed: Record<string, SceneCharacterAppearanceState> | null = null;
    let characterStatesHash: string | null = null;
    let previousCharacterStatesHash: string | null = null;
    const characterNames = Array.isArray(scene.characters)
      ? scene.characters.map((n) => String(n || "").trim()).filter(Boolean)
      : [];

    if (!forcePrompt && typeof artStyle === "string" && artStyle.trim()) {
      const stripped = stripKnownStylePhrases({ prompt: promptCore, keepStyleId: validatedArtStyle });
      if (typeof stripped.prompt === "string" && stripped.prompt.trim()) {
        promptCore = stripped.prompt;
        if (stripped.removed && stripped.removed.length > 0) preprocessingSteps.push(`base_prompt_style_stripped:${stripped.removed.length}`);
      }
    }

    if (!forcePrompt) {
      if (characterNames.length > 0 && typeof scene.scene_number === "number" && Number.isFinite(scene.scene_number)) {
        const { data: historyRows, error: historyError } = await admin
          .from("scenes")
          .select("id, scene_number, character_states")
          .eq("story_id", scene.story_id)
          .not("scene_number", "is", null)
          .lte("scene_number", scene.scene_number)
          .order("scene_number", { ascending: true });

        if (historyError) {
          console.warn("[Prompt] Failed to fetch scene history for appearance carry-forward", { requestId, historyError });
        } else {
          const { data: storyCharacters, error: storyCharError } = await admin
            .from("characters")
            .select("name, clothing, accessories, physical_attributes")
            .eq("story_id", scene.story_id);

          const defaultsByLowerName: Record<
            string,
            Pick<SceneCharacterAppearanceState, "clothing" | "physical_attributes"> & Partial<Pick<SceneCharacterAppearanceState, "accessories">>
          > = {};
          if (storyCharError) {
            console.warn("[Prompt] Failed to fetch character defaults", { requestId, storyCharError });
          } else {
            (storyCharacters || []).forEach((c) => {
              const name = typeof (c as { name?: unknown }).name === "string" ? String((c as { name: string }).name) : "";
              if (!name) return;
              const clothing =
                typeof (c as { clothing?: unknown }).clothing === "string" ? String((c as { clothing: string }).clothing) : "";
              const accessories =
                typeof (c as { accessories?: unknown }).accessories === "string"
                  ? String((c as { accessories: string }).accessories)
                  : "";
              const physical_attributes =
                typeof (c as { physical_attributes?: unknown }).physical_attributes === "string"
                  ? String((c as { physical_attributes: string }).physical_attributes)
                  : "";
              defaultsByLowerName[stableLowerName(name)] = { clothing, accessories, physical_attributes };
            });
          }

          const historyScenes = (historyRows || []) as SceneAppearanceHistoryRow[];
          const computed = computeEffectiveAppearanceFromHistory({
            historyScenes,
            characterNames,
            defaultsByLowerName,
          });

          const sceneText = String(scene.original_text || scene.summary || scene.setting || "");
          const coloredEffective: Record<string, SceneCharacterAppearanceState> = {};
          const appearanceByName: Record<string, unknown> = {};
          const clothingColorIssues: Array<{ name: string; clothing: string }> = [];

          for (const name of characterNames) {
            const st = computed.effectiveByName[name] ?? { clothing: "", state: "", physical_attributes: "" };
            const clothingRaw = String(st.clothing || "").trim();
            const clothing =
              clothingRaw.length === 0
                ? ""
                : ensureClothingColors(clothingRaw, {
                    seed: `${scene.story_id}:${scene.id}:${name}:edge`,
                    scene_text: sceneText,
                    force_if_no_keywords: true,
                  }).text || clothingRaw;

            const coverage = clothing ? validateClothingColorCoverage(clothing) : { ok: true };
            if (clothing && coverage.ok === false) {
              clothingColorIssues.push({ name, clothing });
            }

            coloredEffective[name] = { ...st, clothing };
            const extra =
              st.extra && typeof st.extra === "object" && !Array.isArray(st.extra)
                ? Object.fromEntries(
                    Object.entries(st.extra)
                      .filter(([k, v]) => typeof k === "string" && typeof v === "string" && k.trim() && v.trim())
                      .sort(([a], [b]) => a.localeCompare(b)),
                  )
                : undefined;
            appearanceByName[name] = {
              clothing,
              accessories: typeof st.accessories === "string" ? st.accessories : "",
              state: typeof st.state === "string" ? st.state : "",
              physical_attributes: typeof st.physical_attributes === "string" ? st.physical_attributes : "",
              extra,
            };
          }

          characterStatesUsed = coloredEffective;
          characterStatesHash = await sha256Hex(JSON.stringify(appearanceByName));
          preprocessingSteps.push("character_state_history_applied");

          if (computed.missingClothing.length > 0) {
            preprocessingSteps.push(`missing_clothing:${computed.missingClothing.join(",")}`);
          }

          if (clothingColorIssues.length > 0) {
            preprocessingSteps.push(`clothing_color_issues:${clothingColorIssues.map((x) => x.name).join(",")}`);
          }

          // Appendix assembly is deferred to later


          const detailsObj =
            asJsonObject(scene.consistency_details) ??
            (typeof scene.consistency_details === "string"
              ? (() => {
                  try {
                    const parsed = JSON.parse(scene.consistency_details) as unknown;
                    return asJsonObject(parsed);
                  } catch {
                    return null;
                  }
                })()
              : null);
          const genDebug = detailsObj ? asJsonObject(detailsObj.generation_debug) : null;
          previousCharacterStatesHash = genDebug && typeof genDebug.character_states_hash === "string" ? genDebug.character_states_hash : null;
          if (previousCharacterStatesHash && characterStatesHash && previousCharacterStatesHash !== characterStatesHash) {
            preprocessingSteps.push("character_appearance_changed");
          }

          console.log("[Prompt] Character appearance computed", {
            requestId,
            sceneId: scene.id,
            sceneNumber: scene.scene_number,
            characterStatesHash,
            previousCharacterStatesHash,
            missingClothingCount: computed.missingClothing.length,
            clothingColorIssuesCount: clothingColorIssues.length,
          });
        }
      } else if (characterNames.length > 0) {
        console.log("[Prompt] Skipping appearance history (missing scene_number)", { requestId, sceneId: scene.id });
      }
    }
    
    // Safety check for empty prompts
    if (!promptCore.trim()) {
      if (isPromptOnly) {
        return json(200, { success: false, error: "Prompt is empty", requestId, stage: "prompt_only" });
      }
      return json(400, { error: "Prompt is empty", requestId });
    }

    const storyStyleNormalized = normalizeArtStyleId((storyRow as { art_style?: unknown }).art_style);
    const hasStyleOverride = Boolean(validatedArtStyle);
    let selectedStyle = validatedArtStyle ?? storyStyleNormalized;
    if (selectedStyle && !ALLOWED_STYLES.includes(selectedStyle)) selectedStyle = null;
    selectedStyle = selectedStyle || "digital_illustration";

    const styleGuideUsable = Boolean(activeStyleGuideRow && String(activeStyleGuideRow.status || "") !== "archived");
    const styleGuideGuidance =
      styleGuideUsable && selectedStyle === "none"
        ? buildStoryStyleGuideGuidance({
            guide: activeStyleGuideRow?.guide,
            intensity: usedStyleIntensity,
            strict: usedStrictStyle,
          })
        : { positive: "", used: false, issues: [] as string[] };

    if (styleGuideGuidance.used) {
      if (styleGuideGuidance.positive.trim()) {
        if (activeStyleGuideRow?.version) preprocessingSteps.push(`style_guide_applied:v${activeStyleGuideRow.version}`);
        else preprocessingSteps.push("style_guide_applied");
      }
      if (styleGuideGuidance.issues.length > 0) {
        styleGuideGuidance.issues.forEach((issue) => warnings.push(`style_guide_issue:${issue}`));
      }
    } else if (activeStyleGuideId) {
      warnings.push("style_guide_not_applied");
    }
    if (hasStyleOverride && activeStyleGuideId) preprocessingSteps.push("style_guide_skipped_for_style_override");

    const isAnimePreferredStyle =
      selectedStyle === "anime" ||
      selectedStyle === "anime_manga" ||
      selectedStyle === "manga_panel" ||
      selectedStyle === "webtoon" ||
      selectedStyle === "anime_screenshot" ||
      selectedStyle === "studio_ghibli_style";

    const requestedModel = usedModel;
    const styleCategory = getStyleCategory(selectedStyle) ?? (isAnimePreferredStyle ? "anime" : "artistic");
    const preferredModelByCategory: Record<string, string> = {
      anime: "wai-Illustrious",
      realistic: "venice-sd35",
      pixel: "qwen-image",
      "3d": "hidream",
      artistic: "lustify-sdxl",
    };
    const allowedModelsByCategory: Record<string, Set<string>> = {
      anime: new Set(["wai-Illustrious", "hidream", "gemini-2.5-flash", "gemini-3-pro"]),
      realistic: new Set(["venice-sd35", "lustify-sdxl", "lustify-v7", "hidream", "z-image-turbo", "gemini-2.5-flash", "gemini-3-pro"]),
      pixel: new Set(["qwen-image", "lustify-sdxl", "lustify-v7", "gemini-2.5-flash", "gemini-3-pro"]),
      "3d": new Set(["hidream", "lustify-sdxl", "lustify-v7", "gemini-2.5-flash", "gemini-3-pro"]),
      artistic: new Set(["lustify-sdxl", "lustify-v7", "hidream", "qwen-image", "z-image-turbo", "gemini-2.5-flash", "gemini-3-pro"]),
    };
    const preferredModel = preferredModelByCategory[styleCategory] ?? "lustify-sdxl";
    const allowedForCategory = allowedModelsByCategory[styleCategory] ?? new Set<string>();

    const selectedModel = requestedModel || preferredModel;
    if (!requestedModel) {
      preprocessingSteps.push(`model_selected_for_style:${styleCategory}->${selectedModel}`);
    } else if (usedStrictStyle && allowedForCategory.size > 0 && !allowedForCategory.has(requestedModel)) {
      preprocessingSteps.push(`model_not_recommended_for_style:${requestedModel}:${styleCategory}`);
      warnings.push(`model_not_recommended_for_style:${requestedModel}:${styleCategory}`);
    }

    const styleGuidance = buildStyleGuidance({
      styleId: selectedStyle,
      intensity: usedStyleIntensity,
      strict: usedStrictStyle,
      disabledElements: usedDisabledStyleElements,
    });
    if (styleGuidance.usedFallback) warnings.push(`style_prompt_fallback:${selectedStyle}`);
    if (styleGuidance.positive.trim()) {
      preprocessingSteps.push(`style_applied:${selectedStyle}`);
      preprocessingSteps.push(`style_intensity:${Math.round(usedStyleIntensity)}`);
      if (usedStrictStyle) preprocessingSteps.push("style_strict");
      if (usedDisabledStyleElements.length > 0) preprocessingSteps.push(`style_elements_disabled:${usedDisabledStyleElements.length}`);
    }

    const styleValidation = validateStyleApplication({
      styleId: selectedStyle,
      strict: usedStrictStyle,
      guidance: styleGuidance,
      disabledElements: usedDisabledStyleElements,
    });
    if (!styleValidation.ok) {
      styleValidation.issues.forEach((issue) => warnings.push(`style_validation_issue:${issue}`));
      preprocessingSteps.push("style_validation_issues");
      const hardIssues = styleValidation.issues.filter(
        (i) => i === "style_guidance_empty" || i.startsWith("style_category_marker_missing:"),
      );
      if (usedStrictStyle && hardIssues.length > 0) {
        if (!isPromptOnly) {
          await admin.from("scenes").update({ generation_status: "error" }).eq("id", sceneId);
          return json(400, {
            error: "Style validation failed",
            requestId,
            stage: "style_validation",
            details: { issues: hardIssues, styleId: selectedStyle, model: selectedModel },
          });
        }
        return json(200, {
          success: false,
          error: "Style validation failed",
          requestId,
          stage: "style_validation",
          details: { issues: hardIssues, styleId: selectedStyle, model: selectedModel },
        });
      }
    }

    const resolutionFallback = selectedModel === "gemini-2.5-flash" ? { width: 1024, height: 1024 } : { width: 1024, height: 576 };
    const resolution = coerceRequestedResolution({
      model: selectedModel,
      width: requestedWidth,
      height: requestedHeight,
      fallback: resolutionFallback,
    });
    if (resolution.issues.length > 0) {
      resolution.issues.forEach((issue) => warnings.push(`resolution_issue:${issue}`));
      preprocessingSteps.push("resolution_processed");
    }
    const width = resolution.width;
    const height = resolution.height;
    
    // Start timing
    const startTime = performance.now();
    
    // --- GENERATE IMAGE ---
    const isStrict = usedStrictStyle;

    let characterAppendix: string | undefined;
    if (!forcePrompt && characterNames.length > 0 && characterStatesUsed) {
      characterAppendix = buildCharacterAppearanceAppendix({ characterNames, effectiveStates: characterStatesUsed });
    }

    const assembly = assemblePrompt({
      basePrompt: promptCore,
      characterAppendix,
      stylePrefix: styleGuidance.prefix,
      stylePositive: styleGuidance.positive,
      styleGuidePositive: styleGuideGuidance.positive,
      model: selectedModel,
      maxLength: selectedModel.startsWith("gemini") ? 3800 : 1400,
      requiredSubjects: characterNames,
      selectedStyleId: selectedStyle, // Enables V2 cleaning
    });
    
    fullPrompt = assembly.fullPrompt;
    if (assembly.truncated) preprocessingSteps.push("prompt_truncated");
    if (assembly.missingSubjects) {
       assembly.missingSubjects.forEach(s => warnings.push(`missing_subject:${s}`));
    }
    const maxPromptLength = selectedModel.startsWith("gemini") ? 3800 : 1400;
    if (forceFullPromptText && forceFullPromptText.trim()) {
      const normalized = normalizeFullPromptText(forceFullPromptText);
      if (!normalized) {
        if (isPromptOnly) {
          return json(200, { success: false, error: "Prompt is empty", requestId, stage: "prompt_only_force_full_prompt" });
        }
        return json(400, { error: "Prompt is empty", requestId });
      }
      fullPrompt = normalized.length > maxPromptLength ? normalized.slice(0, maxPromptLength) : normalized;
      preprocessingSteps.push("force_full_prompt");
      if (normalized.length > maxPromptLength) preprocessingSteps.push("force_full_prompt_truncated");
      const missing = computeMissingSubjects(fullPrompt, characterNames);
      if (missing.length > 0) missing.forEach((s) => warnings.push(`missing_subject:${s}`));
    }

    if (selectedStyle !== "none" && (styleGuidance.prefix || styleGuidance.positive)) {
      const fullLower = fullPrompt.toLowerCase();
      const prefixLower = String(styleGuidance.prefix || "").trim().toLowerCase();
      const styleNameLower = String(styleGuidance.styleName || "").trim().toLowerCase();
      const styleIdLower = selectedStyle.replace(/_/g, " ").toLowerCase();
      const hasMarker =
        (prefixLower && fullLower.includes(prefixLower)) ||
        (styleNameLower && fullLower.includes(styleNameLower)) ||
        (styleIdLower && fullLower.includes(styleIdLower));
      if (!hasMarker) {
        warnings.push("style_validation_issue:style_marker_missing_in_prompt");
        preprocessingSteps.push("style_marker_missing_in_prompt");
        if (usedStrictStyle) {
          if (!isPromptOnly) {
            await admin.from("scenes").update({ generation_status: "error" }).eq("id", sceneId);
            return json(500, {
              error: "Style application failed",
              requestId,
              stage: "style_application",
              details: { styleId: selectedStyle, model: selectedModel },
            });
          }
          return json(200, {
            success: false,
            error: "Style application failed",
            requestId,
            stage: "style_application",
            details: { styleId: selectedStyle, model: selectedModel },
            prompt: fullPrompt,
            promptFull: fullPrompt,
            preprocessingSteps,
            warnings: warnings.length > 0 ? warnings : undefined,
            parts: assembly.parts,
          });
        }
      }
    }

    const promptHash = await sha256Hex(fullPrompt);
    if (isPromptOnly) {
      return json(200, {
        success: true,
        requestId,
        stage: "prompt_only",
        model: selectedModel,
        prompt: fullPrompt,
        promptFull: fullPrompt,
        promptHash,
        warnings: warnings.length > 0 ? warnings : undefined,
        preprocessingSteps,
        parts: assembly.parts,
        truncated: assembly.truncated,
        missingSubjects: assembly.missingSubjects,
        maxLength: maxPromptLength,
      });
    }
    lastPromptDebug = {
      model: selectedModel,
      prompt: fullPrompt,
      promptFull: fullPrompt,
      preprocessingSteps,
      promptHash,
      warnings: warnings.length > 0 ? warnings : undefined,
      requestParams: {
        model: selectedModel,
        artStyle: selectedStyle,
        styleIntensity: usedStyleIntensity,
        strictStyle: isStrict,
        width,
        height,
        disabledStyleElements: usedDisabledStyleElements.length > 0 ? usedDisabledStyleElements : undefined,
        styleGuideId: activeStyleGuideId ?? undefined,
        styleGuideVersion: typeof activeStyleGuideRow?.version === "number" ? activeStyleGuideRow.version : undefined,
        styleGuideStatus: typeof activeStyleGuideRow?.status === "string" ? activeStyleGuideRow.status : undefined,
      },
    };
    console.log("[Prompt] Using prompt", {
      requestId,
      sceneId: scene.id,
      model: selectedModel,
      promptLen: fullPrompt.length,
      promptHash,
      characterStatesHash,
    });

    const generateImage = async (model: string) => {
      // Handle Google/Gemini Models
      if (GOOGLE_MODELS[model]) {
        const key = geminiApiKey.trim();
        if (!key) return new Response(JSON.stringify({ error: "Gemini API key not configured" }), { status: 500, statusText: "Gemini Key Missing" });

        const googleModel = GOOGLE_MODELS[model];
        const aspectRatio = getAspectRatioLabel(width, height);
        console.log(`[Google] Generating with ${googleModel}, ratio: ${aspectRatio}`);

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${googleModel}:predict`;
        const payload = {
          instances: [{ prompt: fullPrompt.slice(0, 4000) }],
          parameters: {
            sampleCount: 1,
            aspectRatio: aspectRatio,
          }
        };

        try {
          const googleRes = await fetchWithTimeout(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": key },
            body: JSON.stringify(payload)
          }, 60000);

          if (!googleRes.ok) {
            const errorText = await googleRes.text().catch(() => "");
            const headerMap: Record<string, string> = {};
            googleRes.headers.forEach((value, k) => {
              headerMap[String(k).toLowerCase()] = String(value);
            });
            console.error("[Google] Upstream error:", { status: googleRes.status, statusText: googleRes.statusText, errorText });
            return new Response(errorText, {
              status: googleRes.status,
              statusText: googleRes.statusText,
              headers: {
                ...headerMap,
                "Content-Type": headerMap["content-type"] ?? "text/plain",
              },
            });
          }

          const googleData = await googleRes.json();
          const b64 = googleData.predictions?.[0]?.bytesBase64Encoded;

          if (b64) {
            // Transform to Venice-like format for downstream compatibility
            return new Response(JSON.stringify({
              images: [b64]
            }), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            });
          }
          
          return new Response(JSON.stringify(googleData), { status: 500, statusText: "No Image Data in Google Response" });
        } catch (e) {
          return new Response(JSON.stringify({ error: String(e) }), { status: 502, statusText: "Google API Failed" });
        }
      }

      // Enforce Venice API compliance requirements
      console.log(`[Compliance] Enforcing mandatory parameters for ${model}: safe_mode=false, hide_watermark=true`);
      
      // Truncate prompt based on model limits
      let safePrompt = fullPrompt;
      const limitedModels = ["hidream", "qwen-image", "z-image-turbo"];
      if (model.startsWith("lustify") || limitedModels.includes(model)) {
        safePrompt = fullPrompt.length > 1400 ? fullPrompt.slice(0, 1400) : fullPrompt;
      }

      // Adjust steps for specific models
      let steps = computeStyleStepsForStyle({ styleId: selectedStyle, intensity: usedStyleIntensity, strict: usedStrictStyle });
      if (model === "qwen-image") {
        steps = 8; // Max allowed for Qwen
      } else if (model === "z-image-turbo") {
        steps = 4; // Turbo models typically need 1-4 steps. 4 provides better detail than 1-2.
      }
      steps = Math.max(1, Math.min(30, Math.round(steps)));
      
      let cfgScale = computeStyleCfgScaleForStyle({ styleId: selectedStyle, intensity: usedStyleIntensity, strict: usedStrictStyle });
      
      // Override CFG for Turbo models which require low guidance
      if (model === "z-image-turbo") {
         cfgScale = 1.8; // Turbo models burn out at high CFG. 1.5-2.0 is standard range.
      }

      try {
        if (!veniceApiKey.trim()) {
          return new Response(JSON.stringify({ error: "Venice API key not configured" }), { status: 500, statusText: "Venice Key Missing" });
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
            // negative_prompt removed per user request
            width: width,
            height: height,
            steps,
            cfg_scale: cfgScale,
            safe_mode: false,
            hide_watermark: true,
            embed_exif_metadata: false,
          }),
        }, 60000);
        return res;
      } catch (err) {
        console.error(`[Error] Venice fetch failed for ${model}:`, err);
        return new Response(JSON.stringify({ error: `Venice fetch failed: ${String(err)}` }), { status: 502, statusText: "Venice API Connection Failed" });
      }
    };

    const fallbackModel = "lustify-sdxl";

    let aiResponse = await generateImage(selectedModel);
    logTiming("image_gen_primary");
    let aiErrorText: string | null = null;
    let actualModel = selectedModel;
    if (!aiResponse.ok) {
      aiErrorText = await aiResponse.text();
      console.error("AI image generation error:", aiResponse.status, aiErrorText);
      const shouldRetryWithFallback =
        !requestedModel &&
        (aiResponse.status === 400 || aiResponse.status === 404) &&
        typeof aiErrorText === "string" &&
        (aiErrorText.toLowerCase().includes("model") || aiErrorText.toLowerCase().includes("unknown") || aiErrorText.toLowerCase().includes("not found"));
      if (shouldRetryWithFallback) {
        console.warn("Retrying with fallback model...", { usedModel, fallbackModel });
        aiResponse = await generateImage(fallbackModel);
        logTiming("image_gen_fallback");
        actualModel = fallbackModel;
        if (!aiResponse.ok) {
          aiErrorText = await aiResponse.text();
          console.error("AI image generation error:", aiResponse.status, aiErrorText);
        } else {
          aiErrorText = null;
        }
      }
    }

    if (!aiResponse.ok) {
       // Error handling block
       const responseHeaders = collectResponseHeaders(aiResponse);
       const statusText = String(aiResponse.statusText ?? "");
       const body = typeof aiErrorText === "string" && aiErrorText.length > 0 ? truncateText(aiErrorText, 4000) : "No error details provided";
       
       await admin.from("scenes").update({ generation_status: "error" }).eq("id", sceneId);
       
       return json(502, { 
         error: `Upstream Generation Failed (${aiResponse.status})`, 
         requestId,
         details: { statusText, upstream_error: body, headers: responseHeaders },
         model: actualModel
       });
    }

    let aiData;
    try {
      aiData = await aiResponse.json();
    } catch (e) {
      console.error("Failed to parse AI response JSON:", e);
      await admin.from("scenes").update({ generation_status: "error" }).eq("id", sceneId);
      return json(502, { error: "Invalid JSON from upstream provider", requestId, details: String(e) });
    }

    const imageDataUrl = extractFirstBase64Image(aiData);

    if (!imageDataUrl) {
      console.error("No valid image in response", aiData);
      await admin.from("scenes").update({ generation_status: "error" }).eq("id", sceneId);
      return json(500, { error: "No image data returned", requestId, details: "Upstream response missing image data" });
    }

    let bytes;
    try {
      const base64Data = imageDataUrl;
      bytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
    } catch (e) {
      console.error("Failed to decode base64 image data:", e);
      await admin.from("scenes").update({ generation_status: "error" }).eq("id", sceneId);
      return json(500, { error: "Failed to process image data", requestId, details: "Invalid base64 response" });
    }

    const mime = detectImageMime(bytes);
    const ext = extFromMimeTyped(mime);
    const fileName = `${user.id}/${scene.story_id}/${sceneId}-${Date.now()}.${ext}`;
    const file = new Blob([bytes], { type: mime });

    let uploadError: unknown = null;
    try {
      const uploadResult = await admin.storage.from("scene-images").upload(fileName, file, { contentType: mime, upsert: true });
      uploadError = uploadResult.error;
    } catch (e) {
      uploadError = e;
    }

    if (uploadError) {
      console.error("Upload error:", uploadError);
      await admin.from("scenes").update({ generation_status: "error" }).eq("id", sceneId);
      return json(500, { error: "Failed to store image", requestId, details: serializeSupabaseError(uploadError) });
    }

    const { data: urlData } = admin.storage.from("scene-images").getPublicUrl(fileName);

    try {
      const existingDetails =
        (scene.consistency_details && typeof scene.consistency_details === "object" && !Array.isArray(scene.consistency_details)
          ? (scene.consistency_details as Record<string, unknown>)
          : typeof scene.consistency_details === "string"
            ? ((): Record<string, unknown> => {
                try {
                  const parsed = JSON.parse(scene.consistency_details as string) as unknown;
                  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
                } catch {
                  return {};
                }
              })()
            : {}) as Record<string, unknown>;

      const { error: updateError } = await admin
        .from("scenes")
        .update({
          image_url: urlData.publicUrl,
          generation_status: "completed",
          consistency_status: "pass",
          consistency_details: {
            ...existingDetails,
            generation_debug: {
              timestamp: new Date().toISOString(),
              requestId,
              model: actualModel,
              prompt: fullPrompt,
              prompt_base: fullPromptRaw,
              prompt_full: fullPrompt,
              prompt_hash: lastPromptDebug?.promptHash,
              preprocessingSteps: lastPromptDebug?.preprocessingSteps,
              requestParams: lastPromptDebug?.requestParams,
              warnings: lastPromptDebug?.warnings,
              character_states_hash: characterStatesHash,
              previous_character_states_hash: previousCharacterStatesHash,
              character_states_used: characterStatesUsed,
            },
          },
        })
        .eq("id", sceneId);
      if (updateError) {
        console.error("Scene update error:", updateError);
        return json(500, { error: "Failed to update scene with image", requestId, details: serializeSupabaseError(updateError) });
      }
    } catch (e) {
      console.error("Scene update exception:", e);
      return json(500, { error: "Failed to update scene with image", requestId, details: String(e) });
    }

    return json(200, {
      success: true,
      imageUrl: urlData.publicUrl,
      requestId,
      model: actualModel,
      prompt: fullPrompt,
      promptFull: fullPrompt,
      promptHash: lastPromptDebug?.promptHash,
      preprocessingSteps: lastPromptDebug?.preprocessingSteps,
      warnings: lastPromptDebug?.warnings,
      characterStatesHash,
    });

  } catch (e) {
    console.error("Unexpected error:", e);
    return json(500, { error: "Internal Server Error", requestId, details: String(e) });
  }
});
