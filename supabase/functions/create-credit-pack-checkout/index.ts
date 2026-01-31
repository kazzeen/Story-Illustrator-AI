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

export function buildStripeCheckoutForm(params: {
  priceId: string | null;
  successUrl: string;
  cancelUrl: string;
  userId: string;
  productId: string | null;
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
  if (params.productId) form.set("metadata[product_id]", params.productId);
  form.set("payment_intent_data[metadata][user_id]", params.userId);
  form.set("payment_intent_data[metadata][pack]", params.pack);
  form.set("payment_intent_data[metadata][credits]", String(params.credits));
  form.set("payment_intent_data[metadata][price_id]", params.priceId ?? "inline");
  if (params.productId) form.set("payment_intent_data[metadata][product_id]", params.productId);

  return form;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const stripeSecretKeyRaw = Deno.env.get("STRIPE_SECRET_KEY");
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!supabaseServiceKey && !supabaseAnonKey) missing.push("SUPABASE_ANON_KEY");
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
  let defaultPriceId: string | null = null;
  if (pack === "small") defaultPriceId = "price_1SlK6pGhz0DaM9Da16ezWBP0";
  if (pack === "medium") defaultPriceId = "price_1SlK7tGhz0DaM9Da88lwWEOH";
  if (pack === "large") defaultPriceId = "price_1SoBzBGhz0DaM9DaFeIUw3Eo";

  const priceIdRaw = Deno.env.get(priceEnvKey) ?? defaultPriceId;
  const priceId = priceIdRaw && priceIdRaw.startsWith("price_") ? priceIdRaw : null;

  const productId =
    pack === "small"
      ? (Deno.env.get("STRIPE_PRODUCT_CREDITS_SMALL_ID") ?? "prod_Tile8wkupI73el").trim()
      : pack === "medium"
        ? (Deno.env.get("STRIPE_PRODUCT_CREDITS_MEDIUM_ID") ?? "prod_TilfzH9y5Xt4ot").trim()
        : (Deno.env.get("STRIPE_PRODUCT_CREDITS_LARGE_ID") ?? "prod_TljS29toykp4sN").trim();
  const productIdOk = productId.startsWith("prod_");

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

  const urls = buildCheckoutReturnUrls(req, {
    preferredBase: returnBase,
    successParam: "credits_checkout",
    cancelParam: "credits_checkout",
  });
  if (!urls.ok) return json(400, { error: urls.error });

  const db = createClient(supabaseUrl, supabaseServiceKey ?? supabaseAnonKey ?? "", {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: creditsRow } = await db
    .from("user_credits")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const credits = creditsForPack(pack);
  const idempotencyKey = crypto.randomUUID();
  let effectivePriceId: string | null = priceId;
  if (!effectivePriceId && productIdOk) {
    const resolved = await fetchStripePriceId({ stripeSecretKey, productId, type: "one_time" });
    if (resolved.ok) {
      effectivePriceId = resolved.priceId;
    }
  }
  const form = buildStripeCheckoutForm({
    priceId: effectivePriceId,
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    userId: user.id,
    pack,
    credits,
    productId: productIdOk ? productId : null,
    customerId: creditsRow?.stripe_customer_id ?? null,
    customerEmail: user.email ?? null,
  });

  const created = await createStripeCheckoutSession({ stripeSecretKey, idempotencyKey, form });
  if (!created.ok) return json(502, { error: "Stripe session creation failed", status: created.status, details: created.stripeError ?? created.body ?? created.raw });

  return json(200, { url: created.url, sessionId: created.id });
});
