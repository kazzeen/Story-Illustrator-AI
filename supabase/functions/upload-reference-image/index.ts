import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

type JsonObject = Record<string, unknown>;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const ALLOWED_BUCKETS = new Set(["reference-images", "scene-images"]);

const rateState = new Map<string, { windowStart: number; count: number }>();

function json(status: number, body: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
  });
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAllowedOrigins() {
  const raw = Deno.env.get("ALLOWED_ORIGINS") ?? "";
  const list = raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return new Set(list);
}

function buildCorsHeaders(origin: string | null) {
  const allowed = parseAllowedOrigins();
  const allowOrigin = allowed.size === 0 ? "*" : origin && allowed.has(origin) ? origin : "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (allowOrigin) headers["Access-Control-Allow-Origin"] = allowOrigin;
  return headers;
}

function validateOrigin(req: Request) {
  const allowed = parseAllowedOrigins();
  if (allowed.size === 0) return { ok: true as const };
  const origin = req.headers.get("origin");
  if (!origin || !allowed.has(origin)) return { ok: false as const, reason: "Origin not allowed" };
  return { ok: true as const };
}

function validateRateLimit(userId: string) {
  const max = Number(Deno.env.get("UPLOAD_RATE_MAX") ?? "12");
  const windowMs = Number(Deno.env.get("UPLOAD_RATE_WINDOW_MS") ?? "60000");
  const now = Date.now();
  const curr = rateState.get(userId);
  if (!curr || now - curr.windowStart > windowMs) {
    rateState.set(userId, { windowStart: now, count: 1 });
    return { ok: true as const };
  }
  if (curr.count >= max) return { ok: false as const, reason: "Rate limit exceeded" };
  curr.count += 1;
  return { ok: true as const };
}

export function detectMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function getNestedBoolean(root: unknown, path: string[]): boolean | null {
  let curr: unknown = root;
  for (const key of path) {
    if (!isRecord(curr) || !(key in curr)) return null;
    curr = curr[key];
  }
  return asBoolean(curr);
}

function getNestedStringArray(root: unknown, path: string[]): string[] | null {
  let curr: unknown = root;
  for (const key of path) {
    if (!isRecord(curr) || !(key in curr)) return null;
    curr = curr[key];
  }
  if (!Array.isArray(curr)) return null;
  const list = (curr as unknown[]).filter((v): v is string => typeof v === "string");
  return list.length > 0 ? list : [];
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hashBytes = new Uint8Array(digest);
  let out = "";
  for (const b of hashBytes) out += b.toString(16).padStart(2, "0");
  return out;
}

async function scanForViruses(bytes: Uint8Array, filename: string, mime: string) {
  const required = (Deno.env.get("VIRUS_SCAN_REQUIRED") ?? "false").toLowerCase() === "true";
  const url = Deno.env.get("VIRUS_SCAN_URL") ?? "";
  if (!url) {
    if (required) return { ok: false as const, reason: "Virus scanning is required but not configured" };
    return { ok: true as const, skipped: true as const };
  }

  const timeoutMs = clampInt(Number(Deno.env.get("VIRUS_SCAN_TIMEOUT_MS") ?? "15000"), 1000, 60000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), filename);

    const headers = new Headers();
    const apiKey = Deno.env.get("VIRUS_SCAN_API_KEY") ?? "";
    const apiKeyHeader = (Deno.env.get("VIRUS_SCAN_API_KEY_HEADER") ?? "x-api-key").trim();
    const bearer = Deno.env.get("VIRUS_SCAN_AUTH_BEARER") ?? "";
    if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
    if (apiKey && apiKeyHeader) headers.set(apiKeyHeader, apiKey);

    const res = await fetch(url, { method: "POST", body: form, headers, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      if (required) return { ok: false as const, reason: `Virus scan failed (HTTP ${res.status})` };
      return { ok: true as const, skipped: true as const };
    }

    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    const infected =
      getNestedBoolean(parsed, ["infected"]) ??
      getNestedBoolean(parsed, ["malicious"]) ??
      getNestedBoolean(parsed, ["data", "infected"]) ??
      getNestedBoolean(parsed, ["data", "malicious"]) ??
      null;
    const clean =
      getNestedBoolean(parsed, ["clean"]) ??
      getNestedBoolean(parsed, ["data", "clean"]) ??
      null;

    if (infected === true) {
      const viruses =
        getNestedStringArray(parsed, ["viruses"]) ??
        getNestedStringArray(parsed, ["data", "viruses"]) ??
        [];
      return { ok: false as const, reason: `Virus detected${viruses.length ? `: ${viruses.join(", ")}` : ""}` };
    }
    if (clean === true || infected === false) return { ok: true as const };

    if (required) return { ok: false as const, reason: "Virus scan returned an unrecognized response" };
    return { ok: true as const, skipped: true as const };
  } catch {
    if (required) return { ok: false as const, reason: "Virus scan failed" };
    return { ok: true as const, skipped: true as const };
  } finally {
    clearTimeout(timeout);
  }
}

