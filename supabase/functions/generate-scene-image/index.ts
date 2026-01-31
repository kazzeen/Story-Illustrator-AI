import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { ensureClothingColors, validateClothingColorCoverage } from "../_shared/clothing-colors.ts";
import {
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
  character_image_reference_enabled?: boolean;
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

export function shouldLogFailureTransactionForBypassedCredits(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.bypassed === true;
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

export function shouldTryReserveAfterCommitFailure(reason: string | null, commitErr: unknown): boolean {
  if (commitErr) return true;
  return (
    reason === "missing_reservation" ||
    reason === "missing_credit_account" ||
    reason === "missing_request_id"
  );
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

export function asConsistencySettings(val: unknown): ConsistencySettings | null {
  const obj = asJsonObject(val);
  if (!obj) return null;
  return {
    mode: asString(obj.mode) ?? undefined,
    auto_correct: typeof obj.auto_correct === "boolean" ? obj.auto_correct : undefined,
    character_identity_lock: typeof obj.character_identity_lock === "boolean" ? obj.character_identity_lock : undefined,
    character_anchor_strength: typeof obj.character_anchor_strength === "number" ? obj.character_anchor_strength : undefined,
    character_image_reference_enabled:
      typeof obj.character_image_reference_enabled === "boolean"
        ? obj.character_image_reference_enabled
        : typeof obj.characterImageReferenceEnabled === "boolean"
          ? obj.characterImageReferenceEnabled
          : typeof obj.character_image_reference === "boolean"
            ? obj.character_image_reference
            : typeof obj.characterImageReference === "boolean"
              ? obj.characterImageReference
              : undefined,
  };
}

async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

const CHARACTER_IMAGE_REFERENCE_MAX_SIDE = 512;
const CHARACTER_IMAGE_REFERENCE_JPEG_QUALITY = 85;
const CHARACTER_IMAGE_REFERENCE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CHARACTER_IMAGE_REFERENCE_CACHE_MAX_ITEMS = 64;

type CachedRefImage = { base64Jpeg: string; width: number; height: number; byteSize: number; lastAccess: number };
type CachedVision = { text: string; lastAccess: number };

const characterRefImageCache = new Map<string, CachedRefImage>();
const characterVisionCache = new Map<string, CachedVision>();

function nowMs() {
  return Date.now();
}

function evictOldest(map: Map<string, { lastAccess: number }>, maxItems: number) {
  if (map.size <= maxItems) return;
  const entries = Array.from(map.entries());
  entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
  for (let i = 0; i < entries.length && map.size > maxItems; i += 1) {
    map.delete(entries[i][0]);
  }
}

function readCache<T extends { lastAccess: number }>(map: Map<string, T>, key: string, ttlMs: number): T | null {
  const hit = map.get(key);
  if (!hit) return null;
  const age = nowMs() - hit.lastAccess;
  if (age > ttlMs) {
    map.delete(key);
    return null;
  }
  hit.lastAccess = nowMs();
  return hit;
}

function writeCache<T extends { lastAccess: number }>(map: Map<string, T>, key: string, value: Omit<T, "lastAccess">) {
  map.set(key, { ...value, lastAccess: nowMs() } as T);
  evictOldest(map, CHARACTER_IMAGE_REFERENCE_CACHE_MAX_ITEMS);
}

async function fetchBytesWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf, contentType: ct };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeAllowedImageMime(contentType: string): "image/png" | "image/jpeg" | null {
  const ct = (contentType || "").split(";")[0].trim().toLowerCase();
  if (ct === "image/jpeg" || ct === "image/jpg") return "image/jpeg";
  if (ct === "image/png") return "image/png";
  return null;
}

async function prepareCharacterReferenceImage(args: { url: string; timeoutMs: number }) {
  const cached = readCache(characterRefImageCache, args.url, CHARACTER_IMAGE_REFERENCE_CACHE_TTL_MS);
  if (cached) return cached;

  const { bytes, contentType } = await fetchBytesWithTimeout(args.url, args.timeoutMs);
  const mime = normalizeAllowedImageMime(contentType);
  if (!mime) {
    throw new Error(`Unsupported image type: ${contentType || "unknown"}`);
  }

  const decoded = await Image.decode(bytes);
  const iw = decoded.width;
  const ih = decoded.height;
  const maxSide = Math.max(iw, ih);
  if (maxSide > CHARACTER_IMAGE_REFERENCE_MAX_SIDE) {
    const scale = CHARACTER_IMAGE_REFERENCE_MAX_SIDE / maxSide;
    const tw = Math.max(1, Math.round(iw * scale));
    const th = Math.max(1, Math.round(ih * scale));
    decoded.resize(tw, th);
  }

  const encoded = await decoded.encodeJPEG(CHARACTER_IMAGE_REFERENCE_JPEG_QUALITY);
  const base64Jpeg = encodeBase64(encoded);
  const out: CachedRefImage = {
    base64Jpeg,
    width: decoded.width,
    height: decoded.height,
    byteSize: encoded.byteLength,
    lastAccess: nowMs(),
  };
  writeCache(characterRefImageCache, args.url, {
    base64Jpeg: out.base64Jpeg,
    width: out.width,
    height: out.height,
    byteSize: out.byteSize,
  });
  return out;
}

async function describeCharactersFromReferenceImages(args: {
  veniceApiKey: string;
  requestId: string;
  characters: Array<{ name: string; imageUrl: string }>;
  timeoutMs: number;
}) {
  const warnings: string[] = [];
  const byName: Record<string, string> = {};
  const missing: Array<{ name: string; imageUrl: string }> = [];

  for (const item of args.characters) {
    const cached = readCache(characterVisionCache, item.imageUrl, CHARACTER_IMAGE_REFERENCE_CACHE_TTL_MS);
    if (cached) {
      byName[item.name] = cached.text;
    } else {
      missing.push(item);
    }
  }

  if (missing.length === 0) return { byName, warnings };
  if (!args.veniceApiKey.trim()) {
    warnings.push("character_image_reference_skipped:missing_venice_api_key");
    return { byName, warnings };
  }

  const prepared: Array<{ name: string; imageUrl: string; dataUrl: string }> = [];
  for (const item of missing.slice(0, 8)) {
    try {
      const img = await prepareCharacterReferenceImage({ url: item.imageUrl, timeoutMs: args.timeoutMs });
      prepared.push({ name: item.name, imageUrl: item.imageUrl, dataUrl: `data:image/jpeg;base64,${img.base64Jpeg}` });
    } catch (e) {
      warnings.push(`character_image_reference_failed:${item.name}`);
      void e;
    }
  }

  if (prepared.length === 0) return { byName, warnings };

  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text:
        `For each character image, summarize stable visual traits visible in the image (face shape, hair style/color, eye color if clear, skin tone, distinctive marks, clothing items and their colors/patterns, accessories). ` +
        `Avoid subjective adjectives. Output one line per character in the exact format "Name: traits". Keep each line under 40 words.`,
    },
  ];

  for (const item of prepared) {
    content.push({ type: "text", text: `Name: ${item.name}` });
    content.push({ type: "image_url", image_url: { url: item.dataUrl } });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.veniceApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistral-31-24b",
        messages: [{ role: "user", content }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      warnings.push(`character_image_reference_vision_http_${res.status}`);
      void t;
      return { byName, warnings };
    }

    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const choices = Array.isArray(data?.choices) ? (data!.choices as unknown[]) : [];
    const first = choices.length > 0 && isRecord(choices[0]) ? (choices[0] as Record<string, unknown>) : null;
    const message = first && isRecord(first.message) ? (first.message as Record<string, unknown>) : null;
    const text = message && typeof message.content === "string" ? (message.content as string) : "";
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx <= 0) continue;
      const name = line.slice(0, idx).trim();
      const traits = line.slice(idx + 1).trim();
      if (!name || !traits) continue;
      byName[name] = traits;
    }

    for (const item of prepared) {
      const found = byName[item.name];
      if (typeof found === "string" && found.trim()) {
        writeCache(characterVisionCache, item.imageUrl, { text: found });
      }
    }

    return { byName, warnings };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCharacterReferenceInputs(args: {
  admin: ReturnType<typeof createClient>;
  storyId: string;
  characterNames: string[];
  requestId: string;
}): Promise<{
  byName: Record<string, { imageUrl: string | null; promptSnippet: string | null }>;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const wanted = new Set(args.characterNames.map((n) => stableLowerName(n)));
  if (wanted.size === 0) return { byName: {}, warnings };

  const { data: chars, error: charError } = await args.admin
    .from("characters")
    .select("id, name, active_reference_sheet_id")
    .eq("story_id", args.storyId);

  if (charError) {
    warnings.push("character_image_reference_failed:characters_fetch");
    return { byName: {}, warnings };
  }

  const matched = (chars || [])
    .map((c) => {
      const id = typeof (c as { id?: unknown }).id === "string" ? String((c as { id: string }).id) : "";
      const name = typeof (c as { name?: unknown }).name === "string" ? String((c as { name: string }).name) : "";
      const activeRefId =
        typeof (c as { active_reference_sheet_id?: unknown }).active_reference_sheet_id === "string"
          ? String((c as { active_reference_sheet_id: string }).active_reference_sheet_id)
          : "";
      return { id, name, lower: stableLowerName(name), activeRefId };
    })
    .filter((c) => c.id && c.name && wanted.has(c.lower));

  if (matched.length === 0) return { byName: {}, warnings };

  const byCharId: Record<string, { name: string; activeRefId?: string }> = {};
  matched.forEach((c) => {
    byCharId[c.id] = { name: c.name, activeRefId: c.activeRefId && UUID_REGEX.test(c.activeRefId) ? c.activeRefId : undefined };
  });

  const activeRefIds = Array.from(
    new Set(
      matched
        .map((c) => (c.activeRefId && UUID_REGEX.test(c.activeRefId) ? c.activeRefId : null))
        .filter((v): v is string => typeof v === "string"),
    ),
  );

  const sheetsById: Record<string, CharacterReferenceSheetRow> = {};
  if (activeRefIds.length > 0) {
    const { data: activeSheets, error: activeErr } = await args.admin
      .from("character_reference_sheets")
      .select("id, character_id, version, status, prompt_snippet, reference_image_url")
      .in("id", activeRefIds);
    if (activeErr) warnings.push("character_image_reference_failed:active_reference_fetch");
    (activeSheets || []).forEach((row) => {
      const id = typeof (row as { id?: unknown }).id === "string" ? String((row as { id: string }).id) : "";
      if (!id) return;
      sheetsById[id] = row as unknown as CharacterReferenceSheetRow;
    });
  }

  const characterIds = matched.map((c) => c.id);
  const { data: approvedSheets, error: approvedErr } = await args.admin
    .from("character_reference_sheets")
    .select("id, character_id, version, status, prompt_snippet, reference_image_url")
    .in("character_id", characterIds)
    .eq("status", "approved")
    .order("version", { ascending: false });

  if (approvedErr) warnings.push("character_image_reference_failed:approved_reference_fetch");

  const latestApprovedByCharacterId: Record<string, CharacterReferenceSheetRow> = {};
  (approvedSheets || []).forEach((row) => {
    const cid = typeof (row as { character_id?: unknown }).character_id === "string" ? String((row as { character_id: string }).character_id) : "";
    if (!cid) return;
    if (!latestApprovedByCharacterId[cid]) latestApprovedByCharacterId[cid] = row as unknown as CharacterReferenceSheetRow;
  });

  const byName: Record<string, { imageUrl: string | null; promptSnippet: string | null }> = {};
  for (const c of matched) {
    const meta = byCharId[c.id];
    const activeSheet = meta?.activeRefId ? sheetsById[meta.activeRefId] : undefined;
    const approvedSheet = latestApprovedByCharacterId[c.id];
    const picked = activeSheet && activeSheet.reference_image_url ? activeSheet : approvedSheet;
    const imageUrl = picked && typeof picked.reference_image_url === "string" ? picked.reference_image_url : null;
    const promptSnippet = picked && typeof picked.prompt_snippet === "string" ? picked.prompt_snippet : null;
    byName[c.name] = { imageUrl, promptSnippet };
  }

  return { byName, warnings };
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

export function computeSampleLumaStatsFromBitmap(args: {
  bitmap: Uint8Array;
  width: number;
  height: number;
  maxSamples?: number;
}): { mean: number; std: number; samples: number; maxRgb: number; maxAlpha: number } {
  const w = Number(args.width);
  const h = Number(args.height);
  const bitmap = args.bitmap;
  const maxSamples = typeof args.maxSamples === "number" && args.maxSamples > 0 ? Math.floor(args.maxSamples) : 4096;

  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { mean: 0, std: 0, samples: 0, maxRgb: 0, maxAlpha: 0 };
  if (!bitmap || bitmap.length < w * h * 4) return { mean: 0, std: 0, samples: 0, maxRgb: 0, maxAlpha: 0 };

  const totalPixels = w * h;
  const step = Math.max(1, Math.floor(Math.sqrt(totalPixels / Math.min(maxSamples, totalPixels))));
  const stepX = step;
  const stepY = step;

  let sum = 0;
  let sumSq = 0;
  let samples = 0;
  let maxRgb = 0;
  let maxAlpha = 0;

  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      const idx = (y * w + x) * 4;
      const r = bitmap[idx] ?? 0;
      const g = bitmap[idx + 1] ?? 0;
      const b = bitmap[idx + 2] ?? 0;
      const a = bitmap[idx + 3] ?? 0;
      const rgbMax = Math.max(r, g, b);
      if (rgbMax > maxRgb) maxRgb = rgbMax;
      if (a > maxAlpha) maxAlpha = a;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += luma;
      sumSq += luma * luma;
      samples += 1;
    }
  }

  if (samples <= 0) return { mean: 0, std: 0, samples: 0, maxRgb: maxRgb, maxAlpha: maxAlpha };
  const mean = sum / samples;
  const variance = Math.max(0, sumSq / samples - mean * mean);
  const std = Math.sqrt(variance);
  return { mean, std, samples, maxRgb, maxAlpha };
}

