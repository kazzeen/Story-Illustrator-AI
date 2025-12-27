export type StoryHtmlScene = {
  id?: string;
  scene_number: number;
  title: string | null;
  original_text: string | null;
  summary: string | null;
  image_url: string | null;
};

export type StoryBlock =
  | { kind: "text"; text: string }
  | { kind: "scene"; text: string; scene: StoryHtmlScene };

const escapeHtml = (input: string) =>
  input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const isSectionBreakParagraph = (p: string) => {
  const trimmed = p.trim();
  if (!trimmed) return false;
  if (/^(?:\*\s*){3,}$/.test(trimmed)) return true;
  if (/^(?:-\s*){3,}$/.test(trimmed)) return true;
  if (/^(?:—\s*){3,}$/.test(trimmed)) return true;
  return false;
};

const isChapterHeadingParagraph = (p: string) => {
  const trimmed = p.trim();
  if (!trimmed) return false;
  if (/^chapter\s+\w+/i.test(trimmed)) return true;
  if (/^part\s+\w+/i.test(trimmed)) return true;
  if (/^(prologue|epilogue)$/i.test(trimmed)) return true;
  return false;
};

const paragraphToHtml = (p: string) => {
  const trimmed = p.trim();
  if (!trimmed) return "";
  if (isSectionBreakParagraph(trimmed)) return `<hr class="section-break" aria-hidden="true" />`;
  if (isChapterHeadingParagraph(trimmed)) return `<h2 class="chapter-heading">${escapeHtml(trimmed)}</h2>`;
  return `<p>${escapeHtml(trimmed)}</p>`;
};

const textToParagraphsHtml = (text: string) => {
  const normalized = text.replace(/\r\n/g, "\n");
  const paragraphs = normalized.split(/\n\s*\n/g).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return "";
  const inner = paragraphs.map(paragraphToHtml).filter(Boolean).join("");
  if (!inner) return "";
  return `<section class="text-block">${inner}</section>`;
};

const canonicalizeChar = (ch: string) => {
  if (ch === "“" || ch === "”") return '"';
  if (ch === "‘" || ch === "’") return "'";
  if (ch === "—" || ch === "–") return "-";
  return ch.toLowerCase();
};

const isWhitespaceChar = (ch: string) =>
  ch === " " || ch === "\n" || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v";

const normalizeForSearch = (text: string) => {
  const normalizedChars: string[] = [];
  let inWs = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const isWs = isWhitespaceChar(ch);
    if (isWs) {
      if (!inWs && normalizedChars.length > 0) normalizedChars.push(" ");
      inWs = true;
      continue;
    }
    inWs = false;
    normalizedChars.push(canonicalizeChar(ch));
  }

  const raw = normalizedChars.join("");
  return raw.trim();
};

const normalizeWithMap = (text: string) => {
  const normalizedChars: string[] = [];
  const map: number[] = [];
  let inWs = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const isWs = isWhitespaceChar(ch);
    if (isWs) {
      if (!inWs && normalizedChars.length > 0) {
        normalizedChars.push(" ");
        map.push(i);
      }
      inWs = true;
      continue;
    }
    inWs = false;
    normalizedChars.push(canonicalizeChar(ch));
    map.push(i);
  }

  const raw = normalizedChars.join("");
  let start = 0;
  while (start < raw.length && raw[start] === " ") start += 1;
  let end = raw.length;
  while (end > start && raw[end - 1] === " ") end -= 1;
  const normalized = raw.slice(start, end);
  const trimmedMap = map.slice(start, end);
  return { normalized, map: trimmedMap };
};

type LocatedSlice = {
  originalStart: number;
  originalEndExclusive: number;
  nextNormalizedCursor: number;
};

