import { describe, expect, it } from "vitest";
import { buildStyleGuidance, getStyleCategory, STYLE_CONFLICTS, validateStyleApplication } from "./style-prompts.ts";
import { assemblePrompt } from "./prompt-assembly.ts";

describe("style-accuracy", () => {
  const primaryStyles = [
    "none",
    "cinematic",
    "watercolor",
    "anime",
    "comic",
    "oil",
    "minimalist",
    "realistic",
    "fantasy",
    "cyberpunk",
    "steampunk",
    "storybook_illustration",
    "pixel_art",
    "3d_render",
  ];

  it("includes category-defining keywords in every style guidance", () => {
    primaryStyles.forEach((styleId) => {
      if (styleId === "none") return;
      const guidance = buildStyleGuidance({ styleId, intensity: 70, strict: true });
      const category = getStyleCategory(styleId);
      if (!category) return;

      const positive = guidance.positive.toLowerCase();
      const prefix = (guidance.prefix || "").toLowerCase();

      // Anime styles must mention anime/manga
      if (category === "anime") {
        const hasAnimeMarker = positive.includes("anime") || positive.includes("manga") || prefix.includes("anime");
        expect(hasAnimeMarker).toBe(true);
      }

      // Realistic styles must mention photo/cinematic/film
      if (category === "realistic") {
        const hasRealMarker = positive.includes("photo") || positive.includes("cinematic") || prefix.includes("photo") || prefix.includes("cinematic") || prefix.includes("film");
        expect(hasRealMarker).toBe(true);
      }

      // Pixel styles must mention pixel
      if (category === "pixel") {
        const hasPixelMarker = positive.includes("pixel");
        expect(hasPixelMarker).toBe(true);
      }

      // 3D styles must mention 3d/cgi
      if (category === "3d") {
        const has3DMarker = positive.includes("3d") || positive.includes("cgi");
        expect(has3DMarker).toBe(true);
      }
    });
  });

  it("strips conflicting terms from base prompt when styleId is provided", () => {
    const conflicts = [
      { base: "a photorealistic anime warrior", styleId: "anime", shouldLose: ["photorealistic"] },
      { base: "an 8k cinematic manga scene", styleId: "anime", shouldLose: ["8k"] },
      { base: "a pixel art photograph of a city", styleId: "pixel_art", shouldLose: ["photograph"] },
      { base: "a watercolor 3d render of a dragon", styleId: "watercolor", shouldLose: ["3d render"] },
    ];

    conflicts.forEach(({ base, styleId, shouldLose }) => {
      const out = assemblePrompt({
        basePrompt: base,
        stylePrefix: "",
        stylePositive: "",
        selectedStyleId: styleId,
      });

      shouldLose.forEach((term) => {
        expect(out.fullPrompt.toLowerCase()).not.toContain(term.toLowerCase());
      });
    });
  });

  it("includes an explicit style marker for every model when styleId is provided", () => {
    const models = ["lustify-sdxl", "venice-sd35", "z-image-turbo", "qwen-image", "gemini-3-pro"];
    models.forEach((model) => {
      const out = assemblePrompt({
        basePrompt: "a cat",
        stylePrefix: "anime style artwork of",
        stylePositive: "cel shading",
        model,
        selectedStyleId: "anime",
      });
      expect(out.fullPrompt.toLowerCase()).toContain("anime style");
      expect(out.fullPrompt.toLowerCase().includes("anime style artwork of")).toBe(true);
    });
  });

  it("produces distinct guidance for each primary style", () => {
    const guids = primaryStyles
      .filter((s) => s !== "none")
      .map((styleId) => buildStyleGuidance({ styleId, intensity: 70, strict: true }).positive);
    const unique = new Set(guids);
    expect(unique.size).toBe(guids.length);
  });

  it("respects intensity scaling", () => {
    const low = buildStyleGuidance({ styleId: "fantasy", intensity: 10, strict: false });
    const high = buildStyleGuidance({ styleId: "fantasy", intensity: 95, strict: false });
    expect(high.positive.length).toBeGreaterThan(low.positive.length);
  });

  it("has conflict terms defined for prompt cleaning", () => {
    // We retain this test to ensure STYLE_CONFLICTS are available for prompt cleaning
    const styleId = "anime";
    const category = getStyleCategory(styleId);
    if (!category) throw new Error("No category");
    const conflicts = STYLE_CONFLICTS[category] || [];
    expect(conflicts.length).toBeGreaterThan(0);
    // Sample conflicts that should be cleaned from positive prompt
    expect(conflicts).toContain("photorealistic");
    expect(conflicts).toContain("8k");
  });

  it("preserves non-conflicting descriptive terms", () => {
    const base = "a majestic dragon with intricate scales, perched on a cliff, sunset backdrop";
    const out = assemblePrompt({
      basePrompt: base,
      stylePrefix: "fantasy illustration of",
      stylePositive: "magical atmosphere, ethereal glow",
      selectedStyleId: "fantasy",
    });
    expect(out.fullPrompt).toContain("majestic dragon");
    expect(out.fullPrompt).toContain("intricate scales");
    expect(out.fullPrompt).toContain("cliff");
    expect(out.fullPrompt).toContain("sunset backdrop");
  });

  it("handles unknown styles gracefully with fallback", () => {
    const out = buildStyleGuidance({ styleId: "unknown_futuristic_style", intensity: 70, strict: true });
    expect(out.usedFallback).toBe(true);
    expect(out.positive).toContain("unknown futuristic style");
    expect(out.positive.length).toBeGreaterThan(20);
  });

  it("validates that strict mode enforces mustInclude markers", () => {
    const validation = validateStyleApplication({
      styleId: "anime",
      strict: true,
      guidance: buildStyleGuidance({ styleId: "anime", intensity: 70, strict: true }),
      disabledElements: [],
    });
    expect(validation.ok).toBe(true);
    expect(validation.issues.length).toBe(0);
  });

  it("produces style-stable prompts for varied character archetypes", () => {
    const archetypes = [
      "a photorealistic warrior with detailed armor",
      "a cinematic portrait of an elderly wizard",
      "a cute anime child astronaut",
      "a 3d render of a robot detective",
      "a pixel art knight in a castle",
    ];

    primaryStyles.forEach((styleId) => {
      if (styleId === "none") return;
      const guidance = buildStyleGuidance({ styleId, intensity: 80, strict: true });
      const validation = validateStyleApplication({
        styleId,
        strict: true,
        guidance,
        disabledElements: [],
      });
      expect(validation.ok).toBe(true);

      archetypes.forEach((base) => {
        const out = assemblePrompt({
          basePrompt: base,
          stylePrefix: guidance.prefix,
          stylePositive: guidance.positive,
          selectedStyleId: styleId,
        });

        const lower = out.fullPrompt.toLowerCase();
        expect(lower).toContain(styleId.replace(/_/g, " ").toLowerCase());

        const category = getStyleCategory(styleId);
        if (category) {
          const conflicts = STYLE_CONFLICTS[category] || [];
          conflicts.forEach((term) => {
            const t = term.toLowerCase();
            if (base.toLowerCase().includes(t)) {
              expect(lower).not.toContain(t);
            }
          });
        }
      });
    });
  });

  it("fails validation when mustInclude is disabled in strict mode", () => {
    const guidance = buildStyleGuidance({ styleId: "anime", intensity: 70, strict: true });
    const validation = validateStyleApplication({
      styleId: "anime",
      strict: true,
      guidance,
      disabledElements: ["cel shading"],
    });
    expect(validation.ok).toBe(false);
    expect(validation.issues.some((i) => i.includes("must_include_disabled"))).toBe(true);
  });
});
