// @vitest-environment jsdom

import { describe, expect, test, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { ReactNode } from "react";
import AdminUserDetails from "./AdminUserDetails";

vi.mock("@/components/layout/Layout", () => ({
  Layout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/useAdmin", () => ({
  useAdmin: () => ({ session: { username: "admin@siai.com", csrfToken: "csrf" } }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  SelectValue: () => <span />,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children, open }: { children: ReactNode; open?: boolean }) => (open ? <div>{children}</div> : null),
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: (e: unknown) => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

describe("AdminUserDetails", () => {
  test("prompts confirmation for deduct credit action", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/admin/users/") && (!init || init.method === undefined)) {
        return new Response(
          JSON.stringify({
            ok: true,
            user: {
              user_id: "user-1",
              email: "user@example.com",
              created_at: "2026-01-01T00:00:00Z",
              last_login_at: null,
              plan_tier: "free",
              plan_status: "active",
              plan_expires_at: null,
              last_activity_at: null,
              credits_balance: 5,
              stories_count: 0,
              scenes_count: 0,
            },
            credit_history: [],
            plan_history: [],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/credits") && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter initialEntries={["/admin/users/user-1"]}>
        <Routes>
          <Route path="/admin/users/:id" element={<AdminUserDetails />} />
        </Routes>
      </MemoryRouter>,
    );

    await act(async () => {});

    await userEvent.click(screen.getByText("Deduct"));
    await userEvent.type(screen.getByPlaceholderText("e.g. 50"), "10");
    await userEvent.click(screen.getByText("Apply Credit Change"));

    expect(screen.getByText("Confirm credit change")).toBeTruthy();
  });
});
