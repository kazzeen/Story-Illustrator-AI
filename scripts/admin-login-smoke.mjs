import process from "node:process";
import fs from "node:fs";
import path from "node:path";

function loadDotEnvIfPresent() {
  const p = path.join(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

function pickEnv(keys) {
  for (const k of keys) {
    const v = (process.env[k] ?? "").trim();
    if (v) return v;
  }
  return "";
}

function deriveFunctionsBaseUrl() {
  const supabaseUrl = pickEnv(["VITE_SUPABASE_URL", "SUPABASE_URL"]);
  if (!supabaseUrl) return "";
  try {
    const ref = new URL(supabaseUrl).hostname.split(".")[0] ?? "";
    return ref ? `https://${ref}.functions.supabase.co` : "";
  } catch {
    return "";
  }
}

function deriveFunctionsBaseUrlFromProjectRef() {
  try {
    const p = path.join(process.cwd(), "supabase", ".temp", "project-ref");
    if (!fs.existsSync(p)) return "";
    const ref = fs.readFileSync(p, "utf8").trim();
    return ref ? `https://${ref}.functions.supabase.co` : "";
  } catch {
    return "";
  }
}

function parseArgs(argv) {
  const args = new Map();
  for (const raw of argv) {
    const m = raw.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    args.set(m[1], m[2]);
  }
  return args;
}

async function readJson(resp) {
  const text = await resp.text();
  try {
    return { ok: true, json: JSON.parse(text), text };
  } catch {
    return { ok: false, json: null, text };
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function loginAndSessionGateway({ supabaseUrl, anonKey, origin, username, password }) {
  const baseUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/api-admin`;
  const loginUrl = `${baseUrl}/login`;
  const loginResp = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ username, password }),
  });

  const allowOrigin = loginResp.headers.get("access-control-allow-origin");
  const allowCreds = loginResp.headers.get("access-control-allow-credentials");
  const loginBody = await readJson(loginResp);

  assert(loginResp.status === 200, `Gateway login failed for origin ${origin}: HTTP ${loginResp.status} body=${loginBody.text.slice(0, 200)}`);
  assert(allowOrigin === origin, `Gateway login missing/invalid CORS allow-origin for origin ${origin}: got ${String(allowOrigin)}`);
  assert(allowCreds === "true", `Gateway login missing/invalid CORS allow-credentials for origin ${origin}: got ${String(allowCreds)}`);
  assert(loginBody.ok && loginBody.json && loginBody.json.ok === true, `Gateway login JSON missing ok=true for origin ${origin}`);
  assert(typeof loginBody.json.sessionToken === "string" && loginBody.json.sessionToken.length > 10, `Gateway login JSON missing sessionToken for origin ${origin}`);

  const sessionToken = loginBody.json.sessionToken;
  const sessionUrl = `${baseUrl}/session`;
  const sessionResp = await fetch(sessionUrl, {
    method: "GET",
    headers: {
      Origin: origin,
      apikey: anonKey,
      Authorization: `Bearer ${sessionToken}`,
      "x-admin-session": sessionToken,
    },
  });
  const sessionAllowOrigin = sessionResp.headers.get("access-control-allow-origin");
  const sessionAllowCreds = sessionResp.headers.get("access-control-allow-credentials");
  const sessionBody = await readJson(sessionResp);

  assert(sessionResp.status === 200, `Gateway session failed for origin ${origin}: HTTP ${sessionResp.status} body=${sessionBody.text.slice(0, 200)}`);
  assert(sessionAllowOrigin === origin, `Gateway session missing/invalid CORS allow-origin for origin ${origin}: got ${String(sessionAllowOrigin)}`);
  assert(sessionAllowCreds === "true", `Gateway session missing/invalid CORS allow-credentials for origin ${origin}: got ${String(sessionAllowCreds)}`);
  assert(sessionBody.ok && sessionBody.json && sessionBody.json.ok === true, `Gateway session JSON missing ok=true for origin ${origin}`);

  return { username: sessionBody.json.username ?? null };
}

async function loginAndSession({ baseUrl, origin, username, password }) {
  const loginUrl = `${baseUrl}/api-admin/login`;
  const loginResp = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify({ username, password }),
  });

  const allowOrigin = loginResp.headers.get("access-control-allow-origin");
  const allowCreds = loginResp.headers.get("access-control-allow-credentials");
  const loginBody = await readJson(loginResp);

  assert(loginResp.status === 200, `Login failed for origin ${origin}: HTTP ${loginResp.status} body=${loginBody.text.slice(0, 200)}`);
  assert(allowOrigin === origin, `Missing/invalid CORS allow-origin for origin ${origin}: got ${String(allowOrigin)}`);
  assert(allowCreds === "true", `Missing/invalid CORS allow-credentials for origin ${origin}: got ${String(allowCreds)}`);
  assert(loginBody.ok && loginBody.json && loginBody.json.ok === true, `Login JSON missing ok=true for origin ${origin}`);
  assert(typeof loginBody.json.sessionToken === "string" && loginBody.json.sessionToken.length > 10, `Login JSON missing sessionToken for origin ${origin}`);

  const sessionToken = loginBody.json.sessionToken;
  const sessionUrl = `${baseUrl}/api-admin/session`;
  const sessionResp = await fetch(sessionUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      Origin: origin,
    },
  });
  const sessionAllowOrigin = sessionResp.headers.get("access-control-allow-origin");
  const sessionAllowCreds = sessionResp.headers.get("access-control-allow-credentials");
  const sessionBody = await readJson(sessionResp);

  assert(sessionResp.status === 200, `Session failed for origin ${origin}: HTTP ${sessionResp.status} body=${sessionBody.text.slice(0, 200)}`);
  assert(sessionAllowOrigin === origin, `Session missing/invalid CORS allow-origin for origin ${origin}: got ${String(sessionAllowOrigin)}`);
  assert(sessionAllowCreds === "true", `Session missing/invalid CORS allow-credentials for origin ${origin}: got ${String(sessionAllowCreds)}`);
  assert(sessionBody.ok && sessionBody.json && sessionBody.json.ok === true, `Session JSON missing ok=true for origin ${origin}`);

  return { username: sessionBody.json.username ?? null };
}

async function main() {
  loadDotEnvIfPresent();
  const args = parseArgs(process.argv.slice(2));

  const username = (args.get("username") ?? pickEnv(["ADMIN_SMOKE_USERNAME", "ADMIN_USERNAME"]) ?? "admin@siai.com").trim() || "admin@siai.com";
  const password = pickEnv(["ADMIN_SMOKE_PASSWORD", "ADMIN_BOOTSTRAP_PASSWORD"]);
  if (!password) {
    throw new Error("Missing password. Set ADMIN_SMOKE_PASSWORD in your environment.");
  }

  const supabaseUrl = pickEnv(["VITE_SUPABASE_URL", "SUPABASE_URL"]);
  const anonKey = pickEnv(["VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "SB_ANON_KEY"]);

  const baseUrl = String(
    args.get("functionsBase") ||
      pickEnv(["ADMIN_FUNCTIONS_BASE"]) ||
      deriveFunctionsBaseUrl() ||
      deriveFunctionsBaseUrlFromProjectRef(),
  ).trim();
  if (!baseUrl) {
    throw new Error("Missing functions base URL. Set VITE_SUPABASE_URL or SUPABASE_URL, or pass --functionsBase=https://<ref>.functions.supabase.co");
  }

  const originListRaw = String(
    args.get("origins") || pickEnv(["ADMIN_SMOKE_ORIGINS"]) || "http://localhost:5173,https://story-illustrator-ai.vercel.app",
  ).trim();
  const origins = originListRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const results = [];
  for (const origin of origins) {
    if (supabaseUrl && anonKey) {
      const gatewayRes = await loginAndSessionGateway({ supabaseUrl, anonKey, origin, username, password });
      results.push({ origin, via: "functions_v1", username: gatewayRes.username });
    }
    const res = await loginAndSession({ baseUrl, origin, username, password });
    results.push({ origin, via: "functions_domain", username: res.username });
  }

  process.stdout.write(`${JSON.stringify({ ok: true, baseUrl, results })}\n`);
}

await main();
