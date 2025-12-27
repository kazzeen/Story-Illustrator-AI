import { describe, expect, it } from "vitest";
import { applyRedo, applyUndo, getAfterScenesForSentence, parseStoryIntoSentences, validateAnchorsContinuity } from "./StorySceneDragDropEditor";

describe("parseStoryIntoSentences", () => {
  it("splits paragraphs and counts sentences", () => {
    const parsed = parseStoryIntoSentences("Hello world. Second sentence!\n\nNew paragraph?");
    expect(parsed.totalSentences).toBe(3);
    expect(parsed.paragraphs.length).toBe(2);
    expect(parsed.paragraphs[0]?.sentences[0]?.text).toBe("Hello world.");
    expect(parsed.paragraphs[0]?.sentences[1]?.text).toBe("Second sentence!");
    expect(parsed.paragraphs[1]?.sentences[0]?.text).toBe("New paragraph?");
  });
});

describe("validateAnchorsContinuity", () => {
  it("rejects anchors that invert chronological scene order", () => {
    const result = validateAnchorsContinuity({
      scenes: [
        { id: "a", scene_number: 1, title: null, summary: null, original_text: null, image_url: null },
        { id: "b", scene_number: 2, title: null, summary: null, original_text: null, image_url: null },
      ],
      anchors: { a: 1, b: 0 },
      defaultAnchors: { a: 0, b: 1 },
      totalSentences: 5,
      movingSceneId: "a",
    });
    expect(result.ok).toBe(false);
  });

  it("allows scenes to share an anchor while keeping scene_number order", () => {
    const result = validateAnchorsContinuity({
      scenes: [
        { id: "a", scene_number: 1, title: null, summary: null, original_text: null, image_url: null },
        { id: "b", scene_number: 2, title: null, summary: null, original_text: null, image_url: null },
      ],
      anchors: { a: 0, b: 0 },
      defaultAnchors: { a: 0, b: 1 },
      totalSentences: 5,
    });
    expect(result.ok).toBe(true);
  });
});

describe("undo/redo stacks", () => {
  it("does nothing when undo stack is empty", () => {
    const result = applyUndo({ anchors: { a: 1 }, past: [], future: [] });
    expect(result.ok).toBe(false);
  });

  it("does nothing when redo stack is empty", () => {
    const result = applyRedo({ anchors: { a: 1 }, past: [], future: [] });
    expect(result.ok).toBe(false);
  });

  it("supports a single undo and redo", () => {
    const s0 = { a: 0 };
    const s1 = { a: 1 };

    const undoRes = applyUndo({ anchors: s1, past: [s0], future: [] });
    expect(undoRes.ok).toBe(true);
    if (undoRes.ok) {
      expect(undoRes.next.anchors).toEqual(s0);
      expect(undoRes.next.past).toEqual([]);
      expect(undoRes.next.future).toEqual([s1]);
    }

    const redoRes = applyRedo(undoRes.ok ? undoRes.next : { anchors: s1, past: [s0], future: [] });
    expect(redoRes.ok).toBe(true);
    if (redoRes.ok) {
      expect(redoRes.next.anchors).toEqual(s1);
      expect(redoRes.next.past).toEqual([s0]);
      expect(redoRes.next.future).toEqual([]);
    }
  });

  it("supports multiple consecutive operations", () => {
    const s0 = { a: 0 };
    const s1 = { a: 1 };
    const s2 = { a: 2 };

    let state = { anchors: s2, past: [s0, s1], future: [] as Array<{ a: number }> };

    const u1 = applyUndo(state);
    expect(u1.ok).toBe(true);
    if (!u1.ok) return;
    state = u1.next;
    expect(state.anchors).toEqual(s1);

    const u2 = applyUndo(state);
    expect(u2.ok).toBe(true);
    if (!u2.ok) return;
    state = u2.next;
    expect(state.anchors).toEqual(s0);
    expect(state.past).toEqual([]);
    expect(state.future).toEqual([s1, s2]);

    const r1 = applyRedo(state);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    state = r1.next;
    expect(state.anchors).toEqual(s1);

    const r2 = applyRedo(state);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    state = r2.next;
    expect(state.anchors).toEqual(s2);
    expect(state.past).toEqual([s0, s1]);
    expect(state.future).toEqual([]);
  });
});

describe("scene rendering", () => {
  it("does not render after-scenes at paragraph boundaries", () => {
    const parsed = parseStoryIntoSentences("First sentence.\n\nSecond sentence.");
    const scene = { id: "a", scene_number: 1, title: null, summary: null, original_text: null, image_url: null };
    const scenesAtAnchor = new Map<number, Array<typeof scene>>();
    scenesAtAnchor.set(1, [scene]);

    expect(getAfterScenesForSentence({ parsed, scenesAtAnchor, sentenceGlobalIndex: 0 })).toEqual([]);
  });

  it("renders after-scenes only after the final sentence overall", () => {
    const parsed = parseStoryIntoSentences("Only sentence.");
    const scene = { id: "a", scene_number: 1, title: null, summary: null, original_text: null, image_url: null };
    const scenesAtAnchor = new Map<number, Array<typeof scene>>();
    scenesAtAnchor.set(1, [scene]);

    expect(getAfterScenesForSentence({ parsed, scenesAtAnchor, sentenceGlobalIndex: 0 })).toEqual([scene]);
  });
});
