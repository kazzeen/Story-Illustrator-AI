import { ensureClothingColors } from "@/lib/clothing-colors";

export type SceneCharacterAppearanceState = {
  clothing: string;
  state: string;
  physical_attributes: string;
};

export function applyClothingColorsToCharacterStates(args: {
  storyId: string;
  sceneId: string;
  sceneText: string;
  characterStates: Record<string, SceneCharacterAppearanceState>;
}) {
  const out: Record<string, SceneCharacterAppearanceState> = {};
  for (const [name, s] of Object.entries(args.characterStates)) {
    const clothingRaw = String(s.clothing || "").trim();
    const clothing =
      clothingRaw.length === 0
        ? ""
        : ensureClothingColors(clothingRaw, {
            seed: `${args.storyId}:${args.sceneId}:${name}:ui`,
            scene_text: args.sceneText,
            force_if_no_keywords: true,
          }).text || clothingRaw;
    out[name] = {
      clothing,
      state: String(s.state || ""),
      physical_attributes: String(s.physical_attributes || ""),
    };
  }
  return out;
}

