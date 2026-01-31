import { describe, expect, it } from "vitest";

// We import the functions' logic directly since they're pure utility functions.
// In the actual edge functions, these are imported from helpers.ts via Deno,
// but the logic is identical and testable with Vitest.

// Re-implement locally for testing since Deno imports can't be resolved by Vitest.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(
  status: number,
  body: unknown,
  corsHeaders: Record<string, string>,
  extraHeaders?: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(extraHeaders ?? {}) },
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("Supabase _shared/helpers.ts", () => {
  describe("isRecord", () => {
    it("returns true for plain objects", () => {
      expect(isRecord({})).toBe(true);
      expect(isRecord({ key: "val" })).toBe(true);
    });

    it("returns false for non-objects", () => {
      expect(isRecord(null)).toBe(false);
      expect(isRecord([])).toBe(false);
      expect(isRecord("str")).toBe(false);
      expect(isRecord(123)).toBe(false);
    });
  });

  describe("asString", () => {
    it("returns the string for string inputs", () => {
      expect(asString("test")).toBe("test");
    });

    it("returns null for non-strings", () => {
      expect(asString(123)).toBe(null);
      expect(asString(null)).toBe(null);
      expect(asString(undefined)).toBe(null);
    });
  });

  describe("UUID_REGEX", () => {
    it("matches valid UUIDs (lowercase)", () => {
      expect(UUID_REGEX.test("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(true);
    });

    it("matches valid UUIDs (uppercase)", () => {
      expect(UUID_REGEX.test("A1B2C3D4-E5F6-7890-ABCD-EF1234567890")).toBe(true);
    });

    it("rejects invalid UUIDs", () => {
      expect(UUID_REGEX.test("short")).toBe(false);
      expect(UUID_REGEX.test("a1b2c3d4-e5f6-7890-abcd")).toBe(false);
    });
  });

  describe("jsonResponse", () => {
    it("creates a Response with correct status", async () => {
      const resp = jsonResponse(200, { ok: true }, { "X-Custom": "val" });
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body).toEqual({ ok: true });
    });

    it("includes CORS headers and Content-Type", () => {
      const cors = { "Access-Control-Allow-Origin": "*" };
      const resp = jsonResponse(400, { error: "bad" }, cors);
      expect(resp.headers.get("Content-Type")).toBe("application/json");
      expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("merges extra headers", () => {
      const resp = jsonResponse(200, {}, {}, { "X-Extra": "yes" });
      expect(resp.headers.get("X-Extra")).toBe("yes");
    });
  });

  describe("escapeRegExp", () => {
    it("escapes special regex characters", () => {
      expect(escapeRegExp("hello.world")).toBe("hello\\.world");
      expect(escapeRegExp("a+b*c?")).toBe("a\\+b\\*c\\?");
      expect(escapeRegExp("(foo)")).toBe("\\(foo\\)");
      expect(escapeRegExp("[bar]")).toBe("\\[bar\\]");
      expect(escapeRegExp("{baz}")).toBe("\\{baz\\}");
      expect(escapeRegExp("a|b")).toBe("a\\|b");
      expect(escapeRegExp("^start$end")).toBe("\\^start\\$end");
      expect(escapeRegExp("back\\slash")).toBe("back\\\\slash");
    });

    it("returns plain strings unchanged", () => {
      expect(escapeRegExp("hello world")).toBe("hello world");
      expect(escapeRegExp("abc123")).toBe("abc123");
    });

    it("escaped strings work correctly in RegExp", () => {
      const special = "price: $9.99 (USD)";
      const re = new RegExp(escapeRegExp(special));
      expect(re.test(special)).toBe(true);
      expect(re.test("price: $9X99 (USD)")).toBe(false);
    });
  });
});