const findNormalizedCursorAtOrAfterOriginalIndex = (map: number[], originalIndex: number) => {
  let lo = 0;
  let hi = map.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((map[mid] ?? 0) < originalIndex) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

const locateSlice = (
  full: ReturnType<typeof normalizeWithMap>,
  needleRaw: string,
  normalizedCursor: number,
): LocatedSlice | null => {
  const needle = normalizeForSearch(needleRaw);
  const words = needle.length > 0 ? needle.split(" ").filter(Boolean) : [];
  if (needle.length < 18 || words.length < 6) return null;

  const candidates = [
    needle,
    needle.slice(0, 260),
    needle.slice(0, 160),
    needle.length > 200 ? needle.slice(-200) : "",
    needle.length > 160 ? needle.slice(-160) : "",
  ]
    .map((c) => c.trim())
    .filter((c, idx, arr) => c.length >= 18 && arr.indexOf(c) === idx);

  for (const cand of candidates) {
    const idx = full.normalized.indexOf(cand, normalizedCursor);
    if (idx < 0) continue;
    const start = full.map[idx] ?? 0;
    const endNormIdx = Math.min(idx + cand.length - 1, full.map.length - 1);
    const end = (full.map[endNormIdx] ?? start) + 1;
    return { originalStart: start, originalEndExclusive: end, nextNormalizedCursor: idx + cand.length };
  }

  return null;
};

const buildSceneBlockHtml = (scene: StoryHtmlScene, text: string) => {
  const heading = `Scene ${scene.scene_number}${scene.title ? `: ${scene.title}` : ""}`;
  const imgAlt = `Scene ${scene.scene_number}${scene.title ? `: ${scene.title}` : ""}`;
  const imageHtml = scene.image_url
    ? `<figure class="scene-media"><img src="${escapeHtml(scene.image_url)}" alt="${escapeHtml(imgAlt)}" loading="lazy" /></figure>`
    : `<figure class="scene-media placeholder" aria-label="No image available"><div class="placeholder-box">No image</div></figure>`;

  return `
    <section class="scene-block" aria-label="${escapeHtml(heading)}">
      <div class="scene-grid">
        <div class="scene-text">
          <h2>${escapeHtml(heading)}</h2>
          ${textToParagraphsHtml(text)}
        </div>
        ${imageHtml}
      </div>
    </section>
  `;
};

type ParagraphRange = { start: number; endExclusive: number; text: string };

const splitIntoParagraphRanges = (text: string): ParagraphRange[] => {
  const ranges: ParagraphRange[] = [];
  const normalized = text.replace(/\r\n/g, "\n");
  let cursor = 0;

  while (cursor < normalized.length) {
    while (cursor < normalized.length && (normalized[cursor] === "\n" || normalized[cursor] === " " || normalized[cursor] === "\t")) {
      cursor += 1;
    }
    if (cursor >= normalized.length) break;

    const match = /\n\s*\n/g.exec(normalized.slice(cursor));
    if (!match) {
      const end = normalized.length;
      const slice = normalized.slice(cursor, end);
      if (slice.trim()) ranges.push({ start: cursor, endExclusive: end, text: slice });
      break;
    }

    const relativeIdx = match.index;
    const end = cursor + relativeIdx;
    const slice = normalized.slice(cursor, end);
    if (slice.trim()) ranges.push({ start: cursor, endExclusive: end, text: slice });
    cursor = end + match[0].length;
  }

  return ranges;
};

const tokenize = (text: string) => {
  const normalized = normalizeForSearch(text);
  const parts = normalized.split(" ").map((p) => p.trim()).filter(Boolean);
  const tokens = new Set<string>();
  for (const p of parts) {
    if (p.length <= 2) continue;
    tokens.add(p);
  }
  return tokens;
};

const scoreOverlap = (needle: Set<string>, hay: Set<string>) => {
  if (needle.size === 0) return 0;
  let inter = 0;
  needle.forEach((t) => {
    if (hay.has(t)) inter += 1;
  });
  return inter / needle.size;
};

export const buildStoryBlocks = (args: { originalContent: string; scenes: StoryHtmlScene[] }) => {
  const originalContent = args.originalContent.replace(/\r\n/g, "\n");
  const scenes = (args.scenes || []).slice().sort((a, b) => a.scene_number - b.scene_number);

  const full = normalizeWithMap(originalContent);
  let normalizedCursor = 0;
  let originalCursor = 0;
  const usedSceneNumbers = new Set<number>();
  const blocks: StoryBlock[] = [];
  const duplicateSceneNumbers: number[] = [];
  let overlapConflicts = 0;
  const paragraphRanges = splitIntoParagraphRanges(originalContent);
  const paragraphTokens = paragraphRanges.map((p) => tokenize(p.text));

  const locateByParagraphMatch = (sourceText: string, afterOriginalCursor: number): LocatedSlice | null => {
    const needleTokens = tokenize(sourceText);
    if (needleTokens.size < 8) return null;

    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < paragraphRanges.length; i += 1) {
      const r = paragraphRanges[i];
      if (r.start < afterOriginalCursor) continue;
      const score = scoreOverlap(needleTokens, paragraphTokens[i] ?? new Set<string>());
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
      if (score >= 0.9) break;
    }

    if (bestIdx < 0) return null;
    const bestRange = paragraphRanges[bestIdx];
    const ok = bestScore >= 0.45 || (bestScore >= 0.35 && needleTokens.size >= 18);
    if (!ok) return null;

    const nextNormalizedCursor = findNormalizedCursorAtOrAfterOriginalIndex(full.map, bestRange.endExclusive);
    return {
      originalStart: bestRange.start,
      originalEndExclusive: bestRange.endExclusive,
      nextNormalizedCursor,
    };
  };

  for (const scene of scenes) {
    if (usedSceneNumbers.has(scene.scene_number)) {
      duplicateSceneNumbers.push(scene.scene_number);
      continue;
    }

    const primaryText = scene.original_text || "";
    const summaryText = scene.summary || "";

    const located =
      (primaryText ? locateSlice(full, primaryText, normalizedCursor) : null) ||
      (summaryText ? locateSlice(full, summaryText, normalizedCursor) : null) ||
      (primaryText ? locateByParagraphMatch(primaryText, originalCursor) : null) ||
      (summaryText ? locateByParagraphMatch(summaryText, originalCursor) : null);

    if (!located) continue;
    if (located.originalStart < originalCursor) {
      overlapConflicts += 1;
      continue;
    }

    const before = originalContent.slice(originalCursor, located.originalStart);
    if (before.trim()) blocks.push({ kind: "text", text: before });

    const matched = originalContent.slice(located.originalStart, located.originalEndExclusive);
    blocks.push({ kind: "scene", scene, text: matched });
    usedSceneNumbers.add(scene.scene_number);

    originalCursor = located.originalEndExclusive;
    normalizedCursor = Math.max(located.nextNormalizedCursor, findNormalizedCursorAtOrAfterOriginalIndex(full.map, originalCursor));
  }

  const tail = originalContent.slice(originalCursor);
  if (tail.trim()) blocks.push({ kind: "text", text: tail });

  const unplacedScenesRaw = scenes.filter((s) => !usedSceneNumbers.has(s.scene_number));
  const unplacedScenes: StoryHtmlScene[] = [];
  const unplacedSceneNumberSet = new Set<number>();
  for (const s of unplacedScenesRaw) {
    if (unplacedSceneNumberSet.has(s.scene_number)) continue;
    unplacedSceneNumberSet.add(s.scene_number);
    unplacedScenes.push(s);
  }
  return {
    blocks,
    unplacedScenes,
    diagnostics: {
      totalScenes: scenes.length,
      placedScenes: usedSceneNumbers.size,
      unplacedScenes: unplacedScenes.length,
      overlapConflicts,
      duplicateSceneNumbers,
    },
  };
};

