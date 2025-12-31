import { describe, expect, test } from "vitest";
import {
  applyClothingColorsToCharacterStates,
  buildCharacterAppearanceAppendix,
  computeEffectiveCharacterAppearanceFromHistory,
  regenerateImagePromptFromCharacterStates,
  updateImagePromptWithAttributes,
} from "./scene-character-appearance";
import { validateClothingColorCoverage } from "./clothing-colors";

describe("applyClothingColorsToCharacterStates", () => {
  test("adds colors to missing clothing descriptions", () => {
    const res = applyClothingColorsToCharacterStates({
      storyId: "story",
      sceneId: "scene",
      sceneText: "castle at night",
      characterStates: {
        Alice: { clothing: "dress, boots", state: "", physical_attributes: "" },
      },
    });
    expect(res.Alice?.clothing).toBeTruthy();
    expect(validateClothingColorCoverage(res.Alice!.clothing).ok).toBe(true);
  });

  test("preserves existing colored clothing", () => {
    const res = applyClothingColorsToCharacterStates({
      storyId: "story",
      sceneId: "scene",
      sceneText: "market at noon",
      characterStates: {
        Bob: { clothing: "red cape, black boots", state: "", physical_attributes: "" },
      },
    });
    expect(res.Bob?.clothing.toLowerCase()).toContain("red cape");
    expect(res.Bob?.clothing.toLowerCase()).toContain("black boots");
  });

  test("leaves empty clothing as empty", () => {
    const res = applyClothingColorsToCharacterStates({
      storyId: "story",
      sceneId: "scene",
      sceneText: "",
      characterStates: {
        Cara: { clothing: "", state: "", physical_attributes: "" },
      },
    });
    expect(res.Cara?.clothing).toBe("");
  });
});

describe("computeEffectiveCharacterAppearanceFromHistory", () => {
  test("carries clothing forward from prior scenes when missing", () => {
    const scenes = [
      {
        id: "s1",
        scene_number: 1,
        characters: ["Alice"],
        character_states: { Alice: { clothing: "red cape", state: "", physical_attributes: "" } },
      },
      {
        id: "s2",
        scene_number: 2,
        characters: ["Alice"],
        character_states: {},
      },
    ];

    const res = computeEffectiveCharacterAppearanceFromHistory({
      scenes,
      currentSceneId: "s2",
      characterNames: ["Alice"],
    });
    expect(res.effective.Alice?.clothing).toBe("red cape");
    expect(res.missingClothing).toEqual([]);
  });

  test("uses current scene clothing override when provided", () => {
    const scenes = [
      {
        id: "s1",
        scene_number: 1,
        characters: ["Bob"],
        character_states: { Bob: { clothing: "blue jacket", state: "", physical_attributes: "" } },
      },
      {
        id: "s2",
        scene_number: 2,
        characters: ["Bob"],
        character_states: { Bob: { clothing: "green hoodie", state: "", physical_attributes: "" } },
      },
    ];

    const res = computeEffectiveCharacterAppearanceFromHistory({
      scenes,
      currentSceneId: "s2",
      characterNames: ["Bob"],
    });
    expect(res.effective.Bob?.clothing).toBe("green hoodie");
  });

  test("falls back to defaults when no history exists", () => {
    const scenes = [
      {
        id: "s1",
        scene_number: 1,
        characters: ["Cara"],
        character_states: {},
      },
    ];

    const res = computeEffectiveCharacterAppearanceFromHistory({
      scenes,
      currentSceneId: "s1",
      characterNames: ["Cara"],
      defaultsByName: { cara: { clothing: "black coat", accessories: "silver pendant", physical_attributes: "tall" } },
    });
    expect(res.effective.Cara?.clothing).toBe("black coat");
    expect(res.effective.Cara?.accessories).toBe("silver pendant");
    expect(res.missingClothing).toEqual([]);
  });
});

describe("buildCharacterAppearanceAppendix", () => {
  test("formats clothing/state/physical into appendix", () => {
    const appendix = buildCharacterAppearanceAppendix({
      characterNames: ["Alice", "Bob"],
      effectiveStates: {
        Alice: {
          clothing: "red cape",
          accessories: "gold ring",
          state: "injured arm",
          physical_attributes: "",
          extra: { hairstyle: "braided hair" },
        },
        Bob: { clothing: "", state: "", physical_attributes: "" },
      },
    });
    expect(appendix).toContain("Character appearance:");
    expect(appendix).toContain("Alice");
    expect(appendix.toLowerCase()).toContain("wearing red cape");
    expect(appendix.toLowerCase()).toContain("accessories: gold ring");
    expect(appendix.toLowerCase()).toContain("condition: injured arm");
    expect(appendix.toLowerCase()).toContain("details: hairstyle: braided hair");
    expect(appendix).not.toContain("Bob (");
  });
});

