import { describe, expect, it } from "vitest";
import { ensureHairEyeColorAttributes } from "./clothing-colors";

describe("ensureHairEyeColorAttributes", () => {
  it("adds Hair color and Eye color when missing", () => {
    const res = ensureHairEyeColorAttributes({
      storyId: "story",
      storyText: "modern office drama",
      characterName: "Alice",
      description: "young adult woman",
      physicalAttributes: "",
    });
    expect(res.physicalAttributes).toMatch(/\bHair color:\s+/i);
    expect(res.physicalAttributes).toMatch(/\bEye color:\s+/i);
  });

  it("does not duplicate existing attributes", () => {
    const phys = "Hair color: black\nEye color: blue\nTall";
    const res = ensureHairEyeColorAttributes({
      storyId: "story",
      storyText: "modern office drama",
      characterName: "Bob",
      description: "",
      physicalAttributes: phys,
    });
    expect(res.physicalAttributes).toBe(phys);
    expect(res.added).toEqual({});
    expect(res.skipped).toEqual({ hairColor: true, eyeColor: true });
  });

  it("uses explicit description clues when present", () => {
    const res = ensureHairEyeColorAttributes({
      storyId: "story",
      storyText: "slice of life",
      characterName: "Cara",
      description: "She has blonde hair and blue eyes.",
      physicalAttributes: "",
    });
    expect(res.physicalAttributes).toMatch(/\bHair color:\s+blonde\b/i);
    expect(res.physicalAttributes).toMatch(/\bEye color:\s+blue\b/i);
  });

  it("applies per-character overrides and records conflicts", () => {
    const res = ensureHairEyeColorAttributes({
      storyId: "story",
      storyText: "modern city",
      characterName: "Alice",
      description: "black hair, blue eyes",
      physicalAttributes: "",
      config: {
        overrides: { alice: { hairColor: "red", eyeColor: "green" } },
        overrideWins: true,
      },
    });
    expect(res.physicalAttributes).toMatch(/\bHair color:\s+red\b/i);
    expect(res.physicalAttributes).toMatch(/\bEye color:\s+green\b/i);
    expect(res.issues).toContain("override_hair_conflicts_with_description");
    expect(res.issues).toContain("override_eye_conflicts_with_description");
  });

  it("supports disabling auto-generation", () => {
    const phys = "Tall";
    const res = ensureHairEyeColorAttributes({
      storyId: "story",
      storyText: "fantasy",
      characterName: "Dara",
      description: "blue eyes",
      physicalAttributes: phys,
      config: { enabled: false },
    });
    expect(res.physicalAttributes).toBe(phys);
    expect(res.added).toEqual({});
  });
});

