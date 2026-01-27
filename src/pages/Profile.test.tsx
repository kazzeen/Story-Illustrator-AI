// @vitest-environment jsdom

import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
    vi.useRealTimers();
    mocks.authState.user = null;
    mocks.authState.profile = null;
    mocks.supabase.functions.invoke.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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

  test("shows failed activity with specific reason for releases", async () => {
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
            id: "tx-2",
            amount: 0,
            transaction_type: "release",
            description: "Scene image generation failed: Generated image appears blank (mean=0, std=0)",
            metadata: {
              feature: "generate-scene-image",
              stage: "blank_image",
              release_reason: "Scene image generation failed: Generated image appears blank (mean=0, std=0)",
            },
            pool: "monthly",
            created_at: "2026-01-03T00:00:00Z",
            request_id: "00000000-0000-0000-0000-000000000099",
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

    const failedCell = await screen.findByText("failed");
    const row = failedCell.closest("tr");
    expect(row?.textContent ?? "").toMatch(/Generated\s+image\s+appears\s+blank/i);
  });

  test("shows failed activity using metadata failure_reason when description missing", async () => {
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
            id: "tx-3",
            amount: 0,
            transaction_type: "refund",
            description: null,
            metadata: {
              feature: "generate-scene-image",
              failure_reason: "Scene image generation failed: Upstream timeout",
            },
            pool: "monthly",
            created_at: "2026-01-04T00:00:00Z",
            request_id: "req-2",
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

    expect(await screen.findByText(/Upstream timeout/)).toBeTruthy();
  });

  test("shows failed activity using refund_reason when present", async () => {
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
            id: "tx-4",
            amount: 0,
            transaction_type: "refund",
            description: "Generation failed",
            metadata: {
              feature: "generate-scene-image",
              refund_reason: "Scene image generation failed: Model rejected prompt",
            },
            pool: "monthly",
            created_at: "2026-01-05T00:00:00Z",
            request_id: "req-3",
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

    expect(await screen.findByText(/Model rejected prompt/)).toBeTruthy();
  });
  
});
