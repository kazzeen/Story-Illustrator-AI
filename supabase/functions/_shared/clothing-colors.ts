import { escapeRegExp } from "./helpers.ts";

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

export type HairEyeAutogenConfig = {
  enabled: boolean;
  allowFantasyColors: boolean;
  allowRareEyeColors: boolean;
  overrideWins: boolean;
  preferredHairColors?: string[];
  preferredEyeColors?: string[];
  overrides?: Record<string, { hairColor?: string; eyeColor?: string }>;
};

type InferredGenre = "fantasy" | "scifi" | "historical" | "modern" | "noir" | "western" | "unknown";
type InferredEthnicity = "east_asian" | "south_asian" | "african" | "middle_eastern" | "european" | "latino" | "unknown";
type InferredAge = "child" | "teen" | "young_adult" | "adult" | "middle_aged" | "elderly" | "unknown";

const STANDARD_HAIR_COLORS = [
  "black",
  "dark brown",
  "brown",
  "light brown",
  "chestnut",
  "auburn",
  "red",
  "strawberry blonde",
  "blonde",
  "platinum blonde",
  "gray",
  "white",
  "silver",
];

const STANDARD_EYE_COLORS = ["dark brown", "brown", "hazel", "green", "blue", "gray", "amber"];

const FANTASY_HAIR_COLORS = ["silver", "white", "midnight blue", "deep purple", "pink"];
const FANTASY_EYE_COLORS = ["violet", "gold", "silver"];

function canonicalizeColor(raw: string): string {
  const t = normalizeWhitespace(raw).toLowerCase();
  if (!t) return "";
  const map: Record<string, string> = {
    grey: "gray",
    "jet black": "black",
    "raven black": "black",
    raven: "black",
    brunette: "brown",
    blond: "blonde",
    "dirty blonde": "blonde",
    "light blond": "blonde",
    "light blonde": "blonde",
    "dark blond": "blonde",
    "dark blonde": "blonde",
    "salt and pepper": "gray",
    "silver gray": "silver",
  };
  if (map[t]) return map[t]!;
  if (t === "dark" || t === "light") return "";
  return t;
}

function isStandardHairColor(color: string, allowFantasy: boolean) {
  const c = canonicalizeColor(color);
  if (!c) return false;
  if (STANDARD_HAIR_COLORS.includes(c)) return true;
  if (allowFantasy && FANTASY_HAIR_COLORS.includes(c)) return true;
  return false;
}

function isStandardEyeColor(color: string, allowRare: boolean) {
  const c = canonicalizeColor(color);
  if (!c) return false;
  if (STANDARD_EYE_COLORS.includes(c)) return true;
  if (allowRare && FANTASY_EYE_COLORS.includes(c)) return true;
  return false;
}

function inferGenre(storyText: string): InferredGenre {
  const t = String(storyText || "").toLowerCase();
  if (/(spaceship|starship|android|cyborg|laser|warp|galaxy|space station|mech|neon|cyberpunk)/i.test(t)) return "scifi";
  if (/(wizard|spell|dragon|kingdom|sword|castle|elf|dwarf|orc|mage|quest|tavern|rune|prophecy)/i.test(t)) return "fantasy";
  if (/(sheriff|saloon|outlaw|frontier|cowboy|duel|stagecoach)/i.test(t)) return "western";
  if (/(noir|detective|femme fatale|rain-soaked|cigarette smoke|hardboiled)/i.test(t)) return "noir";
  if (/(victorian|medieval|renaissance|ancient|romans|pharaoh|wwii|world war|regency|colonial)/i.test(t)) return "historical";
  if (/(smartphone|instagram|wifi|subway|apartment|office|startup|skyscraper)/i.test(t)) return "modern";
  return "unknown";
}

function inferEthnicity(text: string): InferredEthnicity {
  const t = String(text || "").toLowerCase();
  if (/(japanese|korean|chinese|taiwanese|vietnamese|thai|filipino|asian\b|east asian)/i.test(t)) return "east_asian";
  if (/(indian|pakistani|bangladeshi|sri lankan|south asian)/i.test(t)) return "south_asian";
  if (/(african\b|nigerian|kenyan|ethiopian|somali|ghanaian|black\b)/i.test(t)) return "african";
  if (/(arab\b|persian|iranian|iraqi|syrian|lebanese|turkish|middle eastern)/i.test(t)) return "middle_eastern";
  if (/(latina|latino|mexican|brazilian|colombian|puerto rican|cuban|dominican|hispanic)/i.test(t)) return "latino";
  if (/(european|english|french|german|italian|spanish|irish|scottish|slavic|swedish|norwegian|danish|white\b|caucasian)/i.test(t))
    return "european";
  return "unknown";
}

