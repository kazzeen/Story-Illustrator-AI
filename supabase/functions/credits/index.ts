import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClientLike } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, Authorization, x-client-info, apikey, content-type, x-supabase-url, x-forwarded-host, host",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonObject = Record<string, unknown>;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeHost(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const first = trimmed.split(",")[0]?.trim() ?? "";
  if (!first) return null;
  return first.replace(/:\d+$/, "").toLowerCase();
}

function supabaseUrlFromHost(host: string | null): string | null {
  const h = normalizeHost(host);
  if (!h) return null;
  if (h.endsWith(".functions.supabase.co")) {
    const ref = h.split(".")[0];
    return ref ? `https://${ref}.supabase.co` : null;
  }
  if (h.endsWith(".supabase.co")) {
    const ref = h.split(".")[0];
    return ref ? `https://${ref}.supabase.co` : null;
  }
  return null;
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.trim().match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1]?.trim() ?? "";
  return token ? token : null;
}

function deriveSupabaseUrl(req: Request): string | null {
  const fromEnv = Deno.env.get("SUPABASE_URL");
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  const fromHeader = req.headers.get("x-supabase-url") ?? req.headers.get("X-Supabase-Url");
  if (fromHeader) {
    try {
      const parsed = new URL(fromHeader.trim());
      const candidate = supabaseUrlFromHost(parsed.hostname);
      if (candidate) return candidate;
    } catch {
      void 0;
    }
  }

  const fromForwardedHost = supabaseUrlFromHost(req.headers.get("x-forwarded-host") ?? req.headers.get("X-Forwarded-Host"));
  if (fromForwardedHost) return fromForwardedHost;

  const fromHostHeader = supabaseUrlFromHost(req.headers.get("host") ?? req.headers.get("Host"));
  if (fromHostHeader) return fromHostHeader;

  try {
    const fromUrl = supabaseUrlFromHost(new URL(req.url).hostname);
    if (fromUrl) return fromUrl;
  } catch {
    void 0;
  }

  return null;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (isRecord(err) && typeof err.message === "string") return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function isMissingDbObjectError(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase();
  return (
    msg.includes("could not find the function") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("unknown function")
  );
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
  reserved_monthly?: number | null;
  bonus_credits_total: number;
  bonus_credits_used: number;
  reserved_bonus?: number | null;
}) {
  const reservedMonthly = typeof row.reserved_monthly === "number" ? row.reserved_monthly : 0;
  const reservedBonus = typeof row.reserved_bonus === "number" ? row.reserved_bonus : 0;
  const remainingMonthly = Math.max(row.monthly_credits_per_cycle - row.monthly_credits_used - reservedMonthly, 0);
  const remainingBonus = Math.max(row.bonus_credits_total - row.bonus_credits_used - reservedBonus, 0);
  return { remainingMonthly, remainingBonus };
}

type CreditsRequest =
  | { action?: "status"; limit?: number }
  | { action: "admin_adjust_bonus"; userId: string; amount: number; reason: string; metadata?: JsonObject }
  | { action: "admin_init_active_to_free_5"; dryRun?: boolean }
  | { action: "admin_reset_active_to_free_5"; dryRun?: boolean }
  | { action: "admin_verify_active_to_free_5"; sampleLimit?: number };

serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });

    const supabaseUrl = deriveSupabaseUrl(req);
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? null;
    const headerApiKey = req.headers.get("apikey") ?? req.headers.get("Apikey") ?? null;
    const supabaseAnonKey =
      Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("SUPABASE_ANON_PUBLIC_KEY") ??
      Deno.env.get("SUPABASE_PUBLIC_ANON_KEY") ??
      headerApiKey ??
      null;

    let rawBody: unknown = null;
    try {
      rawBody = await req.json();
    } catch {
      rawBody = {};
    }
    const body = (isRecord(rawBody) ? rawBody : {}) as CreditsRequest & Record<string, unknown>;
    const action = (asString(body.action) as CreditsRequest["action"] | null) ?? "status";

    if (!supabaseUrl) {
      if (action === "status") return json(200, { success: false, error: "Configuration error", details: "Could not determine SUPABASE_URL" });
      return json(500, { error: "Configuration error", details: "Could not determine SUPABASE_URL" });
    }

    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    const token = extractBearerToken(authHeader);
    if (!token) {
      if (action === "status") return json(200, { success: false, error: "Not authenticated" });
      return json(401, { error: "Missing Authorization header" });
    }

    const admin = supabaseServiceKey ? (createClient(supabaseUrl, supabaseServiceKey) as SupabaseClientLike) : null;
    const authClient = supabaseAnonKey
      ? (createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        }) as SupabaseClientLike)
      : null;

    const authResp = admin
      ? await admin.auth.getUser(token)
      : authClient
        ? await authClient.auth.getUser()
        : { data: null, error: { message: "Missing SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY" } };

    const { data: userData, error: userErr } = authResp as {
      data: unknown;
      error: unknown;
    };
    const user = (userData as { user?: { id: string } } | null)?.user ?? null;
    if (userErr || !user?.id) {
      if (action === "status") return json(200, { success: false, error: "Invalid or expired session" });
      return json(401, { error: "Invalid or expired session" });
    }

    if (action === "admin_adjust_bonus") {
      if (!admin) return json(500, { error: "Configuration error", missing: ["SUPABASE_SERVICE_ROLE_KEY"] });
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
      if (!admin) return json(500, { error: "Configuration error", missing: ["SUPABASE_SERVICE_ROLE_KEY"] });
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
      if (!admin) return json(500, { error: "Configuration error", missing: ["SUPABASE_SERVICE_ROLE_KEY"] });
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
      if (!admin) return json(500, { error: "Configuration error", missing: ["SUPABASE_SERVICE_ROLE_KEY"] });
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

    const db = admin ?? authClient;
    if (!db) {
      if (action === "status") {
        return json(200, { success: false, error: "Configuration error", missing: ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY"] });
      }
      return json(500, { error: "Configuration error", missing: ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY"] });
    }

    if (admin) {
      const { error: ensureErr } = await admin.rpc("ensure_user_credits", { p_user_id: user.id });
      if (ensureErr && !isMissingDbObjectError(ensureErr)) {
        console.warn("ensure_user_credits failed", { error: errorMessage(ensureErr) });
      }

      const { error: resetErr } = await admin.rpc("reset_user_credits_cycle", { p_user_id: user.id });
      if (resetErr && !isMissingDbObjectError(resetErr)) {
        console.warn("reset_user_credits_cycle failed", { error: errorMessage(resetErr) });
      }
    }

    const { data: credits, error: creditsErr } = await db.from("user_credits").select("*").eq("user_id", user.id).maybeSingle();

    const creditsRecord = credits && typeof credits === "object" ? (credits as Record<string, unknown>) : null;
    const canComputeRemaining =
      !!creditsRecord &&
      typeof creditsRecord.monthly_credits_per_cycle === "number" &&
      typeof creditsRecord.monthly_credits_used === "number" &&
      typeof creditsRecord.bonus_credits_total === "number" &&
      typeof creditsRecord.bonus_credits_used === "number";

    const remaining = canComputeRemaining
      ? computeRemaining(creditsRecord as unknown as {
          monthly_credits_per_cycle: number;
          monthly_credits_used: number;
          reserved_monthly?: number | null;
          bonus_credits_total: number;
          bonus_credits_used: number;
          reserved_bonus?: number | null;
        })
      : null;

    const { data: transactions, error: txErr } = await db
      .from("credit_transactions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    const nonFatalErrors: Record<string, unknown> = {};
    if (creditsErr && !isMissingDbObjectError(creditsErr)) nonFatalErrors.credits = creditsErr;
    if (txErr && !isMissingDbObjectError(txErr)) nonFatalErrors.transactions = txErr;

    return json(200, {
      success: true,
      credits:
        credits && remaining
          ? {
              ...(credits as Record<string, unknown>),
              remaining_monthly: remaining.remainingMonthly,
              remaining_bonus: remaining.remainingBonus,
            }
          : credits ?? null,
      transactions: transactions ?? [],
      ...(Object.keys(nonFatalErrors).length > 0 ? { non_fatal_errors: nonFatalErrors } : {}),
    });
  } catch (e) {
    console.error("credits function failed", { error: errorMessage(e) });
    return json(500, { error: "Unexpected error", details: errorMessage(e) });
  }
});
