// @vitest-environment jsdom

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Pricing, { formatUsd } from "./Pricing";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReactNode } from "react";

vi.mock("@/components/layout/Layout", () => ({
  Layout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
    expect(formatUsd(0.1, "de-DE")).toMatch(/0[,\.]10/);
  });
});
