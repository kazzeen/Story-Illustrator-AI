import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(status: number, body: unknown, headers?: HeadersInit) {
  const merged = new Headers(headers);
  merged.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), {
    status,
    headers: merged,
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

function parseCookies(req: Request): Record<string, string> {
  const raw = req.headers.get("cookie") ?? "";
  if (!raw.trim()) return {};
  const out: Record<string, string> = {};
  raw.split(";").forEach((part) => {
    const [k, ...rest] = part.split("=");
    const key = (k ?? "").trim();
    if (!key) return;
    const value = rest.join("=").trim();
    out[key] = decodeURIComponent(value);
  });
  return out;
}

function serializeCookie(
  name: string,
  value: string,
  opts: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
    path?: string;
    maxAge?: number;
  } = {},
) {
  const parts: string[] = [];
  parts.push(`${name}=${encodeURIComponent(value)}`);
  parts.push(`Path=${opts.path ?? "/"}`);
  if (typeof opts.maxAge === "number") parts.push(`Max-Age=${Math.trunc(opts.maxAge)}`);
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  return parts.join("; ");
}

function randomToken(bytes: number) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function extractBearerToken(value: string | null) {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] ?? "").trim() || null;
}

function parseEmailList(value: string | null): Set<string> {
  const raw = (value ?? "").trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function issueAdminSession(req: Request, admin: SupabaseClient, verifiedUsername: string) {
  const ip = extractClientIp(req) ?? "unknown";
  const sessionToken = randomToken(32);
  const csrfToken = randomToken(32);
  const sessionTokenHash = await sha256Hex(sessionToken);
  const csrfTokenHash = await sha256Hex(csrfToken);
  const ttlSeconds = Number(Deno.env.get("ADMIN_SESSION_TTL_SECONDS") ?? "28800");
  const expiresAt = new Date(Date.now() + Math.max(ttlSeconds, 300) * 1000).toISOString();

  const userAgent = (req.headers.get("user-agent") ?? "").trim();
  const ipHash = await sha256Hex(ip);
  const userAgentHash = await sha256Hex(userAgent || "unknown");

  const { error: insertErr } = await admin.from("admin_sessions").insert({
    admin_username: verifiedUsername,
    session_token_hash: sessionTokenHash,
    csrf_token_hash: csrfTokenHash,
    expires_at: expiresAt,
    ip_hash: ipHash,
    user_agent_hash: userAgentHash,
  });
  if (insertErr) return { ok: false as const, response: json(500, { error: "login_failed" }, withCors(req)) };

  const headers = new Headers(withCors(req));
  const secureEnv = Deno.env.get("ADMIN_COOKIE_SECURE");
  const secure = secureEnv ? secureEnv.toLowerCase() !== "false" : new URL(req.url).protocol === "https:";
  headers.append("Set-Cookie", serializeCookie("admin_session", sessionToken, { httpOnly: true, secure, sameSite: "Strict", path: "/", maxAge: ttlSeconds }));
  headers.append("Set-Cookie", serializeCookie("admin_csrf", csrfToken, { httpOnly: false, secure, sameSite: "Strict", path: "/", maxAge: ttlSeconds }));

  return { ok: true as const, response: json(200, { ok: true, username: verifiedUsername, csrfToken, sessionToken }, headers) };
}

async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function extractClientIp(req: Request) {
  const xf = req.headers.get("x-forwarded-for") ?? req.headers.get("X-Forwarded-For") ?? "";
  const first = xf.split(",")[0]?.trim() ?? "";
  if (first) return first;
  const xr = req.headers.get("x-real-ip") ?? req.headers.get("X-Real-IP") ?? "";
  return xr.trim() || null;
}

function functionSubpath(req: Request, functionName: string) {
  const path = new URL(req.url).pathname;
  const directPrefix = `/${functionName}`;
  const gatewayPrefix = `/functions/v1/${functionName}`;
  const prefix = path.startsWith(gatewayPrefix) ? gatewayPrefix : directPrefix;
  if (!path.startsWith(prefix)) return "/";
  const rest = path.slice(prefix.length);
  return rest.startsWith("/") ? rest : `/${rest}`;
}

function withCors(req: Request, headers: HeadersInit = {}) {
  const origin = (req.headers.get("origin") ?? "").trim();
  const allowOrigin = origin || "*";
  const base: HeadersInit = {
    "Access-Control-Allow-Origin": allowOrigin,
    ...(allowOrigin === "*" ? {} : { "Access-Control-Allow-Credentials": "true" }),
    "Access-Control-Allow-Headers": "content-type, x-csrf-token, x-admin-session, x-client-info, apikey, authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Vary": "Origin",
  };
  return { ...base, ...headers };
}

function requireEnabled() {
  const disabled = (Deno.env.get("ADMIN_API_DISABLED") ?? "").toLowerCase();
  if (disabled === "true" || disabled === "1" || disabled === "yes") return false;

  const enabled = Deno.env.get("ADMIN_API_ENABLED");
  if (enabled == null || enabled === "") return true;
  const normalized = enabled.toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

type AdminSessionRow = {
  id: string;
  admin_username: string;
  session_token_hash: string;
  csrf_token_hash: string;
  last_seen_at: string;
  expires_at: string;
  ip_hash?: string | null;
  user_agent_hash?: string | null;
};

async function rateLimit(admin: SupabaseClient, rateKey: string, limit: number, windowSeconds: number) {
  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count, error: countErr } = await admin
    .from("admin_rate_limit_events")
    .select("*", { count: "exact", head: true })
    .eq("rate_key", rateKey)
    .gte("created_at", windowStart);

  if (countErr) return { ok: false, error: "rate_limit_check_failed" as const };
  if ((count ?? 0) >= limit) {
    const { data: earliest } = await admin
      .from("admin_rate_limit_events")
      .select("created_at")
      .eq("rate_key", rateKey)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const earliestMs = earliest && typeof earliest === "object" && typeof (earliest as { created_at?: unknown }).created_at === "string"
      ? Date.parse((earliest as { created_at: string }).created_at)
      : NaN;
    const elapsed = Number.isFinite(earliestMs) ? (Date.now() - earliestMs) / 1000 : windowSeconds;
    const retryAfter = Math.max(1, Math.ceil(windowSeconds - elapsed));
    return { ok: false, error: "rate_limited" as const, retryAfter };
  }

  const { error: insertErr } = await admin.from("admin_rate_limit_events").insert({ rate_key: rateKey });
  if (insertErr) return { ok: false, error: "rate_limit_record_failed" as const };
  return { ok: true as const };
}

async function loadAdminSession(admin: SupabaseClient, sessionToken: string): Promise<AdminSessionRow | null> {
  const sessionHash = await sha256Hex(sessionToken);
  const { data, error } = await admin
    .from("admin_sessions")
    .select("id, admin_username, session_token_hash, csrf_token_hash, last_seen_at, expires_at, ip_hash, user_agent_hash")
    .eq("session_token_hash", sessionHash)
    .maybeSingle();
  if (error || !data) return null;
  return data as AdminSessionRow;
}

async function touchAdminSession(admin: SupabaseClient, sessionId: string) {
  await admin.from("admin_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", sessionId);
}

async function requireAdminSession(
  req: Request,
  admin: SupabaseClient,
  opts: { requireCsrf: boolean },
): Promise<
  | { ok: true; adminUsername: string; session: AdminSessionRow; headers: HeadersInit }
  | { ok: false; response: Response }
> {
  const cookies = parseCookies(req);
  const cookieToken = (cookies.admin_session ?? "").trim();
  const headerToken = (req.headers.get("x-admin-session") ?? req.headers.get("X-Admin-Session") ?? "").trim();
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  const bearerToken = extractBearerToken(authHeader) ?? "";
  const sessionToken = cookieToken || headerToken || bearerToken;
  if (!sessionToken) {
    return { ok: false, response: json(401, { error: "not_authenticated" }, withCors(req)) };
  }

  const session = await loadAdminSession(admin, sessionToken);
  if (!session) {
    return { ok: false, response: json(401, { error: "invalid_session" }, withCors(req)) };
  }

  const expiresAtMs = Date.parse(session.expires_at);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    await admin.from("admin_sessions").delete().eq("id", session.id);
    return { ok: false, response: json(401, { error: "session_expired" }, withCors(req)) };
  }

  const idleSeconds = Number(Deno.env.get("ADMIN_SESSION_IDLE_SECONDS") ?? "3600");
  const lastSeenMs = Date.parse(session.last_seen_at);
  if (Number.isFinite(lastSeenMs) && idleSeconds > 0 && lastSeenMs + idleSeconds * 1000 <= Date.now()) {
    await admin.from("admin_sessions").delete().eq("id", session.id);
    return { ok: false, response: json(401, { error: "session_expired" }, withCors(req)) };
  }

  const bindIp = (Deno.env.get("ADMIN_SESSION_BIND_IP") ?? "").toLowerCase() === "true";
  if (bindIp && session.ip_hash) {
    const ip = extractClientIp(req) ?? "unknown";
    const ipHash = await sha256Hex(ip);
    if (ipHash !== session.ip_hash) return { ok: false, response: json(401, { error: "invalid_session" }, withCors(req)) };
  }

  const bindUa = (Deno.env.get("ADMIN_SESSION_BIND_UA") ?? "").toLowerCase() === "true";
  if (bindUa && session.user_agent_hash) {
    const ua = (req.headers.get("user-agent") ?? "").trim() || "unknown";
    const uaHash = await sha256Hex(ua);
    if (uaHash !== session.user_agent_hash) return { ok: false, response: json(401, { error: "invalid_session" }, withCors(req)) };
  }

  if (opts.requireCsrf) {
    const headerToken = (req.headers.get("x-csrf-token") ?? "").trim();
    const cookieCsrf = (cookies.admin_csrf ?? "").trim();
    if (!headerToken) {
      return { ok: false, response: json(403, { error: "csrf_failed" }, withCors(req)) };
    }
    if (cookieCsrf && headerToken !== cookieCsrf) {
      return { ok: false, response: json(403, { error: "csrf_failed" }, withCors(req)) };
    }
    const expected = session.csrf_token_hash;
    const got = await sha256Hex(headerToken);
    if (got !== expected) {
      return { ok: false, response: json(403, { error: "csrf_failed" }, withCors(req)) };
    }
  }

  await touchAdminSession(admin, session.id);
  return { ok: true, adminUsername: session.admin_username, session, headers: withCors(req) };
}

