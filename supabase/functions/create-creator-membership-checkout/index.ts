import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";
import { jsonResponse } from "../_shared/helpers.ts";
import {
  normalizeStripeSecretKey,
  classifyStripeKeyPrefix,
  buildCheckoutReturnUrls,
  fetchStripePriceId,
  createStripeCheckoutSession,
} from "../_shared/stripe-helpers.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, Authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown, extraHeaders?: Record<string, string>) {
  return jsonResponse(status, body, corsHeaders, extraHeaders);
}

function unitAmountCentsForTier(params: { tier: "creator" | "professional"; interval: "month" | "year" }) {
  const monthlyCents = params.tier === "professional" ? 3999 : 1999;
  if (params.interval === "month") return monthlyCents;
  return Math.round(monthlyCents * 12 * 0.8);
}

export function buildStripeCheckoutForm(params: {
  priceId: string | null;
  unitAmountCents: number;
  successUrl: string;
  cancelUrl: string;
  userId: string;
  productId: string | null;
  tier: "creator" | "professional";
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
    form.set(
      "line_items[0][price_data][product_data][name]",
      `SIAI ${params.tier === "professional" ? "Professional" : "Creator"} (${params.interval === "year" ? "Annual" : "Monthly"})`,
    );
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
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const stripeSecretKeyRaw = Deno.env.get("STRIPE_SECRET_KEY");
  const monthlyPriceIdRaw =
    (tier === "professional"
      ? Deno.env.get("STRIPE_PRICE_PROFESSIONAL_ID") ?? "price_1SkA5XGhz0DaM9DauhtkNecq"
      : Deno.env.get("STRIPE_PRICE_CREATOR_ID") ?? "price_1SlLG4Ghz0DaM9DammUhNwTH");
  const annualPriceIdRaw =
    (tier === "professional"
      ? Deno.env.get("STRIPE_PRICE_PROFESSIONAL_ANNUAL_ID") ?? "price_1Sli8gGhz0DaM9Dadz4YTMSm"
      : Deno.env.get("STRIPE_PRICE_CREATOR_ANNUAL_ID") ?? "price_1SlLG4Ghz0DaM9Dal11krHXI");
  const envPriceId = interval === "year" ? annualPriceIdRaw : monthlyPriceIdRaw;
  const envPriceIdOk = Boolean(envPriceId && envPriceId.startsWith("price_"));

  const creatorProductId = (Deno.env.get("STRIPE_PRODUCT_CREATOR_ID") ?? "prod_TimpRrgY9Ko9IL").trim();
  const professionalProductId = (Deno.env.get("STRIPE_PRODUCT_PROFESSIONAL_ID") ?? "prod_ThZDvY85b9kQtx").trim();
  const productId = tier === "professional" ? professionalProductId : creatorProductId;
  const productIdOk = productId.startsWith("prod_");
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!supabaseServiceKey && !supabaseAnonKey) missing.push("SUPABASE_ANON_KEY");
  if (!stripeSecretKeyRaw) missing.push("STRIPE_SECRET_KEY");
  if (missing.length) return json(500, { error: "Configuration error", missing });
  const stripeSecretKey = normalizeStripeSecretKey(stripeSecretKeyRaw);
  if (!stripeSecretKey.startsWith("sk_")) return json(500, { error: "Configuration error", details: "STRIPE_SECRET_KEY must start with sk_", got: classifyStripeKeyPrefix(stripeSecretKey) });

  let priceId: string | null = envPriceIdOk ? (envPriceId as string) : null;
  if (!priceId) {
    const resolved = await fetchStripePriceId({
      stripeSecretKey,
      productId,
      type: "recurring",
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

  const urls = buildCheckoutReturnUrls(req, { preferredBase: returnBase });
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
    unitAmountCents: unitAmountCentsForTier({ tier, interval }),
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    userId: user.id,
    tier,
    interval,
    productId: productIdOk ? productId : null,
    customerId: creditsRow?.stripe_customer_id ?? null,
    customerEmail: user.email ?? null,
  });

  const created = await createStripeCheckoutSession({ stripeSecretKey, idempotencyKey, form });
  if (!created.ok) return json(502, { error: "Stripe session creation failed", status: created.status, details: created.stripeError ?? created.body ?? created.raw });

  return json(200, { url: created.url, sessionId: created.id });
});
