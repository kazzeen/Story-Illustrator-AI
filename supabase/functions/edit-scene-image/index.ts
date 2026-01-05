import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClientLike } from "https://esm.sh/@supabase/supabase-js@2.49.2";
import { parseConsumeCreditsResult } from "../_shared/credits.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeMime(value: string | undefined): string | null {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v === "image/jpg") return "image/jpeg";
  if (v === "image/jpeg") return "image/jpeg";
  if (v === "image/png") return "image/png";
  if (v === "image/webp") return "image/webp";
  return null;
}

export function decodeDataUrlOrBase64(input: string): { base64: string; mime?: string } {
  const trimmed = input.trim();
  if (!trimmed.startsWith("data:")) return { base64: trimmed };
  const match = trimmed.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return { base64: trimmed };
  return { mime: match[1], base64: match[2] };
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function hasFiniteNumberField(obj: Record<string, unknown>, key: string) {
  return Number.isFinite(toFiniteNumber(obj[key], NaN));
}

async function backfillProfessionalMonthlyUsage(args: {
  admin: SupabaseClientLike;
  userId: string;
  amount: number;
}): Promise<{ remaining_monthly: number; remaining_bonus: number; tier: string } | null> {
  const selectCols =
    "tier,monthly_credits_per_cycle,monthly_credits_used,bonus_credits_total,bonus_credits_used,reserved_monthly,reserved_bonus";

  const computeRemaining = (row: Record<string, unknown>) => {
    const perCycle = toFiniteNumber(row.monthly_credits_per_cycle, 0);
    const usedMonthly = toFiniteNumber(row.monthly_credits_used, 0);
    const reservedMonthly = toFiniteNumber(row.reserved_monthly, 0);
    const bonusTotal = toFiniteNumber(row.bonus_credits_total, 0);
    const bonusUsed = toFiniteNumber(row.bonus_credits_used, 0);
    const reservedBonus = toFiniteNumber(row.reserved_bonus, 0);
    const remainingMonthly = Math.max(perCycle - usedMonthly - reservedMonthly, 0);
    const remainingBonus = Math.max(bonusTotal - bonusUsed - reservedBonus, 0);
    return { remainingMonthly, remainingBonus };
  };

  let lastRow: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: row, error: rowErr } = await args.admin
      .from("user_credits")
      .select(selectCols)
      .eq("user_id", args.userId)
      .maybeSingle();
    if (rowErr || !row) return null;

    lastRow = row as unknown as Record<string, unknown>;
    const currentUsed = toFiniteNumber(lastRow.monthly_credits_used, 0);
    const nextUsed = currentUsed + args.amount;

    const { data: updated, error: updErr } = await args.admin
      .from("user_credits")
      .update({ monthly_credits_used: nextUsed })
      .eq("user_id", args.userId)
      .eq("monthly_credits_used", currentUsed)
      .select(selectCols)
      .maybeSingle();

    if (!updErr && updated) {
      const updatedRec = updated as unknown as Record<string, unknown>;
      const remaining = computeRemaining(updatedRec);
      return {
        remaining_monthly: remaining.remainingMonthly,
        remaining_bonus: remaining.remainingBonus,
        tier: typeof updatedRec.tier === "string" ? updatedRec.tier : "professional",
      };
    }
  }

  if (!lastRow) return null;
  const remaining = computeRemaining(lastRow);
  return {
    remaining_monthly: remaining.remainingMonthly,
    remaining_bonus: remaining.remainingBonus,
    tier: typeof lastRow.tier === "string" ? lastRow.tier : "professional",
  };
}

type PreviewRequest = {
  mode: "preview";
  prompt?: string;
  image_base64?: string;
  image_url?: string;
};

