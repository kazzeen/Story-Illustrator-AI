// @vitest-environment jsdom

import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { AdminProvider } from "./admin-provider";
import { useAdmin } from "./useAdmin";

function Consumer() {
  const { loading, session, login, logout, refreshSession } = useAdmin();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="username">{session?.username ?? ""}</div>
      <button type="button" onClick={() => void refreshSession()}>
        refresh
      </button>
      <button type="button" onClick={() => void login({ username: "admin@siai.com", password: "pw" })}>
        login
      </button>
      <button type="button" onClick={() => void logout()}>
        logout
      </button>
    </div>
  );
}

function Wrapper({ children }: { children: ReactNode }) {
  return <AdminProvider>{children}</AdminProvider>;
}

describe("AdminProvider", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    (import.meta as unknown as { env: Record<string, unknown> }).env = {
      ...(import.meta as unknown as { env: Record<string, unknown> }).env,
      VITE_ADMIN_UI_ENABLED: "true",
    };

    Object.defineProperty(document, "cookie", { value: "admin_csrf=testcsrf", writable: true });
  });

  test("loads unauthenticated session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "not_authenticated" }), { status: 401 })),
    );

    render(
      <Wrapper>
        <Consumer />
      </Wrapper>,
    );

    await act(async () => {});
    expect(screen.getByTestId("loading").textContent).toBe("false");
    expect(screen.getByTestId("username").textContent).toBe("");
  });

  test("logs in and sets session", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/admin/login")) {
        return new Response(JSON.stringify({ ok: true, username: "admin@siai.com", csrfToken: "abc" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <Wrapper>
        <Consumer />
      </Wrapper>,
    );

    await act(async () => {
      screen.getAllByText("login")[0]?.click();
    });

    expect(screen.getByTestId("username").textContent).toBe("admin@siai.com");
  });

  test("logs out and clears session", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/admin/login")) {
        return new Response(JSON.stringify({ ok: true, username: "admin@siai.com", csrfToken: "abc" }), { status: 200 });
      }
      if (url.includes("/api/admin/logout")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, username: "admin@siai.com" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <Wrapper>
        <Consumer />
      </Wrapper>,
    );

    await act(async () => {
      screen.getAllByText("login")[0]?.click();
    });
    expect(screen.getByTestId("username").textContent).toBe("admin@siai.com");

    await act(async () => {
      screen.getAllByText("logout")[0]?.click();
    });
    expect(screen.getByTestId("username").textContent).toBe("");
  });

  test("falls back to functions/v1 and sends apikey + auth headers", async () => {
    (import.meta as unknown as { env: Record<string, unknown> }).env = {
      ...(import.meta as unknown as { env: Record<string, unknown> }).env,
      VITE_SUPABASE_URL: "https://gaxmjxiqjirjeyemjcyc.supabase.co",
    };

    let gatewayHeaders: Headers | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/admin/login")) {
        return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405 });
      }
      if (url.includes("/functions/v1/api-admin/login")) {
        gatewayHeaders = new Headers(init?.headers ?? {});
        return new Response(JSON.stringify({ ok: true, username: "admin@siai.com", csrfToken: "abc", sessionToken: "sess" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <Wrapper>
        <Consumer />
      </Wrapper>,
    );

    await act(async () => {
      screen.getAllByText("login")[0]?.click();
    });

    const apiKey = gatewayHeaders?.get("apikey") ?? "";
    expect(apiKey.length).toBeGreaterThan(10);
    expect(gatewayHeaders?.get("authorization")).toBe(`Bearer ${apiKey}`);
    expect(screen.getByTestId("username").textContent).toBe("admin@siai.com");
  });
});
