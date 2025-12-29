import { describe, expect, test } from "vitest";
import { buildVeniceEditPrompt, inferImageMimeFromUrl, normalizeImageMime, normalizeRect, selectionHint, validateVeniceImageConstraints } from "./venice-image-edit";

describe("venice-image-edit", () => {
  test("normalizeImageMime supports common mime variants", () => {
    expect(normalizeImageMime("image/png")).toBe("image/png");
    expect(normalizeImageMime("image/jpg")).toBe("image/jpeg");
    expect(normalizeImageMime("IMAGE/JPEG")).toBe("image/jpeg");
    expect(normalizeImageMime("image/webp")).toBe("image/webp");
    expect(normalizeImageMime("image/gif")).toBe(null);
  });

  test("inferImageMimeFromUrl detects extension with query/hash", () => {
    expect(inferImageMimeFromUrl("https://example.com/a.png?x=1")).toBe("image/png");
    expect(inferImageMimeFromUrl("https://example.com/a.jpg#frag")).toBe("image/jpeg");
    expect(inferImageMimeFromUrl("https://example.com/a.jpeg?x=1#y")).toBe("image/jpeg");
    expect(inferImageMimeFromUrl("https://example.com/a.webp")).toBe("image/webp");
    expect(inferImageMimeFromUrl("https://example.com/a")).toBe(null);
  });

  test("normalizeRect clamps and normalizes", () => {
    expect(normalizeRect({ x: -1, y: -1, w: 2, h: 2 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    const r = normalizeRect({ x: 0.8, y: 0.8, w: 0.4, h: 0.4 });
    expect(r.x).toBeCloseTo(0.8);
    expect(r.y).toBeCloseTo(0.8);
    expect(r.w).toBeCloseTo(0.2);
    expect(r.h).toBeCloseTo(0.2);
  });

  test("selectionHint returns empty for null or empty", () => {
    expect(selectionHint(null)).toBe("");
    expect(selectionHint({ x: 0.2, y: 0.2, w: 0, h: 0.1 })).toBe("");
  });

  test("buildVeniceEditPrompt returns freeform inpaint prompt", () => {
    const prompt = buildVeniceEditPrompt({ tool: "inpaint", selection: null, freeform: "add a lantern" });
    expect(prompt).toBe("add a lantern");
  });

  test("buildVeniceEditPrompt returns empty for blank inpaint prompt", () => {
    const prompt = buildVeniceEditPrompt({ tool: "inpaint", selection: null, freeform: "   " });
    expect(prompt).toBe("");
  });

  test("buildVeniceEditPrompt supports object removal", () => {
    const prompt = buildVeniceEditPrompt({ tool: "remove", selection: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, objectToRemove: "person" });
    expect(prompt.toLowerCase()).toContain("remove the person");
    expect(prompt.toLowerCase()).toContain("fill the background");
    expect(prompt.toLowerCase()).toContain("selected area");
  });

  test("buildVeniceEditPrompt supports color adjustment", () => {
    const prompt = buildVeniceEditPrompt({ tool: "color", selection: null, colorTarget: "sky", newColor: "sunrise orange" });
    expect(prompt.toLowerCase()).toContain("change the color of sky to sunrise orange");
  });

  test("buildVeniceEditPrompt supports tone adjustment", () => {
    const prompt = buildVeniceEditPrompt({ tool: "tone", selection: null, brightness: 30, contrast: -20, toneTarget: "foreground" });
    expect(prompt.toLowerCase()).toContain("increase brightness");
    expect(prompt.toLowerCase()).toContain("decrease contrast");
    expect(prompt.toLowerCase()).toContain("for foreground");
  });

  test("validateVeniceImageConstraints enforces pixel limits", () => {
    expect(validateVeniceImageConstraints({ width: 64, height: 64 })).toEqual({ ok: false, reason: expect.stringContaining("min") });
    expect(validateVeniceImageConstraints({ width: 1024, height: 1024 })).toEqual({ ok: true });
  });

  test("validateVeniceImageConstraints warns about file size", () => {
    expect(validateVeniceImageConstraints({ width: 1024, height: 1024, byteSize: 11 * 1024 * 1024 })).toEqual({
      ok: false,
      reason: expect.stringContaining("10MB"),
    });
  });
});
