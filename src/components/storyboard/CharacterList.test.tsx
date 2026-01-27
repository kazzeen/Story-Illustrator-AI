// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

type SupabaseSession = { access_token: string; user: { id: string; email?: string } };

const mocks = vi.hoisted(() => ({
  refreshProfile: vi.fn<() => Promise<void>>().mockResolvedValue(),
  fetchCharacters: vi.fn<() => Promise<void>>().mockResolvedValue(),
  toast: vi.fn(),
  session: { access_token: "token", user: { id: "user-1", email: "test@example.com" } } as SupabaseSession,
  verificationRows: [{ id: "c1", name: "Alice", image_url: "https://example.com/image.png" }],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () =>
    ({
      refreshProfile: mocks.refreshProfile,
      user: { id: "user-1" },
    }) as unknown,
}));

vi.mock("@/hooks/useCharacters", () => ({
  useCharacters: () => ({
    characters: [
      {
        id: "c1",
        story_id: "s1",
        name: "Alice",
        description: null,
        physical_attributes: null,
        clothing: null,
        accessories: null,
        personality: null,
        image_url: "https://example.com/existing.png",
        source: "manual",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    loading: false,
    addCharacter: vi.fn(),
    updateCharacter: vi.fn(),
    deleteCharacter: vi.fn(),
    fetchCharacters: mocks.fetchCharacters,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const verificationBuilder = {
    select: vi.fn(() => verificationBuilder),
    eq: vi.fn(async () => ({ data: mocks.verificationRows, error: null })),
  };

  const SUPABASE_URL = "https://example.supabase.co";
  const SUPABASE_KEY = "sb_publishable_test";

  const supabase = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: mocks.session }, error: null })),
      refreshSession: vi.fn(async () => ({ data: { session: mocks.session }, error: null })),
    },
    from: vi.fn(() => verificationBuilder),
  };

  return { supabase, SUPABASE_URL, SUPABASE_KEY };
});

beforeEach(() => {
  mocks.refreshProfile.mockClear();
  mocks.fetchCharacters.mockClear();
  mocks.toast.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => {
    return new Response(JSON.stringify({ success: true, imageUrl: "https://example.com/new.png" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));
  if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== "function") {
    vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-0000-0000-000000000000" });
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CharacterList credit balance refresh", () => {
  test("refreshes profile after regenerating a character image", async () => {
    const { CharacterList } = await import("./CharacterList");
    const { container } = render(<CharacterList storyId="s1" />);

    const regenerateButton = container.querySelector("button.absolute.top-2.right-2");
    if (!regenerateButton) throw new Error("Regenerate button not found");

    fireEvent.click(regenerateButton);

    await waitFor(() => {
      expect(mocks.fetchCharacters).toHaveBeenCalledTimes(1);
      expect(mocks.refreshProfile).toHaveBeenCalledTimes(1);
    });
  });

  test("refreshes profile after batch character generation", async () => {
    vi.useFakeTimers();

    const { CharacterList } = await import("./CharacterList");
    render(<CharacterList storyId="s1" />);

    fireEvent.click(screen.getByRole("button", { name: /generate characters/i }));

    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(mocks.fetchCharacters).toHaveBeenCalledTimes(1);
    expect(mocks.refreshProfile).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