export const buildStoryHtmlDocument = (args: {
  title: string;
  originalContent: string | null | undefined;
  scenes: StoryHtmlScene[];
}) => {
  const title = args.title || "Story";
  const originalContent = typeof args.originalContent === "string" ? args.originalContent : "";
  const scenes = (args.scenes || []).slice().sort((a, b) => a.scene_number - b.scene_number);

  if (!originalContent.trim()) {
    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} - Story</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; line-height: 1.7; }
      .error { max-width: 900px; margin: 0 auto; }
      .error h1 { margin: 0 0 12px; }
      .error p { margin: 0; color: #555; }
    </style>
  </head>
  <body>
    <main class="error" role="main" aria-label="Story view">
      <h1>${escapeHtml(title)}</h1>
      <p>Story content is unavailable.</p>
    </main>
  </body>
</html>`;
  }

  const { blocks, unplacedScenes } = buildStoryBlocks({ originalContent, scenes });
  const parts: string[] = blocks.map((b) => {
    if (b.kind === "text") return textToParagraphsHtml(b.text);
    return buildSceneBlockHtml(b.scene, b.text);
  });

  if (unplacedScenes.length > 0) {
    parts.push(`<hr class="separator" /><section class="unplaced" aria-label="Unplaced scenes"><h2>Scenes</h2></section>`);
    for (const scene of unplacedScenes) {
      const fallbackText = scene.original_text || scene.summary || "";
      if (!fallbackText) continue;
      parts.push(buildSceneBlockHtml(scene, fallbackText));
    }
  }

  const bodyHtml = parts.join("");

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} - Story</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
        margin: 0;
        padding: clamp(18px, 2.8vw, 40px);
        line-height: 1.75;
        font-size: clamp(16px, 0.7vw + 14px, 19px);
        background: #fff;
        color: #111;
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        hyphens: auto;
      }
      @media (prefers-color-scheme: dark) {
        body { background: #0b0b0c; color: #f2f2f2; }
      }
      main { max-width: 72ch; margin: 0 auto; }
      h1 {
        font-size: clamp(26px, 2.2vw + 18px, 38px);
        line-height: 1.15;
        margin: 0 0 1.25em;
        letter-spacing: -0.01em;
      }
      .text-block p { margin: 0; text-indent: 1.5em; }
      .text-block p + p { margin-top: 0.95em; }
      .text-block .chapter-heading + p { text-indent: 0; }
      .text-block .section-break + p { text-indent: 0; }
      .chapter-heading {
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        font-size: clamp(18px, 0.9vw + 16px, 22px);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin: 2.25em 0 1.1em;
      }
      .section-break {
        border: 0;
        border-top: 1px solid rgba(0,0,0,0.18);
        width: min(16ch, 35%);
        margin: 2.4em auto;
      }
      .scene-block { border: 1px solid rgba(0,0,0,0.10); border-radius: 16px; padding: clamp(14px, 2vw, 18px); margin: 1.6em 0; background: rgba(0,0,0,0.02); page-break-inside: avoid; break-inside: avoid; }
      @media (prefers-color-scheme: dark) {
        .scene-block { border-color: rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); }
        .section-break { border-top-color: rgba(255,255,255,0.18); }
      }
      .scene-grid { display: grid; grid-template-columns: 1fr; gap: 14px; align-items: start; }
      @media (min-width: 900px) {
        .scene-grid { grid-template-columns: minmax(0, 1fr) 420px; }
      }
      .scene-text h2 {
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        font-size: clamp(16px, 0.7vw + 14px, 18px);
        line-height: 1.25;
        margin: 0 0 0.9em;
      }
      .scene-text p { margin: 0.9em 0 0; text-indent: 0; }
      .scene-media { margin: 0; }
      .scene-media img { width: 100%; height: auto; border-radius: 12px; display: block; border: 1px solid rgba(0,0,0,0.12); background: rgba(0,0,0,0.06); }
      @media (prefers-color-scheme: dark) {
        .scene-media img { border-color: rgba(255,255,255,0.14); background: rgba(255,255,255,0.06); }
      }
      .scene-media.placeholder .placeholder-box { width: 100%; min-height: 240px; border-radius: 12px; display: grid; place-items: center; border: 1px dashed rgba(0,0,0,0.25); color: rgba(0,0,0,0.6); background: rgba(0,0,0,0.03); }
      @media (prefers-color-scheme: dark) {
        .scene-media.placeholder .placeholder-box { border-color: rgba(255,255,255,0.22); color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.04); }
      }
      .separator { margin: 2.4em 0; border: none; border-top: 1px solid rgba(0,0,0,0.12); }
      @media (prefers-color-scheme: dark) {
        .separator { border-top-color: rgba(255,255,255,0.12); }
      }
      .unplaced h2 { font-size: 20px; margin: 0 0 14px; }

      @media print {
        @page { margin: 20mm; }
        body { background: #fff !important; color: #000 !important; padding: 0 !important; font-size: 11.5pt !important; }
        main { max-width: none !important; }
        .scene-block { background: transparent !important; }
        .scene-media img { break-inside: avoid; page-break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <main role="main" aria-label="Story view">
      <h1>${escapeHtml(title)}</h1>
      ${bodyHtml}
    </main>
  </body>
</html>`;
};