serve(async (req: Request) => {
  if (!requireEnabled()) return json(404, { error: "not_found" });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: withCors(req) });

  const supabaseUrl = deriveSupabaseUrl(req) ?? Deno.env.get("SB_SUPABASE_URL") ?? null;
  const supabaseServiceKey = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? null;
  if (!supabaseUrl || !supabaseServiceKey) {
    return json(500, { error: "configuration_error" }, withCors(req));
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey);
  const subpath = functionSubpath(req, "api-admin");

  if (subpath === "/bootstrap" && req.method === "POST") {
    const bootstrapEnabled = (Deno.env.get("ADMIN_BOOTSTRAP_ENABLED") ?? "").toLowerCase() === "true";
    if (!bootstrapEnabled) return json(404, { error: "not_found" }, withCors(req));

    const tokenHeader = (req.headers.get("x-admin-bootstrap-token") ?? "").trim();
    const expectedToken = (Deno.env.get("ADMIN_BOOTSTRAP_TOKEN") ?? "").trim();
    if (!expectedToken || tokenHeader !== expectedToken) return json(403, { error: "forbidden" }, withCors(req));

    const ip = extractClientIp(req) ?? "unknown";
    const rateKey = `bootstrap:${await sha256Hex(ip)}`;
    const rl = await rateLimit(admin, rateKey, 10, 60);
    if (!rl.ok) return json(429, { error: rl.error, retryAfterSeconds: "retryAfter" in rl ? rl.retryAfter : null }, withCors(req, { "Retry-After": String("retryAfter" in rl ? rl.retryAfter : 60) }));

    const username = (Deno.env.get("ADMIN_USERNAME") ?? "admin@siai.com").trim();
    const password = (Deno.env.get("ADMIN_BOOTSTRAP_PASSWORD") ?? "").trim();
    if (!password) return json(500, { error: "missing_bootstrap_password" }, withCors(req));

    const { data: created, error } = await admin.rpc("admin_create_account", { p_username: username, p_password: password });
    if (error) return json(500, { error: "bootstrap_failed" }, withCors(req));
    return json(200, { ok: true, created }, withCors(req));
  }

  if (subpath === "/sso" && req.method === "POST") {
    const ip = extractClientIp(req) ?? "unknown";
    const rateKey = `sso:${await sha256Hex(ip)}`;
    const rl = await rateLimit(admin, rateKey, 30, 60);
    if (!rl.ok) return json(429, { error: rl.error, retryAfterSeconds: "retryAfter" in rl ? rl.retryAfter : null }, withCors(req, { "Retry-After": String("retryAfter" in rl ? rl.retryAfter : 60) }));

    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    const supabaseJwt = extractBearerToken(authHeader);
    if (!supabaseJwt) return json(401, { error: "missing_auth" }, withCors(req));

    const { data: userData, error: userErr } = await admin.auth.getUser(supabaseJwt);
    if (userErr || !userData?.user) return json(401, { error: "invalid_auth" }, withCors(req));

    const email = (userData.user.email ?? "").trim().toLowerCase();
    if (!email) return json(401, { error: "invalid_auth" }, withCors(req));

    const { data: existing, error: existingErr } = await admin.from("admin_accounts").select("username").eq("username", email).maybeSingle();
    if (existingErr) return json(500, { error: "sso_failed" }, withCors(req));

    if (!existing) {
      const bootstrapEmails = parseEmailList(Deno.env.get("ADMIN_BOOTSTRAP_EMAILS"));
      const { data: profileRow, error: profileErr } = await admin.from("profiles").select("is_admin").eq("user_id", userData.user.id).maybeSingle();
      if (profileErr) return json(500, { error: "sso_failed" }, withCors(req));
      const isAdmin = Boolean(profileRow && typeof profileRow === "object" && (profileRow as { is_admin?: unknown }).is_admin === true);
      const allowed = bootstrapEmails.has(email) || email === "kasseen@gmail.com" || isAdmin;
      if (!allowed) return json(403, { error: "forbidden" }, withCors(req));

      const password = randomToken(24);
      const { error: createErr } = await admin.rpc("admin_create_account", { p_username: email, p_password: password });
      if (createErr) return json(500, { error: "sso_failed" }, withCors(req));
    }

    const issued = await issueAdminSession(req, admin, email);
    return issued.response;
  }

  if (subpath === "/bypass" && req.method === "POST") {
    const bypassEnabledEnv = (Deno.env.get("ADMIN_BYPASS_ENABLED") ?? "").trim().toLowerCase();
    if (bypassEnabledEnv === "false") return json(404, { error: "not_found" }, withCors(req));

    const ip = extractClientIp(req) ?? "unknown";
    const rateKey = `bypass:${await sha256Hex(ip)}`;
    const rl = await rateLimit(admin, rateKey, 10, 60);
    if (!rl.ok) {
      return json(
        429,
        { error: rl.error, retryAfterSeconds: "retryAfter" in rl ? rl.retryAfter : null },
        withCors(req, { "Retry-After": String("retryAfter" in rl ? rl.retryAfter : 60) }),
      );
    }

    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    const supabaseJwt = extractBearerToken(authHeader);
    if (!supabaseJwt) return json(401, { error: "missing_auth" }, withCors(req));

    const { data: userData, error: userErr } = await admin.auth.getUser(supabaseJwt);
    if (userErr || !userData?.user) return json(401, { error: "invalid_auth" }, withCors(req));

    const userId = (userData.user.id ?? "").trim();
    const email = (userData.user.email ?? "").trim().toLowerCase();
    const emailConfirmed = Boolean((userData.user as { email_confirmed_at?: unknown }).email_confirmed_at);
    if (!userId || !email || !emailConfirmed) return json(403, { error: "forbidden" }, withCors(req));

    const bootstrapEmails = parseEmailList(Deno.env.get("ADMIN_BOOTSTRAP_EMAILS"));
    const { data: profileRow, error: profileErr } = await admin.from("profiles").select("is_admin").eq("user_id", userId).maybeSingle();
    if (profileErr) return json(500, { error: "bypass_failed" }, withCors(req));
    const isAdmin = Boolean(profileRow && typeof profileRow === "object" && (profileRow as { is_admin?: unknown }).is_admin === true);
    const allowedVia = isAdmin ? "profile.is_admin" : bootstrapEmails.has(email) ? "bootstrap_emails" : null;
    if (!allowedVia) return json(403, { error: "forbidden" }, withCors(req));

    const { data: existing, error: existingErr } = await admin.from("admin_accounts").select("username").eq("username", email).maybeSingle();
    if (existingErr) return json(500, { error: "bypass_failed" }, withCors(req));
    if (!existing) {
      const password = randomToken(24);
      const { error: createErr } = await admin.rpc("admin_create_account", { p_username: email, p_password: password });
      if (createErr) return json(500, { error: "bypass_failed" }, withCors(req));
    }

    const userAgent = (req.headers.get("user-agent") ?? "").trim();
    await admin.from("audit_logs").insert({
      admin_username: email,
      action_type: "admin.bypass",
      target_user_id: userId,
      reason: "bypass",
      after: { ip, user_agent: userAgent || null, allowed_via: allowedVia },
    });

    const issued = await issueAdminSession(req, admin, email);
    return issued.response;
  }

  if (subpath === "/login" && req.method === "POST") {
    const ip = extractClientIp(req) ?? "unknown";
    const rateKey = `login:${await sha256Hex(ip)}`;
    const rl = await rateLimit(admin, rateKey, 20, 60);
    if (!rl.ok) return json(429, { error: rl.error, retryAfterSeconds: "retryAfter" in rl ? rl.retryAfter : null }, withCors(req, { "Retry-After": String("retryAfter" in rl ? rl.retryAfter : 60) }));

    let rawBody: unknown = null;
    try {
      rawBody = await req.json();
    } catch {
      rawBody = {};
    }
    const body = isRecord(rawBody) ? rawBody : {};
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) return json(400, { error: "username_and_password_required" }, withCors(req));

    let verifiedUsername = username;
    const { data: ok, error: verifyErr } = await admin.rpc("admin_verify_account", { p_username: username, p_password: password });
    if (verifyErr) return json(500, { error: "login_failed" }, withCors(req));
    if (!ok) {
      const preferredUsername = (Deno.env.get("ADMIN_USERNAME") ?? "admin@siai.com").trim();
      const legacyUsername = (Deno.env.get("ADMIN_LEGACY_USERNAME") ?? "admin").trim();
      if (preferredUsername && legacyUsername && username === preferredUsername && legacyUsername !== preferredUsername) {
        const { data: legacyOk, error: legacyErr } = await admin.rpc("admin_verify_account", {
          p_username: legacyUsername,
          p_password: password,
        });
        if (legacyErr) return json(500, { error: "login_failed" }, withCors(req));
        if (!legacyOk) return json(401, { error: "invalid_credentials" }, withCors(req));
        verifiedUsername = legacyUsername;
      } else {
        return json(401, { error: "invalid_credentials" }, withCors(req));
      }
    }

    const issued = await issueAdminSession(req, admin, verifiedUsername);
    return issued.response;
  }

  if (subpath === "/logout" && req.method === "POST") {
    const cookies = parseCookies(req);
    const cookieToken = (cookies.admin_session ?? "").trim();
    const headerToken = (req.headers.get("x-admin-session") ?? req.headers.get("X-Admin-Session") ?? "").trim();
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    const bearerToken = extractBearerToken(authHeader) ?? "";
    const sessionToken = cookieToken || headerToken || bearerToken;
    if (sessionToken) {
      const sessionHash = await sha256Hex(sessionToken);
      await admin.from("admin_sessions").delete().eq("session_token_hash", sessionHash);
    }
    const headers = new Headers(withCors(req));
    const secureEnv = Deno.env.get("ADMIN_COOKIE_SECURE");
    const secure = secureEnv ? secureEnv.toLowerCase() !== "false" : new URL(req.url).protocol === "https:";
    headers.append("Set-Cookie", serializeCookie("admin_session", "", { httpOnly: true, secure, sameSite: "Strict", path: "/", maxAge: 0 }));
    headers.append("Set-Cookie", serializeCookie("admin_csrf", "", { httpOnly: false, secure, sameSite: "Strict", path: "/", maxAge: 0 }));
    return json(200, { ok: true }, headers);
  }

  if (subpath === "/session" && req.method === "GET") {
    const auth = await requireAdminSession(req, admin, { requireCsrf: false });
    if (!auth.ok) return auth.response;
    return json(200, { ok: true, username: auth.adminUsername }, auth.headers);
  }

  const segments = subpath.split("/").filter(Boolean);

  if (segments[0] === "users" && req.method === "GET") {
    const auth = await requireAdminSession(req, admin, { requireCsrf: false });
    if (!auth.ok) return auth.response;

    const url = new URL(req.url);
    const page = Math.max(parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20, 1), 200);

    if (segments.length === 1) {
      const q = url.searchParams.get("q");
      const sortBy = url.searchParams.get("sortBy");
      const sortDir = url.searchParams.get("sortDir");
      const planTier = url.searchParams.get("planTier");
      const status = url.searchParams.get("status");
      const activity = url.searchParams.get("activity");

      const readKey = `users_list:${auth.adminUsername}`;
      const rl = await rateLimit(admin, readKey, 300, 60);
      if (!rl.ok) return json(429, { error: rl.error, retryAfterSeconds: "retryAfter" in rl ? rl.retryAfter : null }, { ...auth.headers, "Retry-After": String("retryAfter" in rl ? rl.retryAfter : 60) });

      const { data, error } = await admin.rpc("admin_list_users", {
        p_page: page,
        p_page_size: pageSize,
        p_query: q,
        p_sort_by: sortBy,
        p_sort_dir: sortDir,
        p_plan_tier: planTier,
        p_status: status,
        p_activity: activity,
      });
      if (error) return json(500, { error: "list_failed" }, auth.headers);

      const rows = Array.isArray(data) ? data : [];
      const totalRaw = rows.length > 0 ? (rows[0] as { total_count?: unknown }).total_count : 0;
      const total =
        typeof totalRaw === "number" ? totalRaw : typeof totalRaw === "string" ? parseInt(totalRaw, 10) || 0 : 0;

      const shaped = rows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          user_id: String(row.user_id ?? ""),
          email: typeof row.email === "string" ? row.email : null,
          created_at: typeof row.created_at === "string" ? row.created_at : null,
          last_login_at: typeof row.last_login_at === "string" ? row.last_login_at : null,
          plan_tier: typeof row.plan_tier === "string" ? row.plan_tier : null,
          credits_balance: typeof row.credits_balance === "number" ? row.credits_balance : null,
          stories_count:
            typeof row.stories_count === "number"
              ? row.stories_count
              : typeof row.stories_count === "string"
                ? parseInt(row.stories_count, 10) || 0
                : null,
          scenes_count:
            typeof row.scenes_count === "number"
              ? row.scenes_count
              : typeof row.scenes_count === "string"
                ? parseInt(row.scenes_count, 10) || 0
                : null,
        };
      });

      return json(200, { ok: true, page, pageSize, total, rows: shaped }, auth.headers);
    }

    if (segments.length === 2) {
      const userId = segments[1] ?? "";
      try {
        const { data, error } = await admin.rpc("admin_get_user_details", { p_user_id: userId });
        if (error || !data) return json(404, { error: "not_found" }, auth.headers);
        const obj = isRecord(data) ? data : {};
        if (obj.ok !== true) return json(404, { error: "not_found" }, auth.headers);

        const { data: txns, error: txnErr } = await admin
          .from("credit_transactions")
          .select("id, amount, transaction_type, description, metadata, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (txnErr) return json(500, { error: "history_failed" }, auth.headers);

        const { data: planHistory, error: planErr } = await admin
          .from("plan_history")
          .select("id, admin_username, old_tier, new_tier, old_status, new_status, old_expires_at, new_expires_at, notes, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (planErr) return json(500, { error: "history_failed" }, auth.headers);

        return json(200, { ...obj, credit_history: txns ?? [], plan_history: planHistory ?? [] }, auth.headers);
      } catch {
        return json(400, { error: "invalid_user_id" }, auth.headers);
      }
    }

    return json(404, { error: "not_found" }, auth.headers);
  }

  if (segments[0] === "users" && segments.length === 2 && req.method === "PATCH") {
    const auth = await requireAdminSession(req, admin, { requireCsrf: true });
    if (!auth.ok) return auth.response;

    const writeKey = `user_patch:${auth.adminUsername}`;
    const rl = await rateLimit(admin, writeKey, 120, 60);
    if (!rl.ok) return json(429, { error: rl.error, retryAfterSeconds: "retryAfter" in rl ? rl.retryAfter : null }, { ...auth.headers, "Retry-After": String("retryAfter" in rl ? rl.retryAfter : 60) });

    let rawBody: unknown = null;
    try {
      rawBody = await req.json();
    } catch {
      rawBody = {};
    }
    const body = isRecord(rawBody) ? rawBody : {};
    const displayName = typeof body.display_name === "string" ? body.display_name.trim() : null;
    const avatarUrl = typeof body.avatar_url === "string" ? body.avatar_url.trim() : null;
    const subscriptionStatus = typeof body.subscription_status === "string" ? body.subscription_status.trim() : null;

    const patch: Record<string, unknown> = {};
    if (displayName !== null) patch.display_name = displayName || null;
    if (avatarUrl !== null) patch.avatar_url = avatarUrl || null;
    if (subscriptionStatus !== null) patch.subscription_status = subscriptionStatus || null;
    if (Object.keys(patch).length === 0) return json(400, { error: "no_fields" }, auth.headers);

    const userId = segments[1] ?? "";
    const { data: beforeProfile } = await admin
      .from("profiles")
      .select("display_name, avatar_url, subscription_status")
      .eq("user_id", userId)
      .maybeSingle();

    const { error } = await admin.from("profiles").update(patch).eq("user_id", userId);
    if (error) return json(500, { error: "update_failed" }, auth.headers);

    const { data: afterProfile } = await admin
      .from("profiles")
      .select("display_name, avatar_url, subscription_status")
      .eq("user_id", userId)
      .maybeSingle();

    await admin.from("audit_logs").insert({
      admin_username: auth.adminUsername,
      action_type: "user.update",
      target_user_id: userId,
      reason: typeof body.reason === "string" ? body.reason : null,
      before: beforeProfile ?? null,
      after: afterProfile ?? null,
    });

    return json(200, { ok: true }, auth.headers);
  }

  if (segments[0] === "users" && segments.length === 3 && segments[2] === "credits" && req.method === "POST") {
    const auth = await requireAdminSession(req, admin, { requireCsrf: true });
    if (!auth.ok) return auth.response;

    const writeKey = `credits:${auth.adminUsername}`;
    const rl = await rateLimit(admin, writeKey, 120, 60);
    if (!rl.ok) return json(429, { error: rl.error, retryAfterSeconds: "retryAfter" in rl ? rl.retryAfter : null }, { ...auth.headers, "Retry-After": String("retryAfter" in rl ? rl.retryAfter : 60) });

    let rawBody: unknown = null;
    try {
      rawBody = await req.json();
    } catch {
      rawBody = {};
    }
    const body = isRecord(rawBody) ? rawBody : {};
    const operation = typeof body.operation === "string" ? body.operation : "";
    const amount = typeof body.amount === "number" ? Math.trunc(body.amount) : typeof body.amount === "string" ? Math.trunc(Number(body.amount)) : NaN;
    const reason = typeof body.reason === "string" ? body.reason : null;

    if (!operation || !Number.isFinite(amount)) return json(400, { error: "invalid_request" }, auth.headers);

    const userId = segments[1] ?? "";
    const { data, error } = await admin.rpc("admin_modify_user_credits", {
      p_user_id: userId,
      p_operation: operation,
      p_amount: amount,
      p_admin_username: auth.adminUsername,
      p_reason: reason,
    });
    if (error) return json(500, { error: "credits_update_failed" }, auth.headers);
    return json(200, data, auth.headers);
  }

  if (segments[0] === "users" && segments.length === 3 && segments[2] === "plan" && req.method === "POST") {
    const auth = await requireAdminSession(req, admin, { requireCsrf: true });
    if (!auth.ok) return auth.response;

    const writeKey = `plan:${auth.adminUsername}`;
    const rl = await rateLimit(admin, writeKey, 120, 60);
    if (!rl.ok) return json(429, { error: rl.error, retryAfterSeconds: "retryAfter" in rl ? rl.retryAfter : null }, { ...auth.headers, "Retry-After": String("retryAfter" in rl ? rl.retryAfter : 60) });

    let rawBody: unknown = null;
    try {
      rawBody = await req.json();
    } catch {
      rawBody = {};
    }
    const body = isRecord(rawBody) ? rawBody : {};
    const newTier = typeof body.newTier === "string" ? body.newTier : null;
    const newStatus = typeof body.newStatus === "string" ? body.newStatus : null;
    const newExpiresAt = typeof body.newExpiresAt === "string" ? body.newExpiresAt : null;
    const notes = typeof body.notes === "string" ? body.notes : null;

    const userId = segments[1] ?? "";
    const { data, error } = await admin.rpc("admin_update_user_plan", {
      p_user_id: userId,
      p_new_tier: newTier,
      p_new_status: newStatus,
      p_new_expires_at: newExpiresAt,
      p_notes: notes,
      p_admin_username: auth.adminUsername,
    });
    if (error) return json(500, { error: "plan_update_failed" }, auth.headers);
    return json(200, data, auth.headers);
  }

  if (segments[0] === "audit-logs" && req.method === "GET") {
    const auth = await requireAdminSession(req, admin, { requireCsrf: false });
    if (!auth.ok) return auth.response;

    const url = new URL(req.url);
    const page = Math.max(parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25, 1), 200);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const readKey = `audit:${auth.adminUsername}`;
    const rl = await rateLimit(admin, readKey, 300, 60);
    if (!rl.ok) return json(429, { error: rl.error, retryAfterSeconds: "retryAfter" in rl ? rl.retryAfter : null }, { ...auth.headers, "Retry-After": String("retryAfter" in rl ? rl.retryAfter : 60) });

    const { data: rows, error, count } = await admin
      .from("audit_logs")
      .select("id, admin_username, action_type, target_user_id, reason, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) return json(500, { error: "audit_list_failed" }, auth.headers);

    return json(200, { ok: true, page, pageSize, total: count ?? 0, rows: rows ?? [] }, auth.headers);
  }

  return json(404, { error: "not_found" }, withCors(req));
});
