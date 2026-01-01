import { getStyleCategory, STYLE_CONFLICTS } from "./style-prompts.ts";

export const MAX_PROMPT_LENGTH_DEFAULT = 1400;

export interface PromptAssemblyOptions {
  basePrompt: string;
  characterAppendix?: string;
  stylePrefix?: string;
  stylePositive?: string;
  styleGuidePositive?: string;
  model?: string;
  maxLength?: number;
  requiredSubjects?: string[];
  selectedStyleId?: string;
}

export function sanitizePrompt(text: string): string {
  const cleaned = Array.from(text || "")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  return cleaned.replace(/\s+/g, " ").trim();
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitStyleParts(text: string): string[] {
  return String(text || "")
    .split(/[,\n]/g)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function joinComma(parts: string[]): string {
  return parts
    .map((p) => String(p || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(", ");
}

function uniqParts(parts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const p = String(raw || "").replace(/\s+/g, " ").trim();
    if (!p) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function truncateAtWordBoundary(text: string, maxLen: number): string {
  const t = String(text || "");
  if (maxLen <= 0) return "";
  if (t.length <= maxLen) return t;
  const slice = t.slice(0, maxLen);
  const lastSpace = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf(","), slice.lastIndexOf("."));
  if (lastSpace > Math.floor(maxLen * 0.7)) return slice.slice(0, lastSpace).trim();
  return slice.trim();
}

function cleanPromptForStyle(prompt: string, styleId?: string): string {
  if (!styleId || styleId === "none") return prompt;
  const category = getStyleCategory(styleId);
  if (!category) return prompt;

  const conflicts = STYLE_CONFLICTS[category];
  if (!conflicts || conflicts.length === 0) return prompt;

  let out = prompt;
  for (const term of conflicts) {
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, "gi");
    out = out.replace(pattern, "");
  }

  return out.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").replace(/^,/, "").replace(/,$/, "").trim();
}

function styleLabelFromId(styleId?: string): string {
  const id = String(styleId || "").trim();
  if (!id || id === "none") return "";
  return id.replace(/_/g, " ").trim();
}

function buildStyledSubject(stylePrefix: string, base: string): string {
  const p = sanitizePrompt(stylePrefix);
  const b = sanitizePrompt(base);
  if (!p) return b;
  if (!b) return p;
  if (/\bof$/i.test(p)) return `${p} ${b}`.trim();
  return joinComma([p, b]);
}

function computeMissingSubjects(prompt: string, requiredSubjects?: string[]): string[] | undefined {
  if (!requiredSubjects || requiredSubjects.length === 0) return undefined;
  const fullLower = String(prompt || "").toLowerCase();
  const missing: string[] = [];
  for (const sub of requiredSubjects) {
    const s = String(sub || "").trim();
    if (!s) continue;
    if (!fullLower.includes(s.toLowerCase())) missing.push(s);
  }
  return missing.length > 0 ? missing : undefined;
}

export function assemblePrompt(opts: PromptAssemblyOptions): {
  fullPrompt: string;
  truncated: boolean;
  parts: {
    base: string;
    characters: string;
    style: string;
    guide: string;
  };
  missingSubjects?: string[];
} {
  const limit = opts.maxLength ?? MAX_PROMPT_LENGTH_DEFAULT;

  const selectedStyleId = String(opts.selectedStyleId || "").trim();
  const styleLabel = styleLabelFromId(selectedStyleId);
  const styleMarker = styleLabel ? `${styleLabel} style` : "";

  const baseClean = cleanPromptForStyle(sanitizePrompt(opts.basePrompt), selectedStyleId);
  const charsClean = sanitizePrompt(opts.characterAppendix || "");
  const guideClean = sanitizePrompt(opts.styleGuidePositive || "");

  const styleParts = uniqParts([...splitStyleParts(opts.stylePositive || ""), ...splitStyleParts(guideClean)]);

  const stylePrefixClean = sanitizePrompt(opts.stylePrefix || "");
  const styledSubject = buildStyledSubject(stylePrefixClean, baseClean);

  const head = joinComma(uniqParts([...(styleMarker ? [styleMarker] : []), styledSubject, ...styleParts]));

  let full = head;
  let partsStyle = joinComma(uniqParts([...(styleMarker ? [styleMarker] : []), ...styleParts]));
  let partsGuide = guideClean;
  let partsBase = styledSubject;
  let partsChars = charsClean;

  if (partsChars) full = `${full}\n\n${partsChars}`;
  if (styleMarker) full = `${full}\n\n${styleMarker}`;

  let truncated = false;
  if (full.length > limit) {
    truncated = true;
    const workingStyleParts = styleParts.slice();
    let workingBase = styledSubject;
    let workingChars = partsChars;
    let includeTailMarker = Boolean(styleMarker);

    const assemble = () => {
      const core = joinComma(uniqParts([...(styleMarker ? [styleMarker] : []), workingBase, ...workingStyleParts]));
      const withChars = workingChars ? `${core}\n\n${workingChars}` : core;
      return includeTailMarker && styleMarker ? `${withChars}\n\n${styleMarker}` : withChars;
    };

    let out = assemble();
    if (out.length > limit && includeTailMarker) {
      includeTailMarker = false;
      out = assemble();
    }

    if (out.length > limit && workingChars) {
      const withoutTail = out;
      const coreLen = withoutTail.replace(/\n\n[\s\S]*$/g, "").length;
      const remaining = Math.max(0, limit - coreLen - 2);
      workingChars = truncateAtWordBoundary(workingChars, remaining);
      out = assemble();
    }

    while (out.length > limit && workingStyleParts.length > 0) {
      workingStyleParts.pop();
      out = assemble();
    }

    if (out.length > limit) {
      const head = joinComma(uniqParts([...(styleMarker ? [styleMarker] : []), ...workingStyleParts]));
      const budgetForBase = Math.max(0, limit - head.length - 2);
      workingBase = truncateAtWordBoundary(workingBase, budgetForBase);
      out = assemble();
    }

    full = out.length > limit ? truncateAtWordBoundary(out, limit) : out;
    partsStyle = joinComma(uniqParts([...(styleMarker ? [styleMarker] : []), ...workingStyleParts]));
    partsBase = workingBase;
    partsChars = workingChars;
    partsGuide = guideClean;
  }

  const missingSubjects = computeMissingSubjects(full, opts.requiredSubjects);

  return {
    fullPrompt: full,
    truncated,
    missingSubjects,
    parts: {
      base: partsBase,
      characters: partsChars,
      style: partsStyle,
      guide: partsGuide,
    },
  };
}
