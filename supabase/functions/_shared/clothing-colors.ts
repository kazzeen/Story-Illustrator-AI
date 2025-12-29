export type ClothingColorCategory = "feminine" | "masculine" | "neutral";

export type ClothingColorOptions = {
  seed: string;
  scene_text?: string;
  force_if_no_keywords?: boolean;
};

const FEMININE_PALETTE = [
  "pink",
  "rose pink",
  "hot pink",
  "blush",
  "magenta",
  "fuchsia",
  "lavender",
  "lilac",
  "purple",
  "violet",
  "plum",
];

const MASCULINE_PALETTE = [
  "black",
  "charcoal",
  "slate gray",
  "navy",
  "midnight blue",
  "white",
  "cream",
  "brown",
  "tan",
  "olive",
  "forest green",
  "burgundy",
];

const NEUTRAL_PALETTE = [
  "black",
  "white",
  "gray",
  "navy",
  "denim blue",
  "olive",
  "tan",
  "brown",
  "beige",
  "teal",
  "maroon",
];

const ALL_COLOR_WORDS = [
  ...new Set(
    [
      ...FEMININE_PALETTE,
      ...MASCULINE_PALETTE,
      ...NEUTRAL_PALETTE,
      "red",
      "blue",
      "green",
      "yellow",
      "orange",
      "purple",
      "pink",
      "brown",
      "black",
      "white",
      "gray",
      "grey",
      "silver",
      "gold",
      "beige",
      "tan",
      "cream",
      "ivory",
      "maroon",
      "burgundy",
      "teal",
      "turquoise",
      "cyan",
      "indigo",
      "violet",
      "magenta",
      "fuchsia",
      "lavender",
      "lilac",
      "plum",
      "olive",
      "khaki",
      "navy",
      "charcoal",
      "slate",
    ].map((s) => s.toLowerCase()),
  ),
].sort((a, b) => b.length - a.length);

const COLOR_DETECT_RE = new RegExp(`\\b(${ALL_COLOR_WORDS.map(escapeRegExp).join("|")})\\b`, "i");

const FEMININE_KEYWORDS = [
  "dress",
  "gown",
  "skirt",
  "blouse",
  "lingerie",
  "bra",
  "panties",
  "corset",
  "heels",
  "stiletto",
  "pantyhose",
  "stockings",
];

const MASCULINE_KEYWORDS = ["tie", "bow tie", "tuxedo", "suit", "boxers"];

const CLOTHING_KEYWORDS = [
  "shirt",
  "t-shirt",
  "tee",
  "blouse",
  "sweater",
  "hoodie",
  "jacket",
  "coat",
  "blazer",
  "suit",
  "vest",
  "cardigan",
  "dress",
  "gown",
  "skirt",
  "pants",
  "trousers",
  "jeans",
  "shorts",
  "leggings",
  "socks",
  "shoes",
  "boots",
  "heels",
  "sneakers",
  "scarf",
  "hat",
  "cap",
  "gloves",
  "belt",
  "tie",
  "bow tie",
  "tuxedo",
  "kimono",
  "robe",
  "cloak",
  "cape",
  "tunic",
  "armor",
  "armour",
  "breastplate",
  "cuirass",
  "gauntlets",
  "greaves",
  "bracers",
  "sandals",
  "cloak",
  "cape",
  "sari",
  "uniform",
  "attire",
  "outfit",
  "top",
  "bottoms",
];

