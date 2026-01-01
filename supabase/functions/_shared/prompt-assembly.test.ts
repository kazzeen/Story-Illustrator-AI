import { describe, expect, it } from "vitest";
import { assemblePrompt } from "./prompt-assembly.ts";

describe("prompt-assembly", () => {
  it("assembles a basic prompt with style prefix and suffix", () => {
    const out = assemblePrompt({
      basePrompt: "a cat sitting on a wall",
      stylePrefix: "anime style artwork of",
      stylePositive: "cel shading, vibrant",
      selectedStyleId: "anime",
    });

    expect(out.fullPrompt).toContain("anime style artwork of a cat sitting on a wall");
    expect(out.fullPrompt.startsWith("anime style, anime style artwork of a cat sitting on a wall")).toBe(true);
    expect(out.fullPrompt.endsWith("\n\nanime style")).toBe(true);
  });

  it("cleans conflicting terms from base prompt when styleId is provided", () => {
    const out = assemblePrompt({
      basePrompt: "a photorealistic portrait of a warrior, 8k, unreal engine",
      stylePrefix: "anime style artwork of",
      stylePositive: "cel shading",
      selectedStyleId: "anime",
    });

    // "photorealistic", "8k", "unreal engine" should be stripped
    expect(out.fullPrompt).not.toMatch(/photorealistic/i);
    expect(out.fullPrompt).not.toMatch(/8k/i);
    expect(out.fullPrompt).not.toMatch(/unreal engine/i);
    expect(out.fullPrompt).toContain("anime style artwork of");
    expect(out.fullPrompt).toContain("portrait of a warrior");
  });

  it("cleans anime tokens from realistic prompts when styleId is realistic", () => {
    const out = assemblePrompt({
      basePrompt: "anime, manga, a hero on a rooftop, cel shaded",
      stylePrefix: "photograph of",
      stylePositive: "photorealistic detail, realistic lighting",
      selectedStyleId: "realistic",
    });
    expect(out.fullPrompt).not.toMatch(/\banime\b/i);
    expect(out.fullPrompt).not.toMatch(/\bmanga\b/i);
    expect(out.fullPrompt).not.toMatch(/cel shaded/i);
    expect(out.fullPrompt).toMatch(/photograph of/i);
  });

  it("preserves non-conflicting terms", () => {
    const out = assemblePrompt({
      basePrompt: "a cute cat, fluffy, highly detailed",
      stylePrefix: "anime style artwork of",
      selectedStyleId: "anime",
    });

    expect(out.fullPrompt).toContain("fluffy");
    expect(out.fullPrompt).toContain("highly detailed");
  });

  it("handles character appendix correctly", () => {
    const out = assemblePrompt({
      basePrompt: "two people talking",
      characterAppendix: "Alice (blue dress) | Bob (red shirt)",
      stylePrefix: "cinematic film still of",
      selectedStyleId: "cinematic",
    });

    expect(out.fullPrompt).toContain("cinematic film still of two people talking");
    expect(out.fullPrompt).toContain("\n\nAlice (blue dress) | Bob (red shirt)");
  });

  it("reports missing required subjects", () => {
    const out = assemblePrompt({
      basePrompt: "a stormy ocean under moonlight",
      stylePrefix: "cinematic film still of",
      requiredSubjects: ["Alice", "Bob"],
    });
    expect(out.missingSubjects).toEqual(["Alice", "Bob"]);
  });

  it("handles truncation priorities", () => {
    // Super long base prompt
    const longBase = "word ".repeat(1000);
    const out = assemblePrompt({
      basePrompt: longBase,
      stylePrefix: "style prefix",
      stylePositive: "style suffix",
      maxLength: 100,
      selectedStyleId: "fantasy",
    });

    expect(out.truncated).toBe(true);
    expect(out.fullPrompt.toLowerCase()).toContain("fantasy style");
    expect(out.fullPrompt).toContain("style prefix");
    expect(out.fullPrompt.length).toBeLessThanOrEqual(100);
    // Base should be truncated
    expect(out.parts.base.length).toBeLessThan(longBase.length);
  });

  it("joins 'of' prefixes to base without a comma", () => {
    const out = assemblePrompt({
      basePrompt: "a dog",
      stylePrefix: "photograph of",
    });
    expect(out.fullPrompt).toContain("photograph of a dog");
    expect(out.fullPrompt).not.toContain("photograph of, a dog");
  });
});