type CommitRequest = {
  mode: "commit";
  sceneId?: string;
  edited_image_base64?: string;
  edited_mime?: string;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const requestId = crypto.randomUUID();

  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json(401, { error: "Missing Authorization header", requestId });
  }

  let requestBody: PreviewRequest | CommitRequest;
  try {
    requestBody = (await req.json()) as PreviewRequest | CommitRequest;
  } catch {
    return json(400, { error: "Invalid request body", requestId });
  }

  const mode = isRecord(requestBody) ? asString(requestBody.mode) : null;
  if (mode !== "preview" && mode !== "commit") {
    return json(400, { error: "mode must be 'preview' or 'commit'", requestId });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const veniceApiKeyRaw = Deno.env.get("VENICE_API_KEY");
  const veniceApiKey = typeof veniceApiKeyRaw === "string" ? veniceApiKeyRaw.trim().replace(/^["']|["']$/g, "") : "";
  if (!veniceApiKey) return json(500, { error: "Configuration error", requestId, details: "Missing VENICE_API_KEY" });

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  }) as SupabaseClientLike;

  const { data: userData, error: userErr } = await authClient.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) {
    return json(401, { error: "Invalid or expired session", requestId });
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey) as SupabaseClientLike;

  if (mode === "preview") {
    const prompt = asString((requestBody as PreviewRequest).prompt) ?? "";
    if (!prompt.trim()) return json(400, { error: "prompt is required", requestId });
    if (prompt.length > 1500) return json(400, { error: "prompt exceeds maximum length (1500)", requestId });

    const imageBase64Raw = asString((requestBody as PreviewRequest).image_base64);
    const imageUrl = asString((requestBody as PreviewRequest).image_url);
    if (!imageBase64Raw && !imageUrl) return json(400, { error: "image_base64 or image_url is required", requestId });

    const payload: { prompt: string; image: string } = {
      prompt: prompt.trim(),
      image: imageBase64Raw ? decodeDataUrlOrBase64(imageBase64Raw).base64 : String(imageUrl),
    };

    const adminRpc = admin as unknown as {
      rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    };

    const { data: creditData, error: creditError } = await adminRpc.rpc("consume_credits", {
      p_user_id: user.id,
      p_amount: 1,
      p_description: "Scene image edit",
      p_metadata: {
        feature: "edit-scene-image",
        provider: "venice",
        mode: "preview",
        prompt_len: prompt.trim().length,
        image_source: imageBase64Raw ? "base64" : "url",
      },
      p_request_id: requestId,
    });

    if (creditError) return json(500, { error: "Failed to consume credits", requestId, details: creditError });
    const parsedCredits = parseConsumeCreditsResult(creditData);
    if (!parsedCredits?.ok) {
      const reason = parsedCredits?.reason ? String(parsedCredits.reason) : "insufficient_credits";
      if (reason === "insufficient_credits") {
        return json(402, {
          error: "Insufficient credits",
          requestId,
          details: {
            reason,
            tier: parsedCredits?.tier,
            remaining_monthly: parsedCredits?.remaining_monthly,
            remaining_bonus: parsedCredits?.remaining_bonus,
          },
        });
      }
      return json(400, { error: "Credit check failed", requestId, details: { reason } });
    }

    const parsedOk = parsedCredits as unknown as Record<string, unknown>;
    const parsedTier = typeof parsedOk.tier === "string" ? parsedOk.tier : null;
    const parsedUnlimited = typeof parsedOk.unlimited === "boolean" ? parsedOk.unlimited : false;
    const parsedIdempotent = parsedOk.idempotent === true;
    const creditsBackfilled =
      parsedTier === "professional" &&
      parsedUnlimited === true &&
      !parsedIdempotent &&
      !hasFiniteNumberField(parsedOk, "remaining_monthly") &&
      !hasFiniteNumberField(parsedOk, "remaining_bonus")
        ? await backfillProfessionalMonthlyUsage({ admin, userId: user.id, amount: 1 })
        : null;

    const credits = {
      consumed: 1,
      remaining_monthly: creditsBackfilled?.remaining_monthly ?? parsedCredits.remaining_monthly,
      remaining_bonus: creditsBackfilled?.remaining_bonus ?? parsedCredits.remaining_bonus,
      tier: creditsBackfilled?.tier ?? parsedCredits.tier,
      unlimited: creditsBackfilled ? false : parsedCredits.unlimited,
    };

    let veniceRes: Response;
    try {
      veniceRes = await fetch("https://api.venice.ai/api/v1/image/edit", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${veniceApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      try {
        await adminRpc.rpc("refund_consumed_credits", {
          p_user_id: user.id,
          p_request_id: requestId,
          p_reason: "Scene image edit failed",
          p_metadata: { feature: "edit-scene-image", provider: "venice", mode: "preview" },
        });
      } catch {
        void 0;
      }
      return json(502, { error: "Failed to reach Venice API", requestId, details: e instanceof Error ? e.message : String(e) });
    }

    if (!veniceRes.ok) {
      const errorText = await veniceRes.text().catch(() => "");
      try {
        await adminRpc.rpc("refund_consumed_credits", {
          p_user_id: user.id,
          p_request_id: requestId,
          p_reason: "Scene image edit failed",
          p_metadata: { feature: "edit-scene-image", provider: "venice", mode: "preview", upstream_status: veniceRes.status },
        });
      } catch {
        void 0;
      }
      return json(veniceRes.status, {
        error: "Venice image edit failed",
        requestId,
        upstreamError: errorText,
      });
    }

    const mime = veniceRes.headers.get("content-type") ?? "image/png";
    const bytes = new Uint8Array(await veniceRes.arrayBuffer());
    const editedBase64 = bytesToBase64(bytes);
    return json(200, { success: true, requestId, credits, mime, edited_image_base64: editedBase64 });
  }

  const sceneId = asString((requestBody as CommitRequest).sceneId);
  const editedImageRaw = asString((requestBody as CommitRequest).edited_image_base64);
  const editedMime = asString((requestBody as CommitRequest).edited_mime) ?? undefined;

  if (!sceneId || !UUID_REGEX.test(sceneId)) return json(400, { error: "Valid sceneId is required", requestId });
  if (!editedImageRaw) return json(400, { error: "edited_image_base64 is required", requestId });

  const decoded = decodeDataUrlOrBase64(editedImageRaw);
  const mime = editedMime ?? decoded.mime ?? "image/png";
  const imageBytes = base64ToBytes(decoded.base64);

  const { data: sceneRow, error: sceneErr } = await admin
    .from("scenes")
    .select("id, story_id, stories(user_id)")
    .eq("id", sceneId)
    .maybeSingle();

  if (sceneErr) return json(500, { error: "Failed to fetch scene", requestId });
  if (!sceneRow) return json(404, { error: "Scene not found", requestId });

  const ownerId = isRecord((sceneRow as unknown as JsonObject).stories)
    ? asString(((sceneRow as unknown as JsonObject).stories as JsonObject).user_id)
    : null;
  if (!ownerId || ownerId !== user.id) return json(403, { error: "Not allowed", requestId });

  const normalizedMime = normalizeMime(mime);
  if (!normalizedMime || !ALLOWED_MIME.has(normalizedMime)) return json(400, { error: "Unsupported image type", requestId });
  if (imageBytes.length <= 0) return json(400, { error: "Empty image payload", requestId });
  if (imageBytes.length > 10 * 1024 * 1024) return json(400, { error: "Image is too large (max 10MB)", requestId });

  const extension = normalizedMime === "image/webp" ? "webp" : normalizedMime === "image/jpeg" ? "jpg" : "png";
  const fileName = `${sceneId}/edit-${Date.now()}.${extension}`;

  console.log("[edit-scene-image] commit upload", { userId: user.id, sceneId, mime: normalizedMime, bytes: imageBytes.length, fileName });

  const { error: uploadError } = await admin.storage
    .from("scene-images")
    .upload(fileName, imageBytes, { contentType: normalizedMime, upsert: true });

  if (uploadError) {
    console.error("[edit-scene-image] upload failed", { sceneId, error: uploadError.message });
    return json(500, { error: "Failed to store edited image", requestId });
  }

  const { data: urlData } = admin.storage.from("scene-images").getPublicUrl(fileName);
  const imageUrl = urlData.publicUrl;

  const { error: updateErr } = await admin
    .from("scenes")
    .update({ image_url: imageUrl, updated_at: new Date().toISOString() })
    .eq("id", sceneId);
  if (updateErr) {
    console.error("[edit-scene-image] scene update failed", { sceneId, error: updateErr.message });
    try {
      await admin.storage.from("scene-images").remove([fileName]);
    } catch (e) {
      console.error("[edit-scene-image] cleanup failed", { sceneId, fileName, error: e instanceof Error ? e.message : String(e) });
    }
    return json(500, { error: "Failed to update scene image", requestId });
  }

  return json(200, { success: true, requestId, imageUrl });
});
