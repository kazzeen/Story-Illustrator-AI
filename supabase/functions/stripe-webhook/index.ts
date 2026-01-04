import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonObject = Record<string, unknown>;

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

function isDuplicateKeyError(err: unknown) {
  if (!err || typeof err !== "object") return false;
  const record = err as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : null;
  if (code === "23505") return true;
  const message = typeof record.message === "string" ? record.message : "";
  const details = typeof record.details === "string" ? record.details : "";
  const combined = `${message} ${details}`.toLowerCase();
  return combined.includes("duplicate") || combined.includes("already exists");
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function hexToBytes(hex: string) {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(byte)) return null;
    out[i] = byte;
  }
  return out;
}

async function hmacSha256(key: string, data: string) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return new Uint8Array(sig);
}

async function verifyStripeSignature(params: { payload: string; header: string; secret: string }) {
  const { payload, header, secret } = params;
  const parts = header.split(",").map((p) => p.trim()).filter(Boolean);
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Parts = parts.filter((p) => p.startsWith("v1="));
  const t = tPart ? tPart.slice("t=".length) : null;
  const timestamp = t && /^\d+$/.test(t) ? Number(t) : null;
  if (!timestamp) return { ok: false as const, reason: "invalid_signature_header" };

  const signed = `${t}.${payload}`;
  const expected = await hmacSha256(secret, signed);

  for (const v1 of v1Parts) {
    const sigHex = v1.slice("v1=".length);
    const sigBytes = hexToBytes(sigHex);
    if (!sigBytes) continue;
    if (timingSafeEqual(sigBytes, expected)) return { ok: true as const, timestamp };
  }
  return { ok: false as const, reason: "signature_mismatch" };
}

type StripeEvent = {
  id: string;
  type: string;
  data?: { object?: unknown };
};

async function postAlertWebhook(params: { url: string; payload: Record<string, unknown> }) {
  try {
    await fetch(params.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params.payload),
    });
  } catch {
    return;
  }
}

function resolveTierFromPriceId(priceId: string, env: Record<string, string | undefined>) {
  const starterIds = [env.STRIPE_PRICE_STARTER_ID, env.STRIPE_PRICE_STARTER_ANNUAL_ID].filter(Boolean) as string[];
  const creatorIds = [env.STRIPE_PRICE_CREATOR_ID, env.STRIPE_PRICE_CREATOR_ANNUAL_ID].filter(Boolean) as string[];
  const professionalIds = [env.STRIPE_PRICE_PROFESSIONAL_ID, env.STRIPE_PRICE_PROFESSIONAL_ANNUAL_ID].filter(Boolean) as string[];
  if (starterIds.includes(priceId)) return "starter";
  if (creatorIds.includes(priceId)) return "creator";
  if (professionalIds.includes(priceId)) return "professional";
  return null;
}

