// @vitest-environment jsdom

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Pricing, { formatUsd } from "./Pricing";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  authState: {
    user: null as { id: string; email?: string | null } | null,
    refreshProfile: vi.fn(async () => {}),
  },
  getSession: vi.fn(async () => ({ data: { session: { access_token: "token" } }, error: null })),
}));

vi.mock("@/components/layout/Layout", () => ({
  Layout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mocks.authState,
}));

vi.mock("@/integrations/supabase/client", () => ({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_KEY: "sb_publishable_test",
  supabase: { auth: { getSession: mocks.getSession } },
}));

describe("Pricing toggle", () => {
  test("updates starter credit cost immediately when toggling billing period", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TooltipProvider>
          <Pricing />
        </TooltipProvider>
      </MemoryRouter>,
    );

    expect(screen.getAllByText("$0.08 per credit")[0]).toBeTruthy();

    const toggles = screen.getAllByRole("switch");
    const toggle = toggles[0];
    await user.click(toggle);

    const monthly = await screen.findByText("$0.10 per credit");
    expect(monthly).toBeTruthy();
    expect(monthly.className).toContain("animate-in");
    expect(monthly.className).toContain("fade-in");
  });

  test.skip("handles rapid toggling between modes", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TooltipProvider>
          <Pricing />
        </TooltipProvider>
      </MemoryRouter>,
    );

    const toggles = screen.getAllByRole("switch");
    const toggle = toggles[0];
    // Toggle 3 times (odd number) to switch from Annual (default) to Monthly
    for (let i = 0; i < 3; i++) {
      await user.click(toggle);
    }

    const monthlyText = await screen.findByText("$0.10 per credit");
    expect(monthlyText).toBeTruthy();
  });

  test("keeps starter credit pricing visible at different viewport sizes", () => {
    const prevWidth = window.innerWidth;
    try {
      window.innerWidth = 360;
      window.dispatchEvent(new Event("resize"));
      render(
        <MemoryRouter>
          <TooltipProvider>
            <Pricing />
          </TooltipProvider>
        </MemoryRouter>,
      );
      const prices = screen.getAllByText("$0.08 per credit");
      expect(prices.length).toBeGreaterThan(0);
      expect(prices[0]).toBeTruthy();
    } finally {
      window.innerWidth = prevWidth;
      window.dispatchEvent(new Event("resize"));
    }
  });

  test("formats currency with two decimal places across locales", () => {
    expect(formatUsd(0.1, "en-US")).toBe("$0.10");
    expect(formatUsd(1, "en-US")).toBe("$1.00");
    expect(formatUsd(0.1, "de-DE")).toMatch(/0[,.]10/);
  });

  test("starts credit pack checkout for logged-in users", async () => {
    mocks.authState.user = { id: "user-1", email: "test@example.com" };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ url: "https://stripe.example/checkout" }),
    }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const assignMock = vi.fn();
    const originalLocation = window.location;
    vi.stubGlobal(
      "location",
      {
        origin: originalLocation.origin,
        href: originalLocation.href,
        assign: assignMock,
      } as unknown as Location,
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TooltipProvider>
          <Pricing />
        </TooltipProvider>
      </MemoryRouter>,
    );

    const btn = await screen.findByRole("button", { name: /buy 50 credits/i });
    await user.click(btn);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [fetchUrl, fetchInit] = fetchMock.mock.calls[0] as unknown as [unknown, unknown];
    expect(fetchUrl).toBe("https://example.supabase.co/functions/v1/create-credit-pack-checkout");
    expect(fetchInit).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        apikey: "sb_publishable_test",
        "Content-Type": "application/json",
      },
    });
    expect(assignMock).toHaveBeenCalledTimes(1);
    expect(assignMock).toHaveBeenCalledWith("https://stripe.example/checkout");
    vi.unstubAllGlobals();
    mocks.authState.user = null;
  });
});
