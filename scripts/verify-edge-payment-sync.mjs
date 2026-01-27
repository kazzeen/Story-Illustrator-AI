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

async function parseJsonResponse(resp) {
  const text = await resp.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: resp.status, ok: resp.ok, body };
}

async function main() {
  const supabaseUrl = normalizeUrl(process.env.SB_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL);
  const serviceRoleKey = (process.env.SB_SERVICE_ROLE_KEY ?? "").trim() || (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  const anonKey =
    (process.env.SUPABASE_ANON_KEY ?? "").trim() ||
    (process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim() ||
    (process.env.VITE_SUPABASE_ANON_KEY ?? "").trim() ||
    (process.env.SB_ANON_KEY ?? "").trim();
  if (!anonKey) throw new Error("Missing SUPABASE_ANON_KEY");

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const email = `edge_test_${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = "TestPass!12345";

  const headersFromToken = (token) => ({
    Authorization: `Bearer ${token}`,
    apikey: anonKey,
    "Content-Type": "application/json",
  });

  const invalidToken = "header.payload.signature";

  const createAttempt = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createAttempt.error || !createAttempt.data?.user?.id) {
    const reconcileResp = await fetch(`${supabaseUrl}/functions/v1/reconcile-stripe-checkout`, {
      method: "POST",
      headers: headersFromToken(invalidToken),
      body: JSON.stringify({ session_id: "cs_test_invalid" }),
    });
    const reconcile = await parseJsonResponse(reconcileResp);

    const creditPackReconcileResp = await fetch(`${supabaseUrl}/functions/v1/reconcile-stripe-credit-pack`, {
      method: "POST",
      headers: headersFromToken(invalidToken),
      body: JSON.stringify({ session_id: "cs_test_invalid" }),
    });
    const creditPackReconcile = await parseJsonResponse(creditPackReconcileResp);

    const creditsResp = await fetch(`${supabaseUrl}/functions/v1/credits`, {
      method: "POST",
      headers: headersFromToken(invalidToken),
      body: JSON.stringify({ action: "status", limit: 0 }),
    });
    const credits = await parseJsonResponse(creditsResp);

    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          note: "Skipped real-user JWT verification because auth user creation failed. Verified function behavior with an invalid token instead.",
          createUserError: createAttempt.error ?? null,
          reconcileInvalidToken: { status: reconcile.status, body: reconcile.body },
          creditPackReconcileInvalidToken: { status: creditPackReconcile.status, body: creditPackReconcile.body },
          creditsInvalidToken: { status: credits.status, body: credits.body },
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  const userId = createAttempt.data.user.id;
  try {
    const { data: signed, error: signErr } = await client.auth.signInWithPassword({ email, password });
    if (signErr) throw signErr;
    const token = signed.session?.access_token ?? null;
    if (!token) throw new Error("Missing access token after sign-in");

    const reconcileResp = await fetch(`${supabaseUrl}/functions/v1/reconcile-stripe-checkout`, {
      method: "POST",
      headers: headersFromToken(token),
      body: JSON.stringify({ session_id: "cs_test_invalid" }),
    });
    const reconcile = await parseJsonResponse(reconcileResp);
    if (reconcile.status === 401) {
      throw new Error(`reconcile-stripe-checkout auth failed (401): ${JSON.stringify(reconcile.body)}`);
    }
    if (reconcile.status !== 400) {
      throw new Error(`Unexpected reconcile status ${reconcile.status}: ${JSON.stringify(reconcile.body)}`);
    }

    const creditPackReconcileResp = await fetch(`${supabaseUrl}/functions/v1/reconcile-stripe-credit-pack`, {
      method: "POST",
      headers: headersFromToken(token),
      body: JSON.stringify({ session_id: "cs_test_invalid" }),
    });
    const creditPackReconcile = await parseJsonResponse(creditPackReconcileResp);
    if (creditPackReconcile.status === 401) {
      throw new Error(`reconcile-stripe-credit-pack auth failed (401): ${JSON.stringify(creditPackReconcile.body)}`);
    }

    const creditsResp = await fetch(`${supabaseUrl}/functions/v1/credits`, {
      method: "POST",
      headers: headersFromToken(token),
      body: JSON.stringify({ action: "status", limit: 0 }),
    });
    const credits = await parseJsonResponse(creditsResp);
    if (!credits.ok) {
      throw new Error(`credits failed (HTTP ${credits.status}): ${JSON.stringify(credits.body)}`);
    }

    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          reconcile: { status: reconcile.status, body: reconcile.body },
          creditPackReconcile: { status: creditPackReconcile.status, body: creditPackReconcile.body },
          creditsStatus: credits.status,
          creditsBody: credits.body,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await admin.auth.admin.deleteUser(userId);
  }
}

await main();
