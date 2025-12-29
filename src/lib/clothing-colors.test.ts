import { describe, expect, test } from "vitest";
import { ensureClothingColors, inferClothingColorCategory, validateClothingColorCoverage } from "../../supabase/functions/_shared/clothing-colors";

const FEMININE = ["pink", "rose", "magenta", "fuchsia", "lavender", "lilac", "purple", "violet", "plum", "blush"];
const MASCULINE = [
  "black",
  "charcoal",
  "slate",
  "navy",
  "midnight",
  "white",
  "cream",
  "brown",
  "tan",
  "olive",
  "forest",
  "burgundy",
];

function hasAnyWord(text: string, words: string[]) {
  const t = text.toLowerCase();
  return words.some((w) => t.includes(w));
}

describe("clothing color assignment", () => {
  test("adds a color to a single clothing item", () => {
    const res = ensureClothingColors("shirt", { seed: "s1" });
    expect(res.text).not.toEqual("shirt");
    expect(validateClothingColorCoverage(res.text)).toEqual({ ok: true, missing: [] });
  });

  test("adds distinct colors to multiple clothing items", () => {
    const res = ensureClothingColors("shirt, pants", { seed: "s2" });
    expect(validateClothingColorCoverage(res.text).ok).toEqual(true);
    const parts = res.text.split(",").map((s) => s.trim()).filter(Boolean);
    expect(parts.length).toEqual(2);
    expect(parts[0]).not.toEqual(parts[1]);
  });

  test("uses feminine palette for feminine-coded clothing", () => {
    expect(inferClothingColorCategory("dress")).toEqual("feminine");
    const res = ensureClothingColors("dress", { seed: "s3" });
    expect(hasAnyWord(res.text, FEMININE)).toEqual(true);
    expect(validateClothingColorCoverage(res.text).ok).toEqual(true);
  });

  test("uses masculine palette for masculine-coded clothing", () => {
    expect(inferClothingColorCategory("suit")).toEqual("masculine");
    const res = ensureClothingColors("suit", { seed: "s4" });
    expect(hasAnyWord(res.text, MASCULINE)).toEqual(true);
    expect(validateClothingColorCoverage(res.text).ok).toEqual(true);
  });

  test("preserves an explicitly specified color", () => {
    const res = ensureClothingColors("red shirt, pants", { seed: "s5" });
    expect(res.text.toLowerCase()).toContain("red shirt");
    expect(validateClothingColorCoverage(res.text).ok).toEqual(true);
  });

  test("colors fantasy clothing types like cape, tunic, and boots", () => {
    const res = ensureClothingColors("cape, tunic, boots", { seed: "s5b" });
    expect(validateClothingColorCoverage(res.text).ok).toEqual(true);
  });

  test("handles multiple items joined by 'and' when both are clothing", () => {
    const res = ensureClothingColors("a shirt and pants", { seed: "s6" });
    expect(res.text.toLowerCase()).toContain("shirt");
    expect(res.text.toLowerCase()).toContain("pants");
    expect(validateClothingColorCoverage(res.text).ok).toEqual(true);
  });

  test("adds colors for secondary clothing items introduced by connectors", () => {
    const res = ensureClothingColors("blue dress with heels", { seed: "s6b" });
    expect(res.text.toLowerCase()).toContain("blue dress");
    expect(res.text.toLowerCase()).toContain("heels");
    expect(validateClothingColorCoverage(res.text).ok).toEqual(true);
  });

  test("does not change descriptions without clothing items", () => {
    const res = ensureClothingColors("smiling happily", { seed: "s7" });
    expect(res).toEqual({ text: "smiling happily", changed: false });
    expect(validateClothingColorCoverage(res.text)).toEqual({ ok: true, missing: [] });
  });

  test("can force a color even when clothing keywords are not detected", () => {
    const res = ensureClothingColors("ceremonial regalia", { seed: "s8", force_if_no_keywords: true });
    expect(res.changed).toEqual(true);
    expect(res.text).not.toEqual("ceremonial regalia");
  });
});