function inferAge(text: string): InferredAge {
  const t = String(text || "").toLowerCase();
  const m = t.match(/\b(\d{1,2})\s*(?:yo|y\/o|years?\s*old)\b/i);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) {
      if (n < 13) return "child";
      if (n < 18) return "teen";
      if (n < 30) return "young_adult";
      if (n < 50) return "adult";
      if (n < 70) return "middle_aged";
      return "elderly";
    }
  }
  if (/(elderly|old man|old woman|senior|grandmother|grandfather|wrinkled|gray hair|grey hair|white hair)/i.test(t)) return "elderly";
  if (/(middle-aged|midlife)/i.test(t)) return "middle_aged";
  if (/(young adult|college|twenty-something)/i.test(t)) return "young_adult";
  if (/(teen|teenager|high school)/i.test(t)) return "teen";
  if (/(child|kid|boy|girl|toddler)/i.test(t)) return "child";
  if (/(adult|man|woman)/i.test(t)) return "adult";
  return "unknown";
}

function chooseFromWeighted(seed: string, items: string[]) {
  if (items.length === 0) return "";
  const h = fnv1a32(seed);
  return items[h % items.length] || "";
}

function phraseListToAlternation(phrases: string[]) {
  const uniq = [...new Set(phrases.map((p) => normalizeWhitespace(p).toLowerCase()).filter(Boolean))].sort((a, b) => b.length - a.length);
  return uniq
    .map((p) => p.split(/\s+/g).map(escapeRegExp).join("\\s+"))
    .filter(Boolean)
    .join("|");
}

function extractExplicitHairColor(text: string): string {
  const t = String(text || "");
  const allow = [...STANDARD_HAIR_COLORS, ...FANTASY_HAIR_COLORS, "blond", "dirty blonde", "jet black", "raven black", "salt and pepper"];
  const alt = phraseListToAlternation(allow);
  if (alt) {
    const m1 = t.match(new RegExp(`\\bhair\\s*(?:color)?\\s*[:-]\\s*(${alt})\\b`, "i"));
    if (m1?.[1]) {
      const c = canonicalizeColor(m1[1]);
      if (c && c.length <= 24) return c;
    }
    const m2 = t.match(new RegExp(`\\b(${alt})\\s+(?:hair|haired)\\b`, "i"));
    if (m2?.[1]) {
      const c = canonicalizeColor(m2[1]);
      if (c && c.length <= 24) return c;
    }
  }
  const m3 = t.match(/\b(redhead|brunette)\b/i);
  if (m3?.[1]) {
    const c = canonicalizeColor(m3[1]);
    if (c && c.length <= 24) return c;
  }
  if (/\bblond(?:e)?\s+hair\b/i.test(t)) return "blonde";
  return "";
}

function extractExplicitEyeColor(text: string): string {
  const t = String(text || "");
  const allow = [...STANDARD_EYE_COLORS, ...FANTASY_EYE_COLORS, "grey"];
  const alt = phraseListToAlternation(allow);
  if (alt) {
    const m1 = t.match(new RegExp(`\\beye\\s*(?:color)?\\s*[:-]\\s*(${alt})\\b`, "i"));
    if (m1?.[1]) {
      const c = canonicalizeColor(m1[1]);
      if (c && c.length <= 24) return c;
    }
    const m2 = t.match(new RegExp(`\\b(${alt})\\s+(?:eyes|eyed)\\b`, "i"));
    if (m2?.[1]) {
      const c = canonicalizeColor(m2[1]);
      if (c && c.length <= 24) return c;
    }
  }
  return "";
}

function parseExistingAttribute(text: string, key: "hair" | "eye"): string {
  const t = String(text || "");
  const re =
    key === "hair"
      ? /\b(?:hair\s*color|hair)\s*[:-]\s*([a-z][a-z\s-]{1,30})/i
      : /\b(?:eye\s*color|eyes?)\s*[:-]\s*([a-z][a-z\s-]{1,30})/i;
  const m = t.match(re);
  if (!m) return "";
  return canonicalizeColor(m[1] || "");
}

function normalizeOverrideNameKey(name: string) {
  return String(name || "").trim().toLowerCase();
}

