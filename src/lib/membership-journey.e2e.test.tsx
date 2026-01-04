import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";

type InvokeResult = { data: unknown; error: unknown };

const supabaseMocks = vi.hoisted(() => ({
  invokeMock: vi.fn<(...args: unknown[]) => Promise<InvokeResult>>(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const session = {
    user: { id: "user-1", email: "test@example.com" },
    access_token: "token",
  };

  const fromBuilder = {
    select: vi.fn(() => fromBuilder),
    eq: vi.fn(() => fromBuilder),
    single: vi.fn(async () => ({
      data: { display_name: null, avatar_url: null, preferred_style: null, credits_balance: 0, subscription_tier: "free" },
      error: null,
    })),
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
    channel: vi.fn(() => ({ on: vi.fn(() => ({ subscribe: vi.fn(() => ({}) as unknown) }) as unknown), subscribe: vi.fn(() => ({})) })),
    removeChannel: vi.fn(),
  };

  return { supabase, SUPABASE_URL: "https://example.supabase.co", SUPABASE_KEY: "sb_publishable_test" };
});

function getCreditsButton() {
  const buttons = screen.queryAllByRole("button");
  return buttons.find((button) => /credits/i.test(button.textContent ?? "")) ?? null;
}

describe("membership journey (e2e)", () => {
  beforeEach(() => {
    vi.resetModules();
    supabaseMocks.invokeMock.mockReset();
    window.history.replaceState({}, "", "/pricing?checkout=success&session_id=cs_test");
  });

  afterEach(() => {
    cleanup();
  });

  test("shows updated plan and credits after successful checkout return", async () => {
    supabaseMocks.invokeMock.mockResolvedValue({
      data: { success: true, credits: { tier: "professional", remaining_monthly: 1000, remaining_bonus: 0 } },
      error: null,
    });

    const [{ AuthProvider }, { default: Pricing }] = await Promise.all([
      import("@/hooks/auth-provider"),
      import("@/pages/Pricing"),
    ]);

    render(
      <MemoryRouter initialEntries={["/pricing?checkout=success&session_id=cs_test"]}>
        <AuthProvider>
          <TooltipProvider>
            <Pricing />
          </TooltipProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(
      () => {
        const btn = getCreditsButton();
        if (!btn) throw new Error("Credits button not found");
        const text = btn.textContent ?? "";
        if (!/1000\s*credits/i.test(text)) throw new Error(`Credits button text was ${JSON.stringify(text)}`);
        if (!/\bpro\b/i.test(text)) throw new Error(`Plan text was ${JSON.stringify(text)}`);
      },
      { timeout: 4000 },
    );
  });
});
