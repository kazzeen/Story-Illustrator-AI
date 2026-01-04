import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, Authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(extraHeaders ?? {}) },
  });
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

function classifyStripeKeyPrefix(value: string) {
  if (!value) return "empty";
  if (value.startsWith("sk_test_")) return "sk_test_";
  if (value.startsWith("sk_live_")) return "sk_live_";
  if (value.startsWith("pk_test_")) return "pk_test_";
  if (value.startsWith("pk_live_")) return "pk_live_";
  if (value.startsWith("rk_test_")) return "rk_test_";
  if (value.startsWith("rk_live_")) return "rk_live_";
  if (value.startsWith("whsec_")) return "whsec_";
  if (value.startsWith("eyJ")) return "jwt_like";
  return "unknown";
}

export function buildCheckoutReturnUrls(req: Request, preferredBase?: string | null) {
  let origin =
    req.headers.get("origin") ??
    req.headers.get("Origin") ??
    null;

  if (!origin) {
    const ref = req.headers.get("referer") ?? req.headers.get("referrer") ?? null;
    if (ref) {
      try {
        origin = new URL(ref).origin;
      } catch {
        origin = null;
      }
    }
  }

  origin =
    origin ??
    Deno.env.get("PUBLIC_SITE_URL") ??
    Deno.env.get("SITE_URL") ??
    Deno.env.get("APP_URL") ??
    null;

  if (!origin) return { ok: false as const, error: "Missing request origin" };

  const requestOrigin = origin.replace(/\/$/, "");
  let base = requestOrigin;
  if (preferredBase && typeof preferredBase === "string") {
    const trimmed = preferredBase.trim();
    if (trimmed) {
      try {
        const preferredUrl = new URL(trimmed);
        const requestUrl = new URL(requestOrigin);
        if (preferredUrl.origin === requestUrl.origin) {
          base = trimmed.replace(/\/$/, "");
        }
      } catch {
        base = requestOrigin;
      }
    }
  }

  const successUrl = `${base}/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${base}/pricing?checkout=cancel`;
  return { ok: true as const, successUrl, cancelUrl };
}

export function buildStripeCheckoutForm(params: {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  userId: string;
  tier: "creator" | "professional";
  interval: "month" | "year";
  customerId?: string | null;
  customerEmail?: string | null;
  clientReferenceId?: string | null;
}) {
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("line_items[0][price]", params.priceId);
  form.set("line_items[0][quantity]", "1");
  form.set("success_url", params.successUrl);
  form.set("cancel_url", params.cancelUrl);
  form.set("allow_promotion_codes", "true");

  const ref = params.clientReferenceId ?? params.userId;
  if (ref) form.set("client_reference_id", ref);

  if (params.customerId) {
    form.set("customer", params.customerId);
  } else if (params.customerEmail) {
    form.set("customer_email", params.customerEmail);
  }

  form.set("metadata[user_id]", params.userId);
  form.set("metadata[tier]", params.tier);
  form.set("metadata[interval]", params.interval);
  form.set("metadata[price_id]", params.priceId);
  form.set("subscription_data[metadata][user_id]", params.userId);
  form.set("subscription_data[metadata][tier]", params.tier);
  form.set("subscription_data[metadata][interval]", params.interval);
  form.set("subscription_data[metadata][price_id]", params.priceId);

  return form;
}

async function createStripeCheckoutSession(params: {
  stripeSecretKey: string;
  idempotencyKey: string;
  form: URLSearchParams;
}) {
  const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": params.idempotencyKey,
    },
    body: params.form.toString(),
  });

  const text = await resp.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  if (!resp.ok) {
    const stripeError =
      body && typeof body === "object" && "error" in (body as Record<string, unknown>) && typeof (body as Record<string, unknown>).error === "object"
        ? (body as { error?: unknown }).error
        : null;
    return { ok: false as const, status: resp.status, body, raw: text, stripeError };
  }

  const url =
    body && typeof body === "object" && "url" in (body as Record<string, unknown>) && typeof (body as Record<string, unknown>).url === "string"
      ? String((body as Record<string, unknown>).url)
      : null;

  const id =
    body && typeof body === "object" && "id" in (body as Record<string, unknown>) && typeof (body as Record<string, unknown>).id === "string"
      ? String((body as Record<string, unknown>).id)
      : null;

  if (!url || !id) return { ok: false as const, status: 502, body, raw: text };
  return { ok: true as const, id, url };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let tier: "creator" | "professional" = "creator";
  let interval: "month" | "year" = "month";
  let returnBase: string | null = null;
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const record = body as Record<string, unknown>;
      tier = record.tier === "professional" ? "professional" : "creator";
      const raw = record.interval;
      if (raw === "month" || raw === "year") interval = raw;
      returnBase = typeof record.returnBase === "string" ? record.returnBase : null;
    }
  } catch {
    interval = "month";
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKeyRaw = Deno.env.get("STRIPE_SECRET_KEY");
  const monthlyPriceId =
    tier === "professional" ? Deno.env.get("STRIPE_PRICE_PROFESSIONAL_ID") : Deno.env.get("STRIPE_PRICE_CREATOR_ID");
  const annualPriceId =
    tier === "professional"
      ? Deno.env.get("STRIPE_PRICE_PROFESSIONAL_ANNUAL_ID")
      : Deno.env.get("STRIPE_PRICE_CREATOR_ANNUAL_ID");
  const priceId = interval === "year" && annualPriceId ? annualPriceId : monthlyPriceId;
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!supabaseServiceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!stripeSecretKeyRaw) missing.push("STRIPE_SECRET_KEY");
  if (!monthlyPriceId) missing.push(tier === "professional" ? "STRIPE_PRICE_PROFESSIONAL_ID" : "STRIPE_PRICE_CREATOR_ID");
  if (interval === "year" && !annualPriceId) {
    missing.push(tier === "professional" ? "STRIPE_PRICE_PROFESSIONAL_ANNUAL_ID" : "STRIPE_PRICE_CREATOR_ANNUAL_ID");
  }
  if (missing.length) return json(500, { error: "Configuration error", missing });
  const stripeSecretKey = normalizeStripeSecretKey(stripeSecretKeyRaw);
  if (!stripeSecretKey.startsWith("sk_")) return json(500, { error: "Configuration error", details: "STRIPE_SECRET_KEY must start with sk_", got: classifyStripeKeyPrefix(stripeSecretKey) });
  if (!priceId.startsWith("price_")) return json(500, { error: "Configuration error", details: `Selected Stripe price must start with price_ (${interval})` });

  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Missing Authorization header" });
  const token = authHeader.slice("Bearer ".length);

  const admin = createClient(supabaseUrl, supabaseServiceKey);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) return json(401, { error: "Invalid or expired session" });

  const urls = buildCheckoutReturnUrls(req, returnBase);
  if (!urls.ok) return json(400, { error: urls.error });

  const { data: creditsRow } = await admin
    .from("user_credits")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const idempotencyKey = crypto.randomUUID();
  const form = buildStripeCheckoutForm({
    priceId,
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    userId: user.id,
    tier,
    interval,
    customerId: creditsRow?.stripe_customer_id ?? null,
    customerEmail: user.email ?? null,
  });

  const created = await createStripeCheckoutSession({ stripeSecretKey, idempotencyKey, form });
  if (!created.ok) return json(502, { error: "Stripe session creation failed", status: created.status, details: created.stripeError ?? created.body ?? created.raw });

  return json(200, { url: created.url, sessionId: created.id });
});
