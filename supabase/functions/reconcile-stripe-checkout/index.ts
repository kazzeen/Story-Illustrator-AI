import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClientLike } from "https://esm.sh/@supabase/supabase-js@2.49.2";
import { resolveSubscriptionTier } from "../_shared/stripe-tier.ts";

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

function isoFromStripeSeconds(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Date(value * 1000).toISOString();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SB_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? null;
  const supabaseServiceKey = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? null;
  const supabaseAnonKey = Deno.env.get("SB_ANON_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? null;
  const stripeSecretKeyRaw = Deno.env.get("STRIPE_SECRET_KEY") ?? null;
  if (!supabaseUrl || !stripeSecretKeyRaw || !supabaseServiceKey) {
    const missing: string[] = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!supabaseServiceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!stripeSecretKeyRaw) missing.push("STRIPE_SECRET_KEY");
    return json(500, {
      error: "Configuration error",
      missing,
    });
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
  if (userError || !user) return json(401, { error: "Authorization failed", details: userError?.message ?? null, hasAuthHeader: Boolean(authHeader), tokenParsed: true });

  const bodyRaw = (await req.json().catch(() => null)) as unknown;
  const sessionId =
    (isRecord(bodyRaw) ? asString(bodyRaw.session_id ?? bodyRaw.sessionId) : null) ??
    null;
  if (!sessionId || !sessionId.startsWith("cs_")) return json(400, { error: "Invalid request", details: "Missing or invalid session_id" });

  const sessionResp = await fetchJson({
    url: `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand%5B%5D=subscription`,
    stripeSecretKey,
  });
  if (!sessionResp.ok || !isRecord(sessionResp.body)) {
    return json(502, { error: "Stripe session fetch failed", status: sessionResp.status, details: sessionResp.body ?? sessionResp.raw });
  }

  const sessionObj = sessionResp.body as Record<string, unknown>;
  const mode = asString(sessionObj.mode);
  if (mode !== "subscription") return json(400, { error: "Unsupported checkout session mode", details: mode });

  const metadata = isRecord(sessionObj.metadata) ? (sessionObj.metadata as Record<string, unknown>) : null;
  const metadataTier = metadata ? asString(metadata.tier) : null;
  const metadataUserId = metadata ? asString(metadata.supabase_user_id ?? metadata.user_id) : null;
  if (metadataUserId && metadataUserId !== user.id) return json(403, { error: "Session does not belong to current user" });

  const customerId = asString(sessionObj.customer);
  const subscription = sessionObj.subscription;
  const subscriptionId = typeof subscription === "string" ? subscription : isRecord(subscription) ? asString(subscription.id) : null;
  const invoiceId = asString(sessionObj.invoice);
  if (!subscriptionId) return json(400, { error: "Missing subscription id on checkout session" });

  const subResp = await fetchJson({
    url: `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    stripeSecretKey,
  });
  if (!subResp.ok || !isRecord(subResp.body)) {
    return json(502, { error: "Stripe subscription fetch failed", status: subResp.status, details: subResp.body ?? subResp.raw });
  }

  const subObj = subResp.body as Record<string, unknown>;
  const cycleStart = isoFromStripeSeconds(subObj.current_period_start);
  const cycleEnd = isoFromStripeSeconds(subObj.current_period_end);
  const subMeta = isRecord(subObj.metadata) ? (subObj.metadata as Record<string, unknown>) : null;
  const subTier = subMeta ? asString(subMeta.tier) : null;

  const items = isRecord(subObj.items) ? (subObj.items as Record<string, unknown>) : null;
  const dataArr = items && Array.isArray(items.data) ? items.data : null;
  const firstItem = dataArr && dataArr.length > 0 && isRecord(dataArr[0]) ? (dataArr[0] as Record<string, unknown>) : null;
  const price = firstItem && isRecord(firstItem.price) ? (firstItem.price as Record<string, unknown>) : null;
  const priceId = price ? asString(price.id) : null;
  if (!priceId) return json(400, { error: "Could not determine subscription price id" });

  const env = {
    STRIPE_PRICE_STARTER_ID: Deno.env.get("STRIPE_PRICE_STARTER_ID"),
    STRIPE_PRICE_STARTER_ANNUAL_ID: Deno.env.get("STRIPE_PRICE_STARTER_ANNUAL_ID"),
    STRIPE_PRICE_CREATOR_ID: Deno.env.get("STRIPE_PRICE_CREATOR_ID"),
    STRIPE_PRICE_CREATOR_ANNUAL_ID: Deno.env.get("STRIPE_PRICE_CREATOR_ANNUAL_ID"),
    STRIPE_PRICE_PROFESSIONAL_ID: Deno.env.get("STRIPE_PRICE_PROFESSIONAL_ID"),
    STRIPE_PRICE_PROFESSIONAL_ANNUAL_ID: Deno.env.get("STRIPE_PRICE_PROFESSIONAL_ANNUAL_ID"),
  };

  const tier = resolveSubscriptionTier({ metadataTier, subscriptionTier: subTier, priceId, env });
  if (!tier) return json(400, { error: "Unknown subscription price", details: { priceId } });

  const cycleStartIso = cycleStart ?? new Date().toISOString();
  const cycleEndIso = cycleEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const eventId = `reconcile:${sessionId}`;
  const { data: applied, error: applyErr } = await admin.rpc("apply_stripe_subscription_state", {
    p_user_id: user.id,
    p_tier: tier,
    p_customer_id: customerId,
    p_subscription_id: subscriptionId,
    p_price_id: priceId,
    p_cycle_start: cycleStartIso,
    p_cycle_end: cycleEndIso,
    p_event_id: eventId,
    p_invoice_id: invoiceId,
    p_reset_usage: true,
  });
  if (applyErr) return json(500, { error: "Failed to apply subscription credits", details: applyErr });

  return json(200, { ok: true, result: applied, tier, subscriptionId, priceId, cycleStart: cycleStartIso, cycleEnd: cycleEndIso });
});
