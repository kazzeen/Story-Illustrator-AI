import { createClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

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
      .select("user_id,tier,monthly_credits_per_cycle,monthly_credits_used,bonus_credits_total,bonus_credits_used")
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
  return { userId, email };
}

async function deleteTestUser(supabase: SupabaseClient, userId: string) {
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) throw error;
}

describe("credits initialization (integration)", () => {
  const supabase: SupabaseClient | null = enabled
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

  test.skipIf(!enabled)("new accounts receive 5 credits upon creation", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      const credits = await waitForUserCredits(supabase, userId);
      expect(credits.tier).toBe("basic");
      expect(credits.monthly_credits_per_cycle).toBe(5);
      expect(credits.monthly_credits_used).toBe(0);
      expect(credits.bonus_credits_total).toBe(0);
      expect(credits.bonus_credits_used).toBe(0);
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });

  test.skipIf(!enabled)("active accounts without credits are initialized", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      await waitForUserCredits(supabase, userId);
      const { error: delErr } = await supabase.from("user_credits").delete().eq("user_id", userId);
      if (delErr) throw delErr;

      const { error: initErr } = await rpc(supabase, "admin_init_active_accounts_free_5", {
        p_dry_run: false,
        p_created_by: null,
      });
      if (initErr) throw initErr;

      const credits = await waitForUserCredits(supabase, userId);
      expect(credits.tier).toBe("basic");
      expect(credits.monthly_credits_per_cycle).toBe(5);
      expect(credits.monthly_credits_used).toBe(0);
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });

  test.skipIf(!enabled)("system does not reinitialize accounts that already have credits", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      await waitForUserCredits(supabase, userId);

      const { data: consumed, error: consumeErr } = await rpc(supabase, "consume_credits", {
        p_user_id: userId,
        p_amount: 1,
        p_description: "integration_test_spend",
        p_metadata: {},
        p_request_id: null,
      });
      if (consumeErr) throw consumeErr;
      if (!consumed || typeof consumed !== "object" || !("ok" in (consumed as Record<string, unknown>))) {
        throw new Error("Unexpected consume_credits response");
      }
      if ((consumed as Record<string, unknown>).ok !== true) throw new Error("consume_credits did not succeed");

      const before = await waitForUserCredits(supabase, userId);

      const { error: initErr } = await rpc(supabase, "admin_init_active_accounts_free_5", {
        p_dry_run: false,
        p_created_by: null,
      });
      if (initErr) throw initErr;

      const after = await waitForUserCredits(supabase, userId);
      expect(after.monthly_credits_used).toBe(before.monthly_credits_used);
      expect(after.monthly_credits_per_cycle).toBe(5);
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });

  test.skipIf(!enabled)("consume_credits blocks when insufficient and does not go negative", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      await waitForUserCredits(supabase, userId);

      const requestIds = Array.from({ length: 6 }, () => crypto.randomUUID());
      const results: Record<string, unknown>[] = [];

      for (const requestId of requestIds) {
        const { data, error } = await rpc(supabase, "consume_credits", {
          p_user_id: userId,
          p_amount: 1,
          p_description: "integration_test_character_image",
          p_metadata: { feature: "generate-character-reference" },
          p_request_id: requestId,
        });
        if (error) throw error;
        if (!data || typeof data !== "object") throw new Error("Unexpected consume_credits response");
        results.push(data as Record<string, unknown>);
      }

      const oks = results.filter((r) => r.ok === true).length;
      const fails = results.filter((r) => r.ok === false).length;
      expect(oks).toBe(5);
      expect(fails).toBe(1);
      const fail = results.find((r) => r.ok === false) ?? null;
      if (fail) expect(fail.reason).toBe("insufficient_credits");

      const after = await waitForUserCredits(supabase, userId);
      expect(after.monthly_credits_used).toBe(5);
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });

  test.skipIf(!enabled)("consume_credits updates profiles.credits_balance via sync trigger", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      await waitForUserCredits(supabase, userId);

      const requestId = crypto.randomUUID();
      const { data, error } = await rpc(supabase, "consume_credits", {
        p_user_id: userId,
        p_amount: 1,
        p_description: "integration_test_profile_sync",
        p_metadata: { feature: "credits-profile-sync" },
        p_request_id: requestId,
      });
      if (error) throw error;
      if (!data || typeof data !== "object") throw new Error("Unexpected consume_credits response");
      expect((data as Record<string, unknown>).ok).toBe(true);

      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("credits_balance,subscription_tier")
        .eq("user_id", userId)
        .maybeSingle();
      if (profileErr) throw profileErr;
      if (!profile || typeof profile !== "object") throw new Error("Missing profile row");

      expect((profile as Record<string, unknown>).credits_balance).toBe(4);
      expect((profile as Record<string, unknown>).subscription_tier).toBe("free");
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });

  test.skipIf(!enabled)("consume_credits respects reserved credits", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      await waitForUserCredits(supabase, userId);

      const reservationId = crypto.randomUUID();
      const { data: reserved, error: reserveErr } = await rpc(supabase, "reserve_credits", {
        p_user_id: userId,
        p_amount: 5,
        p_description: "integration_test_reservation",
        p_metadata: { feature: "generate-scene-image" },
        p_request_id: reservationId,
      });
      if (reserveErr) throw reserveErr;
      if (!reserved || typeof reserved !== "object") throw new Error("Unexpected reserve_credits response");
      expect((reserved as Record<string, unknown>).ok).toBe(true);

      const requestId = crypto.randomUUID();
      const { data: consumed, error: consumeErr } = await rpc(supabase, "consume_credits", {
        p_user_id: userId,
        p_amount: 1,
        p_description: "integration_test_should_fail_due_to_reservation",
        p_metadata: { feature: "reservation-block" },
        p_request_id: requestId,
      });
      if (consumeErr) throw consumeErr;
      if (!consumed || typeof consumed !== "object") throw new Error("Unexpected consume_credits response");
      expect((consumed as Record<string, unknown>).ok).toBe(false);
      expect((consumed as Record<string, unknown>).reason).toBe("insufficient_credits");

      const { data: released, error: releaseErr } = await rpc(supabase, "release_reserved_credits", {
        p_user_id: userId,
        p_request_id: reservationId,
        p_reason: "integration_test_release",
        p_metadata: { feature: "reservation-release" },
      });
      if (releaseErr) throw releaseErr;
      if (!released || typeof released !== "object") throw new Error("Unexpected release_reserved_credits response");
      expect((released as Record<string, unknown>).ok).toBe(true);

      const requestId2 = crypto.randomUUID();
      const { data: consumed2, error: consumeErr2 } = await rpc(supabase, "consume_credits", {
        p_user_id: userId,
        p_amount: 1,
        p_description: "integration_test_after_release",
        p_metadata: { feature: "reservation-release" },
        p_request_id: requestId2,
      });
      if (consumeErr2) throw consumeErr2;
      if (!consumed2 || typeof consumed2 !== "object") throw new Error("Unexpected consume_credits response");
      expect((consumed2 as Record<string, unknown>).ok).toBe(true);
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });

  test.skipIf(!enabled)("refund_consumed_credits returns credits and is idempotent", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      await waitForUserCredits(supabase, userId);

      const requestId = crypto.randomUUID();
      const { data: consume, error: consumeErr } = await rpc(supabase, "consume_credits", {
        p_user_id: userId,
        p_amount: 1,
        p_description: "integration_test_character_image",
        p_metadata: { feature: "generate-character-reference" },
        p_request_id: requestId,
      });
      if (consumeErr) throw consumeErr;
      if (!consume || typeof consume !== "object" || (consume as Record<string, unknown>).ok !== true) {
        throw new Error("consume_credits did not succeed");
      }

      const usedAfterConsume = await waitForUserCredits(supabase, userId);
      expect(usedAfterConsume.monthly_credits_used).toBe(1);

      const { data: refund1, error: refundErr1 } = await rpc(supabase, "refund_consumed_credits", {
        p_user_id: userId,
        p_request_id: requestId,
        p_reason: "integration_test_refund",
        p_metadata: { feature: "generate-character-reference" },
      });
      if (refundErr1) throw refundErr1;
      if (!refund1 || typeof refund1 !== "object") throw new Error("Unexpected refund_consumed_credits response");
      expect((refund1 as Record<string, unknown>).ok).toBe(true);

      const usedAfterRefund = await waitForUserCredits(supabase, userId);
      expect(usedAfterRefund.monthly_credits_used).toBe(0);

      const { data: refund2, error: refundErr2 } = await rpc(supabase, "refund_consumed_credits", {
        p_user_id: userId,
        p_request_id: requestId,
        p_reason: "integration_test_refund",
        p_metadata: { feature: "generate-character-reference" },
      });
      if (refundErr2) throw refundErr2;
      if (!refund2 || typeof refund2 !== "object") throw new Error("Unexpected refund_consumed_credits response");
      expect((refund2 as Record<string, unknown>).ok).toBe(true);
      expect((refund2 as Record<string, unknown>).already_refunded).toBe(true);

      const { data: tx, error: txErr } = await supabase
        .from("credit_transactions")
        .select("id,transaction_type,pool,amount,request_id")
        .eq("user_id", userId)
        .eq("request_id", requestId);
      if (txErr) throw txErr;
      const rows = (Array.isArray(tx) ? tx : []) as Array<Record<string, unknown>>;
      const refundRows = rows.filter((r) => r.transaction_type === "refund");
      expect(refundRows.length).toBeGreaterThanOrEqual(1);
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });

  test.skipIf(!enabled)("consume_credits is idempotent for the same request_id", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      await waitForUserCredits(supabase, userId);

      const requestId = crypto.randomUUID();
      const { data: first, error: firstErr } = await rpc(supabase, "consume_credits", {
        p_user_id: userId,
        p_amount: 1,
        p_description: "integration_test_idempotent_spend",
        p_metadata: { feature: "idempotency-test" },
        p_request_id: requestId,
      });
      if (firstErr) throw firstErr;
      if (!first || typeof first !== "object" || (first as Record<string, unknown>).ok !== true) {
        throw new Error("consume_credits did not succeed");
      }

      const usedAfterFirst = await waitForUserCredits(supabase, userId);
      expect(usedAfterFirst.monthly_credits_used).toBe(1);

      const { data: second, error: secondErr } = await rpc(supabase, "consume_credits", {
        p_user_id: userId,
        p_amount: 1,
        p_description: "integration_test_idempotent_spend",
        p_metadata: { feature: "idempotency-test" },
        p_request_id: requestId,
      });
      if (secondErr) throw secondErr;
      if (!second || typeof second !== "object" || (second as Record<string, unknown>).ok !== true) {
        throw new Error("consume_credits did not succeed on retry");
      }

      const usedAfterSecond = await waitForUserCredits(supabase, userId);
      expect(usedAfterSecond.monthly_credits_used).toBe(1);
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });

  test.skipIf(!enabled)("consume_credits is safe under concurrent requests", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      await waitForUserCredits(supabase, userId);

      const requestIds = Array.from({ length: 6 }, () => crypto.randomUUID());
      const calls = requestIds.map((requestId) =>
        rpc(supabase, "consume_credits", {
          p_user_id: userId,
          p_amount: 1,
          p_description: "integration_test_concurrent_spend",
          p_metadata: { feature: "generate-character-reference" },
          p_request_id: requestId,
        }),
      );
      const settled = await Promise.all(calls);

      const parsed = settled.map(({ data, error }) => {
        if (error) throw error;
        if (!data || typeof data !== "object") throw new Error("Unexpected consume_credits response");
        return data as Record<string, unknown>;
      });

      const oks = parsed.filter((r) => r.ok === true).length;
      const fails = parsed.filter((r) => r.ok === false).length;
      expect(oks).toBe(5);
      expect(fails).toBe(1);

      const after = await waitForUserCredits(supabase, userId);
      expect(after.monthly_credits_used).toBe(5);
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });

  test.skipIf(!enabled)("apply_stripe_subscription_state grants correct tier credits and bonuses", async () => {
    if (!supabase) throw new Error("Test client not initialized");

    const tiers: Array<{ tier: "starter" | "creator" | "professional"; perCycle: number; bonus: number }> = [
      { tier: "starter", perCycle: 100, bonus: 20 },
      { tier: "creator", perCycle: 300, bonus: 100 },
      { tier: "professional", perCycle: 1000, bonus: 0 },
    ];

    for (const entry of tiers) {
      const { userId } = await createTestUser(supabase);
      try {
        await waitForUserCredits(supabase, userId);

        const now = new Date();
        const cycleStart = now.toISOString();
        const cycleEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const eventId = `evt_${crypto.randomUUID().replace(/-/g, "")}`;
        const invoiceId = `in_${crypto.randomUUID().replace(/-/g, "")}`;
        const subscriptionId = `sub_${crypto.randomUUID().replace(/-/g, "")}`;
        const customerId = `cus_${crypto.randomUUID().replace(/-/g, "")}`;
        const priceId = `price_${crypto.randomUUID().replace(/-/g, "")}`;

        const { data, error } = await rpc(supabase, "apply_stripe_subscription_state", {
          p_user_id: userId,
          p_tier: entry.tier,
          p_customer_id: customerId,
          p_subscription_id: subscriptionId,
          p_price_id: priceId,
          p_cycle_start: cycleStart,
          p_cycle_end: cycleEnd,
          p_event_id: eventId,
          p_invoice_id: invoiceId,
          p_reset_usage: true,
        });
        if (error) throw error;
        if (!data || typeof data !== "object") throw new Error("Unexpected apply_stripe_subscription_state response");
        expect((data as Record<string, unknown>).ok).toBe(true);
        expect((data as Record<string, unknown>).remaining_monthly).toBe(entry.perCycle);
        expect((data as Record<string, unknown>).remaining_bonus).toBe(entry.bonus);

        const credits = await waitForUserCredits(supabase, userId);
        expect(credits.tier).toBe(entry.tier);
        expect(credits.monthly_credits_per_cycle).toBe(entry.perCycle);
        expect(credits.monthly_credits_used).toBe(0);

        const { data: tx, error: txErr } = await supabase
          .from("credit_transactions")
          .select("transaction_type,pool,amount,stripe_event_id,stripe_invoice_id,stripe_subscription_id")
          .eq("user_id", userId)
          .eq("stripe_event_id", eventId);
        if (txErr) throw txErr;
        const rows = (Array.isArray(tx) ? tx : []) as Array<Record<string, unknown>>;

        const grant = rows.find((r) => r.transaction_type === "subscription_grant" && r.pool === "monthly") ?? null;
        expect(grant).not.toBeNull();
        if (grant) {
          expect(grant.amount).toBe(entry.perCycle);
          expect(grant.stripe_invoice_id).toBe(invoiceId);
          expect(grant.stripe_subscription_id).toBe(subscriptionId);
        }

        const bonusRows = rows.filter((r) => r.transaction_type === "bonus" && r.pool === "bonus");
        if (entry.bonus > 0) {
          expect(bonusRows.length).toBe(1);
          expect(bonusRows[0]?.amount).toBe(entry.bonus);
        } else {
          expect(bonusRows.length).toBe(0);
        }
      } finally {
        await deleteTestUser(supabase, userId);
      }
    }
  });
});

describe("credits tier mapping (migration contract)", () => {
  test("subscription tiers have correct monthly credit amounts", () => {
    const file = path.resolve(process.cwd(), "supabase", "migrations", "20260104090000_fix_subscription_tier_credit_amounts.sql");
    const sql = readFileSync(file, "utf8");
    expect(sql).toContain("WHEN 'starter' THEN 100");
    expect(sql).toContain("WHEN 'creator' THEN 300");
    expect(sql).toContain("WHEN 'professional' THEN 1000");
  });
});