function parsePositiveInt(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0 && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!supabaseUrl || !supabaseServiceKey || !webhookSecret) return json(500, { error: "Configuration error" });

  const sigHeader = req.headers.get("stripe-signature") ?? req.headers.get("Stripe-Signature");
  if (!sigHeader) return json(400, { error: "Missing stripe-signature header" });

  const payload = await req.text();
  const sigOk = await verifyStripeSignature({ payload, header: sigHeader, secret: webhookSecret });
  if (!sigOk.ok) return json(400, { error: "Invalid signature", reason: sigOk.reason });

  let event: StripeEvent;
  try {
    event = JSON.parse(payload);
  } catch {
    return json(400, { error: "Invalid JSON payload" });
  }
  if (!event?.id || !event?.type) return json(400, { error: "Invalid event shape" });

  const admin = createClient(supabaseUrl, supabaseServiceKey);

  const { error: dedupeErr } = await admin.from("stripe_webhook_events").insert({ event_id: event.id });
  if (dedupeErr) {
    if (isDuplicateKeyError(dedupeErr)) return json(200, { received: true, deduped: true });
    console.error("Failed to record Stripe webhook event:", dedupeErr);
    return json(500, { error: "Failed to record Stripe webhook event" });
  }

  const obj = isRecord(event.data) ? event.data.object : null;
  const objRec = isRecord(obj) ? obj : null;

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? null;
  const alertWebhookUrl = Deno.env.get("ALERT_WEBHOOK_URL") ?? null;

  const env = {
    STRIPE_PRICE_STARTER_ID: Deno.env.get("STRIPE_PRICE_STARTER_ID"),
    STRIPE_PRICE_STARTER_ANNUAL_ID: Deno.env.get("STRIPE_PRICE_STARTER_ANNUAL_ID"),
    STRIPE_PRICE_CREATOR_ID: Deno.env.get("STRIPE_PRICE_CREATOR_ID"),
    STRIPE_PRICE_CREATOR_ANNUAL_ID: Deno.env.get("STRIPE_PRICE_CREATOR_ANNUAL_ID"),
    STRIPE_PRICE_PROFESSIONAL_ID: Deno.env.get("STRIPE_PRICE_PROFESSIONAL_ID"),
    STRIPE_PRICE_PROFESSIONAL_ANNUAL_ID: Deno.env.get("STRIPE_PRICE_PROFESSIONAL_ANNUAL_ID"),
  };

  const logWebhookOutcome = async (params: {
    status: "ok" | "ignored" | "error";
    userId?: string | null;
    reason?: string | null;
    details?: Record<string, unknown> | null;
  }) => {
    try {
      await admin
        .from("stripe_webhook_events")
        .update({
          event_type: event.type,
          status: params.status,
          processed_at: new Date().toISOString(),
          user_id: params.userId ?? null,
          reason: params.reason ?? null,
          details: params.details ?? null,
        })
        .eq("event_id", event.id);
    } catch {
      return;
    }
  };

  const alertIfNeeded = async (params: { status: "error" | "ignored"; reason: string; userId?: string | null; details?: Record<string, unknown> | null }) => {
    if (!alertWebhookUrl) return;
    if (params.status !== "error") return;
    await postAlertWebhook({
      url: alertWebhookUrl,
      payload: {
        kind: "stripe_webhook_error",
        event_id: event.id,
        event_type: event.type,
        user_id: params.userId ?? null,
        reason: params.reason,
        details: params.details ?? null,
        at: new Date().toISOString(),
      },
    });
  };

  const handleSubscriptionState = async (params: {
    userId: string;
    tier: string;
    customerId: string | null;
    subscriptionId: string | null;
    priceId: string | null;
    cycleStart: number | null;
    cycleEnd: number | null;
    invoiceId: string | null;
    resetUsage: boolean;
  }) => {
    const cycleStart = params.cycleStart ? new Date(params.cycleStart * 1000).toISOString() : new Date().toISOString();
    const cycleEnd = params.cycleEnd ? new Date(params.cycleEnd * 1000).toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin.rpc("apply_stripe_subscription_state", {
      p_user_id: params.userId,
      p_tier: params.tier,
      p_customer_id: params.customerId,
      p_subscription_id: params.subscriptionId,
      p_price_id: params.priceId,
      p_cycle_start: cycleStart,
      p_cycle_end: cycleEnd,
      p_event_id: event.id,
      p_invoice_id: params.invoiceId,
      p_reset_usage: params.resetUsage,
    });
    return { data, error };
  };

  const fetchStripeSubscription = async (subscriptionId: string) => {
    if (!stripeSecretKey) return { ok: false as const, reason: "missing_stripe_secret" as const };
    const resp = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${stripeSecretKey}` },
    });
    const text = await resp.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (!resp.ok || !body || typeof body !== "object") {
      return { ok: false as const, reason: "stripe_fetch_failed" as const, status: resp.status, body, raw: text };
    }
    return { ok: true as const, subscription: body as Record<string, unknown> };
  };

  const findUserId = async (params: { customerId?: string | null; subscriptionId?: string | null; metadataUserId?: string | null }) => {
    const metadataUserId = params.metadataUserId;
    if (metadataUserId) return metadataUserId;

    const bySub = params.subscriptionId
      ? await admin.from("user_credits").select("user_id").eq("stripe_subscription_id", params.subscriptionId).maybeSingle()
      : null;
    if (bySub?.data?.user_id) return bySub.data.user_id as string;

    const byCustomer = params.customerId
      ? await admin.from("user_credits").select("user_id").eq("stripe_customer_id", params.customerId).maybeSingle()
      : null;
    if (byCustomer?.data?.user_id) return byCustomer.data.user_id as string;

    return null;
  };

  const subscriptionObjectToParams = (sub: Record<string, unknown>) => {
    const customerId = asString(sub.customer);
    const subscriptionId = asString(sub.id);
    const currentPeriodStart = typeof sub.current_period_start === "number" ? sub.current_period_start : null;
    const currentPeriodEnd = typeof sub.current_period_end === "number" ? sub.current_period_end : null;
    const meta = isRecord(sub.metadata) ? sub.metadata : null;
    const metadataUserId = meta ? asString(meta.supabase_user_id ?? meta.user_id) : null;

    let priceId: string | null = null;
    const items = isRecord(sub.items) ? sub.items : null;
    const dataArr = items && Array.isArray(items.data) ? items.data : null;
    const firstItem = dataArr && dataArr.length > 0 && isRecord(dataArr[0]) ? (dataArr[0] as Record<string, unknown>) : null;
    const price = firstItem && isRecord(firstItem.price) ? (firstItem.price as Record<string, unknown>) : null;
    if (price) priceId = asString(price.id);

    return { customerId, subscriptionId, currentPeriodStart, currentPeriodEnd, priceId, metadataUserId };
  };

  if (event.type === "checkout.session.completed") {
    if (!objRec) return json(400, { error: "Missing event object" });
    const mode = asString(objRec.mode);
    const paymentStatus = asString(objRec.payment_status);
    const subscriptionPaymentOk = paymentStatus === "paid" || paymentStatus === "no_payment_required";
    if (mode === "payment" && paymentStatus !== "paid") {
      await logWebhookOutcome({ status: "ignored", reason: "not_paid" });
      return json(200, { received: true, ignored: true, reason: "not_paid" });
    }
    if (mode === "subscription" && paymentStatus && !subscriptionPaymentOk) {
      await logWebhookOutcome({ status: "ignored", reason: "subscription_not_paid", details: { paymentStatus } });
      return json(200, { received: true, ignored: true, reason: "subscription_not_paid" });
    }

    const sessionId = asString(objRec.id);
    const customerId = asString(objRec.customer);
    const paymentIntentId = asString(objRec.payment_intent);
    const meta = isRecord(objRec.metadata) ? objRec.metadata : null;
    const userId = meta ? asString(meta.supabase_user_id ?? meta.user_id) : null;
    const subscriptionId = asString(objRec.subscription);
    const invoiceId = asString(objRec.invoice);

    if (mode === "payment") {
      const credits = meta ? parsePositiveInt(meta.credits) : null;
      const pack = meta ? asString(meta.pack) : null;
      const priceId = meta ? asString(meta.price_id) : null;

      if (!userId || !credits || (credits !== 50 && credits !== 200 && credits !== 400) || !sessionId) {
        await logWebhookOutcome({ status: "ignored", reason: "missing_metadata", details: { mode, has_user: Boolean(userId), credits } });
        return json(200, { received: true, ignored: true, reason: "missing_metadata" });
      }

      const { data, error } = await admin.rpc("admin_apply_stripe_credit_pack_purchase", {
        p_user_id: userId,
        p_amount: credits,
        p_event_id: event.id,
        p_checkout_session_id: sessionId,
        p_payment_intent_id: paymentIntentId,
        p_customer_id: customerId,
        p_price_id: priceId,
        p_pack: pack,
      });
      if (error) {
        await logWebhookOutcome({ status: "error", userId, reason: "credit_pack_apply_failed", details: { error } });
        await alertIfNeeded({ status: "error", userId, reason: "credit_pack_apply_failed", details: { error } });
        return json(500, { error: "Failed to apply credit purchase", details: error });
      }

      await logWebhookOutcome({ status: "ok", userId, reason: "credit_pack_applied" });
      return json(200, { received: true, result: data });
    }

    if (mode === "subscription") {
      const metadataTier = meta ? asString(meta.tier) : null;
      const metadataUserId = meta ? asString(meta.supabase_user_id ?? meta.user_id) : null;
      const metadataPriceId = meta ? asString(meta.price_id) : null;
      const metadataInterval = meta ? asString(meta.interval) : null;
      const resolvedUserId = await findUserId({ customerId, subscriptionId, metadataUserId });
      if (!subscriptionId) {
        await logWebhookOutcome({ status: "ignored", userId: resolvedUserId, reason: "missing_subscription_id" });
        return json(200, { received: true, ignored: true, reason: "missing_subscription_id" });
      }

      const tierFromMetadata =
        metadataTier === "starter" || metadataTier === "creator" || metadataTier === "professional" ? metadataTier : null;
      const intervalFromMetadata = metadataInterval === "month" || metadataInterval === "year" ? metadataInterval : null;
      if (tierFromMetadata && resolvedUserId) {
        const nowSec = Math.floor(Date.now() / 1000);
        const cycleStart = nowSec;
        const cycleEnd = nowSec + (intervalFromMetadata === "year" ? 365 * 24 * 60 * 60 : 30 * 24 * 60 * 60);

        const { error } = await handleSubscriptionState({
          userId: resolvedUserId,
          tier: tierFromMetadata,
          customerId,
          subscriptionId,
          priceId: metadataPriceId,
          cycleStart,
          cycleEnd,
          invoiceId,
          resetUsage: true,
        });
        if (error) {
          await logWebhookOutcome({ status: "error", userId: resolvedUserId, reason: "subscription_apply_failed_metadata", details: { error } });
          await alertIfNeeded({ status: "error", userId: resolvedUserId, reason: "subscription_apply_failed_metadata", details: { error } });
          return json(500, { error: "Failed to apply subscription grant", details: error });
        }

        await logWebhookOutcome({
          status: "ok",
          userId: resolvedUserId,
          reason: "subscription_grant_applied_metadata",
          details: { tier: tierFromMetadata, interval: intervalFromMetadata, priceId: metadataPriceId },
        });
        return json(200, { received: true });
      }

      const fetched = await fetchStripeSubscription(subscriptionId);
      if (!fetched.ok) {
        await logWebhookOutcome({
          status: "ignored",
          userId: resolvedUserId,
          reason: fetched.reason,
          details: { subscriptionId, mode, metadataTier, metadataPriceId },
        });
        return json(200, { received: true, ignored: true, reason: fetched.reason });
      }

      const subParams = subscriptionObjectToParams(fetched.subscription);
      const userIdFromSub = await findUserId({
        customerId: subParams.customerId ?? customerId,
        subscriptionId: subParams.subscriptionId ?? subscriptionId,
        metadataUserId: subParams.metadataUserId ?? metadataUserId,
      });
      if (!userIdFromSub) {
        await logWebhookOutcome({ status: "ignored", reason: "user_not_found" });
        return json(200, { received: true, ignored: true, reason: "user_not_found" });
      }

      const tier = subParams.priceId ? resolveTierFromPriceId(subParams.priceId, env) : null;
      if (!tier) {
        await logWebhookOutcome({ status: "ignored", userId: userIdFromSub, reason: "unknown_price", details: { priceId: subParams.priceId } });
        return json(200, { received: true, ignored: true, reason: "unknown_price" });
      }

      const { error } = await handleSubscriptionState({
        userId: userIdFromSub,
        tier,
        customerId: subParams.customerId ?? customerId,
        subscriptionId: subParams.subscriptionId ?? subscriptionId,
        priceId: subParams.priceId,
        cycleStart: subParams.currentPeriodStart,
        cycleEnd: subParams.currentPeriodEnd,
        invoiceId,
        resetUsage: true,
      });
      if (error) {
        await logWebhookOutcome({ status: "error", userId: userIdFromSub, reason: "subscription_apply_failed", details: { error } });
        await alertIfNeeded({ status: "error", userId: userIdFromSub, reason: "subscription_apply_failed", details: { error } });
        return json(500, { error: "Failed to apply subscription grant", details: error });
      }

      await logWebhookOutcome({ status: "ok", userId: userIdFromSub, reason: "subscription_grant_applied" });
      return json(200, { received: true });
    }

    await logWebhookOutcome({ status: "ignored", reason: "unsupported_mode", details: { mode } });
    return json(200, { received: true, ignored: true, reason: "unsupported_mode" });
  }

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
    if (!objRec) return json(400, { error: "Missing event object" });
    const subParams = subscriptionObjectToParams(objRec);
    const userId = await findUserId({ customerId: subParams.customerId, subscriptionId: subParams.subscriptionId, metadataUserId: subParams.metadataUserId });
    if (!userId) {
      await logWebhookOutcome({ status: "ignored", reason: "user_not_found" });
      return json(200, { received: true, ignored: true, reason: "user_not_found" });
    }
    const tier = subParams.priceId ? resolveTierFromPriceId(subParams.priceId, env) : null;
    if (!tier) {
      await logWebhookOutcome({ status: "ignored", userId, reason: "unknown_price", details: { priceId: subParams.priceId } });
      return json(200, { received: true, ignored: true, reason: "unknown_price" });
    }

    const { error } = await handleSubscriptionState({
      userId,
      tier,
      customerId: subParams.customerId,
      subscriptionId: subParams.subscriptionId,
      priceId: subParams.priceId,
      cycleStart: subParams.currentPeriodStart,
      cycleEnd: subParams.currentPeriodEnd,
      invoiceId: null,
      resetUsage: false,
    });
    if (error) {
      await logWebhookOutcome({ status: "error", userId, reason: "subscription_state_apply_failed", details: { error } });
      await alertIfNeeded({ status: "error", userId, reason: "subscription_state_apply_failed", details: { error } });
      return json(500, { error: "Failed to apply subscription state", details: error });
    }
    await logWebhookOutcome({ status: "ok", userId, reason: "subscription_state_applied" });
    return json(200, { received: true });
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    if (!objRec) return json(400, { error: "Missing event object" });
    const invoicePaid = (objRec as { paid?: unknown }).paid === true || asString((objRec as { status?: unknown }).status) === "paid";
    if (!invoicePaid) {
      await logWebhookOutcome({ status: "ignored", reason: "invoice_not_paid" });
      return json(200, { received: true, ignored: true, reason: "invoice_not_paid" });
    }
    const customerId = asString(objRec.customer);
    const invoiceId = asString(objRec.id);
    const subscriptionId = asString(objRec.subscription);
    const lines = isRecord(objRec.lines) ? objRec.lines : null;
    const dataArr = lines && Array.isArray(lines.data) ? lines.data : null;
    const firstLine = dataArr && dataArr.length > 0 && isRecord(dataArr[0]) ? (dataArr[0] as Record<string, unknown>) : null;
    const price = firstLine && isRecord(firstLine.price) ? (firstLine.price as Record<string, unknown>) : null;
    const priceId = price ? asString(price.id) : null;
    const period = firstLine && isRecord(firstLine.period) ? (firstLine.period as Record<string, unknown>) : null;
    const cycleStart = period && typeof period.start === "number" ? period.start : null;
    const cycleEnd = period && typeof period.end === "number" ? period.end : null;

    const meta = isRecord(objRec.metadata) ? objRec.metadata : null;
    const metadataUserId = meta ? asString(meta.supabase_user_id ?? meta.user_id) : null;

    const userId = await findUserId({ customerId, subscriptionId, metadataUserId });
    if (!userId) {
      await logWebhookOutcome({ status: "ignored", reason: "user_not_found" });
      return json(200, { received: true, ignored: true, reason: "user_not_found" });
    }
    const tier = priceId ? resolveTierFromPriceId(priceId, env) : null;
    if (!tier) {
      await logWebhookOutcome({ status: "ignored", userId, reason: "unknown_price", details: { priceId } });
      return json(200, { received: true, ignored: true, reason: "unknown_price" });
    }

    const { error } = await handleSubscriptionState({
      userId,
      tier,
      customerId,
      subscriptionId,
      priceId,
      cycleStart,
      cycleEnd,
      invoiceId,
      resetUsage: true,
    });
    if (error) {
      await logWebhookOutcome({ status: "error", userId, reason: "invoice_grant_apply_failed", details: { error, invoiceId, subscriptionId } });
      await alertIfNeeded({ status: "error", userId, reason: "invoice_grant_apply_failed", details: { error, invoiceId, subscriptionId } });
      return json(500, { error: "Failed to apply invoice grant", details: error });
    }
    await logWebhookOutcome({ status: "ok", userId, reason: "invoice_grant_applied", details: { invoiceId, subscriptionId } });
    return json(200, { received: true });
  }

  if (event.type === "customer.subscription.deleted") {
    if (!objRec) return json(400, { error: "Missing event object" });
    const subParams = subscriptionObjectToParams(objRec);
    const userId = await findUserId({ customerId: subParams.customerId, subscriptionId: subParams.subscriptionId, metadataUserId: subParams.metadataUserId });
    if (!userId) {
      await logWebhookOutcome({ status: "ignored", reason: "user_not_found" });
      return json(200, { received: true, ignored: true, reason: "user_not_found" });
    }

    const { data, error } = await admin.rpc("apply_stripe_subscription_canceled", {
      p_user_id: userId,
      p_event_id: event.id,
      p_subscription_id: subParams.subscriptionId,
    });
    if (error) {
      await logWebhookOutcome({ status: "error", userId, reason: "subscription_cancel_failed", details: { error } });
      await alertIfNeeded({ status: "error", userId, reason: "subscription_cancel_failed", details: { error } });
      return json(500, { error: "Failed to cancel subscription", details: error });
    }
    await logWebhookOutcome({ status: "ok", userId, reason: "subscription_canceled" });
    return json(200, { received: true, result: data });
  }

  await logWebhookOutcome({ status: "ignored", reason: "unhandled_event_type" });
  return json(200, { received: true, ignored: true });
});