function buildHairPalette(args: { ethnicity: InferredEthnicity; age: InferredAge; genre: InferredGenre; config: HairEyeAutogenConfig }) {
  const e = args.ethnicity;
  const a = args.age;
  const allowFantasy = args.config.allowFantasyColors || args.genre === "fantasy" || args.genre === "scifi";

  let base: string[] =
    e === "east_asian"
      ? ["black", "black", "black", "dark brown", "black", "dark brown"]
      : e === "south_asian"
        ? ["black", "black", "dark brown", "black", "dark brown"]
        : e === "african"
          ? ["black", "black", "black", "dark brown", "black"]
          : e === "middle_eastern"
            ? ["black", "dark brown", "black", "dark brown", "brown"]
            : e === "latino"
              ? ["black", "dark brown", "brown", "black", "brown"]
              : e === "european"
                ? ["brown", "brown", "dark brown", "light brown", "blonde", "blonde", "black", "auburn", "red", "chestnut"]
                : ["black", "dark brown", "brown", "brown", "light brown", "blonde"];

  if (a === "elderly") base = [...base, "gray", "gray", "white", "silver"];
  else if (a === "middle_aged") base = [...base, "dark brown", "brown", "gray"];

  if (allowFantasy) base = [...base, ...FANTASY_HAIR_COLORS];

  const pref = Array.isArray(args.config.preferredHairColors) ? args.config.preferredHairColors.map(canonicalizeColor).filter(Boolean) : [];
  const filteredPref = pref.filter((c) => isStandardHairColor(c, allowFantasy));
  if (filteredPref.length > 0) return filteredPref;
  return base.filter((c) => isStandardHairColor(c, allowFantasy));
}

function buildEyePalette(args: { ethnicity: InferredEthnicity; genre: InferredGenre; config: HairEyeAutogenConfig }) {
  const e = args.ethnicity;
  const allowRare = args.config.allowRareEyeColors || args.genre === "fantasy" || args.genre === "scifi";

  let base: string[] =
    e === "east_asian"
      ? ["dark brown", "brown", "brown", "dark brown", "hazel"]
      : e === "south_asian"
        ? ["dark brown", "brown", "brown", "hazel"]
        : e === "african"
          ? ["dark brown", "brown", "brown", "dark brown"]
          : e === "middle_eastern"
            ? ["dark brown", "brown", "hazel", "brown"]
            : e === "latino"
              ? ["dark brown", "brown", "hazel", "brown"]
              : e === "european"
                ? ["blue", "brown", "green", "hazel", "gray", "blue", "brown"]
                : ["brown", "hazel", "blue", "green", "brown"];

  if (allowRare) base = [...base, ...FANTASY_EYE_COLORS];

  const pref = Array.isArray(args.config.preferredEyeColors) ? args.config.preferredEyeColors.map(canonicalizeColor).filter(Boolean) : [];
  const filteredPref = pref.filter((c) => isStandardEyeColor(c, allowRare));
  if (filteredPref.length > 0) return filteredPref;
  return base.filter((c) => isStandardEyeColor(c, allowRare));
}

function appendAttributeLines(existing: string, attrs: Array<{ key: string; value: string }>) {
  const base = String(existing || "").trim();
  const lines = attrs
    .map((a) => ({ key: String(a.key || "").trim(), value: String(a.value || "").trim() }))
    .filter((a) => a.key && a.value)
    .map((a) => `${a.key}: ${a.value}`);
  if (lines.length === 0) return base;
  if (!base) return lines.join("\n");
  const joiner = base.includes("\n") ? "\n" : "\n";
  return `${base}${joiner}${lines.join("\n")}`.trim();
}

