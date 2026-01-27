import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function normalizeUrl(input) {
  const raw = String(input ?? "").trim().replace(/\/$/, "");
  if (!raw) throw new Error("Missing SUPABASE_URL");
  return raw;
}

async function main() {
  const sessionId = process.argv[2] ? String(process.argv[2]).trim() : "";
  if (!sessionId || !sessionId.startsWith("cs_")) {
    throw new Error("Usage: node scripts/verify-credit-pack-application.mjs <checkout_session_id>");
  }

  const supabaseUrl = normalizeUrl(process.env.SB_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL);
  const serviceRoleKey = (process.env.SB_SERVICE_ROLE_KEY ?? "").trim() || requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: txns, error: txErr } = await admin
    .from("credit_transactions")
    .select("id, user_id, amount, transaction_type, pool, stripe_event_id, stripe_checkout_session_id, stripe_payment_intent_id, created_at, metadata")
    .eq("stripe_checkout_session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (txErr) throw txErr;

  const userId = txns && txns.length ? txns[0].user_id : null;
  const { data: creditsRow, error: creditsErr } = userId
    ? await admin
        .from("user_credits")
        .select("user_id, tier, bonus_credits_total, bonus_credits_used, monthly_credits_per_cycle, monthly_credits_used, updated_at")
        .eq("user_id", userId)
        .maybeSingle()
    : { data: null, error: null };

  if (creditsErr) throw creditsErr;

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        sessionId,
        transactions: txns ?? [],
        userCredits: creditsRow ?? null,
      },
      null,
      2,
    ) + "\n",
  );
}

await main();

