import { describe, expect, test } from "vitest";
import { applyClothingColorsToCharacterStates } from "./scene-character-appearance";
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