function countUniqueColors(bitmap: Uint8Array, width: number, height: number, maxSamples = 1000) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 0;
  if (!bitmap || bitmap.length < w * h * 4) return 0;

  const totalPixels = w * h;
  const step = Math.max(1, Math.floor(totalPixels / Math.min(maxSamples, totalPixels)));
  const seen = new Set<string>();

  for (let i = 0; i < totalPixels; i += step) {
    const idx = i * 4;
    const r = bitmap[idx] ?? 0;
    const g = bitmap[idx + 1] ?? 0;
    const b = bitmap[idx + 2] ?? 0;
    // Simple quantization to reduce noise sensitivity
    const qr = Math.floor(r / 8) * 8;
    const qg = Math.floor(g / 8) * 8;
    const qb = Math.floor(b / 8) * 8;
    seen.add(`${qr},${qg},${qb}`);
    if (seen.size >= 50) break; // Optimization: If we have enough variety, stop
  }
  return seen.size;
}

function roundStat(n: number) {
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.round(n * 1000) / 1000;
  return Math.abs(rounded) < 0.0005 ? 0 : rounded;
}

async function computeEncodedImageStats(bytes: Uint8Array): Promise<
  | {
      ok: true;
      width: number;
      height: number;
      mean: number;
      std: number;
      samples: number;
      maxRgb: number;
      maxAlpha: number;
      uniqueColors: number;
    }
  | { ok: false; error: string }
