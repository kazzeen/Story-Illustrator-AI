// @vitest-environment jsdom

import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import Profile from "./Profile";

const mocks = vi.hoisted(() => ({
  authState: {
    user: null as null | { id: string; email?: string | null },
    profile: null as null | { credits_balance?: number | null; subscription_tier?: string | null; display_name?: string | null },
    refreshProfile: vi.fn(async () => {}),
  },
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: "token-1" } } })),
    },
    functions: {
      invoke: vi.fn(async () => ({ data: null, error: null })),
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mocks.authState,
}));

vi.mock("@/components/layout/Layout", () => ({
  Layout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: mocks.supabase,
}));

describe("Profile", () => {
  beforeEach(() => {
    mocks.authState.user = null;
    mocks.authState.profile = null;
    mocks.supabase.functions.invoke.mockResolvedValue({ data: null, error: null });
  });

  test("prompts for sign in when signed out", () => {
    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );

    expect(screen.getByText("Profile")).toBeTruthy();
    expect(screen.getByText("Sign in to view your account and credit usage.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign In" })).toBeTruthy();
  });

  test("shows credits and recent activity for signed-in user", async () => {
    mocks.authState.user = { id: "user-1", email: "user@example.com" };
    mocks.authState.profile = { credits_balance: 10, subscription_tier: "starter", display_name: "Alex" };

    mocks.supabase.functions.invoke.mockResolvedValue({
      data: {
        success: true,
        credits: {
          tier: "starter",
          monthly_credits_per_cycle: 5,
          monthly_credits_used: 2,
          bonus_credits_total: 10,
          bonus_credits_used: 1,
          remaining_monthly: 3,
          remaining_bonus: 9,
          cycle_start_at: "2026-01-01T00:00:00Z",
          cycle_end_at: "2026-02-01T00:00:00Z",
        },
        transactions: [
          {
            id: "tx-1",
            amount: -1,
            transaction_type: "usage",
            description: "Scene image generation",
            metadata: { feature: "generate-scene-image" },
            pool: "monthly",
            created_at: "2026-01-02T00:00:00Z",
            request_id: "req-1",
          },
        ],
      },
      error: null,
    });

    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );

    expect(await screen.findByText("user@example.com")).toBeTruthy();
    const balance = await screen.findByTestId("profile-credits-balance");
    expect(balance.textContent).toBe("12");
    expect(await screen.findByText("Scene image generation")).toBeTruthy();
    expect(await screen.findByText("generate-scene-image")).toBeTruthy();
  });
});
