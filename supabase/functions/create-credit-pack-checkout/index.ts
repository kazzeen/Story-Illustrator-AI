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

function pickPack(input: unknown): "small" | "medium" | "large" | null {
  if (input === "small" || input === "medium" || input === "large") return input;
  return null;
}

function creditsForPack(pack: "small" | "medium" | "large") {
  if (pack === "small") return 50;
  if (pack === "medium") return 200;
  return 400;
}

function priceCentsForPack(pack: "small" | "medium" | "large") {
  if (pack === "small") return 499;
  if (pack === "medium") return 1499;
  return 2499;
}

function priceEnvKeyForPack(pack: "small" | "medium" | "large") {
  if (pack === "small") return "STRIPE_PRICE_CREDITS_SMALL_ID";
  if (pack === "medium") return "STRIPE_PRICE_CREDITS_MEDIUM_ID";
  return "STRIPE_PRICE_CREDITS_LARGE_ID";
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

  try {
    new URL(base);
  } catch {
    return { ok: false as const, error: "Invalid request origin" };
  }
  const successUrl = `${base}/pricing?credits_checkout=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${base}/pricing?credits_checkout=cancel`;
  return { ok: true as const, successUrl, cancelUrl };
}

export function buildStripeCheckoutForm(params: {
  priceId: string | null;
  successUrl: string;
  cancelUrl: string;
  userId: string;
  pack: "small" | "medium" | "large";
  credits: number;
  customerId?: string | null;
  customerEmail?: string | null;
  clientReferenceId?: string | null;
}) {
  const form = new URLSearchParams();
  form.set("mode", "payment");
  if (params.priceId) {
    form.set("line_items[0][price]", params.priceId);
  } else {
    const unitAmount = priceCentsForPack(params.pack);
    form.set("line_items[0][price_data][currency]", "usd");
    form.set("line_items[0][price_data][unit_amount]", String(unitAmount));
    form.set("line_items[0][price_data][product_data][name]", `SIAI Credits (${params.credits})`);
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
  form.set("metadata[pack]", params.pack);
  form.set("metadata[credits]", String(params.credits));
  form.set("metadata[price_id]", params.priceId ?? "inline");
  form.set("payment_intent_data[metadata][user_id]", params.userId);
  form.set("payment_intent_data[metadata][pack]", params.pack);
  form.set("payment_intent_data[metadata][credits]", String(params.credits));
  form.set("payment_intent_data[metadata][price_id]", params.priceId ?? "inline");

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKeyRaw = Deno.env.get("STRIPE_SECRET_KEY");
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!supabaseServiceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!stripeSecretKeyRaw) missing.push("STRIPE_SECRET_KEY");
  if (missing.length) return json(500, { error: "Configuration error", missing });

  const stripeSecretKey = normalizeStripeSecretKey(stripeSecretKeyRaw);
  if (!stripeSecretKey.startsWith("sk_")) {
    return json(500, { error: "Configuration error", details: "STRIPE_SECRET_KEY must start with sk_", got: classifyStripeKeyPrefix(stripeSecretKey) });
  }

  let pack: "small" | "medium" | "large" | null = null;
  let returnBase: string | null = null;
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const record = body as Record<string, unknown>;
      pack = pickPack(record.pack);
      returnBase = typeof record.returnBase === "string" ? record.returnBase : null;
    }
  } catch {
    pack = null;
  }
  if (!pack) return json(400, { error: "Invalid request", details: "Missing or invalid pack" });

  const priceEnvKey = priceEnvKeyForPack(pack);
  const priceIdRaw = Deno.env.get(priceEnvKey) ?? null;
  const priceId = priceIdRaw && priceIdRaw.startsWith("price_") ? priceIdRaw : null;

  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Missing Authorization header" });
  const token = authHeader.slice("Bearer ".length);

  const admin = createClient(supabaseUrl, supabaseServiceKey) as SupabaseClientLike;
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

  const credits = creditsForPack(pack);
  const idempotencyKey = crypto.randomUUID();
  const form = buildStripeCheckoutForm({
    priceId,
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    userId: user.id,
    pack,
    credits,
    customerId: creditsRow?.stripe_customer_id ?? null,
    customerEmail: user.email ?? null,
  });

  const created = await createStripeCheckoutSession({ stripeSecretKey, idempotencyKey, form });
  if (!created.ok) return json(502, { error: "Stripe session creation failed", status: created.status, details: created.stripeError ?? created.body ?? created.raw });

  return json(200, { url: created.url, sessionId: created.id });
});
