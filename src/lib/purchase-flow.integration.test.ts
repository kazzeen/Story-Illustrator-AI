import { createClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";
import crypto from "node:crypto";

const supabaseUrl = process.env.SUPABASE_TEST_URL ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const enabled = Boolean(supabaseUrl && serviceRoleKey);

type SupabaseClient = ReturnType<typeof createClient>;
type RpcResult = { data: unknown; error: unknown };
type RpcClientLike = { rpc: (fn: string, args?: Record<string, unknown>) => Promise<RpcResult> };

function rpc(supabase: SupabaseClient, fn: string, args?: Record<string, unknown>) {
  return (supabase as unknown as RpcClientLike).rpc(fn, args);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUserCredits(supabase: SupabaseClient, userId: string, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data, error } = await supabase
      .from("user_credits")
      .select("user_id,tier,monthly_credits_per_cycle,monthly_credits_used,bonus_credits_total,bonus_credits_used,bonus_granted")
      .eq("user_id", userId)
      .maybeSingle();
    if (!error && data) return data as Record<string, unknown>;
    await sleep(250);
  }
  throw new Error("Timed out waiting for user_credits");
}

async function createTestUser(supabase: SupabaseClient) {
  const email = `test-${crypto.randomUUID()}@example.com`;
  const password = `pw-${crypto.randomUUID()}`;
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error("Missing created user id");
  return { userId };
}

async function deleteTestUser(supabase: SupabaseClient, userId: string) {
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) throw error;
}

async function waitForProfile(supabase: SupabaseClient, userId: string, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data, error } = await supabase.from("profiles").select("user_id,subscription_status").eq("user_id", userId).maybeSingle();
    if (!error && data) return data as Record<string, unknown>;
    await sleep(250);
  }
  throw new Error("Timed out waiting for profile");
}

describe("purchase flow (integration)", () => {
  const supabase: SupabaseClient | null = enabled
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

  test.skipIf(!enabled)("applies Starter plan credits and first-time bonus", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      await waitForUserCredits(supabase, userId);
      const now = new Date();
      const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const { error } = await rpc(supabase, "apply_stripe_subscription_state", {
        p_user_id: userId,
        p_tier: "starter",
        p_customer_id: "cus_test",
        p_subscription_id: "sub_test",
        p_price_id: "price_test",
        p_cycle_start: now.toISOString(),
        p_cycle_end: end.toISOString(),
        p_event_id: `evt_${crypto.randomUUID()}`,
        p_invoice_id: `in_${crypto.randomUUID()}`,
        p_reset_usage: true,
      });
      if (error) throw error;

      const credits = await waitForUserCredits(supabase, userId);
      expect(credits.tier).toBe("starter");
      expect(credits.monthly_credits_per_cycle).toBe(100);
      expect(credits.bonus_credits_total).toBe(20);
      expect(credits.bonus_granted).toBe(true);
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });

  test.skipIf(!enabled)("applies Creator plan credits and first-time bonus", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      await waitForUserCredits(supabase, userId);
      const now = new Date();
      const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const { error } = await rpc(supabase, "apply_stripe_subscription_state", {
        p_user_id: userId,
        p_tier: "creator",
        p_customer_id: "cus_test",
        p_subscription_id: "sub_test",
        p_price_id: "price_test",
        p_cycle_start: now.toISOString(),
        p_cycle_end: end.toISOString(),
        p_event_id: `evt_${crypto.randomUUID()}`,
        p_invoice_id: `in_${crypto.randomUUID()}`,
        p_reset_usage: true,
      });
      if (error) throw error;

      const credits = await waitForUserCredits(supabase, userId);
      expect(credits.tier).toBe("creator");
      expect(credits.monthly_credits_per_cycle).toBe(300);
      expect(credits.bonus_credits_total).toBe(100);
      expect(credits.bonus_granted).toBe(true);
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });

  test.skipIf(!enabled)("applies Pro plan credits without first-time bonus", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      await waitForUserCredits(supabase, userId);
      const now = new Date();
      const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const { error } = await rpc(supabase, "apply_stripe_subscription_state", {
        p_user_id: userId,
        p_tier: "professional",
        p_customer_id: "cus_test",
        p_subscription_id: "sub_test",
        p_price_id: "price_test",
        p_cycle_start: now.toISOString(),
        p_cycle_end: end.toISOString(),
        p_event_id: `evt_${crypto.randomUUID()}`,
        p_invoice_id: `in_${crypto.randomUUID()}`,
        p_reset_usage: true,
      });
      if (error) throw error;

      const credits = await waitForUserCredits(supabase, userId);
      expect(credits.tier).toBe("professional");
      expect(credits.monthly_credits_per_cycle).toBe(1000);
      expect(credits.bonus_credits_total).toBe(0);
      expect(credits.bonus_granted).toBe(false);
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });

  test.skipIf(!enabled)("applies Stripe credit pack purchase idempotently", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      await waitForUserCredits(supabase, userId);
      const sessionId = `cs_${crypto.randomUUID()}`;
      const paymentIntent = `pi_${crypto.randomUUID()}`;

      const { data: first, error: firstErr } = await rpc(supabase, "admin_apply_stripe_credit_pack_purchase", {
        p_user_id: userId,
        p_amount: 50,
        p_event_id: `evt_${crypto.randomUUID()}`,
        p_checkout_session_id: sessionId,
        p_payment_intent_id: paymentIntent,
        p_customer_id: "cus_test",
        p_price_id: "price_test",
        p_pack: "small",
      });
      if (firstErr) throw firstErr;
      if (!first || typeof first !== "object") throw new Error("Unexpected response for first purchase");
      expect((first as Record<string, unknown>).ok).toBe(true);
      expect((first as Record<string, unknown>).already_applied).toBe(false);

      const afterFirst = await waitForUserCredits(supabase, userId);
      expect(afterFirst.bonus_credits_total).toBe(50);

      const { data: second, error: secondErr } = await rpc(supabase, "admin_apply_stripe_credit_pack_purchase", {
        p_user_id: userId,
        p_amount: 50,
        p_event_id: `evt_${crypto.randomUUID()}`,
        p_checkout_session_id: sessionId,
        p_payment_intent_id: paymentIntent,
        p_customer_id: "cus_test",
        p_price_id: "price_test",
        p_pack: "small",
      });
      if (secondErr) throw secondErr;
      if (!second || typeof second !== "object") throw new Error("Unexpected response for second purchase");
      expect((second as Record<string, unknown>).ok).toBe(true);
      expect((second as Record<string, unknown>).already_applied).toBe(true);

      const afterSecond = await waitForUserCredits(supabase, userId);
      expect(afterSecond.bonus_credits_total).toBe(50);
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });

  test.skipIf(!enabled)("records Stripe webhook event ids uniquely", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const eventId = `evt_test_${crypto.randomUUID().replace(/-/g, "")}`;
    try {
      const { error: firstErr } = await supabase.from("stripe_webhook_events").insert({ event_id: eventId });
      if (firstErr) throw firstErr;

      const { error: secondErr } = await supabase.from("stripe_webhook_events").insert({ event_id: eventId });
      expect(secondErr).toBeTruthy();
    } finally {
      await supabase.from("stripe_webhook_events").delete().eq("event_id", eventId);
    }
  });

  test.skipIf(!enabled)("allows service role to update profile subscription_status", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      await waitForProfile(supabase, userId);
      const { error: updErr } = await supabase.from("profiles").update({ subscription_status: "past_due" }).eq("user_id", userId);
      if (updErr) throw updErr;
      const profile = await waitForProfile(supabase, userId);
      expect(profile.subscription_status).toBe("past_due");
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });
});