async function processImage(bytes: Uint8Array, mime: string) {
  const img = await Image.decode(bytes);
  const maxDim = clampInt(Number(Deno.env.get("REFERENCE_MAX_DIM") ?? "2048"), 256, 4096);
  const thumbMax = clampInt(Number(Deno.env.get("REFERENCE_THUMB_MAX_DIM") ?? "384"), 96, 768);
  const quality = clampInt(Number(Deno.env.get("REFERENCE_WEBP_QUALITY") ?? "85"), 40, 95);

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const resized = scale < 1 ? img.resize(Math.round(img.width * scale), Math.round(img.height * scale)) : img;
  const optimizedBytes = await resized.encodeWEBP(quality);
  const optimizedMime = "image/webp";

  const thumbScale = Math.min(1, thumbMax / Math.max(img.width, img.height));
  const thumbImg = thumbScale < 1 ? img.resize(Math.round(img.width * thumbScale), Math.round(img.height * thumbScale)) : img;
  const thumbBytes = await thumbImg.encodeWEBP(70);
  const thumbMime = "image/webp";

  return { optimizedBytes, optimizedMime, width: resized.width, height: resized.height, thumbBytes, thumbMime };
}

serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const corsHeaders = buildCorsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, corsHeaders);
  const originCheck = validateOrigin(req);
  if (!originCheck.ok) return json(403, { error: originCheck.reason }, corsHeaders);

  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Missing Authorization header" }, corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await authClient.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) return json(401, { error: "Invalid or expired session" }, corsHeaders);

  const rate = validateRateLimit(user.id);
  if (!rate.ok) return json(429, { error: rate.reason }, corsHeaders);

  const contentType = req.headers.get("content-type") ?? "";
  const isJson = contentType.toLowerCase().includes("application/json");
  let body: unknown = null;
  let form: FormData | null = null;
  try {
    if (isJson) {
      body = await req.json();
    } else {
      form = await req.formData();
    }
  } catch {
    return json(400, { error: isJson ? "Invalid JSON body" : "Invalid multipart form data" }, corsHeaders);
  }

  const action = isJson ? (isRecord(body) ? asString(body.action) : null) ?? "upload" : asString(form?.get("action")) ?? "upload";
  const bucket = isJson ? (isRecord(body) ? asString(body.bucket) : null) ?? "reference-images" : asString(form?.get("bucket")) ?? "reference-images";
  if (!ALLOWED_BUCKETS.has(bucket)) return json(400, { error: "Invalid bucket" }, corsHeaders);

  const admin = createClient(supabaseUrl, supabaseServiceKey);

  if (action === "sign") {
    const itemsRaw = isJson
      ? (isRecord(body) ? body.items : null)
      : (() => {
          const raw = asString(form?.get("items"));
          if (!raw) return null;
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })();

    if (!Array.isArray(itemsRaw)) return json(400, { error: "items must be an array" }, corsHeaders);

    const expiresIn = clampInt(
      Number(Deno.env.get("REFERENCE_SIGNED_URL_TTL_SECONDS") ?? "604800"),
      60,
      60 * 60 * 24 * 30,
    );

    const signed = [];
    for (const entry of itemsRaw) {
      if (!isRecord(entry)) continue;
      const id = asString(entry.id) ?? crypto.randomUUID();
      const b = asString(entry.bucket) ?? bucket;
      if (!ALLOWED_BUCKETS.has(b)) continue;
      const objectPath = asString(entry.objectPath);
      const thumbPath = asString(entry.thumbPath);
      if (!objectPath || !thumbPath) continue;
      if (!objectPath.startsWith(`references/${user.id}/`) || !thumbPath.startsWith(`references/${user.id}/`)) continue;

      const { data: urlData, error: signErr } = await admin.storage.from(b).createSignedUrl(objectPath, expiresIn);
      const { data: thumbUrlData, error: thumbSignErr } = await admin.storage.from(b).createSignedUrl(thumbPath, expiresIn);
      if (signErr || thumbSignErr) continue;

      signed.push({
        id,
        bucket: b,
        objectPath,
        thumbPath,
        url: urlData?.signedUrl,
        thumbUrl: thumbUrlData?.signedUrl,
      });
    }

    return json(200, { success: true, items: signed, expiresIn }, corsHeaders);
  }

  if (action === "delete") {
    const objectPath = isJson ? (isRecord(body) ? asString(body.objectPath) : null) : asString(form?.get("objectPath"));
    const thumbPath = isJson ? (isRecord(body) ? asString(body.thumbPath) : null) : asString(form?.get("thumbPath"));
    if (!objectPath || !objectPath.startsWith(`references/${user.id}/`)) {
      return json(400, { error: "Invalid objectPath" }, corsHeaders);
    }
    const removeList = [objectPath, ...(thumbPath && thumbPath.startsWith(`references/${user.id}/`) ? [thumbPath] : [])];
    const { error } = await admin.storage.from(bucket).remove(removeList);
    if (error) return json(500, { error: "Failed to delete reference" }, corsHeaders);
    return json(200, { success: true }, corsHeaders);
  }

  const file = form?.get("file");
  if (!(file instanceof File)) return json(400, { error: "file is required" }, corsHeaders);
  if (file.size <= 0) return json(400, { error: "Empty file" }, corsHeaders);
  if (file.size > MAX_BYTES) return json(413, { error: "File exceeds 10MB" }, corsHeaders);

  const uploadMime = file.type || "application/octet-stream";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectMime(bytes);
  const mime = detected ?? (ALLOWED_MIME.has(uploadMime) ? uploadMime : null);
  if (!mime || !ALLOWED_MIME.has(mime)) return json(400, { error: "Unsupported image type" }, corsHeaders);

  const scan = await scanForViruses(bytes, file.name || "upload", mime);
  if (!scan.ok) return json(400, { error: scan.reason }, corsHeaders);

  const sha256 = await sha256Hex(bytes);

  const sceneId = asString(form?.get("sceneId"));
  if (sceneId && !UUID_REGEX.test(sceneId)) return json(400, { error: "Invalid sceneId" }, corsHeaders);

  let processed;
  try {
    processed = await processImage(bytes, mime);
  } catch {
    return json(400, { error: "Image could not be decoded" }, corsHeaders);
  }

  const id = crypto.randomUUID();
  const basePath = `references/${user.id}/${sceneId ? `${sceneId}/` : ""}${Date.now()}-${id}`;
  const objectPath = `${basePath}.${processed.optimizedMime.includes("webp") ? "webp" : mime.includes("jpeg") ? "jpg" : mime.includes("png") ? "png" : "gif"}`;
  const thumbPath = `${basePath}.thumb.webp`;

  const tryUpload = async (b: string) => {
    const { error } = await admin.storage.from(b).upload(objectPath, processed.optimizedBytes, {
      contentType: processed.optimizedMime,
      upsert: true,
    });
    if (error) return { ok: false as const, error: error.message };
    const { error: thumbErr } = await admin.storage.from(b).upload(thumbPath, processed.thumbBytes, {
      contentType: processed.thumbMime,
      upsert: true,
    });
    if (thumbErr) return { ok: false as const, error: thumbErr.message };
    return { ok: true as const, bucket: b };
  };

  const primary = await tryUpload(bucket);
  const targetBucket = primary.ok ? primary.bucket : "scene-images";
  if (!primary.ok) {
    const fallback = await tryUpload(targetBucket);
    if (!fallback.ok) return json(500, { error: "Failed to store reference image" }, corsHeaders);
  }

  const expiresIn = clampInt(Number(Deno.env.get("REFERENCE_SIGNED_URL_TTL_SECONDS") ?? "604800"), 60, 60 * 60 * 24 * 30);
  const { data: urlData, error: signErr } = await admin.storage.from(targetBucket).createSignedUrl(objectPath, expiresIn);
  const { data: thumbUrlData, error: thumbSignErr } = await admin.storage.from(targetBucket).createSignedUrl(thumbPath, expiresIn);
  if (signErr || thumbSignErr) return json(500, { error: "Failed to sign reference URLs" }, corsHeaders);

  return json(
    200,
    {
      success: true,
      id,
      bucket: targetBucket,
      objectPath,
      thumbPath,
      mime: processed.optimizedMime,
      width: processed.width,
      height: processed.height,
      url: urlData?.signedUrl,
      thumbUrl: thumbUrlData?.signedUrl,
      originalName: file.name,
      sha256,
    },
    corsHeaders,
  );
});
