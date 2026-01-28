// @vitest-environment jsdom

import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Navbar } from "./Navbar";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  authState: {
    user: { id: "user-1", email: "user@example.com" } as { id: string; email?: string | null },
    signOut: vi.fn(async () => {}),
    profile: { credits_balance: 0, subscription_tier: "free" } as { credits_balance?: number; subscription_tier?: string },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mocks.authState,
}));

vi.mock("@/hooks/useAdmin", () => ({
  useAdmin: () => ({ session: null }),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <div />,
}));

describe("Navbar", () => {
  beforeEach(() => {
    mocks.authState.profile = { credits_balance: 0, subscription_tier: "free" };
  });

  test("shows credits and plan label for a signed-in user", () => {
    mocks.authState.profile = { credits_balance: 123, subscription_tier: "creator" };

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Navbar />
      </MemoryRouter>,
    );

    expect(screen.getByText("123")).toBeTruthy();
    expect(screen.getAllByText("credits")[0]).toBeTruthy();
    expect(screen.getByText("Creator")).toBeTruthy();
  });

  test("maps professional tier to Pro label", () => {
    mocks.authState.profile = { credits_balance: 999, subscription_tier: "professional" };

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Navbar />
      </MemoryRouter>,
    );

    expect(screen.getByText("Pro")).toBeTruthy();
  });
});
