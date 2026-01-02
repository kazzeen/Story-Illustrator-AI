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
    expect(out.fullPrompt.startsWith("anime style artwork of a cat sitting on a wall")).toBe(true);
    expect(out.fullPrompt).toContain("cel shading");
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

  it("strips known style phrases from base prompt when a style is selected", () => {
    const out = assemblePrompt({
      basePrompt: "in the style of watercolor, a cat, anime style",
      stylePrefix: "anime style artwork of",
      stylePositive: "cel shading",
      selectedStyleId: "anime",
    });
    expect(out.fullPrompt).not.toMatch(/\bwatercolor\b/i);
    expect(out.fullPrompt.match(/\banime\s+style\b/gi)?.length ?? 0).toBe(1);
    expect(out.fullPrompt).toContain("a cat");
  });

  it("keeps only one instance of the selected style descriptor", () => {
    const out = assemblePrompt({
      basePrompt: "anime style, a hero running, anime style",
      stylePrefix: "anime style artwork of",
      stylePositive: "anime style, cel shading, anime style, vibrant",
      selectedStyleId: "anime",
    });
    expect(out.fullPrompt.match(/\banime\s+style\b/gi)?.length ?? 0).toBe(1);
    expect(out.fullPrompt).toContain("a hero running");
    expect(out.fullPrompt).toContain("cel shading");
    expect(out.fullPrompt).toContain("vibrant");
  });

  it("deduplicates style descriptor across hyphens and underscores", () => {
    const out = assemblePrompt({
      basePrompt: "anime-style, a hero running, anime_style",
      stylePrefix: "anime style artwork of",
      stylePositive: "Japanese anime-style, anime style, cel shading, anime_style",
      selectedStyleId: "anime",
    });
    expect(out.fullPrompt.match(/\banime\b(?:\s+|[-_]+)style\b/gi)?.length ?? 0).toBe(1);
    expect(out.fullPrompt).toContain("a hero running");
    expect(out.fullPrompt).toContain("cel shading");
  });

  it("adds a style marker only when style prefix is missing", () => {
    const out = assemblePrompt({
      basePrompt: "a cat on a wall",
      stylePositive: "cel shading",
      selectedStyleId: "anime",
    });
    expect(out.fullPrompt.startsWith("anime style, a cat on a wall")).toBe(true);
  });

  it("deduplicates overlapping style parts and guide parts", () => {
    const out = assemblePrompt({
      basePrompt: "a cat",
      stylePrefix: "anime style artwork of",
      stylePositive: "cel shading, vibrant, cel shading",
      styleGuidePositive: "palette: warm, vibrant",
      selectedStyleId: "anime",
    });
    const firstLine = out.fullPrompt.split("\n\n")[0] ?? "";
    expect(firstLine.match(/cel shading/gi)?.length ?? 0).toBe(1);
    expect(firstLine.match(/vibrant/gi)?.length ?? 0).toBe(1);
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

  it("strips style descriptors from character appendix when a style is selected", () => {
    const out = assemblePrompt({
      basePrompt: "a hero running",
      characterAppendix: "Character image reference: Alice: anime style artwork of Alice | Bob: in anime style Bob",
      stylePrefix: "anime style artwork of",
      stylePositive: "cel shading",
      selectedStyleId: "anime",
    });
    expect(out.fullPrompt.match(/\banime\s+style\b/gi)?.length ?? 0).toBe(1);
    expect(out.fullPrompt).toContain("Alice:");
    expect(out.fullPrompt).toContain("Bob:");
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
      stylePrefix: "fantasy illustration of",
      stylePositive: "style suffix",
      maxLength: 100,
      selectedStyleId: "fantasy",
    });

    expect(out.truncated).toBe(true);
    expect(out.fullPrompt.toLowerCase()).toContain("fantasy illustration of");
    expect(out.fullPrompt.length).toBeLessThanOrEqual(100);
    // Base should be truncated
    expect(out.parts.base.length).toBeLessThan(longBase.length);
  });

  it("keeps character appendix by dropping style parts first", () => {
    const styleParts = Array.from({ length: 30 }, (_, i) => `fluff${i + 1}`).join(", ");
    const out = assemblePrompt({
      basePrompt: "two people in a room",
      characterAppendix: "Alice (hair: red; eyes: green) | Bob (hair: black; eyes: blue)",
      stylePrefix: "cinematic film still of",
      stylePositive: styleParts,
      maxLength: 160,
      selectedStyleId: "cinematic",
    });

    expect(out.truncated).toBe(true);
    expect(out.parts.characters).toContain("Alice");
    expect(out.parts.characters).toContain("hair: red");
    expect(out.parts.characters).toContain("eyes: green");
    expect(out.parts.style).not.toContain("fluff30");
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
