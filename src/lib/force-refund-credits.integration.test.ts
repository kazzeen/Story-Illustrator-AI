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
      .select("user_id,tier,monthly_credits_per_cycle,monthly_credits_used,bonus_credits_total,bonus_credits_used,reserved_monthly,reserved_bonus")
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
  await supabase.from("credit_transactions").delete().eq("user_id", userId);
  await supabase.from("credit_reservations").delete().eq("user_id", userId);
  await supabase.from("user_credits").delete().eq("user_id", userId);
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) throw error;
}

function asRecord(val: unknown): Record<string, unknown> {
  if (val && typeof val === "object" && !Array.isArray(val)) return val as Record<string, unknown>;
  throw new Error(`Expected record, got: ${JSON.stringify(val)}`);
}

describe("force_refund_credits (integration)", () => {
  const supabase: SupabaseClient | null = enabled
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

  test.skipIf(!enabled)("reserve then force_refund restores credits (reserved state)", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      const before = await waitForUserCredits(supabase, userId);
      const requestId = crypto.randomUUID();

      // Reserve 1 credit
      const { data: reserveData, error: reserveErr } = await rpc(supabase, "reserve_credits", {
        p_user_id: userId,
        p_request_id: requestId,
        p_amount: 1,
        p_feature: "test_scene_generation",
        p_metadata: {},
      });
      expect(reserveErr).toBeNull();
      const reserve = asRecord(reserveData);
      expect(reserve.ok).toBe(true);

      // Verify credits are reserved
      const during = await waitForUserCredits(supabase, userId);
      expect(during.reserved_monthly).toBeGreaterThanOrEqual(1);

      // Force refund
      const { data: refundData, error: refundErr } = await rpc(supabase, "force_refund_credits", {
        p_user_id: userId,
        p_request_id: requestId,
        p_reason: "image_generation_failed",
        p_metadata: { stage: "upstream_generation" },
      });
      expect(refundErr).toBeNull();
      const refund = asRecord(refundData);
      expect(refund.ok).toBe(true);

      // Verify credits are fully restored
      const after = await waitForUserCredits(supabase, userId);
      expect(after.monthly_credits_used).toBe(before.monthly_credits_used);
      expect(after.bonus_credits_used).toBe(before.bonus_credits_used);
      expect(after.reserved_monthly).toBe(before.reserved_monthly);
      expect(after.reserved_bonus).toBe(before.reserved_bonus);
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });

  test.skipIf(!enabled)("reserve, commit, then force_refund restores credits (committed state)", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      const before = await waitForUserCredits(supabase, userId);
      const requestId = crypto.randomUUID();

      // Reserve
      const { data: reserveData, error: reserveErr } = await rpc(supabase, "reserve_credits", {
        p_user_id: userId,
        p_request_id: requestId,
        p_amount: 1,
        p_feature: "test_scene_generation",
        p_metadata: {},
      });
      expect(reserveErr).toBeNull();
      expect(asRecord(reserveData).ok).toBe(true);

      // Commit (simulates successful image generation)
      const { data: commitData, error: commitErr } = await rpc(supabase, "commit_reserved_credits", {
        p_user_id: userId,
        p_request_id: requestId,
        p_metadata: { scene_id: "test-scene" },
      });
      expect(commitErr).toBeNull();
      expect(asRecord(commitData).ok).toBe(true);

      // Verify credits were consumed
      const during = await waitForUserCredits(supabase, userId);
      expect(Number(during.monthly_credits_used) + Number(during.bonus_credits_used))
        .toBeGreaterThan(Number(before.monthly_credits_used) + Number(before.bonus_credits_used));

      // Force refund (e.g., post-commit failure discovered)
      const { data: refundData, error: refundErr } = await rpc(supabase, "force_refund_credits", {
        p_user_id: userId,
        p_request_id: requestId,
        p_reason: "post_commit_failure",
        p_metadata: { stage: "scene_update" },
      });
      expect(refundErr).toBeNull();
      expect(asRecord(refundData).ok).toBe(true);

      // Verify credits fully restored
      const after = await waitForUserCredits(supabase, userId);
      expect(after.monthly_credits_used).toBe(before.monthly_credits_used);
      expect(after.bonus_credits_used).toBe(before.bonus_credits_used);
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });

  test.skipIf(!enabled)("force_refund is idempotent (double call is safe)", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      const before = await waitForUserCredits(supabase, userId);
      const requestId = crypto.randomUUID();

      // Reserve
      const { data: reserveData, error: reserveErr } = await rpc(supabase, "reserve_credits", {
        p_user_id: userId,
        p_request_id: requestId,
        p_amount: 1,
        p_feature: "test_idempotent",
        p_metadata: {},
      });
      expect(reserveErr).toBeNull();
      expect(asRecord(reserveData).ok).toBe(true);

      // First refund
      const { data: refund1Data, error: refund1Err } = await rpc(supabase, "force_refund_credits", {
        p_user_id: userId,
        p_request_id: requestId,
        p_reason: "first_refund",
        p_metadata: {},
      });
      expect(refund1Err).toBeNull();
      expect(asRecord(refund1Data).ok).toBe(true);

      // Second refund (should still succeed, not double-refund)
      const { data: refund2Data, error: refund2Err } = await rpc(supabase, "force_refund_credits", {
        p_user_id: userId,
        p_request_id: requestId,
        p_reason: "second_refund",
        p_metadata: {},
      });
      expect(refund2Err).toBeNull();
      expect(asRecord(refund2Data).ok).toBe(true);

      // Credits unchanged from original
      const after = await waitForUserCredits(supabase, userId);
      expect(after.monthly_credits_used).toBe(before.monthly_credits_used);
      expect(after.bonus_credits_used).toBe(before.bonus_credits_used);
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });

  test.skipIf(!enabled)("force_refund with no reservation returns nothing_to_refund", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      const requestId = crypto.randomUUID();

      const { data, error } = await rpc(supabase, "force_refund_credits", {
        p_user_id: userId,
        p_request_id: requestId,
        p_reason: "no_reservation_test",
        p_metadata: {},
      });
      expect(error).toBeNull();
      const result = asRecord(data);
      expect(result.ok).toBe(true);
      expect(result.reason).toBe("nothing_to_refund");
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });

  test.skipIf(!enabled)("insufficient credits are not deducted on failed reservation", async () => {
    if (!supabase) throw new Error("Test client not initialized");
    const { userId } = await createTestUser(supabase);
    try {
      const before = await waitForUserCredits(supabase, userId);
      const requestId = crypto.randomUUID();

      // Try to reserve more credits than available (basic tier has 5)
      const { data: reserveData, error: reserveErr } = await rpc(supabase, "reserve_credits", {
        p_user_id: userId,
        p_request_id: requestId,
        p_amount: 999,
        p_feature: "test_insufficient",
        p_metadata: {},
      });
      expect(reserveErr).toBeNull();
      const reserve = asRecord(reserveData);
      expect(reserve.ok).toBe(false);
      expect(reserve.reason).toBe("insufficient_credits");

      // Credits should be completely unchanged
      const after = await waitForUserCredits(supabase, userId);
      expect(after.monthly_credits_used).toBe(before.monthly_credits_used);
      expect(after.bonus_credits_used).toBe(before.bonus_credits_used);
      expect(after.reserved_monthly).toBe(before.reserved_monthly);
      expect(after.reserved_bonus).toBe(before.reserved_bonus);
    } finally {
      await deleteTestUser(supabase, userId);
    }
  });
});