const CLOTHING_KEYWORD_RE = new RegExp(`\\b(${CLOTHING_KEYWORDS.map(escapeRegExp).join("|")})\\b`, "i");

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fnv1a32(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function pickDistinctColor(palette: string[], seed: string, used: Set<string>) {
  if (palette.length === 0) return "black";
  const base = fnv1a32(seed);
  for (let attempt = 0; attempt < palette.length; attempt++) {
    const idx = (base + attempt) % palette.length;
    const color = palette[idx];
    const key = color.toLowerCase();
    if (!used.has(key)) {
      used.add(key);
      return color;
    }
  }
  const fallback = palette[base % palette.length];
  used.add(fallback.toLowerCase());
  return fallback;
}

function inferVibe(sceneText: string) {
  const t = sceneText.toLowerCase();
  if (/(wedding|gala|ball|banquet|ceremony|black tie)/i.test(t)) return "formal";
  if (/(office|boardroom|meeting|interview|corporate|conference)/i.test(t)) return "professional";
  if (/(funeral|memorial)/i.test(t)) return "somber";
  if (/(beach|pool|vacation|summer|sunny)/i.test(t)) return "warm";
  if (/(snow|winter|blizzard|freezing|cold)/i.test(t)) return "cold";
  if (/(gym|workout|training|run|jog)/i.test(t)) return "athletic";
  return "default";
}

export function inferClothingColorCategory(itemText: string): ClothingColorCategory {
  const t = itemText.toLowerCase();
  if (FEMININE_KEYWORDS.some((k) => t.includes(k))) return "feminine";
  if (MASCULINE_KEYWORDS.some((k) => t.includes(k))) return "masculine";
  return "neutral";
}

function paletteFor(category: ClothingColorCategory, sceneText?: string) {
  const vibe = inferVibe(sceneText || "");
  if (category === "feminine") {
    if (vibe === "professional" || vibe === "formal") return ["plum", "deep purple", "lavender", "rose pink"];
    if (vibe === "somber") return ["deep purple", "plum", "lavender"];
    return FEMININE_PALETTE;
  }
  if (category === "masculine") {
    if (vibe === "formal" || vibe === "professional") return ["navy", "charcoal", "black", "white"];
    if (vibe === "somber") return ["black", "charcoal", "navy"];
    return MASCULINE_PALETTE;
  }
  if (vibe === "formal" || vibe === "professional") return ["navy", "charcoal", "black", "white", "cream"];
  if (vibe === "somber") return ["black", "charcoal", "slate gray"];
  if (vibe === "warm") return ["white", "cream", "teal", "denim blue", "tan"];
  if (vibe === "cold") return ["navy", "charcoal", "forest green", "burgundy"];
  return NEUTRAL_PALETTE;
}

function hasAnyColor(text: string) {
  return COLOR_DETECT_RE.test(text);
}

function normalizeWhitespace(text: string) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function splitSegments(text: string) {
  const out: string[] = [];
  const primary = normalizeWhitespace(text).split(/[;,]+/g).map((s) => s.trim()).filter(Boolean);
  for (const seg of primary) {
    const connectors = [/\s+\band\b\s+/i, /\s*&\s*/i, /\s+\bwith\b\s+/i, /\s+\bover\b\s+/i, /\s+\bunder\b\s+/i, /\s+\bplus\b\s+/i];
    let segments = [seg];
    for (const connector of connectors) {
      const next: string[] = [];
      for (const s of segments) {
        const parts = s.split(connector).map((p) => p.trim()).filter(Boolean);
        if (parts.length <= 1) {
          next.push(s);
          continue;
        }
        const partsWithClothing = parts.filter((p) => CLOTHING_KEYWORD_RE.test(p));
        if (partsWithClothing.length >= 2) next.push(...parts);
        else next.push(s);
      }
      segments = next;
    }
    out.push(...segments.map((s) => s.trim()).filter(Boolean));
  }
  return out;
}

function insertColor(item: string, color: string) {
  const trimmed = item.trim();
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase();
  const lead = ["a ", "an ", "the "].find((p) => lower.startsWith(p));
  if (lead) return `${trimmed.slice(0, lead.length)}${color} ${trimmed.slice(lead.length)}`.trim();
  if (lower.startsWith("pair of ")) return `pair of ${color} ${trimmed.slice("pair of ".length)}`.trim();
  return `${color} ${trimmed}`.trim();
}

export function ensureClothingColors(description: string, options: ClothingColorOptions) {
  const original = normalizeWhitespace(description);
  if (!original) return { text: "", changed: false };

  const segments = splitSegments(original);
  const hasClothingKeyword = CLOTHING_KEYWORD_RE.test(original);
  const force = Boolean(options.force_if_no_keywords);
  if (!force && segments.length <= 1 && !hasClothingKeyword) return { text: original, changed: false };
  if (force && !hasClothingKeyword && !hasAnyColor(original)) {
    const category = inferClothingColorCategory(original);
    const palette = paletteFor(category, options.scene_text);
    const used = new Set<string>();
    const color = pickDistinctColor(palette, `${options.seed}:force:${category}:${original}`, used);
    const text = insertColor(original, color);
    return { text, changed: text !== original };
  }

  const used = new Set<string>();
  const coloredSegments = segments.map((seg, idx) => {
    const s = normalizeWhitespace(seg);
    if (!s) return s;
    if (!CLOTHING_KEYWORD_RE.test(s)) return s;
    if (hasAnyColor(s)) return s;
    const category = inferClothingColorCategory(s);
    const palette = paletteFor(category, options.scene_text);
    const color = pickDistinctColor(palette, `${options.seed}:${idx}:${category}:${s}`, used);
    return insertColor(s, color);
  });

  const text = coloredSegments.join(", ");
  const changed = text !== original;
  return { text, changed };
}

export function validateClothingColorCoverage(description: string) {
  const text = normalizeWhitespace(description);
  if (!text) return { ok: true, missing: [] as string[] };

  const segments = splitSegments(text);
  const missing: string[] = [];
  for (const seg of segments) {
    const s = normalizeWhitespace(seg);
    if (!s) continue;
    if (!CLOTHING_KEYWORD_RE.test(s)) continue;
    if (!hasAnyColor(s)) missing.push(s);
  }
  return { ok: missing.length === 0, missing };
}
