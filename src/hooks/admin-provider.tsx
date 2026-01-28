import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AdminContext, type AdminContextValue, type AdminSession } from "./admin-context";
import { useToast } from "./use-toast";

const ADMIN_SESSION_TOKEN_KEY = "admin_session_token";
const ADMIN_CSRF_TOKEN_KEY = "admin_csrf_token";

class AdminApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.body = body;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function functionsBaseFromSupabaseUrl() {
  const raw = String((import.meta as unknown as { env?: Record<string, unknown> }).env?.VITE_SUPABASE_URL ?? "").trim();
  if (!raw) return null;
  try {
    const ref = new URL(raw).hostname.split(".")[0] ?? "";
    if (!ref) return null;
    return `https://${ref}.functions.supabase.co`;
  } catch {
    return null;
  }
}

function functionsGatewayBaseFromSupabaseUrl() {
  const supabaseUrl = String((import.meta as unknown as { env?: Record<string, unknown> }).env?.VITE_SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  const anonKey = String((import.meta as unknown as { env?: Record<string, unknown> }).env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  if (!supabaseUrl || !anonKey) return null;
  return { baseUrl: `${supabaseUrl}/functions/v1`, anonKey };
}

function rewriteAdminPathToFunctionPath(path: string) {
  return path.replace(/^\/api\/admin/, "/api-admin");
}

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")}=([^;]*)`));
  return match ? decodeURIComponent(match[1] ?? "") : null;
}

function getStored(key: string) {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStored(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (!value) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    void 0;
  }
}

async function fetchJson(url: string, init: RequestInit | undefined, includeCredentials: boolean) {
  const sessionToken = getStored(ADMIN_SESSION_TOKEN_KEY);
  const isGateway = url.includes("/functions/v1/");
  const mergedHeaders = new Headers(init?.headers ?? {});
  if (!mergedHeaders.has("Content-Type")) mergedHeaders.set("Content-Type", "application/json");
  if (!isGateway && sessionToken && !mergedHeaders.has("Authorization")) mergedHeaders.set("Authorization", `Bearer ${sessionToken}`);
  const resp = await fetch(url, {
    credentials: includeCredentials ? "include" : "omit",
    ...(init ?? {}),
    headers: mergedHeaders,
  });
  const contentType = (resp.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    const text = await resp.text().catch(() => "");
    const statusForError = resp.ok ? 502 : resp.status;
    throw new AdminApiError(`non_json_response (HTTP ${statusForError})`, statusForError, {
      error: "non_json_response",
      status: resp.status,
      contentType,
      sample: text.slice(0, 200) || null,
    });
  }

  const data = (await resp.json().catch(() => ({}))) as unknown;
  if (!resp.ok) {
    let msg = typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : `HTTP_${resp.status}`;
    if (resp.status === 429 && isRecord(data) && data.error === "rate_limited") {
      const retryAfter = typeof data.retryAfterSeconds === "number" ? data.retryAfterSeconds : null;
      if (retryAfter && Number.isFinite(retryAfter)) msg = `rate_limited (retry in ${Math.max(1, Math.round(retryAfter))}s)`;
    }
    throw new AdminApiError(`${msg} (HTTP ${resp.status})`, resp.status, data);
  }
  return data;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return (await fetchJson(path, init, true)) as T;
  } catch (err) {
    const shouldFallback =
      path.startsWith("/api/admin") &&
      (err instanceof TypeError ||
        (err instanceof AdminApiError &&
          (err.status === 404 ||
            err.status === 405 ||
            err.status === 502 ||
            err.status === 503 ||
            err.status === 504 ||
            (err.status === 500 && isRecord(err.body) && err.body.error === "configuration_error"))));

    if (!shouldFallback) throw err;

    const gateway = functionsGatewayBaseFromSupabaseUrl();
    if (gateway) {
      try {
        const url = `${gateway.baseUrl}${rewriteAdminPathToFunctionPath(path)}`;
        const sessionToken = getStored(ADMIN_SESSION_TOKEN_KEY);
        const headers = new Headers(init?.headers ?? {});
        headers.set("apikey", gateway.anonKey);
        if (!headers.has("Authorization")) {
          if (path === "/api/admin/login") {
            headers.set("Authorization", `Bearer ${gateway.anonKey}`);
          } else if (sessionToken) {
            headers.set("Authorization", `Bearer ${sessionToken}`);
            headers.set("x-admin-session", sessionToken);
          } else {
            headers.set("Authorization", `Bearer ${gateway.anonKey}`);
          }
        }
        return (await fetchJson(url, { ...(init ?? {}), headers }, false)) as T;
      } catch {
        void 0;
      }
    }

    const base = functionsBaseFromSupabaseUrl();
    if (!base) throw err;

    const url = `${base}${rewriteAdminPathToFunctionPath(path)}`;
    return (await fetchJson(url, init, false)) as T;
  }
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AdminSession | null>(null);
  const { toast } = useToast();

  const refreshSession = useCallback(async () => {
    setLoading(true);
    try {
      const enabled = String(import.meta.env.VITE_ADMIN_UI_ENABLED ?? "true").toLowerCase() !== "false";
      if (!enabled) {
        setSession(null);
        return;
      }
      const res = await api<{ ok: boolean; username?: string }>("/api/admin/session", { method: "GET" });
      if (res.ok && res.username) {
        const csrf = getCookie("admin_csrf") ?? getStored(ADMIN_CSRF_TOKEN_KEY);
        const sessionToken = getStored(ADMIN_SESSION_TOKEN_KEY);
        setSession({ username: res.username, csrfToken: csrf, sessionToken });
      } else {
        setSession(null);
      }
    } catch (err) {
      if (err instanceof AdminApiError) {
        const status = err.status;
        const body = err.body;
        const code = isRecord(body) && typeof body.error === "string" ? body.error : null;
        const definitiveLogout =
          status === 401 ||
          status === 403 ||
          status === 404 ||
          code === "not_authenticated" ||
          code === "invalid_session" ||
          code === "session_expired";
        if (definitiveLogout) {
          setStored(ADMIN_SESSION_TOKEN_KEY, null);
          setStored(ADMIN_CSRF_TOKEN_KEY, null);
          setSession(null);
        }
      }
    }
    finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(
    async ({ username, password }: { username: string; password: string }) => {
      const res = await api<{ ok: boolean; username: string; csrfToken?: string; sessionToken?: string }>("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      const csrf = res.csrfToken ?? getCookie("admin_csrf");
      const sessionToken = res.sessionToken ?? getStored(ADMIN_SESSION_TOKEN_KEY);
      setStored(ADMIN_SESSION_TOKEN_KEY, sessionToken ?? null);
      setStored(ADMIN_CSRF_TOKEN_KEY, csrf ?? null);
      setSession({ username: res.username, csrfToken: csrf ?? null, sessionToken: sessionToken ?? null });
    },
    [],
  );

  const ssoLogin = useCallback(async ({ accessToken }: { accessToken: string }) => {
    const res = await api<{ ok: boolean; username: string; csrfToken?: string; sessionToken?: string }>("/api/admin/sso", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({}),
    });
    const csrf = res.csrfToken ?? getCookie("admin_csrf");
    const sessionToken = res.sessionToken ?? getStored(ADMIN_SESSION_TOKEN_KEY);
    setStored(ADMIN_SESSION_TOKEN_KEY, sessionToken ?? null);
    setStored(ADMIN_CSRF_TOKEN_KEY, csrf ?? null);
    setSession({ username: res.username, csrfToken: csrf ?? null, sessionToken: sessionToken ?? null });
  }, []);

  const bypassLogin = useCallback(async ({ accessToken }: { accessToken: string }) => {
    const res = await api<{ ok: boolean; username: string; csrfToken?: string; sessionToken?: string }>("/api/admin/bypass", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({}),
    });
    const csrf = res.csrfToken ?? getCookie("admin_csrf");
    const sessionToken = res.sessionToken ?? getStored(ADMIN_SESSION_TOKEN_KEY);
    setStored(ADMIN_SESSION_TOKEN_KEY, sessionToken ?? null);
    setStored(ADMIN_CSRF_TOKEN_KEY, csrf ?? null);
    setSession({ username: res.username, csrfToken: csrf ?? null, sessionToken: sessionToken ?? null });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api<{ ok: boolean }>("/api/admin/logout", { method: "POST", body: JSON.stringify({}) });
    } catch {
      void 0;
    } finally {
      setStored(ADMIN_SESSION_TOKEN_KEY, null);
      setStored(ADMIN_CSRF_TOKEN_KEY, null);
      setSession(null);
      toast({ title: "Signed out", description: "Admin session ended." });
    }
  }, [toast]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const value = useMemo<AdminContextValue>(
    () => ({ loading, session, refreshSession, login, ssoLogin, bypassLogin, logout }),
    [loading, session, refreshSession, login, ssoLogin, bypassLogin, logout],
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}
