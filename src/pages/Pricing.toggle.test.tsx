// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReactNode } from "react";

function stubLocationAssign() {
  const origin = window.location.origin;
  const assign = vi.fn();
  vi.stubGlobal("location", { origin, assign } as unknown as Location);
  return assign;
}

vi.mock("@/components/layout/Layout", () => ({
  Layout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const mocks = vi.hoisted(() => ({
  authState: {
    user: null,
    session: null,
    refreshProfile: vi.fn(async () => {}),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mocks.authState,
}));

const navigationMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => navigationMocks.navigate,
  };
});

const toastMocks = vi.hoisted(() => ({
  toast: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => toastMocks,
}));

const supabaseMocks = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(async () => ({ data: { session: { access_token: "token" } } })),
    refreshSession: vi.fn(async () => ({ data: { session: { access_token: "token" } }, error: null })),
  },
  functions: {
    invoke: vi.fn(async () => ({ data: { url: "https://example.com/checkout" }, error: null })),
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: supabaseMocks,
}));

beforeEach(() => {
  vi.resetModules();
  mocks.authState.user = null;
  mocks.authState.session = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("Pricing toggle", () => {
  test("updates starter credit cost immediately when toggling billing period", async () => {
    const user = userEvent.setup();
    const { default: Pricing } = await import("./Pricing");
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
    const { default: Pricing } = await import("./Pricing");
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

  test("keeps starter credit pricing visible at different viewport sizes", async () => {
    const prevWidth = window.innerWidth;
    try {
      window.innerWidth = 360;
      window.dispatchEvent(new Event("resize"));
      const { default: Pricing } = await import("./Pricing");
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
});

describe("Pricing checkout buttons", () => {
  test("starts Starter subscription checkout", async () => {
    const user = userEvent.setup();
    toastMocks.toast.mockClear();
    navigationMocks.navigate.mockClear();
    supabaseMocks.functions.invoke.mockClear();
    mocks.authState.user = { id: "user-id" } as never;
    const { default: Pricing } = await import("./Pricing");
    const assign = stubLocationAssign();

    render(
      <MemoryRouter>
        <TooltipProvider>
          <Pricing />
        </TooltipProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getAllByRole("button", { name: "Get Started" })[0]);

    expect(supabaseMocks.functions.invoke).toHaveBeenCalled();
    const [fn, opts] = supabaseMocks.functions.invoke.mock.calls[0];
    expect(fn).toBe("create-starter-membership-checkout");
    expect((opts as { body?: Record<string, unknown> }).body?.interval).toBe("year");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://example.com/checkout"));
  });

  test("starts Creator subscription checkout", async () => {
    const user = userEvent.setup();
    toastMocks.toast.mockClear();
    navigationMocks.navigate.mockClear();
    supabaseMocks.functions.invoke.mockClear();
    mocks.authState.user = { id: "user-id" } as never;
    const { default: Pricing } = await import("./Pricing");
    const assign = stubLocationAssign();

    render(
      <MemoryRouter>
        <TooltipProvider>
          <Pricing />
        </TooltipProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Upgrade to Creator" }));

    expect(supabaseMocks.functions.invoke).toHaveBeenCalled();
    const [fn, opts] = supabaseMocks.functions.invoke.mock.calls[0];
    expect(fn).toBe("create-creator-membership-checkout");
    expect((opts as { body?: Record<string, unknown> }).body?.tier).toBe("creator");
    expect((opts as { body?: Record<string, unknown> }).body?.interval).toBe("year");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://example.com/checkout"));
  });

  test("starts Professional subscription checkout", async () => {
    const user = userEvent.setup();
    toastMocks.toast.mockClear();
    navigationMocks.navigate.mockClear();
    supabaseMocks.functions.invoke.mockClear();
    mocks.authState.user = { id: "user-id" } as never;
    const { default: Pricing } = await import("./Pricing");
    const assign = stubLocationAssign();

    render(
      <MemoryRouter>
        <TooltipProvider>
          <Pricing />
        </TooltipProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getAllByRole("button", { name: "Go Professional" })[0]);

    expect(supabaseMocks.functions.invoke).toHaveBeenCalled();
    const [fn, opts] = supabaseMocks.functions.invoke.mock.calls[0];
    expect(fn).toBe("create-creator-membership-checkout");
    expect((opts as { body?: Record<string, unknown> }).body?.tier).toBe("professional");
    expect((opts as { body?: Record<string, unknown> }).body?.interval).toBe("year");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://example.com/checkout"));
  });

  test("starts credit pack checkout", async () => {
    const user = userEvent.setup();
    toastMocks.toast.mockClear();
    navigationMocks.navigate.mockClear();
    supabaseMocks.functions.invoke.mockClear();
    mocks.authState.user = { id: "user-id" } as never;
    const { default: Pricing } = await import("./Pricing");
    const assign = stubLocationAssign();

    render(
      <MemoryRouter>
        <TooltipProvider>
          <Pricing />
        </TooltipProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getAllByRole("button", { name: "Buy 50 Credits" })[0]);

    expect(supabaseMocks.functions.invoke).toHaveBeenCalled();
    const [fn, opts] = supabaseMocks.functions.invoke.mock.calls[0];
    expect(fn).toBe("create-credit-pack-checkout");
    expect((opts as { body?: Record<string, unknown> }).body?.pack).toBe("small");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://example.com/checkout"));
  });

  test("redirects to auth with feedback when session is missing", async () => {
    const user = userEvent.setup();
    toastMocks.toast.mockClear();
    navigationMocks.navigate.mockClear();
    supabaseMocks.functions.invoke.mockClear();
    mocks.authState.user = null;
    supabaseMocks.auth.getSession.mockImplementationOnce(async () => ({ data: { session: null } }));
    supabaseMocks.auth.refreshSession.mockImplementationOnce(async () => ({ data: { session: null }, error: null }));

    const { default: Pricing } = await import("./Pricing");
    render(
      <MemoryRouter>
        <TooltipProvider>
          <Pricing />
        </TooltipProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getAllByRole("button", { name: "Get Started" })[0]);

    expect(supabaseMocks.functions.invoke).not.toHaveBeenCalled();
    expect(toastMocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Sign in required", variant: "destructive" }),
    );
    expect(navigationMocks.navigate).toHaveBeenCalled();
  });

  test("shows clear authorization error when Edge Function returns 401", async () => {
    const user = userEvent.setup();
    toastMocks.toast.mockClear();
    navigationMocks.navigate.mockClear();
    supabaseMocks.functions.invoke.mockClear();
    mocks.authState.user = { id: "user-id" } as never;
    const { default: Pricing } = await import("./Pricing");
    const assign = stubLocationAssign();

    supabaseMocks.functions.invoke
      .mockImplementationOnce(async () => ({
        data: null,
        error: { status: 401 } as never,
      }))
      .mockImplementationOnce(async () => ({
        data: null,
        error: { status: 401 } as never,
      }));

    render(
      <MemoryRouter>
        <TooltipProvider>
          <Pricing />
        </TooltipProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getAllByRole("button", { name: "Get Started" })[0]);

    expect(assign).not.toHaveBeenCalled();
    expect(toastMocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Authorization error", variant: "destructive" }),
    );
    expect(navigationMocks.navigate).not.toHaveBeenCalled();
  });
});
