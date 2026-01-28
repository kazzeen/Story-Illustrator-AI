// @vitest-environment jsdom

import { describe, expect, test, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminUsers from "./AdminUsers";
import type { ReactNode } from "react";

const toastMock = vi.fn();

vi.mock("@/components/layout/Layout", () => ({
  Layout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/useAdmin", () => ({
  useAdmin: () => ({ session: { username: "admin@siai.com", csrfToken: "csrf" } }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  SelectValue: () => <span />,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("AdminUsers", () => {
  test("requests user list with pagination and sorting params", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, page: 1, pageSize: 20, total: 0, rows: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <AdminUsers />
      </MemoryRouter>,
    );

    await act(async () => {});
    expect(fetchMock).toHaveBeenCalled();
    const calledUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("/api/admin/users?");
    expect(calledUrl).toContain("page=1");
    expect(calledUrl).toContain("pageSize=20");
    expect(calledUrl).toContain("sortBy=");
    expect(calledUrl).toContain("sortDir=");
    expect(screen.getByText("Users")).toBeTruthy();
  });
});