export function ensureHairEyeColorAttributes(args: {
  storyId: string;
  storyText: string;
  characterName: string;
  description?: string | null;
  physicalAttributes?: string | null;
  config?: Partial<HairEyeAutogenConfig>;
}) {
  const config: HairEyeAutogenConfig = {
    enabled: args.config?.enabled ?? true,
    allowFantasyColors: args.config?.allowFantasyColors ?? false,
    allowRareEyeColors: args.config?.allowRareEyeColors ?? false,
    overrideWins: args.config?.overrideWins ?? true,
    preferredHairColors: args.config?.preferredHairColors,
    preferredEyeColors: args.config?.preferredEyeColors,
    overrides: args.config?.overrides,
  };

  const issues: string[] = [];
  const desc = String(args.description || "");
  const phys = String(args.physicalAttributes || "");
  const storyText = String(args.storyText || "");

  if (!config.enabled) {
    const existingHair = parseExistingAttribute(phys, "hair");
    const existingEye = parseExistingAttribute(phys, "eye");
    return {
      physicalAttributes: phys,
      added: {} as { hairColor?: string; eyeColor?: string },
      skipped: { hairColor: true, eyeColor: true },
      final: { hairColor: existingHair, eyeColor: existingEye },
      issues,
      context: { genre: inferGenre(storyText), ethnicity: inferEthnicity(`${desc}\n${phys}\n${storyText}`), age: inferAge(`${desc}\n${phys}\n${storyText}`) },
      configUsed: config,
    };
  }
  const genre = inferGenre(storyText);
  const demoText = `${desc}\n${phys}\n${storyText}`;
  const ethnicity = inferEthnicity(demoText);
  const age = inferAge(demoText);

  const existingHair = parseExistingAttribute(phys, "hair");
  const existingEye = parseExistingAttribute(phys, "eye");
  const explicitHair = extractExplicitHairColor(`${desc}\n${phys}\n${storyText}`);
  const explicitEye = extractExplicitEyeColor(`${desc}\n${phys}\n${storyText}`);

  const allowFantasyHair = config.allowFantasyColors || genre === "fantasy" || genre === "scifi";
  const allowRareEye = config.allowRareEyeColors || genre === "fantasy" || genre === "scifi";

  const nameKey = normalizeOverrideNameKey(args.characterName);
  const override = config.overrides && nameKey ? config.overrides[nameKey] : undefined;
  const overrideHair = override?.hairColor ? canonicalizeColor(override.hairColor) : "";
  const overrideEye = override?.eyeColor ? canonicalizeColor(override.eyeColor) : "";

  const hairFromClue = explicitHair && isStandardHairColor(explicitHair, allowFantasyHair) ? explicitHair : "";
  const eyeFromClue = explicitEye && isStandardEyeColor(explicitEye, allowRareEye) ? explicitEye : "";

  let targetHair = "";
  let targetEye = "";

  if (overrideHair && isStandardHairColor(overrideHair, allowFantasyHair)) {
    if (hairFromClue && hairFromClue !== overrideHair) issues.push("override_hair_conflicts_with_description");
    targetHair = config.overrideWins ? overrideHair : hairFromClue || overrideHair;
  } else {
    targetHair = hairFromClue;
  }

  if (overrideEye && isStandardEyeColor(overrideEye, allowRareEye)) {
    if (eyeFromClue && eyeFromClue !== overrideEye) issues.push("override_eye_conflicts_with_description");
    targetEye = config.overrideWins ? overrideEye : eyeFromClue || overrideEye;
  } else {
    targetEye = eyeFromClue;
  }

  if (!targetHair) {
    const palette = buildHairPalette({ ethnicity, age, genre, config });
    targetHair = chooseFromWeighted(`${args.storyId}:${nameKey}:hair:${ethnicity}:${age}:${genre}`, palette);
  }
  if (!targetEye) {
    const palette = buildEyePalette({ ethnicity, genre, config });
    targetEye = chooseFromWeighted(`${args.storyId}:${nameKey}:eye:${ethnicity}:${genre}`, palette);
  }

  if (!isStandardHairColor(targetHair, allowFantasyHair)) {
    targetHair = chooseFromWeighted(`${args.storyId}:${nameKey}:hair:fallback`, STANDARD_HAIR_COLORS);
    issues.push("hair_color_fell_back_to_standard");
  }
  if (!isStandardEyeColor(targetEye, allowRareEye)) {
    targetEye = chooseFromWeighted(`${args.storyId}:${nameKey}:eye:fallback`, STANDARD_EYE_COLORS);
    issues.push("eye_color_fell_back_to_standard");
  }

  const skipped = { hairColor: Boolean(existingHair), eyeColor: Boolean(existingEye) };
  const added: { hairColor?: string; eyeColor?: string } = {};

  let nextPhysical = phys;
  const toAppend: Array<{ key: string; value: string }> = [];

  if (!existingHair) {
    toAppend.push({ key: "Hair color", value: targetHair });
    added.hairColor = targetHair;
  }
  if (!existingEye) {
    toAppend.push({ key: "Eye color", value: targetEye });
    added.eyeColor = targetEye;
  }

  nextPhysical = appendAttributeLines(nextPhysical, toAppend);

  const finalHair = parseExistingAttribute(nextPhysical, "hair") || targetHair;
  const finalEye = parseExistingAttribute(nextPhysical, "eye") || targetEye;

  return {
    physicalAttributes: nextPhysical,
    added,
    skipped,
    final: { hairColor: finalHair, eyeColor: finalEye },
    issues,
    context: { genre, ethnicity, age },
    configUsed: config,
  };
}
