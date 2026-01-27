import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClientLike } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, Authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0 && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.trim().match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1]?.trim() ?? "";
  return token ? token : null;
}

function normalizeStripeSecretKey(input: string) {
  const trimmed = input.trim();
  const unquoted =
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  const compact = unquoted.replace(/\s+/g, "");
  const match = compact.match(/sk_(?:test|live)_[0-9a-zA-Z]+/);
  return match?.[0] ?? compact;
}

async function fetchJson(params: { url: string; stripeSecretKey: string }) {
  const resp = await fetch(params.url, {
    headers: { Authorization: `Bearer ${params.stripeSecretKey}` },
  });
  const text = await resp.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { ok: resp.ok, status: resp.status, body, raw: text };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SB_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? null;
  const supabaseServiceKey = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? null;
  const stripeSecretKeyRaw = Deno.env.get("STRIPE_SECRET_KEY") ?? null;
  if (!supabaseUrl || !supabaseServiceKey || !stripeSecretKeyRaw) {
    const missing: string[] = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!supabaseServiceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!stripeSecretKeyRaw) missing.push("STRIPE_SECRET_KEY");
    return json(500, { error: "Configuration error", missing });
  }
  const stripeSecretKey = normalizeStripeSecretKey(stripeSecretKeyRaw);

  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  const token = extractBearerToken(authHeader);
  if (!token) return json(401, { error: "Missing Authorization header", hasAuthHeader: Boolean(authHeader), tokenParsed: false });

  const admin = createClient(supabaseUrl, supabaseServiceKey) as SupabaseClientLike;
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token);
  if (userError || !user) {
    return json(401, {
      error: "Authorization failed",
      details: userError?.message ?? null,
      hasAuthHeader: Boolean(authHeader),
      tokenParsed: true,
    });
  }

  const bodyRaw = (await req.json().catch(() => null)) as unknown;
  const sessionId = (isRecord(bodyRaw) ? asString(bodyRaw.session_id ?? bodyRaw.sessionId) : null) ?? null;
  if (!sessionId || !sessionId.startsWith("cs_")) return json(400, { error: "Invalid request", details: "Missing or invalid session_id" });

  const sessionResp = await fetchJson({
    url: `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    stripeSecretKey,
  });
  if (!sessionResp.ok || !isRecord(sessionResp.body)) {
    return json(502, { error: "Stripe session fetch failed", status: sessionResp.status, details: sessionResp.body ?? sessionResp.raw });
  }

  const sessionObj = sessionResp.body as Record<string, unknown>;
  const mode = asString(sessionObj.mode);
  const paymentStatus = asString(sessionObj.payment_status);
  if (mode !== "payment") return json(400, { error: "Unsupported checkout session mode", details: mode });
  if (paymentStatus !== "paid") return json(409, { error: "Checkout session not paid", details: { payment_status: paymentStatus } });

  const metadata = isRecord(sessionObj.metadata) ? (sessionObj.metadata as Record<string, unknown>) : null;
  const metadataUserId = metadata ? asString(metadata.supabase_user_id ?? metadata.user_id) : null;
  const pack = metadata ? asString(metadata.pack) : null;
  const credits = metadata ? parsePositiveInt(metadata.credits) : null;
  const priceId = metadata ? asString(metadata.price_id) : null;
  if (!metadataUserId || metadataUserId !== user.id) return json(403, { error: "Session does not belong to current user" });
  if (!credits) return json(400, { error: "Missing credits metadata on checkout session" });

  const customerId = asString(sessionObj.customer);
  const paymentIntentId = asString(sessionObj.payment_intent);
  const eventId = `reconcile_credit_pack:${sessionId}`;

  const { data: applied, error: applyErr } = await admin.rpc("admin_apply_stripe_credit_pack_purchase", {
    p_user_id: user.id,
    p_amount: credits,
    p_event_id: eventId,
    p_checkout_session_id: sessionId,
    p_payment_intent_id: paymentIntentId,
    p_customer_id: customerId,
    p_price_id: priceId,
    p_pack: pack,
  });
  if (applyErr) return json(500, { error: "Failed to apply credit purchase", details: applyErr });

  return json(200, { ok: true, result: applied, credits, pack, sessionId });
});

