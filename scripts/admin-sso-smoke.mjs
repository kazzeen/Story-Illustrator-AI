import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

function pick(keys) {
  for (const k of keys) {
    const v = String(process.env[k] ?? "").trim();
    if (v) return v;
  }
  return "";
}

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing ${name} in environment.`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function getUserAccessTokenByMagicLink({ supabaseUrl, anonKey, serviceRoleKey, email }) {
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr) throw new Error(`generateLink failed: ${linkErr.message}`);

  const props = linkData?.properties ?? {};
  const emailOtp = props.email_otp || props.emailOtp || "";
  const actionLink = props.action_link || props.actionLink || "";

  let token = String(emailOtp ?? "").trim();
  if (!token && actionLink) {
    try {
      const u = new URL(actionLink);
      token = String(u.searchParams.get("token") || u.searchParams.get("code") || u.searchParams.get("token_hash") || "").trim();
    } catch {
      void 0;
    }
  }
  if (!token) throw new Error("Could not extract OTP token from generated link.");

  const typesToTry = ["magiclink", "email"];
  let lastErr = null;
  for (const type of typesToTry) {
    const { data, error } = await anon.auth.verifyOtp({ email, token, type });
    if (!error && data?.session?.access_token) return data.session.access_token;
    lastErr = error ?? new Error("verifyOtp returned no session");
  }
  throw new Error(`verifyOtp failed: ${lastErr?.message ?? "unknown error"}`);
}

async function main() {
  const email = (process.env.ADMIN_SSO_EMAIL ?? "kasseen@gmail.com").trim();
  const origin = (process.env.ADMIN_SSO_ORIGIN ?? "https://story-illustrator-ai.vercel.app").trim();

  const supabaseUrl = requireEnv("SUPABASE_URL", pick(["SUPABASE_URL", "VITE_SUPABASE_URL"]));
  const anonKey = requireEnv("SUPABASE_ANON_KEY", pick(["SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"]));
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", pick(["SUPABASE_SERVICE_ROLE_KEY", "SB_SERVICE_ROLE_KEY"]));

  const accessToken = await getUserAccessTokenByMagicLink({ supabaseUrl, anonKey, serviceRoleKey, email });

  const ssoUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/api-admin/sso`;
  const resp = await fetch(ssoUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({}),
  });

  const text = await resp.text();
  assert(resp.status === 200, `SSO failed: HTTP ${resp.status} body=${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  assert(json.ok === true, "SSO response missing ok=true");
  assert(typeof json.sessionToken === "string" && json.sessionToken.length > 10, "SSO missing sessionToken");

  const sessionUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/api-admin/session`;
  const sessionResp = await fetch(sessionUrl, {
    method: "GET",
    headers: {
      Origin: origin,
      apikey: anonKey,
      Authorization: `Bearer ${json.sessionToken}`,
      "x-admin-session": json.sessionToken,
    },
  });
  const sessionText = await sessionResp.text();
  assert(sessionResp.status === 200, `Session failed: HTTP ${sessionResp.status} body=${sessionText.slice(0, 200)}`);

  process.stdout.write(`${JSON.stringify({ ok: true, email, username: json.username })}\n`);
}

await main();

