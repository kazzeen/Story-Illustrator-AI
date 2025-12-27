import { describe, expect, it } from "vitest";
import {
  buildAnchoredStoryHtmlDocument,
  buildStoryHtmlDocument,
  validateStoryHtmlDocument,
  validateStoryHtmlSceneCoverage,
} from "./story-html";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

describe("story export document", () => {
  it("builds a printable, validated HTML document with headings and section breaks", () => {
    const originalContent = [
      "CHAPTER 1",
      "",
      "“Hello”—said <Alice> & Bob.",
      "",
      "***",
      "",
      "This is a second paragraph with enough words to match the scene block correctly.",
      "",
      "This is trailing text after the scene paragraph.",
    ].join("\n");

    const html = buildStoryHtmlDocument({
      title: "My Story",
      originalContent,
      scenes: [
        {
          scene_number: 1,
          title: "Opening",
          original_text: "This is a second paragraph with enough words to match the scene block correctly.",
          summary: null,
          image_url: null,
        },
      ],
    });

    expect(validateStoryHtmlDocument(html)).toEqual({ ok: true });

    expect(html).toContain('<meta charset="utf-8"');
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain('<main role="main" aria-label="Story view">');

    expect(html).toContain('<h2 class="chapter-heading">CHAPTER 1</h2>');
    expect(html).toContain('<hr class="section-break" aria-hidden="true" />');

    expect(html).toContain("&lt;Alice&gt;");
    expect(html).toContain("&amp;");

    expect(html).toMatch(/@media\s+print/);
    expect(html).toMatch(/@page\s*\{\s*margin:\s*20mm;\s*\}/);
    expect(html).toMatch(/max-width:\s*72ch/);
  });

  it("inserts scene images at saved anchor positions", () => {
    const originalContent = "First sentence. Second sentence.";

    const html = buildAnchoredStoryHtmlDocument({
      title: "Anchored Story",
      originalContent,
      scenes: [
        {
          id: "scene-1",
          scene_number: 1,
          title: "Inserted",
          original_text: null,
          summary: null,
          image_url: "https://example.com/image.png",
        },
      ],
      sceneAnchors: { "scene-1": 1 },
    });

    expect(validateStoryHtmlDocument(html)).toEqual({ ok: true });

    const iFirst = html.indexOf("First sentence.");
    const iFigure = html.indexOf('class="scene-figure"');
    const iSecond = html.indexOf("Second sentence.");

    expect(iFirst).toBeGreaterThanOrEqual(0);
    expect(iFigure).toBeGreaterThanOrEqual(0);
    expect(iSecond).toBeGreaterThanOrEqual(0);
    expect(iFirst).toBeLessThan(iFigure);
    expect(iFigure).toBeLessThan(iSecond);
  });

  it("validates full scene coverage when scene ids are present", () => {
    const html = buildAnchoredStoryHtmlDocument({
      title: "Coverage",
      originalContent: "One. Two.",
      scenes: [
        { id: "a", scene_number: 1, title: null, original_text: null, summary: null, image_url: null },
        { id: "b", scene_number: 2, title: null, original_text: null, summary: null, image_url: null },
      ],
      sceneAnchors: { a: 0, b: 1 },
    });

    const coverage = validateStoryHtmlSceneCoverage({
      html,
      scenes: [
        { id: "a", scene_number: 1 },
        { id: "b", scene_number: 2 },
      ],
    });

    expect(coverage.ok).toBe(true);
    if (coverage.ok) {
      expect(coverage.present).toBe(2);
      expect(coverage.expected).toBe(2);
      expect(coverage.percentage).toBe(100);
    }
  });
});

describe("print CSS isolation", () => {
  it("keeps story modal visible during print", () => {
    const indexCssPath = fileURLToPath(new URL("../index.css", import.meta.url));
    const css = fs.readFileSync(indexCssPath, "utf-8");

    expect(css).toMatch(/@media\s+print/);
    expect(css).toMatch(/#story-modal-print-root/);
    expect(css).toMatch(/visibility:\s*hidden\s*!important/);
    expect(css).toMatch(/visibility:\s*visible\s*!important/);
  });
});
