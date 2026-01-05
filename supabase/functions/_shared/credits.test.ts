import { describe, expect, it } from "vitest";
import { parseCommitReservedCreditsResult, parseConsumeCreditsResult, parseReleaseReservedCreditsResult } from "./credits";

describe("credits", () => {
  it("parses ok result", () => {
    const parsed = parseConsumeCreditsResult({ ok: true, tier: "starter", remaining_monthly: 10, remaining_bonus: 2 });
    expect(parsed?.ok).toBe(true);
  });

  it("parses insufficient credits result", () => {
    const parsed = parseConsumeCreditsResult({
      ok: false,
      reason: "insufficient_credits",
      remaining_monthly: 0,
      remaining_bonus: 0,
      tier: "basic",
    });
    expect(parsed?.ok).toBe(false);
    if (parsed?.ok === false) expect(parsed.reason).toBe("insufficient_credits");
  });

  it("returns null for non-object values", () => {
    expect(parseConsumeCreditsResult(null)).toBeNull();
    expect(parseConsumeCreditsResult("x")).toBeNull();
    expect(parseConsumeCreditsResult([])).toBeNull();
  });

  it("parses commit reserved credits ok result", () => {
    const parsed = parseCommitReservedCreditsResult({ ok: true, remaining_monthly: 4, remaining_bonus: 0, tier: "basic" });
    expect(parsed?.ok).toBe(true);
  });

  it("parses release reserved credits ok result", () => {
    const parsed = parseReleaseReservedCreditsResult({ ok: true, remaining_monthly: 5, remaining_bonus: 1 });
    expect(parsed?.ok).toBe(true);
  });
});