type ParsedStoryForAnchors = {
  paragraphs: Array<{
    raw: string;
    trimmed: string;
    sentences: Array<{
      text: string;
      start: number;
      endExclusive: number;
      globalIndex: number;
    }>;
  }>;
  totalSentences: number;
  sentenceRanges: Array<{ start: number; endExclusive: number; index: number }>;
};

const parseStoryIntoSentencesForAnchors = (input: string): ParsedStoryForAnchors => {
  const text = input.replace(/\r\n/g, "\n");
  const paragraphsRaw = text.split(/\n\s*\n/g);
  const paragraphs: ParsedStoryForAnchors["paragraphs"] = [];
  const sentenceRanges: ParsedStoryForAnchors["sentenceRanges"] = [];
  let globalIndex = 0;

  let scanIndex = 0;
  for (const rawPara of paragraphsRaw) {
    const paraStart = text.indexOf(rawPara, scanIndex);
    const paraEndExclusive = paraStart >= 0 ? paraStart + rawPara.length : scanIndex;
    scanIndex = Math.max(0, paraEndExclusive);

    const trimmed = rawPara.trim();
    if (!trimmed) continue;

    const sentences: ParsedStoryForAnchors["paragraphs"][number]["sentences"] = [];
    const sentenceRegex = /[^.!?]+[.!?]+(?:["')\]]+)?|\S+$/g;
    let match: RegExpExecArray | null;
    while ((match = sentenceRegex.exec(rawPara)) !== null) {
      const s = match[0];
      const leadingWsMatch = /^\s*/.exec(s);
      const leadingWsLen = leadingWsMatch ? leadingWsMatch[0].length : 0;
      const startLocal = match.index + leadingWsLen;
      const endLocal = match.index + s.length;
      const slice = rawPara.slice(startLocal, endLocal).trim();
      if (!slice) continue;

      const start = (paraStart >= 0 ? paraStart : 0) + startLocal;
      const endExclusive = (paraStart >= 0 ? paraStart : 0) + endLocal;
      sentences.push({ text: slice, start, endExclusive, globalIndex });
      sentenceRanges.push({ start, endExclusive, index: globalIndex });
      globalIndex += 1;
    }

    if (sentences.length > 0) paragraphs.push({ raw: rawPara, trimmed, sentences });
  }

  return { paragraphs, totalSentences: globalIndex, sentenceRanges };
};

const clampAnchor = (anchor: number, totalSentences: number) => Math.max(0, Math.min(totalSentences, anchor));

const computeDefaultSceneAnchors = (args: {
  originalContent: string;
  scenes: StoryHtmlScene[];
  parsed: ParsedStoryForAnchors;
}) => {
  const { originalContent, scenes, parsed } = args;
  const defaultAnchors: Record<string, number> = {};

  const bySceneNumber = new Map<number, StoryHtmlScene>();
  for (const s of scenes) bySceneNumber.set(s.scene_number, s);

  const sentenceIndexAtChar = (pos: number) => {
    if (parsed.sentenceRanges.length === 0) return 0;
    let lo = 0;
    let hi = parsed.sentenceRanges.length - 1;
    let best = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const r = parsed.sentenceRanges[mid];
      if (pos < r.start) {
        hi = mid - 1;
      } else if (pos >= r.endExclusive) {
        best = Math.max(best, r.index);
        lo = mid + 1;
      } else {
        return r.index;
      }
    }
    return best;
  };

  const { blocks } = buildStoryBlocks({ originalContent, scenes });

  let cursor = 0;
  for (const block of blocks) {
    if (block.kind === "text") {
      cursor += block.text.length;
      continue;
    }

    const scene = bySceneNumber.get(block.scene.scene_number);
    const sceneId = scene?.id;
    if (sceneId) defaultAnchors[sceneId] = clampAnchor(sentenceIndexAtChar(cursor), parsed.totalSentences);
    cursor += block.text.length;
  }

  return defaultAnchors;
};

const buildSceneFigureHtml = (scene: StoryHtmlScene) => {
  const caption = `Scene ${scene.scene_number}${scene.title ? `: ${scene.title}` : ""}`;
  const imgAlt = caption;
  const media = scene.image_url
    ? `<img src="${escapeHtml(scene.image_url)}" alt="${escapeHtml(imgAlt)}" loading="lazy" />`
    : `<div class="placeholder-box" aria-label="No image available">No image</div>`;

  const sceneId = typeof scene.id === "string" && scene.id.length > 0 ? escapeHtml(scene.id) : "";
  const sceneIdAttr = sceneId ? ` data-scene-id="${sceneId}"` : "";
  return `<figure class="scene-figure"${sceneIdAttr} data-scene-number="${scene.scene_number}" aria-label="${escapeHtml(caption)}"><figcaption>${escapeHtml(caption)}</figcaption>${media}</figure>`;
};

export const buildAnchoredStoryHtmlDocument = (args: {
  title: string;
  originalContent: string | null | undefined;
  scenes: StoryHtmlScene[];
  sceneAnchors?: Record<string, number>;
}) => {
  const title = args.title || "Story";
  const originalContent = typeof args.originalContent === "string" ? args.originalContent : "";
  const scenes = (args.scenes || []).slice().sort((a, b) => a.scene_number - b.scene_number);
  const sceneAnchors = args.sceneAnchors;

  if (!originalContent.trim()) {
    return buildStoryHtmlDocument({ title, originalContent, scenes });
  }

  const parsed = parseStoryIntoSentencesForAnchors(originalContent);
  const defaultAnchors = computeDefaultSceneAnchors({ originalContent, scenes, parsed });
  const scenesAtAnchor = new Map<number, StoryHtmlScene[]>();

  for (const scene of scenes) {
    const sceneId = scene.id;
    const explicitRaw = sceneId ? sceneAnchors?.[sceneId] : undefined;
    const base = sceneId ? defaultAnchors[sceneId] : undefined;
    const anchor = clampAnchor(
      typeof explicitRaw === "number" && Number.isFinite(explicitRaw)
        ? Math.trunc(explicitRaw)
        : typeof base === "number"
          ? base
          : parsed.totalSentences,
      parsed.totalSentences,
    );

    const list = scenesAtAnchor.get(anchor) ?? [];
    list.push(scene);
    scenesAtAnchor.set(anchor, list);
  }

  scenesAtAnchor.forEach((list) => list.sort((a, b) => a.scene_number - b.scene_number));

  const bodyParts: string[] = [];

  for (const p of parsed.paragraphs) {
    if (p.sentences.length === 1 && isChapterHeadingParagraph(p.trimmed)) {
      const s = p.sentences[0];
      const beforeScenes = scenesAtAnchor.get(s.globalIndex) ?? [];
      if (beforeScenes.length > 0) bodyParts.push(beforeScenes.map(buildSceneFigureHtml).join(""));
      bodyParts.push(`<h2 class="chapter-heading">${escapeHtml(p.trimmed)}</h2>`);
      continue;
    }

    if (p.sentences.length === 1 && isSectionBreakParagraph(p.trimmed)) {
      const s = p.sentences[0];
      const beforeScenes = scenesAtAnchor.get(s.globalIndex) ?? [];
      if (beforeScenes.length > 0) bodyParts.push(beforeScenes.map(buildSceneFigureHtml).join(""));
      bodyParts.push(`<hr class="section-break" aria-hidden="true" />`);
      continue;
    }

    const sentencePieces: string[] = [];
    const flushParagraph = () => {
      if (sentencePieces.length === 0) return;
      bodyParts.push(`<p>${sentencePieces.join("")}</p>`);
      sentencePieces.length = 0;
    };

    for (const s of p.sentences) {
      const beforeScenes = scenesAtAnchor.get(s.globalIndex) ?? [];
      if (beforeScenes.length > 0) {
        flushParagraph();
        bodyParts.push(beforeScenes.map(buildSceneFigureHtml).join(""));
      }

      if (sentencePieces.length > 0) sentencePieces.push(" ");
      sentencePieces.push(escapeHtml(s.text));
    }

    flushParagraph();
  }

  const endScenes = scenesAtAnchor.get(parsed.totalSentences) ?? [];
  if (endScenes.length > 0) bodyParts.push(endScenes.map(buildSceneFigureHtml).join(""));

  const bodyHtml = bodyParts.join("");

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} - Story</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
        margin: 0;
        padding: clamp(18px, 2.8vw, 40px);
        line-height: 1.75;
        font-size: clamp(16px, 0.7vw + 14px, 19px);
        background: #fff;
        color: #111;
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        hyphens: auto;
      }
      @media (prefers-color-scheme: dark) {
        body { background: #0b0b0c; color: #f2f2f2; }
      }
      main { max-width: 72ch; margin: 0 auto; }
      h1 {
        font-size: clamp(26px, 2.2vw + 18px, 38px);
        line-height: 1.15;
        margin: 0 0 1.25em;
        letter-spacing: -0.01em;
      }
      p { margin: 0; text-indent: 1.5em; }
      p + p { margin-top: 0.95em; }
      .chapter-heading + p { text-indent: 0; }
      .section-break + p { text-indent: 0; }
      .chapter-heading {
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        font-size: clamp(18px, 0.9vw + 16px, 22px);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin: 2.25em 0 1.1em;
        text-indent: 0;
      }
      .section-break {
        border: 0;
        border-top: 1px solid rgba(0,0,0,0.18);
        width: min(16ch, 35%);
        margin: 2.4em auto;
      }
      @media (prefers-color-scheme: dark) {
        .section-break { border-top-color: rgba(255,255,255,0.18); }
      }
      .scene-figure {
        margin: 1.4em 0 1.6em;
        padding: 14px;
        border: 1px solid rgba(0,0,0,0.10);
        border-radius: 14px;
        background: rgba(0,0,0,0.02);
        break-inside: avoid;
        page-break-inside: avoid;
      }
      @media (prefers-color-scheme: dark) {
        .scene-figure { border-color: rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); }
      }
      .scene-figure figcaption {
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        font-size: 0.92em;
        letter-spacing: 0.02em;
        margin: 0 0 10px;
        color: rgba(0,0,0,0.75);
      }
      @media (prefers-color-scheme: dark) {
        .scene-figure figcaption { color: rgba(255,255,255,0.78); }
      }
      .scene-figure img {
        width: 100%;
        height: auto;
        display: block;
        border-radius: 12px;
        border: 1px solid rgba(0,0,0,0.12);
        background: rgba(0,0,0,0.06);
      }
      @media (prefers-color-scheme: dark) {
        .scene-figure img { border-color: rgba(255,255,255,0.14); background: rgba(255,255,255,0.06); }
      }
      .scene-figure .placeholder-box {
        width: 100%;
        min-height: 240px;
        border-radius: 12px;
        display: grid;
        place-items: center;
        border: 1px dashed rgba(0,0,0,0.25);
        color: rgba(0,0,0,0.6);
        background: rgba(0,0,0,0.03);
      }
      @media (prefers-color-scheme: dark) {
        .scene-figure .placeholder-box { border-color: rgba(255,255,255,0.22); color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.04); }
      }

      @media print {
        @page { margin: 20mm; }
        body { background: #fff !important; color: #000 !important; padding: 0 !important; font-size: 11.5pt !important; }
        main { max-width: none !important; }
        .scene-figure { background: transparent !important; }
        .scene-figure img { break-inside: avoid; page-break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <main role="main" aria-label="Story view">
      <h1>${escapeHtml(title)}</h1>
      ${bodyHtml}
    </main>
  </body>
</html>`;
};

export const validateStoryHtmlDocument = (html: string) => {
  const issues: string[] = [];

  if (!/<meta\s+charset=["']utf-8["']\s*\/?>/i.test(html)) issues.push("Missing UTF-8 charset meta tag.");
  if (!/<meta\s+name=["']viewport["']/i.test(html)) issues.push("Missing viewport meta tag.");
  if (!/<main[^>]*role=["']main["'][^>]*>/i.test(html)) issues.push("Missing main landmark.");
  if (!/<style[\s>]/i.test(html)) issues.push("Missing style block.");
  if (!/@media\s+print/i.test(html)) issues.push("Missing print styles.");
  if (!/@page\s*\{/i.test(html)) issues.push("Missing @page print settings.");
  if (!/max-width:\s*72ch/i.test(html)) issues.push("Missing readable max-width constraint.");

  return issues.length === 0 ? { ok: true as const } : { ok: false as const, issues };
};

export const validateStoryHtmlSceneCoverage = (args: { html: string; scenes: Array<{ id?: string; scene_number: number }> }) => {
  const expectedById = new Set<string>();
  const expectedByNumber = new Set<number>();

  for (const s of args.scenes) {
    if (typeof s.id === "string" && s.id.length > 0) expectedById.add(s.id);
    expectedByNumber.add(s.scene_number);
  }

  const presentIds = new Set<string>();
  const presentNumbers = new Set<number>();

  const idRe = /data-scene-id="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(args.html)) !== null) {
    const raw = m[1] ?? "";
    const decoded = raw
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    if (decoded) presentIds.add(decoded);
  }

  const numRe = /data-scene-number="(\d+)"/g;
  while ((m = numRe.exec(args.html)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) presentNumbers.add(n);
  }

  const missingIds: string[] = [];
  expectedById.forEach((id) => {
    if (!presentIds.has(id)) missingIds.push(id);
  });

  const missingNumbers: number[] = [];
  expectedByNumber.forEach((n) => {
    if (!presentNumbers.has(n)) missingNumbers.push(n);
  });

  const expected = expectedById.size > 0 ? expectedById.size : expectedByNumber.size;
  const present = expectedById.size > 0 ? presentIds.size : presentNumbers.size;
  const percentage = expected === 0 ? 100 : Math.round((present / expected) * 1000) / 10;

  return missingIds.length === 0 && missingNumbers.length === 0
    ? { ok: true as const, expected, present, percentage }
    : { ok: false as const, expected, present, percentage, missingIds, missingNumbers };
};
