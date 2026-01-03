import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

function asInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function computeRemaining(row: {
  monthly_credits_per_cycle: number;
  monthly_credits_used: number;
  bonus_credits_total: number;
  bonus_credits_used: number;
}) {
  const remainingMonthly = Math.max(row.monthly_credits_per_cycle - row.monthly_credits_used, 0);
  const remainingBonus = Math.max(row.bonus_credits_total - row.bonus_credits_used, 0);
  return { remainingMonthly, remainingBonus };
}

type CreditsRequest =
  | { action?: "status"; limit?: number }
  | { action: "admin_adjust_bonus"; userId: string; amount: number; reason: string; metadata?: JsonObject }
  | { action: "admin_init_active_to_free_5"; dryRun?: boolean }
  | { action: "admin_reset_active_to_free_5"; dryRun?: boolean }
  | { action: "admin_verify_active_to_free_5"; sampleLimit?: number };

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) return json(500, { error: "Configuration error" });

  const admin = createClient(supabaseUrl, supabaseServiceKey);

  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Missing Authorization header" });
  const token = authHeader.slice("Bearer ".length);

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) return json(401, { error: "Invalid or expired session" });

  let rawBody: unknown = null;
  try {
    rawBody = await req.json();
  } catch {
    rawBody = {};
  }
  const body = (isRecord(rawBody) ? rawBody : {}) as CreditsRequest & Record<string, unknown>;
  const action = (asString(body.action) as CreditsRequest["action"] | null) ?? "status";

  if (action === "admin_adjust_bonus") {
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileErr) return json(500, { error: "Failed to verify admin" });
    if (!profile?.is_admin) return json(403, { error: "Admin access required" });

    const targetUserId = asString(body.userId);
    const amount = asInt(body.amount);
    const reason = asString(body.reason);
    const metadata = isRecord(body.metadata) ? body.metadata : {};
    if (!targetUserId || amount === null || !reason) return json(400, { error: "userId, amount, and reason are required" });

    const { data: adjusted, error: adjErr } = await admin.rpc("admin_adjust_bonus_credits", {
      p_user_id: targetUserId,
      p_amount: amount,
      p_reason: reason,
      p_metadata: metadata,
      p_created_by: user.id,
    });
    if (adjErr) return json(500, { error: "Failed to adjust credits", details: adjErr });

    return json(200, { success: true, result: adjusted });
  }

  if (action === "admin_reset_active_to_free_5") {
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileErr) return json(500, { error: "Failed to verify admin" });
    if (!profile?.is_admin) return json(403, { error: "Admin access required" });

    const dryRun = typeof body.dryRun === "boolean" ? body.dryRun : true;

    const { data: result, error: resetErr } = await admin.rpc("admin_reset_active_accounts_to_free_5", {
      p_dry_run: dryRun,
      p_created_by: user.id,
    });

    if (resetErr) return json(500, { error: "Failed to reset credits", details: resetErr });
    return json(200, { success: true, result });
  }

  if (action === "admin_init_active_to_free_5") {
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileErr) return json(500, { error: "Failed to verify admin" });
    if (!profile?.is_admin) return json(403, { error: "Admin access required" });

    const dryRun = typeof body.dryRun === "boolean" ? body.dryRun : true;

    const { data: result, error: initErr } = await admin.rpc("admin_init_active_accounts_free_5", {
      p_dry_run: dryRun,
      p_created_by: user.id,
    });

    if (initErr) return json(500, { error: "Failed to initialize credits", details: initErr });
    return json(200, { success: true, result });
  }

  if (action === "admin_verify_active_to_free_5") {
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileErr) return json(500, { error: "Failed to verify admin" });
    if (!profile?.is_admin) return json(403, { error: "Admin access required" });

    const sampleLimit = asInt(body.sampleLimit);
    const limit = Math.min(Math.max(sampleLimit ?? 50, 0), 200);

    const { data: result, error: verifyErr } = await admin.rpc("admin_verify_active_accounts_free_5", {
      p_sample_limit: limit,
    });

    if (verifyErr) return json(500, { error: "Failed to verify credits", details: verifyErr });

    const mismatchCount =
      result && typeof result === "object" && "mismatch_count" in (result as Record<string, unknown>)
        ? Number((result as Record<string, unknown>).mismatch_count)
        : NaN;
    const missingCount =
      result && typeof result === "object" && "missing_count" in (result as Record<string, unknown>)
        ? Number((result as Record<string, unknown>).missing_count)
        : NaN;
    if ((Number.isFinite(mismatchCount) && mismatchCount > 0) || (Number.isFinite(missingCount) && missingCount > 0)) {
      console.warn("Active accounts not fully reset to 5 credits", { mismatchCount, missingCount, result });
    }

    return json(200, { success: true, result });
  }

  const limitRaw = asInt(body.limit);
  const limit = Math.min(Math.max(limitRaw ?? 50, 1), 200);

  const { error: ensureErr } = await admin.rpc("ensure_user_credits", { p_user_id: user.id });
  if (ensureErr) return json(500, { error: "Failed to initialize credits" });

  const { error: resetErr } = await admin.rpc("reset_user_credits_cycle", { p_user_id: user.id });
  if (resetErr) return json(500, { error: "Failed to refresh credit cycle" });

  const { data: credits, error: creditsErr } = await admin
    .from("user_credits")
    .select(
      "user_id,tier,monthly_credits_per_cycle,monthly_credits_used,bonus_credits_total,bonus_credits_used,cycle_start_at,cycle_end_at,cycle_source,stripe_customer_id,stripe_subscription_id,stripe_price_id",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (creditsErr) return json(500, { error: "Failed to fetch credits", details: creditsErr });
  if (!credits) return json(404, { error: "Credit account not found" });

  const remaining = computeRemaining(credits as unknown as {
    monthly_credits_per_cycle: number;
    monthly_credits_used: number;
    bonus_credits_total: number;
    bonus_credits_used: number;
  });

  const { data: transactions, error: txErr } = await admin
    .from("credit_transactions")
    .select("id,amount,transaction_type,description,metadata,pool,created_at,request_id,stripe_event_id,stripe_invoice_id,stripe_subscription_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (txErr) return json(500, { error: "Failed to fetch transactions", details: txErr });

  return json(200, {
    success: true,
    credits: {
      ...credits,
      remaining_monthly: remaining.remainingMonthly,
      remaining_bonus: remaining.remainingBonus,
    },
    transactions: transactions ?? [],
  });
});
