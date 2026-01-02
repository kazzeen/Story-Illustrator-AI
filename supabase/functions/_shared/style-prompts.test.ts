import { describe, expect, it } from "vitest";
import {
  buildStyleGuidance,
  buildStoryStyleGuideGuidance,
  coerceRequestedResolution,
  computeStyleCfgScale,
  computeStyleCfgScaleForStyle,
  computeStyleSteps,
  computeStyleStepsForStyle,
  getAspectRatioLabel,
  splitCommaParts,
  stripKnownStylePhrases,
  validateStyleApplication,
} from "./style-prompts";

describe("style-prompts", () => {
  it("embeds cinematic guidance into the prompt", () => {
    const out = buildStyleGuidance({ styleId: "cinematic", intensity: 70, strict: true });
    expect(out.positive).toMatch(/cinematic lighting/i);
    expect(out.positive).toMatch(/strict cinematic/i);
  });

  it("scales guidance strength by intensity", () => {
    const low = buildStyleGuidance({ styleId: "watercolor", intensity: 10, strict: false });
    const high = buildStyleGuidance({ styleId: "watercolor", intensity: 95, strict: false });
    expect(splitCommaParts(high.positive).length).toBeGreaterThanOrEqual(splitCommaParts(low.positive).length);
    expect(high.positive).toMatch(/airy pastel-to-mid tones/i);
  });

  it("supports no-style mode", () => {
    const none = buildStyleGuidance({ styleId: "none", intensity: 80, strict: true });
    expect(none.positive).toBe("");
  });

  it("falls back safely for unknown styles", () => {
    const out = buildStyleGuidance({ styleId: "ukiyo_e", intensity: 70, strict: true });
    expect(out.usedFallback).toBe(true);
    expect(out.positive).toMatch(/ukiyo e style/i);
    expect(out.positive).toMatch(/palette inspired by ukiyo e/i);
    expect(out.positive).toMatch(/clear focal subject/i);
  });

  it("aliases related styles onto known templates without fallback", () => {
    const out = buildStyleGuidance({ styleId: "studio_ghibli_style", intensity: 70, strict: true });
    expect(out.usedFallback).toBe(false);
    expect(out.prefix).toMatch(/anime style/i);
    expect(out.positive).toMatch(/studio ghibli style/i);
  });

  it("does not repeat the selected style phrase inside positive elements", () => {
    const out = buildStyleGuidance({ styleId: "anime", intensity: 70, strict: true });
    expect(out.prefix).toMatch(/anime style/i);
    expect(out.positive).not.toMatch(/\banime\s+style\b/i);
  });

  it("removes disabled elements from positive directives", () => {
    const out = buildStyleGuidance({
      styleId: "anime",
      intensity: 70,
      strict: false,
      disabledElements: ["cel shading"],
    });
    expect(out.positive).not.toMatch(/cel shading/i);
  });

  it("computes cfg scale within a safe range", () => {
    const low = computeStyleCfgScale(0);
    const high = computeStyleCfgScale(100);
    expect(low).toBeGreaterThanOrEqual(4.5);
    expect(high).toBeLessThanOrEqual(10);
    expect(high).toBeGreaterThan(low);
  });

  it("computes steps deterministically and respects strict mode", () => {
    const loose = computeStyleSteps(70, false);
    const strict = computeStyleSteps(70, true);
    expect(strict).toBeGreaterThanOrEqual(loose);
    expect(computeStyleSteps(70, true)).toBe(strict);
  });

  it("tunes cfg scale and steps by style", () => {
    const watercolorCfg = computeStyleCfgScaleForStyle({ styleId: "watercolor", intensity: 70, strict: false });
    const realisticCfg = computeStyleCfgScaleForStyle({ styleId: "realistic", intensity: 70, strict: false });
    expect(realisticCfg).toBeGreaterThan(watercolorCfg);

    const watercolorSteps = computeStyleStepsForStyle({ styleId: "watercolor", intensity: 70, strict: false });
    const pixelSteps = computeStyleStepsForStyle({ styleId: "pixel_art", intensity: 70, strict: false });
    expect(watercolorSteps).toBeGreaterThan(pixelSteps);
  });

  it("builds positive style guide guidance from common guide fields", () => {
    const out = buildStoryStyleGuideGuidance({
      guide: {
        rendering_techniques: "cinematic storybook illustration, high detail",
        lighting_and_shading: "soft key light, gentle contrast",
        color_palette: "warm earth tones with teal accents",
        perspective_and_composition: "35mm lens, rule of thirds, consistent framing",
      },
      intensity: 70,
      strict: true,
    });
    expect(out.used).toBe(true);
    expect(out.positive).toMatch(/rendering:/i);
    expect(out.positive).toMatch(/lighting:/i);
    expect(out.positive).toMatch(/palette:/i);
    expect(out.positive).toMatch(/consistent style guide adherence/i);
  });

  it("reduces included guide fields for low intensity", () => {
    const low = buildStoryStyleGuideGuidance({
      guide: {
        rendering_techniques: "cinematic storybook illustration, high detail",
        lighting_and_shading: "soft key light, gentle contrast",
        color_palette: "warm earth tones with teal accents",
        perspective_and_composition: "35mm lens, rule of thirds, consistent framing",
      },
      intensity: 10,
      strict: false,
    });
    const high = buildStoryStyleGuideGuidance({
      guide: {
        rendering_techniques: "cinematic storybook illustration, high detail",
        lighting_and_shading: "soft key light, gentle contrast",
        color_palette: "warm earth tones with teal accents",
        perspective_and_composition: "35mm lens, rule of thirds, consistent framing",
      },
      intensity: 95,
      strict: false,
    });
    expect(splitCommaParts(high.positive).length).toBeGreaterThan(splitCommaParts(low.positive).length);
  });

  it("handles invalid style guide payloads safely", () => {
    const out = buildStoryStyleGuideGuidance({ guide: 123, intensity: 70, strict: true });
    expect(out.used).toBe(false);
    expect(out.positive).toBe("");
    expect(out.issues.length).toBeGreaterThan(0);
  });

  it("produces distinct guidance for each primary UI style", () => {
    const styleIds = ["none", "cinematic", "watercolor", "anime", "comic", "oil", "minimalist", "realistic", "fantasy"];
    const out = styleIds.map((styleId) => buildStyleGuidance({ styleId, intensity: 70, strict: true }).positive);
    expect(new Set(out).size).toBe(out.length);
  });

  it("matches curated style examples in key markers", () => {
    const watercolor = buildStyleGuidance({ styleId: "watercolor", intensity: 80, strict: true }).positive;
    expect(watercolor).toMatch(/soft washes/i);
    expect(watercolor).toMatch(/paper texture/i);

    const cyberpunk = buildStyleGuidance({ styleId: "cyberpunk", intensity: 80, strict: true }).positive;
    expect(cyberpunk).toMatch(/neon/i);
    expect(cyberpunk).toMatch(/rain-slick/i);

    const impressionism = buildStyleGuidance({ styleId: "impressionism", intensity: 80, strict: true }).positive;
    expect(impressionism).toMatch(/broken brushstrokes/i);
    expect(impressionism).toMatch(/plein-air/i);
  });

  it("validates strict style markers and must-include constraints", () => {
    const guidance = buildStyleGuidance({ styleId: "anime", intensity: 70, strict: true });
    const out = validateStyleApplication({
      styleId: "anime",
      strict: true,
      guidance,
      disabledElements: [],
    });
    expect(out.ok).toBe(true);
    expect(out.issues.length).toBe(0);
  });

  it("flags disabled must-include elements in strict mode", () => {
    const guidance = buildStyleGuidance({ styleId: "anime", intensity: 70, strict: true, disabledElements: ["cel shading"] });
    const out = validateStyleApplication({
      styleId: "anime",
      strict: true,
      guidance,
      disabledElements: ["cel shading"],
    });
    expect(out.ok).toBe(false);
    expect(out.issues.some((i) => i.toLowerCase().includes("must_include_disabled"))).toBe(true);
  });

  it("coerces Venice-style resolutions into safe multiples and limits", () => {
    const out = coerceRequestedResolution({ model: "lustify-sdxl", width: 2048, height: 2048 });
    expect(out.width).toBeLessThanOrEqual(1536);
    expect(out.height).toBeLessThanOrEqual(1536);
    expect(out.width % 64).toBe(0);
    expect(out.height % 64).toBe(0);
    expect(out.wasCoerced).toBe(true);
  });

  it("keeps aspect label stable across common geometries", () => {
    expect(getAspectRatioLabel(1920, 1080)).toBe("16:9");
    expect(getAspectRatioLabel(1024, 1024)).toBe("1:1");
    expect(getAspectRatioLabel(1080, 1920)).toBe("9:16");
    expect(getAspectRatioLabel(1024, 768)).toBe("4:3");
    expect(getAspectRatioLabel(768, 1024)).toBe("3:4");
  });

  it("strips conflicting style phrases while keeping selected style", () => {
    const removedOther = stripKnownStylePhrases({
      prompt: "watercolor painting of a castle, in the style of anime",
      keepStyleId: "watercolor",
    });
    expect(removedOther.prompt.toLowerCase()).toContain("watercolor");
    expect(removedOther.prompt.toLowerCase()).not.toContain("style of anime");

    const strippedPrefix = stripKnownStylePhrases({
      prompt: "watercolor painting of a castle",
      keepStyleId: "anime",
    });
    expect(strippedPrefix.prompt.toLowerCase()).not.toContain("watercolor painting of");
    expect(strippedPrefix.prompt.toLowerCase()).toContain("castle");
  });

  it("strips hyphenated and underscored style descriptors", () => {
    const out = stripKnownStylePhrases({
      prompt: "anime-style artwork of a castle, in_the style-of watercolor, influenced-by comic-book",
    });
    const lower = out.prompt.toLowerCase();
    expect(lower).toContain("castle");
    expect(lower).not.toMatch(/\banime\b(?:\s+|[-_]+)style\b/);
    expect(lower).not.toMatch(/\bstyle\b(?:\s+|[-_]+)of\b/);
  });
});
