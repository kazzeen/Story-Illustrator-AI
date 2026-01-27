import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClientLike } from "https://esm.sh/@supabase/supabase-js@2.49.2";

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

function unitAmountCentsForStarter(interval: "month" | "year") {
  const monthlyCents = 999;
  if (interval === "month") return monthlyCents;
  return Math.round(monthlyCents * 12 * 0.8);
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
  priceId: string | null;
  unitAmountCents: number;
  successUrl: string;
  cancelUrl: string;
  userId: string;
  productId: string | null;
  tier: "starter";
  interval: "month" | "year";
  customerId?: string | null;
  customerEmail?: string | null;
  clientReferenceId?: string | null;
}) {
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  if (params.priceId) {
    form.set("line_items[0][price]", params.priceId);
  } else {
    form.set("line_items[0][price_data][currency]", "usd");
    form.set("line_items[0][price_data][unit_amount]", String(params.unitAmountCents));
    form.set("line_items[0][price_data][recurring][interval]", params.interval);
    form.set("line_items[0][price_data][product_data][name]", `SIAI Starter (${params.interval === "year" ? "Annual" : "Monthly"})`);
  }
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
  form.set("metadata[price_id]", params.priceId ?? "inline");
  if (params.productId) form.set("metadata[product_id]", params.productId);
  form.set("subscription_data[metadata][user_id]", params.userId);
  form.set("subscription_data[metadata][tier]", params.tier);
  form.set("subscription_data[metadata][interval]", params.interval);
  form.set("subscription_data[metadata][price_id]", params.priceId ?? "inline");
  if (params.productId) form.set("subscription_data[metadata][product_id]", params.productId);

  return form;
}

async function fetchStripePriceIdForSubscription(params: {
  stripeSecretKey: string;
  productId: string;
  interval: "month" | "year";
}) {
  const url = new URL("https://api.stripe.com/v1/prices");
  url.searchParams.set("product", params.productId);
  url.searchParams.set("active", "true");
  url.searchParams.set("limit", "20");
  url.searchParams.set("type", "recurring");
  url.searchParams.set("recurring[interval]", params.interval);

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${params.stripeSecretKey}` },
  });
  const text = await resp.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!resp.ok || !body || typeof body !== "object") {
    return { ok: false as const, status: resp.status, body, raw: text };
  }

  const data = (body as Record<string, unknown>).data;
  if (!Array.isArray(data)) return { ok: false as const, status: 502, body, raw: text };
  const candidates = data.filter((p) => p && typeof p === "object") as Array<Record<string, unknown>>;

  for (const price of candidates) {
    const id = typeof price.id === "string" ? price.id : null;
    const currency = typeof price.currency === "string" ? price.currency : null;
    const recurring = price.recurring && typeof price.recurring === "object" ? (price.recurring as Record<string, unknown>) : null;
    const interval = recurring && typeof recurring.interval === "string" ? recurring.interval : null;
    if (id && id.startsWith("price_") && currency === "usd" && interval === params.interval) {
      return { ok: true as const, priceId: id };
    }
  }

  for (const price of candidates) {
    const id = typeof price.id === "string" ? price.id : null;
    if (id && id.startsWith("price_")) return { ok: true as const, priceId: id };
  }

  return { ok: false as const, status: 404, body: { error: "No active Stripe price found for product" } };
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

  let interval: "month" | "year" = "month";
  let returnBase: string | null = null;
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const record = body as Record<string, unknown>;
      const raw = record.interval;
      if (raw === "month" || raw === "year") interval = raw;
      returnBase = typeof record.returnBase === "string" ? record.returnBase : null;
    }
  } catch {
    interval = "month";
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const stripeSecretKeyRaw = Deno.env.get("STRIPE_SECRET_KEY");
  const monthlyPriceIdRaw = Deno.env.get("STRIPE_PRICE_STARTER_ID") ?? "price_1SlLG3Ghz0DaM9Dayr9Z3Hq4";
  const annualPriceIdRaw = Deno.env.get("STRIPE_PRICE_STARTER_ANNUAL_ID") ?? "price_1SlLG3Ghz0DaM9DaQcUPswR4";
  const starterProductId = (Deno.env.get("STRIPE_PRODUCT_STARTER_ID") ?? "prod_TimpUzS6BjZH65").trim();
  const envPriceId = interval === "year" ? annualPriceIdRaw : monthlyPriceIdRaw;
  const envPriceIdOk = Boolean(envPriceId && envPriceId.startsWith("price_"));
  const productIdOk = starterProductId.startsWith("prod_");
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!supabaseServiceKey && !supabaseAnonKey) missing.push("SUPABASE_ANON_KEY");
  if (!stripeSecretKeyRaw) missing.push("STRIPE_SECRET_KEY");
  if (missing.length) return json(500, { error: "Configuration error", missing });
  const stripeSecretKey = normalizeStripeSecretKey(stripeSecretKeyRaw);
  if (!stripeSecretKey.startsWith("sk_")) return json(500, { error: "Configuration error", details: "STRIPE_SECRET_KEY must start with sk_", got: classifyStripeKeyPrefix(stripeSecretKey) });

  let priceId: string | null = envPriceIdOk ? (envPriceId as string) : null;
  if (!priceId) {
    const resolved = await fetchStripePriceIdForSubscription({
      stripeSecretKey,
      productId: starterProductId,
      interval,
    });
    if (resolved.ok) priceId = resolved.priceId;
  }

  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader) {
    console.error("Missing Authorization header");
    return json(401, { error: "Missing Authorization header" });
  }

  const supabaseClient = createClient(
    supabaseUrl,
    supabaseAnonKey ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );

  const {
    data: { user },
    error: userError,
  } = await supabaseClient.auth.getUser();

  if (userError || !user) {
    console.error("Authorization failed:", userError);
    return json(401, { error: "Authorization failed", details: userError?.message });
  }

  const urls = buildCheckoutReturnUrls(req, returnBase);
  if (!urls.ok) return json(400, { error: urls.error });

  const db = createClient(supabaseUrl, supabaseServiceKey ?? supabaseAnonKey ?? "", {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: creditsRow } = await db
    .from("user_credits")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const idempotencyKey = crypto.randomUUID();
  const form = buildStripeCheckoutForm({
    priceId,
    unitAmountCents: unitAmountCentsForStarter(interval),
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    userId: user.id,
    productId: productIdOk ? starterProductId : null,
    tier: "starter",
    interval,
    customerId: creditsRow?.stripe_customer_id ?? null,
    customerEmail: user.email ?? null,
  });

  const created = await createStripeCheckoutSession({ stripeSecretKey, idempotencyKey, form });
  if (!created.ok) return json(502, { error: "Stripe session creation failed", status: created.status, details: created.stripeError ?? created.body ?? created.raw });

  return json(200, { url: created.url, sessionId: created.id });
});
