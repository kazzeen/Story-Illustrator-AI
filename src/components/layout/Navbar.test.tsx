// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

type InvokeResult = { data: unknown; error: unknown };

const supabaseMocks = vi.hoisted(() => ({
  realtimeCallback: null as ((payload: unknown) => void) | null,
  invokeMock: vi.fn<(...args: unknown[]) => Promise<InvokeResult>>(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const SUPABASE_URL = "https://example.supabase.co";
  const SUPABASE_KEY = "sb_publishable_test";

  const channelObj = {
    on: vi.fn((event: unknown, filter: unknown, cb: (payload: unknown) => void) => {
      supabaseMocks.realtimeCallback = cb;
      return channelObj;
    }),
    subscribe: vi.fn(() => channelObj),
  };

  const fromBuilder = {
    select: vi.fn(() => fromBuilder),
    eq: vi.fn(() => fromBuilder),
    single: vi.fn(async () => ({
      data: { display_name: null, avatar_url: null, preferred_style: null, credits_balance: null, subscription_tier: "free" },
      error: null,
    })),
  };

  const session = {
    user: { id: "user-1", email: "test@example.com" },
    access_token: "token",
  };

  const supabase = {
    auth: {
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      getSession: vi.fn(async () => ({ data: { session } })),
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn(() => fromBuilder),
    functions: { invoke: supabaseMocks.invokeMock },
    channel: vi.fn(() => channelObj),
    removeChannel: vi.fn(),
  };

  return { supabase, SUPABASE_URL, SUPABASE_KEY };
});

async function renderNavbar() {
  const [{ AuthProvider }, { Navbar }] = await Promise.all([import("@/hooks/auth-provider"), import("./Navbar")]);
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Navbar />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function getCreditsButton() {
  const buttons = screen.queryAllByRole("button");
  return buttons.find((button) => /credits/i.test(button.textContent ?? "")) ?? null;
}

describe("Navbar credits counter", () => {
  beforeEach(() => {
    vi.resetModules();
    supabaseMocks.invokeMock.mockReset();
    supabaseMocks.realtimeCallback = null;
  });

  afterEach(() => {
    cleanup();
  });

  test("shows computed credits balance from credits status", async () => {
    supabaseMocks.invokeMock.mockResolvedValueOnce({
      data: { success: true, credits: { remaining_monthly: 5, remaining_bonus: 0 } },
      error: null,
    });

    await renderNavbar();

    await screen.findByText("New Story");
    await waitFor(
      () => {
        expect(supabaseMocks.invokeMock).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
    await waitFor(
      () => {
        const btn = getCreditsButton();
        if (!btn) throw new Error("Credits button not found");
        const text = btn.textContent ?? "";
        if (!/5\s*credits/i.test(text)) throw new Error(`Credits button text was ${JSON.stringify(text)}`);
      },
      { timeout: 3000 },
    );
  });

  test("updates credits counter after realtime credit change", async () => {
    supabaseMocks.invokeMock.mockResolvedValue({
      data: { success: true, credits: { remaining_monthly: 5, remaining_bonus: 0 } },
      error: null,
    });

    await renderNavbar();

    await screen.findByText("New Story");
    await waitFor(
      () => {
        expect(supabaseMocks.invokeMock).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
    await waitFor(
      () => {
        const btn = getCreditsButton();
        if (!btn) throw new Error("Credits button not found");
        const text = btn.textContent ?? "";
        if (!/5\s*credits/i.test(text)) throw new Error(`Credits button text was ${JSON.stringify(text)}`);
      },
      { timeout: 3000 },
    );

    await waitFor(
      () => {
        expect(supabaseMocks.realtimeCallback).toBeTruthy();
      },
      { timeout: 3000 },
    );

    supabaseMocks.invokeMock.mockResolvedValueOnce({
      data: { success: true, credits: { remaining_monthly: 4, remaining_bonus: 0 } },
      error: null,
    });
    await act(async () => {
      supabaseMocks.realtimeCallback?.({});
    });

    await waitFor(
      () => {
        expect(supabaseMocks.invokeMock).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 },
    );
    await waitFor(
      () => {
        const btn = getCreditsButton();
        if (!btn) throw new Error("Credits button not found");
        const text = btn.textContent ?? "";
        if (!/4\s*credits/i.test(text)) throw new Error(`Credits button text was ${JSON.stringify(text)}`);
      },
      { timeout: 3000 },
    );
  });
});