> {
  try {
    const decoded = (await (Image as unknown as { decode: (b: Uint8Array) => Promise<unknown> }).decode(bytes)) as Record<string, unknown>;
    const width = typeof decoded.width === "number" ? decoded.width : NaN;
    const height = typeof decoded.height === "number" ? decoded.height : NaN;
    const bitmapRaw = (decoded as Record<string, unknown>).bitmap ?? (decoded as Record<string, unknown>).data ?? (decoded as Record<string, unknown>).pixels;
    const bitmap =
      bitmapRaw instanceof Uint8Array || bitmapRaw instanceof Uint8ClampedArray
        ? new Uint8Array(bitmapRaw)
        : bitmapRaw instanceof ArrayBuffer
          ? new Uint8Array(bitmapRaw)
        : ArrayBuffer.isView(bitmapRaw)
          ? new Uint8Array(bitmapRaw.buffer, bitmapRaw.byteOffset, bitmapRaw.byteLength)
          : null;
    if (!bitmap || !Number.isFinite(width) || !Number.isFinite(height)) return { ok: false, error: "missing_bitmap" };
    const stats = computeSampleLumaStatsFromBitmap({ bitmap, width, height });
    const uniqueColors = countUniqueColors(bitmap, width, height);
    return { ok: true, width, height, mean: stats.mean, std: stats.std, samples: stats.samples, maxRgb: stats.maxRgb, maxAlpha: stats.maxAlpha, uniqueColors };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function isImageStatsBlank(args: { mean: number; std: number; uniqueColors?: number }) {
  const mean = roundStat(args.mean);
  const std = roundStat(args.std);
  const unique = args.uniqueColors ?? 100; // Default to passing if not provided
  
  // Strict blank detection:
  // 1. Zero or very low variance (solid color or near-solid)
  if (std < 5) return { blank: true as const, mean, std, unique, reason: "low_variance" };

  // 2. Very few unique colors (flat image)
  if (unique < 10) return { blank: true as const, mean, std, unique, reason: "low_color_variety" };
  
  // 3. Extreme darkness or brightness with low variance
  // (already covered by std < 5, but let's be explicit for very dark/bright images that might have slight noise)
  if (mean < 5 && std < 10) return { blank: true as const, mean, std, unique, reason: "too_dark" };
  if (mean > 250 && std < 10) return { blank: true as const, mean, std, unique, reason: "too_bright" };
  
  return { blank: false as const, mean, std, unique, reason: null };
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

  let requestId = crypto.randomUUID();
  let admin: ReturnType<typeof createClient> | null = null;
  let currentSceneRow: SceneRow | null = null;
  let requestedSceneId: string | null = null;
  const creditFeature = "generate-scene-image";
  const creditsAmount = 1;
  let creditsReservationExists = false;
  let creditsInfo: Record<string, unknown> | null = null;
  let creditsCharged = false;
  let reserveMetadata: Record<string, unknown> | null = null;
  let attemptStarted = false;
  let updateAttempt: ((patch: Record<string, unknown>) => Promise<void>) | null = null;
  let releaseReservationIfNeeded:
    | ((
        reason: string,
        stage: string,
        extraMetadata?: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | null>)
    | null = null;
  let recordFailure:
    | ((
        reason: string,
        stage: string,
        extraMetadata?: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | null>)
    | null = null;
  let handleFailureCredits:
    | ((
        reason: string,
        stage: string,
        extraMetadata?: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | null>)
    | null = null;
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

    const requestBody = await req.json();
    const {
      sceneId,
      clientRequestId,
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
      characterImageReferenceEnabled,
      character_image_reference_enabled: characterImageReferenceEnabledSnake,
    } = requestBody as Record<string, unknown>;

    const clientRequestIdValue = asString(clientRequestId);
    if (clientRequestIdValue && UUID_REGEX.test(clientRequestIdValue)) {
      requestId = clientRequestIdValue;
    }
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

    updateAttempt = async (patch: Record<string, unknown>) => {
      if (!admin) return;
      try {
        const row = {
          request_id: requestId,
          user_id: user.id,
          feature: creditFeature,
          ...(patch ?? {}),
        };
        await admin.from("image_generation_attempts").upsert(row, { onConflict: "request_id" });
      } catch (e) {
        console.warn("[Credits] Failed to upsert attempt row", { requestId, error: String(e) });
      }
    };

    const logEarlyFailureIfNeeded = async (reason: string, stage: string, extraMetadata?: Record<string, unknown>) => {
      if (!admin) return;
      const failureTimestamp = new Date().toISOString();
      console.error("[Credits] Generation failed (pre-charge)", {
        requestId,
        user_id: user.id,
        restored_amount: 0,
        stage,
        reason,
        timestamp: failureTimestamp,
      });

      try {
        await updateAttempt?.({
          status: "failed",
          credits_amount: 0,
          error_stage: stage,
          error_message: reason,
          metadata: {
            feature: creditFeature,
            stage,
            scene_id: requestedSceneId,
            user_id: user.id,
            failure_timestamp: failureTimestamp,
            restored_amount: 0,
            failure_reason: reason,
            ...(extraMetadata ?? {}),
          },
        });
      } catch {
        void 0;
      }

      try {
        const { data } = await admin
          .from("credit_transactions")
          .select("id")
          .eq("user_id", user.id)
          .eq("request_id", requestId)
          .in("transaction_type", ["reservation", "usage", "release", "refund"])
          .limit(1);
        if (Array.isArray(data) && data.length > 0) return;

        await admin.from("credit_transactions").insert({
          user_id: user.id,
          amount: 0,
          transaction_type: "release",
          description: reason,
          metadata: {
            feature: creditFeature,
            stage,
            scene_id: requestedSceneId,
            user_id: user.id,
            failure_timestamp: failureTimestamp,
            restored_amount: 0,
            failure_reason: reason,
            release_reason: reason,
            ...(extraMetadata ?? {}),
          },
          request_id: requestId,
        });
      } catch (e) {
        console.error("[Credits] logZeroAmountFailureTransactionIfNeeded failed:", e);
      }
    };

    const ensureFailureTransactionDetails = async (reason: string, stage: string, extraMetadata?: Record<string, unknown>) => {
      if (!admin) return;
      try {
        const md = {
          feature: creditFeature,
          stage,
          scene_id: requestedSceneId,
          user_id: user.id,
          failure_reason: reason,
          release_reason: reason,
          refund_reason: reason,
          ...(extraMetadata ?? {}),
        };

        const { data: txRows } = await admin
          .from("credit_transactions")
          .select("id, transaction_type, amount, description, metadata")
          .eq("user_id", user.id)
          .eq("request_id", requestId)
          .in("transaction_type", ["release", "refund"]);

        if (!Array.isArray(txRows)) return;

        for (const row of txRows) {
          if (!isRecord(row)) continue;
          const id = asString(row.id);
          const transactionType = asString(row.transaction_type);
          const amount = typeof row.amount === "number" ? row.amount : Number(row.amount);
          if (!id || !transactionType) continue;

          const existingMetadata = isRecord(row.metadata) ? row.metadata : {};
          if (transactionType === "release" && amount === 0) {
            const releaseType = asString(existingMetadata.release_type);
            if (releaseType === "commit") continue;
          }

          const mergedMetadata = {
            ...existingMetadata,
            ...md,
          };

          await admin.from("credit_transactions").update({ description: reason, metadata: mergedMetadata }).eq("id", id);
        }
      } catch {
        void 0;
      }
    };

    releaseReservationIfNeeded = async (reason: string, stage: string, extraMetadata?: Record<string, unknown>) => {
      if (!admin || !creditsReservationExists) return null;
      try {
        const failureTimestamp = new Date().toISOString();
        const { data, error } = await admin.rpc("release_reserved_credits", {
          p_user_id: user.id,
          p_request_id: requestId,
          p_reason: reason,
          p_metadata: {
            feature: creditFeature,
            stage,
            scene_id: requestedSceneId,
            user_id: user.id,
            failure_timestamp: failureTimestamp,
            restored_amount: creditsAmount,
            failure_reason: reason,
            release_reason: reason,
            ...(extraMetadata ?? {}),
          },
        });
        if (error) return null;
        const parsed =
          data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
        if (parsed && parsed.ok === true) {
          creditsReservationExists = false;
          creditsInfo = parsed;
        }
        await ensureFailureTransactionDetails(reason, stage, {
          failure_timestamp: failureTimestamp,
          restored_amount: creditsAmount,
          release_reason: reason,
          ...(extraMetadata ?? {}),
        });
        return parsed;
      } catch (e) {
        console.warn("[Credits] Release failed", { requestId, error: String(e) });
        return null;
      }
    };

    // --- RESET LOGIC ---
    if (resetFlag) {
      // Validate storyId
      if (!storyId || !UUID_REGEX.test(storyId)) {
        await logEarlyFailureIfNeeded("Scene image reset failed: Valid story ID is required", "reset_validate", {
          story_id: typeof storyId === "string" ? storyId : null,
        });
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
        await logEarlyFailureIfNeeded("Scene image reset failed: Failed to fetch story", "reset_story_fetch", {
          story_id: storyIdString,
          details: serializeSupabaseError(storyError),
        });
        return json(500, { error: "Failed to fetch story", requestId, details: serializeSupabaseError(storyError) });
      }

      if (!story) {
        await logEarlyFailureIfNeeded("Scene image reset failed: Story not found", "reset_story_fetch", {
          story_id: storyIdString,
        });
        return json(404, { error: "Story not found", requestId });
      }
      if (story.user_id !== user.id) {
        await logEarlyFailureIfNeeded("Scene image reset failed: Not allowed", "reset_authz", {
          story_id: storyIdString,
        });
        return json(403, { error: "Not allowed", requestId });
      }

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
        await logEarlyFailureIfNeeded("Scene image reset failed: Failed to reset scenes", "reset_update", {
          story_id: storyIdString,
          details: serializeSupabaseError(resetError),
        });
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
      await logEarlyFailureIfNeeded("Scene image generation failed: Valid scene ID is required", "validate_scene_id", {
        scene_id: typeof sceneId === "string" ? sceneId : null,
      });
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
        await logEarlyFailureIfNeeded("Scene image generation failed: Invalid model", "validate_model", {
          model: usedModel,
          allowed_models: ALLOWED_MODELS,
        });
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
      await logEarlyFailureIfNeeded("Scene image generation failed: Failed to fetch scene", "scene_fetch", {
        dbCode,
        dbMessage,
        details: serialized ?? sceneError,
        retryDetails: retrySerialized,
      });
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

    if (!scene) {
      await logEarlyFailureIfNeeded("Scene image generation failed: Scene not found", "scene_fetch", {
        scene_id: sceneId,
      });
      return json(404, { error: "Scene not found", requestId });
    }
    currentSceneRow = scene;

    const { data: storyRow, error: storyError } = await admin
      .from("stories")
      .select("user_id, art_style, consistency_settings, active_style_guide_id")
      .eq("id", scene.story_id)
      .single();

    if (storyError || !storyRow) {
      await logEarlyFailureIfNeeded("Scene image generation failed: Failed to fetch story", "story_fetch", {
        details: storyError ? serializeSupabaseError(storyError) : "missing_story_row",
      });
      return json(500, { error: "Failed to fetch story", requestId });
    }

    if (storyRow.user_id !== user.id) {
      await logEarlyFailureIfNeeded("Scene image generation failed: Not allowed", "story_authz", {
        story_id: scene.story_id,
        scene_id: sceneId,
      });
      return json(403, { error: "Not allowed", requestId });
    }

    const storyConsistency = asConsistencySettings((storyRow as { consistency_settings?: unknown }).consistency_settings) ?? {};
    const characterImageReferenceEnabledEffective =
      typeof characterImageReferenceEnabled === "boolean"
        ? characterImageReferenceEnabled
        : typeof characterImageReferenceEnabledSnake === "boolean"
          ? characterImageReferenceEnabledSnake
          : typeof storyConsistency.character_image_reference_enabled === "boolean"
            ? storyConsistency.character_image_reference_enabled
            : false;

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

    if (!forcePrompt && characterImageReferenceEnabledEffective && characterNames.length > 0) {
      const refInputs = await fetchCharacterReferenceInputs({
        admin,
        storyId: scene.story_id,
        characterNames,
        requestId,
      });
      if (refInputs.warnings.length > 0) warnings.push(...refInputs.warnings);

      const refByLowerName: Record<string, { imageUrl: string | null; promptSnippet: string | null }> = {};
      Object.entries(refInputs.byName).forEach(([name, meta]) => {
        refByLowerName[stableLowerName(name)] = meta;
      });

      const visionCandidates = characterNames
        .map((name) => {
          const meta = refByLowerName[stableLowerName(name)];
          const imageUrl = meta?.imageUrl;
          return imageUrl ? { name, imageUrl } : null;
        })
        .filter(Boolean) as Array<{ name: string; imageUrl: string }>;

      if (visionCandidates.length === 0) {
        preprocessingSteps.push("character_image_reference:no_images");
      } else {
        const vision = await describeCharactersFromReferenceImages({
          veniceApiKey,
          requestId,
          characters: visionCandidates,
          timeoutMs: 25000,
        });
        if (vision.warnings.length > 0) warnings.push(...vision.warnings);

        const traitsByLowerName: Record<string, string> = {};
        Object.entries(vision.byName).forEach(([name, traits]) => {
          if (typeof traits === "string" && traits.trim()) traitsByLowerName[stableLowerName(name)] = traits.trim();
        });

        const parts: string[] = [];
        for (const name of characterNames) {
          const lower = stableLowerName(name);
          const traits = traitsByLowerName[lower];
          const snippet = refByLowerName[lower]?.promptSnippet ?? null;
          const text = traits || (typeof snippet === "string" && snippet.trim() ? snippet.trim() : "");
          if (!text) continue;
          const stripped = stripKnownStylePhrases({ prompt: text }).prompt;
          const cleaned = sanitizePrompt(stripped);
          const finalText = cleaned.trim() ? cleaned : sanitizePrompt(text);
          parts.push(`${name}: ${truncateText(finalText, 220)}`);
        }

        if (parts.length > 0) {
          const appendixRaw = `Character image reference: ${parts.join(" | ")}`;
          const appendix = sanitizePrompt(appendixRaw);
          characterAppendix = characterAppendix ? `${characterAppendix} ${appendix}` : appendix;
          preprocessingSteps.push(`character_image_reference:applied:${Math.min(visionCandidates.length, 8)}`);
        } else {
          preprocessingSteps.push("character_image_reference:no_traits");
        }
      }
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
        await logEarlyFailureIfNeeded("Scene image generation failed: Prompt is empty", "prompt_validate", {
          prompt_source: "force_full_prompt",
        });
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
            await logEarlyFailureIfNeeded("Scene image generation failed: Style application failed", "style_application", {
              styleId: selectedStyle,
              model: selectedModel,
            });
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

    let ensuredCredits = false;
    try {
      const { error: ensureErr } = await admin.rpc("ensure_user_credits", { p_user_id: user.id });
      if (!ensureErr) ensuredCredits = true;
    } catch {
      ensuredCredits = false;
    }

    if (!ensuredCredits) {
      try {
        await admin.from("user_credits").upsert(
          {
            user_id: user.id,
            tier: "free",
            monthly_credits_per_cycle: 10,
            monthly_credits_used: 0,
            bonus_credits_total: 5,
            bonus_credits_used: 0,
            reserved_monthly: 0,
            reserved_bonus: 0,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
      } catch {
        void 0;
      }
    }

    reserveMetadata = {
      feature: creditFeature,
      scene_id: sceneId,
      story_id: scene.story_id,
      model: selectedModel,
      width,
      height,
    };

    const logZeroAmountFailureTransactionIfNeeded = async (reason: string, stage: string, extraMetadata?: Record<string, unknown>) => {
      if (!admin) return;
      if (!shouldLogFailureTransactionForBypassedCredits(creditsInfo)) return;
      try {
        const { data } = await admin
          .from("credit_transactions")
          .select("id")
          .eq("user_id", user.id)
          .eq("request_id", requestId)
          .in("transaction_type", ["release", "refund"])
          .limit(1);
        if (Array.isArray(data) && data.length > 0) return;

        const failureTimestamp = new Date().toISOString();
        await admin.from("credit_transactions").insert({
          user_id: user.id,
          amount: 0,
          transaction_type: "release",
          description: reason,
          metadata: {
            feature: creditFeature,
            stage,
            scene_id: requestedSceneId,
            user_id: user.id,
            failure_timestamp: failureTimestamp,
            restored_amount: 0,
            failure_reason: reason,
            release_reason: reason,
            ...(extraMetadata ?? {}),
          },
          request_id: requestId,
        });
      } catch {
        void 0;
      }
    };

    recordFailure = async (reason: string, stage: string, extraMetadata?: Record<string, unknown>) => {
      const failureTimestamp = new Date().toISOString();
      const restoredAmount = creditsReservationExists ? creditsAmount : 0;
      const metadata = {
        feature: creditFeature,
        stage,
        scene_id: requestedSceneId,
        user_id: user.id,
        failure_timestamp: failureTimestamp,
        restored_amount: restoredAmount,
        failure_reason: reason,
        ...(extraMetadata ?? {}),
      };

      const released = releaseReservationIfNeeded ? await releaseReservationIfNeeded(reason, stage, metadata) : null;
      if (!released) await logZeroAmountFailureTransactionIfNeeded(reason, stage, metadata);
      await ensureFailureTransactionDetails(reason, stage, metadata);
      return released;
    };

    handleFailureCredits = async (reason: string, stage: string, extraMetadata?: Record<string, unknown>) => {
      if (!admin) return null;

      const failureTimestamp = new Date().toISOString();
      const restoredAmount = creditsCharged || creditsReservationExists ? creditsAmount : 0;
      console.error("[Credits] Generation failed", {
        requestId,
        user_id: user.id,
        restored_amount: restoredAmount,
        stage,
        reason,
        timestamp: failureTimestamp,
      });
      const metadata = {
        feature: creditFeature,
        stage,
        scene_id: requestedSceneId,
        user_id: user.id,
        failure_timestamp: failureTimestamp,
        restored_amount: restoredAmount,
        failure_reason: reason,
        release_reason: reason,
        refund_reason: reason,
        ...(extraMetadata ?? {}),
      };

      // Use robust force_refund_credits function to ensure user is refunded
      // This handles both reserved and consumed credits, and is idempotent.
      let result: Record<string, unknown> | null = null;
      try {
        const { data, error } = await admin.rpc("force_refund_credits", {
          p_user_id: user.id,
          p_request_id: requestId,
          p_reason: reason,
          p_metadata: metadata,
        });

        if (error) {
          console.error("[Credits] force_refund_credits RPC failed:", error);
          // Fallback: try legacy release if RPC fails (e.g. migration not applied yet)
          if (releaseReservationIfNeeded) {
             console.log("[Credits] Attempting fallback releaseReservationIfNeeded...");
             const fallback = await releaseReservationIfNeeded(reason, stage, metadata);
             result = fallback as Record<string, unknown> | null;
          }
        } else {
          result = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
          console.log("[Credits] force_refund_credits success:", result);
          
          if (result && result.ok === true) {
             creditsInfo = result;
             creditsReservationExists = false;
             creditsCharged = false;
          }
        }
      } catch (e) {
        console.error("[Credits] force_refund_credits exception:", e);
      }

      try {
        const { data, error } = await admin.rpc("force_refund_request", {
          p_request_id: requestId,
          p_reason: reason,
        });
        if (error) {
          console.error("[Credits] force_refund_request RPC failed:", error);
        } else {
          console.log("[Credits] force_refund_request success:", data);
        }
      } catch (e) {
        console.error("[Credits] force_refund_request exception:", e);
      }

      await ensureFailureTransactionDetails(reason, stage, metadata);
      return result;
    };

    const { data: reserveData, error: reserveErr } = await admin.rpc("reserve_credits", {
      p_user_id: user.id,
      p_request_id: requestId,
      p_amount: creditsAmount,
      p_feature: creditFeature,
      p_metadata: reserveMetadata,
    });
    const reserveRec =
      reserveData && typeof reserveData === "object" && !Array.isArray(reserveData)
        ? (reserveData as Record<string, unknown>)
        : null;
    const reserveErrMessage =
      reserveErr && typeof reserveErr === "object" && "message" in reserveErr ? String((reserveErr as { message?: unknown }).message) : "";
    const missingReserveRpc =
      Boolean(reserveErrMessage) &&
      reserveErrMessage.toLowerCase().includes("reserve_credits") &&
      (reserveErrMessage.toLowerCase().includes("could not find") || reserveErrMessage.toLowerCase().includes("does not exist"));

    if (reserveErr || !reserveRec || reserveRec.ok !== true) {
      const reason = reserveRec && typeof reserveRec.reason === "string" ? String(reserveRec.reason) : "reserve_failed";
      if (reason === "insufficient_credits") {
        await admin.from("scenes").update({ generation_status: "error" }).eq("id", sceneId);
        await logEarlyFailureIfNeeded("Scene image generation failed: Insufficient credits", "credits_reservation", {
          credits: reserveRec ?? undefined,
          details: reserveErr ? serializeSupabaseError(reserveErr) : undefined,
        });
        return json(402, {
          error: "Insufficient credits",
          requestId,
          stage: "credits_reservation",
          credits: reserveRec ?? undefined,
          reason,
          details: reserveErr ? serializeSupabaseError(reserveErr) : undefined,
        });
      }

      creditsReservationExists = false;
      creditsInfo = {
        ok: false,
        bypassed: true,
        reason: missingReserveRpc ? "missing_reserve_credits" : reason,
        details: reserveErr ? serializeSupabaseError(reserveErr) : undefined,
      };

      if (updateAttempt) {
        await updateAttempt({
          status: "started",
          credits_amount: 0,
          metadata: {
            ...reserveMetadata,
            credits_bypassed: true,
            credits_bypass_reason: missingReserveRpc ? "missing_reserve_credits" : reason,
            credits_bypass_details: reserveErr ? serializeSupabaseError(reserveErr) : undefined,
          },
        });
        attemptStarted = true;
      }
    }
    if (!creditsInfo) {
      creditsReservationExists = true;
      creditsInfo = reserveRec;
      await updateAttempt({
        status: "started",
        credits_amount: creditsAmount,
        metadata: reserveMetadata,
      });
      attemptStarted = true;
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
        characterImageReferenceEnabled: characterImageReferenceEnabledEffective,
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
       const failureReasons = deriveFailureReasons({
         status: aiResponse.status,
         statusText,
         headers: responseHeaders,
         bodyText: typeof aiErrorText === "string" ? aiErrorText : null,
       });
       const failureDescription = `Scene image generation failed: ${failureReasons.join("; ")}`;
       
       await admin.from("scenes").update({ generation_status: "error" }).eq("id", sceneId);
       if (attemptStarted && updateAttempt) {
         await updateAttempt({
           status: "failed",
           error_stage: "upstream_generation",
           error_message: failureDescription,
           metadata: { ...reserveMetadata, statusText, failure_reasons: failureReasons },
         });
       }
       const released = await handleFailureCredits(failureDescription, "upstream_generation", {
         status: aiResponse.status,
         statusText,
         failure_reasons: failureReasons,
       });
       
       return json(502, { 
         error: failureDescription,
         requestId,
         details: { statusText, upstream_error: body, headers: responseHeaders },
         model: actualModel,
         credits: released ?? creditsInfo ?? undefined,
       });
    }

    let aiData;
    try {
      aiData = await aiResponse.json();
    } catch (e) {
      console.error("Failed to parse AI response JSON:", e);
      await admin.from("scenes").update({ generation_status: "error" }).eq("id", sceneId);
      const errStr = e instanceof Error ? e.message : String(e);
      const failureDescription = `Scene image generation failed: Invalid JSON from upstream provider (${errStr.substring(0, 100)})`;
      if (attemptStarted && updateAttempt) {
        await updateAttempt({
          status: "failed",
          error_stage: "upstream_parse",
          error_message: failureDescription,
          metadata: reserveMetadata,
        });
      }
      const released = await handleFailureCredits(failureDescription, "upstream_parse", { error: errStr });
      return json(502, { error: failureDescription, requestId, details: errStr, credits: released ?? creditsInfo ?? undefined });
    }

    const imageDataUrl = extractFirstBase64Image(aiData);

    if (!imageDataUrl) {
      console.error("No valid image in response", aiData);
      const failureDescription = "Scene image generation failed: No image data returned";
      await admin.from("scenes").update({ generation_status: "error" }).eq("id", sceneId);
      if (attemptStarted && updateAttempt) {
        await updateAttempt({
          status: "failed",
          error_stage: "upstream_no_image",
          error_message: failureDescription,
          metadata: reserveMetadata,
        });
      }
      const released = await handleFailureCredits(failureDescription, "upstream_no_image");
      return json(500, { error: failureDescription, requestId, details: "Upstream response missing image data", credits: released ?? creditsInfo ?? undefined });
    }

    let bytes;
    try {
      const base64Data = imageDataUrl;
      bytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
      
      // Validate image size (prevent blank/empty images)
      if (bytes.length < 100) {
        throw new Error(`Image data too small (${bytes.length} bytes)`);
      }
    } catch (e) {
      console.error("Failed to decode or validate base64 image data:", e);
      const errStr = e instanceof Error ? e.message : String(e);
      const failureDescription = `Scene image generation failed: Invalid or empty image (${errStr.substring(0, 100)})`;
      await admin.from("scenes").update({ generation_status: "error" }).eq("id", sceneId);
      if (attemptStarted && updateAttempt) {
        await updateAttempt({
          status: "failed",
          error_stage: "decode_base64",
          error_message: failureDescription,
          metadata: reserveMetadata,
        });
      }
      const released = await handleFailureCredits(failureDescription, "decode_base64", { error: errStr });
      return json(500, { error: failureDescription, requestId, details: "Invalid or empty image response", credits: released ?? creditsInfo ?? undefined });
    }

    const encodedStats = await computeEncodedImageStats(bytes);
    if (encodedStats.ok) {
      const blank = isImageStatsBlank({ mean: encodedStats.mean, std: encodedStats.std, uniqueColors: encodedStats.uniqueColors });
      const isFullyTransparent = encodedStats.maxAlpha <= 0;
      if (blank.blank || isFullyTransparent) {
        const blankType = isFullyTransparent ? "transparent" : blank.reason;
        const reason = `Generated image appears blank (mean=${blank.mean}, std=${blank.std}, unique=${blank.unique}, type=${blankType})`;
        const failureDescription = `Scene image generation failed: ${reason}`;
        await admin.from("scenes").update({ generation_status: "error" }).eq("id", sceneId);
        if (attemptStarted && updateAttempt) {
          await updateAttempt({
            status: "failed",
            error_stage: "blank_image",
            error_message: failureDescription,
            metadata: {
              ...reserveMetadata,
              blank_image: true,
              blank_reason: blankType,
              blank_mean: blank.mean,
              blank_std: blank.std,
              blank_unique_colors: blank.unique,
              blank_samples: encodedStats.samples,
              blank_width: encodedStats.width,
              blank_height: encodedStats.height,
            },
          });
        }
        const released = await handleFailureCredits(failureDescription, "blank_image", {
          blank_image: true,
          blank_reason: blankType,
          blank_mean: blank.mean,
          blank_std: blank.std,
          blank_unique_colors: blank.unique,
          blank_samples: encodedStats.samples,
          blank_width: encodedStats.width,
          blank_height: encodedStats.height,
        });
        return json(500, { error: failureDescription, requestId, stage: "blank_image", credits: released ?? creditsInfo ?? undefined });
      }
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
      const errDetails = serializeSupabaseError(uploadError);
      const errStr = errDetails ? JSON.stringify(errDetails) : String(uploadError);
      const failureDescription = `Scene image generation failed: Failed to store image (${errStr.substring(0, 100)})`;
      await admin.from("scenes").update({ generation_status: "error" }).eq("id", sceneId);
      if (attemptStarted && updateAttempt) {
        await updateAttempt({
          status: "failed",
          error_stage: "storage_upload",
          error_message: failureDescription,
          metadata: reserveMetadata,
        });
      }
      const released = await handleFailureCredits(failureDescription, "storage_upload", { error: errDetails });
      return json(500, { error: failureDescription, requestId, details: errDetails, credits: released ?? creditsInfo ?? undefined });
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
        const errDetails = serializeSupabaseError(updateError);
        const errStr = errDetails ? JSON.stringify(errDetails) : String(updateError);
        const failureDescription = `Scene image generation failed: Failed to update scene with image (${errStr.substring(0, 100)})`;
        if (attemptStarted && updateAttempt) {
          await updateAttempt({
            status: "failed",
            error_stage: "scene_update",
            error_message: failureDescription,
            metadata: reserveMetadata,
          });
        }
        const released = await handleFailureCredits(failureDescription, "scene_update", { error: errDetails });
        return json(500, { error: failureDescription, requestId, details: errDetails, credits: released ?? creditsInfo ?? undefined });
      }
    } catch (e) {
      console.error("Scene update exception:", e);
      const errStr = e instanceof Error ? e.message : String(e);
      const failureDescription = `Scene image generation failed: Failed to update scene with image (${errStr.substring(0, 100)})`;
      if (attemptStarted && updateAttempt) {
        await updateAttempt({
          status: "failed",
          error_stage: "scene_update",
          error_message: failureDescription,
          metadata: reserveMetadata,
        });
      }
      const released = await handleFailureCredits(failureDescription, "scene_update", { error: errStr });
      return json(500, { error: failureDescription, requestId, details: errStr, credits: released ?? creditsInfo ?? undefined });
    }

    const commitMetadata = {
      feature: creditFeature,
      scene_id: sceneId,
      story_id: scene.story_id,
      model: actualModel,
      image_stats: encodedStats.ok ? { mean: encodedStats.mean, std: encodedStats.std, unique_colors: encodedStats.uniqueColors } : null,
    };

    const sceneImagesBucket = admin.storage.from("scene-images") as unknown as {
      remove: (paths: string[]) => Promise<{ data?: unknown; error?: unknown }>;
    };

    const commitReservedCredits = async () => {
      const { data: commitData, error: commitErr } = await admin.rpc("commit_reserved_credits", {
        p_user_id: user.id,
        p_request_id: requestId,
        p_metadata: commitMetadata,
      });
      const commitRec =
        commitData && typeof commitData === "object" && !Array.isArray(commitData)
          ? (commitData as Record<string, unknown>)
          : null;
      return { commitRec, commitErr };
    };

    const consumeCredits = async () => {
      const { data, error } = await admin.rpc("consume_credits", {
        p_user_id: user.id,
        p_amount: creditsAmount,
        p_description: "Scene image generation",
        p_metadata: commitMetadata,
        p_request_id: requestId,
      });
      const rec = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
      return { rec, error };
    };

    // --- 5. CREDIT COMMITMENT (DEFERRED) ---
    // Only commit credits if we have successfully generated, validated, and stored the image.
    // This prevents "deduct first, refund later" issues and ensures zero deduction on failure.

    try {
      if (creditsReservationExists) {
        const { commitRec, commitErr } = await commitReservedCredits();
        if (commitErr || !commitRec || commitRec.ok !== true) {
          // If commit fails, we must rollback the scene update and treat as failure
          try {
            await sceneImagesBucket.remove([fileName]);
          } catch (e) {
            console.warn("[Cleanup] Failed to remove image on error:", e);
          }
          await admin
            .from("scenes")
            .update({ image_url: null, generation_status: "error", consistency_status: "fail" })
            .eq("id", sceneId);
            
          const errDetails = commitErr ? serializeSupabaseError(commitErr) : commitRec ?? undefined;
          const errStr = errDetails ? JSON.stringify(errDetails) : "Unknown commit error";
          const failureDescription = `Scene image generation failed: Failed to commit credits (${errStr.substring(0, 100)})`;
          
          if (attemptStarted && updateAttempt) {
            await updateAttempt({
              status: "failed",
              error_stage: "credit_commit",
              error_message: failureDescription,
              metadata: reserveMetadata,
            });
          }
          // Note: Reservation is still open here, so we must release it
          const released = await handleFailureCredits(failureDescription, "credit_commit", {
            commit_error: errDetails,
          });
          return json(500, {
            error: failureDescription,
            requestId,
            stage: "credit_commit",
            details: errDetails,
            credits: released ?? creditsInfo ?? undefined,
          });
        }
        creditsInfo = { ...commitRec, consumed: creditsAmount, charged: true };
        creditsCharged = true;
      } else {
        const { rec, error } = await consumeCredits();
        if (error || !rec || rec.ok !== true) {
          // If consume fails (e.g. insufficient balance), rollback
          const reason = rec && typeof rec.reason === "string" ? String(rec.reason) : null;
          const status = reason === "insufficient_credits" ? 402 : 500;
          const failureDescription =
            reason === "insufficient_credits"
              ? "Scene image generation failed: Insufficient credits"
              : "Scene image generation failed: Failed to consume credits";
              
          try {
            await sceneImagesBucket.remove([fileName]);
          } catch (e) {
            console.warn("[Cleanup] Failed to remove image on error:", e);
          }
          await admin
            .from("scenes")
            .update({ image_url: null, generation_status: "error", consistency_status: "fail" })
            .eq("id", sceneId);
            
          if (attemptStarted && updateAttempt) {
            await updateAttempt({
              status: "failed",
              error_stage: "credit_consume",
              error_message: failureDescription,
              metadata: reserveMetadata,
            });
          }
          // Nothing to refund since consume failed, but we might need to release if we had a reservation logic error
          // In this "else" branch, we didn't have a reservation, so no release needed.
          return json(status, {
            error: failureDescription,
            requestId,
            stage: "credit_consume",
            details: error ? serializeSupabaseError(error) : rec ?? undefined,
            credits: creditsInfo ?? undefined,
          });
        }
        creditsInfo = { ...rec, consumed: creditsAmount, charged: true };
        creditsCharged = true;
      }
    } catch (e) {
      // Catch unexpected errors during commit/consume
      try {
        await sceneImagesBucket.remove([fileName]);
      } catch (e) {
        console.warn("[Cleanup] Failed to remove image on error:", e);
      }
      await admin.from("scenes").update({ image_url: null, generation_status: "error", consistency_status: "fail" }).eq("id", sceneId);
      
      const errorMessage = e instanceof Error ? e.message : String(e);
      const cleanError = errorMessage.replace(/^Error:\s*/, "").substring(0, 200);
      const failureDescription = `Generation failed: ${cleanError}`;

      if (attemptStarted && updateAttempt) {
        await updateAttempt({
          status: "failed",
          error_stage: "credit_commit_exception",
          error_message: failureDescription,
          metadata: reserveMetadata,
        });
      }
      
      const released = await handleFailureCredits(failureDescription, "credit_commit_exception", { error: errorMessage });
      return json(500, { error: failureDescription, requestId, details: errorMessage, credits: released ?? creditsInfo ?? undefined });
    }

    if (attemptStarted && updateAttempt) {
      await updateAttempt({
        status: "succeeded",
        credits_amount: creditsCharged ? creditsAmount : 0,
        metadata: { ...reserveMetadata, image_url: urlData.publicUrl, credits_charged: creditsCharged },
      });
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
      credits: creditsInfo ?? undefined,
    });

  } catch (e) {
    console.error("Unexpected error:", e);
    const failureDescription = "Scene image generation failed: Internal Server Error";
    const released = handleFailureCredits
      ? await handleFailureCredits(failureDescription, "unexpected_exception", { error: String(e) })
      : releaseReservationIfNeeded
        ? await releaseReservationIfNeeded(failureDescription, "unexpected_exception", { error: String(e) })
        : null;
    if (attemptStarted && updateAttempt) {
      await updateAttempt({
        status: "failed",
        error_stage: "unexpected_exception",
        error_message: failureDescription,
        metadata: { error: String(e) },
      });
    }
    return json(500, { error: failureDescription, requestId, details: String(e), credits: released ?? creditsInfo ?? undefined });
  }
});
