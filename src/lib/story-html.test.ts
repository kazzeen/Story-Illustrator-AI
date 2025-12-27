import { describe, expect, it } from "vitest";
import { buildStoryBlocks } from "./story-html";

describe("buildStoryBlocks", () => {
  it("places scenes using case-insensitive matching and canonical punctuation", () => {
    const originalContent =
      "First paragraph.\n\nSecond paragraph with “quotes” and an — em dash.\n\nThird paragraph.";

    const result = buildStoryBlocks({
      originalContent,
      scenes: [
        {
          scene_number: 1,
          title: "Second",
          original_text: 'second paragraph with "quotes" and an - em dash.',
          summary: null,
          image_url: null,
        },
      ],
    });

    expect(result.unplacedScenes.length).toBe(0);
    expect(result.blocks.length).toBe(3);
    expect(result.blocks[0].kind).toBe("text");
    expect(result.blocks[1].kind).toBe("scene");
    expect(result.blocks[2].kind).toBe("text");
    expect(result.blocks[1].kind === "scene" ? result.blocks[1].scene.scene_number : null).toBe(1);
  });

  it("places repeated scenes in chronological order using a moving cursor", () => {
    const repeated =
      "Repeat line A with enough tokens to match reliably in the story content.";
    const originalContent = `Intro.\n\n${repeated}\n\nMiddle.\n\n${repeated}\n\nEnd.`;

    const result = buildStoryBlocks({
      originalContent,
      scenes: [
        { scene_number: 1, title: null, original_text: repeated, summary: null, image_url: null },
        { scene_number: 2, title: null, original_text: repeated, summary: null, image_url: null },
      ],
    });

    const sceneBlocks = result.blocks.filter((b) => b.kind === "scene");
    expect(sceneBlocks.length).toBe(2);
    expect(sceneBlocks[0].kind === "scene" ? sceneBlocks[0].scene.scene_number : null).toBe(1);
    expect(sceneBlocks[1].kind === "scene" ? sceneBlocks[1].scene.scene_number : null).toBe(2);
    expect(result.unplacedScenes.length).toBe(0);
  });

  it("falls back to paragraph overlap when exact slice matching is not possible", () => {
    const paragraph =
      "This is a longer paragraph with many distinct tokens that should allow overlap matching when exact substring matching fails.";
    const originalContent = `Start.\n\n${paragraph}\n\nEnd.`;

    const result = buildStoryBlocks({
      originalContent,
      scenes: [
        {
          scene_number: 1,
          title: null,
          original_text: "Too short",
          summary:
            "A longer paragraph with many distinct tokens that should allow overlap matching when exact substring matching fails",
          image_url: null,
        },
      ],
    });

    expect(result.blocks.some((b) => b.kind === "scene")).toBe(true);
    expect(result.unplacedScenes.length).toBe(0);
  });

  it("does not duplicate unplaced scenes when scene numbers are duplicated", () => {
    const originalContent = "Alpha.\n\nBeta.\n\nGamma.";
    const result = buildStoryBlocks({
      originalContent,
      scenes: [
        { scene_number: 2, title: null, original_text: null, summary: "Not matchable", image_url: null },
        { scene_number: 2, title: null, original_text: null, summary: "Also not matchable", image_url: null },
      ],
    });

    expect(result.unplacedScenes.length).toBe(1);
    expect(result.unplacedScenes[0]?.scene_number).toBe(2);
  });
});

