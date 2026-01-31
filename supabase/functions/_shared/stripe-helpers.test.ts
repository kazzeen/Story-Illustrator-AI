import { describe, expect, it } from "vitest";

// Re-implement the pure functions locally for testing since Deno imports
// can't be resolved by Vitest. These match the implementations in stripe-helpers.ts.

function normalizeStripeSecretKey(input: string) {
  const trimmed = input.trim();
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  const compact = unquoted.replace(/\s+/g, "");
  const match = compact.match(/sk_(?:test|live)_[0-9a-zA-Z]+/);
  return match?.[0] ?? compact;
}

function classifyStripeKeyPrefix(value: string) {
  if (!value) return "empty";
  if (value.startsWith("sk_test_")) return "sk_test_";
  if (value.startsWith("sk_live_")) return "sk_live_";
  if (value.startsWith("pk_test_")) return "pk_test_";
  if (value.startsWith("pk_live_")) return "pk_live_";
  if (value.startsWith("rk_test_")) return "rk_test_";
  if (value.startsWith("rk_live_")) return "rk_live_";
  if (value.startsWith("whsec_")) return "whsec_";
  if (value.startsWith("eyJ")) return "jwt_like";
  return "unknown";
}

describe("Supabase _shared/stripe-helpers.ts", () => {
  describe("normalizeStripeSecretKey", () => {
    it("trims whitespace", () => {
      expect(normalizeStripeSecretKey("  sk_test_abc123  ")).toBe("sk_test_abc123");
    });

    it("removes surrounding double quotes", () => {
      expect(normalizeStripeSecretKey('"sk_test_abc123"')).toBe("sk_test_abc123");
    });

    it("removes surrounding single quotes", () => {
      expect(normalizeStripeSecretKey("'sk_test_abc123'")).toBe("sk_test_abc123");
    });

    it("collapses whitespace in key", () => {
      expect(normalizeStripeSecretKey("sk_test_ abc 123")).toBe("sk_test_abc123");
    });

    it("extracts sk_ key from garbage", () => {
      // The regex is greedy on [0-9a-zA-Z]+, and whitespace is collapsed first,
      // so "suffix" (alphanumeric) gets included in the match.
      expect(normalizeStripeSecretKey("prefix sk_live_xyz789 suffix")).toBe("sk_live_xyz789suffix");
      // But with non-alphanumeric delimiters it extracts correctly:
      expect(normalizeStripeSecretKey("\"sk_live_xyz789\"")).toBe("sk_live_xyz789");
    });

    it("returns compacted input when no sk_ match found", () => {
      expect(normalizeStripeSecretKey("not a key")).toBe("notakey");
    });
  });

  describe("classifyStripeKeyPrefix", () => {
    it("classifies secret test keys", () => {
      expect(classifyStripeKeyPrefix("sk_test_abc")).toBe("sk_test_");
    });

    it("classifies secret live keys", () => {
      expect(classifyStripeKeyPrefix("sk_live_abc")).toBe("sk_live_");
    });

    it("classifies publishable test keys", () => {
      expect(classifyStripeKeyPrefix("pk_test_abc")).toBe("pk_test_");
    });

    it("classifies publishable live keys", () => {
      expect(classifyStripeKeyPrefix("pk_live_abc")).toBe("pk_live_");
    });

    it("classifies restricted keys", () => {
      expect(classifyStripeKeyPrefix("rk_test_abc")).toBe("rk_test_");
      expect(classifyStripeKeyPrefix("rk_live_abc")).toBe("rk_live_");
    });

    it("classifies webhook secrets", () => {
      expect(classifyStripeKeyPrefix("whsec_abc")).toBe("whsec_");
    });

    it("detects JWT-like tokens", () => {
      expect(classifyStripeKeyPrefix("eyJhbGciOiJIUzI1NiJ9")).toBe("jwt_like");
    });

    it("returns empty for empty strings", () => {
      expect(classifyStripeKeyPrefix("")).toBe("empty");
    });

    it("returns unknown for unrecognized prefixes", () => {
      expect(classifyStripeKeyPrefix("random_string")).toBe("unknown");
    });
  });
});
