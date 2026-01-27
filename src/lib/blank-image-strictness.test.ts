
import { describe, it, expect } from "vitest";

// Ported from generate-scene-image/index.ts
function roundStat(num: number) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function isImageStatsBlank(args: { mean: number; std: number; uniqueColors?: number }) {
  const mean = roundStat(args.mean);
  const std = roundStat(args.std);
  const unique = args.uniqueColors ?? 100;
  
  // Strict blank detection:
  // 1. Zero or very low variance (solid color or near-solid)
  if (std < 5) return { blank: true as const, mean, std, unique, reason: "low_variance" };

  // 2. Very few unique colors (flat image)
  if (unique < 10) return { blank: true as const, mean, std, unique, reason: "low_color_variety" };
  
  // 3. Extreme darkness or brightness with low variance
  // (already covered by std < 5, but let's be explicit for very dark/bright images that might have slight noise)
  if (mean < 5 && std < 10) return { blank: true as const, mean, std, unique, reason: "too_dark" };
  if (mean > 250 && std < 10) return { blank: true as const, mean, std, unique, reason: "too_bright" };
  
  return { blank: false as const, mean, std, unique, reason: null };
}

describe("Blank Image Detection Strictness", () => {
  it("should detect completely black image", () => {
    const result = isImageStatsBlank({ mean: 0, std: 0, uniqueColors: 1 });
    expect(result.blank).toBe(true);
    expect(result.reason).toBe("low_variance");
  });

  it("should detect completely white image", () => {
    const result = isImageStatsBlank({ mean: 255, std: 0, uniqueColors: 1 });
    expect(result.blank).toBe(true);
    expect(result.reason).toBe("low_variance");
  });

  it("should detect flat gray image", () => {
    const result = isImageStatsBlank({ mean: 128, std: 0, uniqueColors: 1 });
    expect(result.blank).toBe(true);
    expect(result.reason).toBe("low_variance");
  });

  it("should detect near-black image with slight noise (std < 5)", () => {
    const result = isImageStatsBlank({ mean: 2, std: 4, uniqueColors: 15 });
    expect(result.blank).toBe(true);
    expect(result.reason).toBe("low_variance");
  });

  it("should detect image with very few unique colors (flat)", () => {
    const result = isImageStatsBlank({ mean: 100, std: 20, uniqueColors: 5 });
    expect(result.blank).toBe(true);
    expect(result.reason).toBe("low_color_variety");
  });

  it("should detect dark image with moderate noise (std < 10 but mean < 5)", () => {
    const result = isImageStatsBlank({ mean: 4, std: 8, uniqueColors: 20 });
    expect(result.blank).toBe(true);
    expect(result.reason).toBe("too_dark");
  });

  it("should accept normal image", () => {
    const result = isImageStatsBlank({ mean: 100, std: 50, uniqueColors: 500 });
    expect(result.blank).toBe(false);
  });

  it("should accept dark but detailed image (std >= 10)", () => {
    const result = isImageStatsBlank({ mean: 10, std: 20, uniqueColors: 100 });
    expect(result.blank).toBe(false);
  });
});