describe("updateImagePromptWithAttributes", () => {
  test("appends character appearance from scene state", () => {
    const updated = updateImagePromptWithAttributes({
      basePrompt: "Cinematic shot in a rain-soaked alley.",
      characterNames: ["Alice"],
      characterStates: { Alice: { clothing: "red cape", accessories: "gold ring", physical_attributes: "freckles", state: "smiling" } },
    });
    expect(updated).toContain("Cinematic shot in a rain-soaked alley.");
    expect(updated).toContain("Character appearance:");
    expect(updated.toLowerCase()).toContain("wearing red cape");
    expect(updated.toLowerCase()).toContain("accessories: gold ring");
    expect(updated.toLowerCase()).toContain("physical: freckles");
    expect(updated.toLowerCase()).toContain("condition: smiling");
  });

  test("replaces existing character appearance appendix", () => {
    const updated = updateImagePromptWithAttributes({
      basePrompt: "Base prompt.\n\nCharacter appearance: Alice (wearing old outfit)",
      characterNames: ["Alice"],
      characterStates: { Alice: { clothing: "new outfit", state: "", physical_attributes: "" } },
    });
    expect(updated).toContain("Base prompt.");
    expect(updated.toLowerCase()).toContain("wearing new outfit");
    expect(updated.toLowerCase()).not.toContain("old outfit");
  });

  test("strips appendix when no characters are provided", () => {
    const updated = updateImagePromptWithAttributes({
      basePrompt: "Base prompt.\n\n  CHARACTER APPEARANCE: Alice (wearing old outfit)\n",
      characterNames: [],
      characterStates: { Alice: { clothing: "new outfit", state: "", physical_attributes: "" } },
    });
    expect(updated).toBe("Base prompt.");
    expect(updated.toLowerCase()).not.toContain("character appearance:");
  });

  test("does not add appendix if all attributes are empty", () => {
    const updated = updateImagePromptWithAttributes({
      basePrompt: "Portrait.",
      characterNames: ["Dana"],
      characterStates: { Dana: { clothing: "", state: "", physical_attributes: "" } },
      defaultsByLowerName: { dana: { clothing: "", accessories: "", physical_attributes: "" } },
    });
    expect(updated).toBe("Portrait.");
    expect(updated.toLowerCase()).not.toContain("character appearance:");
  });

  test("includes extra attributes from scene state in a stable order", () => {
    const updated = updateImagePromptWithAttributes({
      basePrompt: "Portrait.",
      characterNames: ["Alice"],
      characterStates: { Alice: { clothing: "red cape", "hair style": "braided hair", "eye-color": "green" } },
    });
    expect(updated).toContain("Character appearance:");
    expect(updated).toContain("details:");
    expect(updated.toLowerCase()).toContain("details: eyecolor: green; hair_style: braided hair");
  });

  test("uses defaults when state is missing", () => {
    const updated = updateImagePromptWithAttributes({
      basePrompt: "Portrait.",
      characterNames: ["Cara"],
      characterStates: {},
      defaultsByLowerName: { cara: { clothing: "black coat", accessories: "silver pendant", physical_attributes: "tall" } },
    });
    expect(updated.toLowerCase()).toContain("wearing black coat");
    expect(updated.toLowerCase()).toContain("accessories: silver pendant");
    expect(updated.toLowerCase()).toContain("physical: tall");
  });
});

describe("regenerateImagePromptFromCharacterStates", () => {
  test("adds clothing colors and updates the prompt appendix", () => {
    const res = regenerateImagePromptFromCharacterStates({
      storyId: "story",
      sceneId: "scene",
      sceneText: "castle at night",
      basePrompt: "Cinematic portrait.",
      characterNames: ["Alice"],
      characterStates: {
        Alice: { clothing: "dress, boots", state: "", physical_attributes: "" },
      },
    });

    expect(res.prompt).toContain("Cinematic portrait.");
    expect(res.prompt).toContain("Character appearance:");
    expect(res.coloredCharacterStates.Alice?.clothing).toBeTruthy();
    expect(validateClothingColorCoverage(res.coloredCharacterStates.Alice!.clothing).ok).toBe(true);
    expect(res.prompt.toLowerCase()).toContain("wearing");
  });
});
