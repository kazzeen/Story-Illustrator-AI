import { escapeRegExp } from "./helpers.ts";

export type StyleCategory = "anime" | "realistic" | "artistic" | "3d" | "pixel";

export type ArtStyleDefinition = {
  id: string;
  name: string;
  category: StyleCategory;
  prefix: string;
  characteristicVisualElements: string[];
  recommendedColorPalettes: string[];
  compositionGuidelines: string[];
  historicalContextReferences: string[];
  tuning?: {
    cfgScaleBias?: number;
    stepsBias?: number;
  };
  quality?: {
    mustInclude?: string[];
  };
};

const ART_STYLE_DEFINITIONS: Record<string, ArtStyleDefinition> = {
  none: {
    id: "none",
    name: "No Specific Style",
    category: "artistic",
    prefix: "",
    characteristicVisualElements: [],
    recommendedColorPalettes: [],
    compositionGuidelines: [],
    historicalContextReferences: [],
  },
  digital_illustration: {
    id: "digital_illustration",
    name: "Digital Illustration",
    category: "artistic",
    prefix: "digital illustration of",
    characteristicVisualElements: ["crisp linework", "painterly shading", "clean edges", "high detail", "masterpiece", "best quality"],
    recommendedColorPalettes: ["balanced palette with clear value separation", "clean highlights and controlled shadows"],
    compositionGuidelines: ["readable silhouettes", "clear focal subject", "strong foreground/midground/background separation"],
    historicalContextReferences: ["contemporary illustration workflows", "concept art clarity and readability"],
    quality: { mustInclude: ["digital illustration"] },
  },
  cinematic: {
    id: "cinematic",
    name: "Cinematic",
    category: "realistic",
    prefix: "cinematic film still of",
    characteristicVisualElements: [
      "cinematic lighting",
      "dramatic contrast",
      "shallow depth of field",
      "controlled color grading",
      "atmospheric haze",
      "subtle film grain",
      "soft bloom on highlights",
    ],
    recommendedColorPalettes: ["teal and orange color grading", "deep shadows with controlled highlights"],
    compositionGuidelines: ["rule of thirds", "leading lines", "strong depth separation", "intentional framing"],
    historicalContextReferences: ["film still aesthetics", "modern blockbuster grading and lighting motifs"],
    tuning: { cfgScaleBias: 0.3, stepsBias: 2 },
    quality: { mustInclude: ["cinematic lighting"] },
  },
  realistic_cinematic: {
    id: "realistic_cinematic",
    name: "Realistic Cinematic",
    category: "realistic",
    prefix: "photorealistic cinematic shot of",
    characteristicVisualElements: [
      "realistic materials",
      "natural micro-textures",
      "filmic contrast",
      "shallow depth of field",
      "lens perspective cues",
      "subtle film grain",
    ],
    recommendedColorPalettes: ["naturalistic palette with filmic grading", "skin tones and materials stay physically plausible"],
    compositionGuidelines: ["photographic framing", "lens perspective cues", "subtle background separation"],
    historicalContextReferences: ["cinematography conventions", "photorealistic VFX/DI pipelines"],
    tuning: { cfgScaleBias: 0.6, stepsBias: 3 },
    quality: { mustInclude: ["photorealistic"] },
  },
  film_noir: {
    id: "film_noir",
    name: "Film Noir",
    category: "realistic",
    prefix: "black and white film noir shot of",
    characteristicVisualElements: ["high contrast lighting", "deep shadows", "monochrome tones", "dramatic composition"],
    recommendedColorPalettes: ["monochrome palette with rich blacks and bright highlights"],
    compositionGuidelines: ["strong diagonals", "silhouette emphasis", "negative space used for tension"],
    historicalContextReferences: ["classic Hollywood noir cinematography", "1940s–1950s noir visual language"],
    tuning: { cfgScaleBias: 0.4, stepsBias: 2 },
    quality: { mustInclude: ["monochrome"] },
  },
  watercolor: {
    id: "watercolor",
    name: "Watercolor",
    category: "artistic",
    prefix: "watercolor painting of",
    characteristicVisualElements: [
      "soft washes",
      "paper texture",
      "cold-press paper grain",
      "translucent pigments",
      "wet-on-wet blooms",
      "bleed edges",
      "light pencil underdrawing",
      "gentle edges",
    ],
    recommendedColorPalettes: ["airy pastel-to-mid tones with preserved whites", "low-to-moderate saturation with clean harmony"],
    compositionGuidelines: ["simplified shapes", "breathable negative space", "focal area with stronger pigment and sharper edges"],
    historicalContextReferences: ["traditional watercolor illustration techniques", "glazing and layered wash methods"],
    tuning: { cfgScaleBias: -0.4, stepsBias: 2 },
    quality: { mustInclude: ["watercolor"] },
  },
  oil: {
    id: "oil",
    name: "Oil Painting",
    category: "artistic",
    prefix: "oil painting of",
    characteristicVisualElements: [
      "visible brush strokes",
      "rich pigment",
      "canvas texture",
      "painterly edges",
      "chiaroscuro lighting",
      "impasto highlights",
    ],
    recommendedColorPalettes: ["warm earth tones with deep values", "controlled saturation with rich color mixing"],
    compositionGuidelines: ["classical balance", "strong value structure", "focal emphasis via contrast"],
    historicalContextReferences: ["classical atelier painting traditions", "old-master lighting and material study"],
    tuning: { cfgScaleBias: 0.1, stepsBias: 3 },
    quality: { mustInclude: ["oil painting"] },
  },
  impressionism: {
    id: "impressionism",
    name: "Impressionism",
    category: "artistic",
    prefix: "impressionist painting of",
    characteristicVisualElements: ["broken brushstrokes", "visible paint texture", "soft edges", "light-focused rendering", "suggested detail"],
    recommendedColorPalettes: ["warm natural light with pastel accents", "high-key palette with subtle complementary contrast"],
    compositionGuidelines: ["plein-air sensibility", "momentary atmosphere", "loose framing with natural balance"],
    historicalContextReferences: ["late-19th-century plein-air painting", "Impressionist approaches to light and color"],
    tuning: { cfgScaleBias: -0.1, stepsBias: 2 },
    quality: { mustInclude: ["impressionist"] },
  },
  anime: {
    id: "anime",
    name: "Anime",
    category: "anime",
    prefix: "anime style artwork of",
    characteristicVisualElements: [
      "2D",
      "flat color",
      "Japanese anime style",
      "crisp line art",
      "clean line art",
      "cel shading",
      "expressive eyes",
      "expressive facial features",
      "stylized hair shapes",
      "readable shadow shapes",
      "masterpiece",
      "best quality",
      "anime key visual",
    ],
    recommendedColorPalettes: ["saturated but controlled colors", "clean shadow colors with minimal gradients"],
    compositionGuidelines: ["dynamic camera angles", "strong character framing", "clear silhouettes and readable poses"],
    historicalContextReferences: ["TV anime and key-animation aesthetics", "modern anime illustration conventions"],
    tuning: { cfgScaleBias: 0.2, stepsBias: 1 },
    quality: { mustInclude: ["cel shading"] },
  },
  anime_manga: {
    id: "anime_manga",
    name: "Manga",
    category: "anime",
    prefix: "manga style illustration of",
    characteristicVisualElements: ["clean line art", "screen tones", "graphic shadow shapes", "2d rendering", "high readability"],
    recommendedColorPalettes: ["black and white with tonal control", "limited accent color if used"],
    compositionGuidelines: ["panel-like framing", "strong focus on faces and gestures", "clear depth separation"],
    historicalContextReferences: ["manga inking and toning conventions", "serialized comic storytelling language"],
    tuning: { cfgScaleBias: 0.2, stepsBias: 1 },
    quality: { mustInclude: ["line art"] },
  },
  comic: {
    id: "comic",
    name: "Comic Book",
    category: "artistic",
    prefix: "comic book panel of",
    characteristicVisualElements: [
      "bold ink outlines",
      "graphic shadows",
      "halftone dots",
      "halftone accents",
      "high contrast highlights",
      "dynamic framing",
    ],
    recommendedColorPalettes: ["vibrant primaries with strong contrast", "limited gradients with bold value blocks"],
    compositionGuidelines: ["strong diagonals", "clear subject separation", "action-focused framing"],
    historicalContextReferences: ["graphic novel inking styles", "print-era halftone and color separation cues"],
    tuning: { cfgScaleBias: 0.2, stepsBias: 1 },
    quality: { mustInclude: ["bold ink"] },
  },
  vintage_comic: {
    id: "vintage_comic",
    name: "Vintage Comic",
    category: "artistic",
    prefix: "vintage comic book illustration of",
    characteristicVisualElements: ["aged paper feel", "halftone print texture", "bold inks", "retro linework"],
    recommendedColorPalettes: ["limited retro palette", "slightly faded inks with print-like contrast"],
    compositionGuidelines: ["clear central subject", "simple backgrounds with graphic shapes", "poster-like readability"],
    historicalContextReferences: ["mid-century print comics", "newsprint texture and vintage printing constraints"],
    tuning: { cfgScaleBias: 0.1, stepsBias: 1 },
    quality: { mustInclude: ["halftone"] },
  },
  minimalist: {
    id: "minimalist",
    name: "Minimalist",
    category: "artistic",
    prefix: "minimalist illustration of",
    characteristicVisualElements: [
      "simple shapes",
      "flat shapes",
      "flat colors",
      "clean edges",
      "vector art style",
      "simple lighting cues",
      "generous negative space",
    ],
    recommendedColorPalettes: ["limited 2–4 color palette", "muted tones or monochrome with one accent"],
    compositionGuidelines: ["strong geometry", "uncluttered focal point", "balanced asymmetry or centered framing"],
    historicalContextReferences: ["modernist graphic design principles", "minimal poster and icon design"],
    tuning: { cfgScaleBias: -0.6, stepsBias: -4 },
    quality: { mustInclude: ["negative space"] },
  },
  realistic: {
    id: "realistic",
    name: "Realistic",
    category: "realistic",
    prefix: "photograph of",
    characteristicVisualElements: [
      "photorealistic detail",
      "realistic lighting",
      "natural materials",
      "sharp focus",
      "accurate proportions",
      "realistic bokeh",
    ],
    recommendedColorPalettes: ["naturalistic color palette", "physically plausible highlights and shadows"],
    compositionGuidelines: ["photographic framing", "subtle depth cues", "balanced exposure and contrast"],
    historicalContextReferences: ["photography and film lens conventions", "realism-driven visual language"],
    tuning: { cfgScaleBias: 0.7, stepsBias: 2 },
    quality: { mustInclude: ["photorealistic"] },
  },
  fantasy: {
    id: "fantasy",
    name: "Fantasy",
    category: "artistic",
    prefix: "fantasy illustration of",
    characteristicVisualElements: [
      "magical atmosphere",
      "ethereal glow",
      "ambient magical effects",
      "epic composition",
      "ornate detail",
      "dramatic lighting",
      "mythic motifs",
    ],
    recommendedColorPalettes: ["luminous accents with cohesive palette", "controlled saturation with strong value contrast"],
    compositionGuidelines: ["layered depth", "scale cues and staging", "clear focal hero element"],
    historicalContextReferences: ["fantasy concept art traditions", "mythology-inspired visual motifs"],
    tuning: { cfgScaleBias: 0.2, stepsBias: 3 },
    quality: { mustInclude: ["epic composition"] },
  },
  cyberpunk: {
    id: "cyberpunk",
    name: "Cyberpunk",
    category: "realistic",
    prefix: "cinematic cyberpunk shot of",
    characteristicVisualElements: ["neon signage", "rain-slick reflections", "futuristic city density", "glowing rim lights", "atmospheric haze", "photorealistic"],
    recommendedColorPalettes: ["neon magenta and cyan accents", "deep blues and purples with bright specular highlights"],
    compositionGuidelines: ["layered city depth", "strong perspective lines", "high contrast focal subject against light sources"],
    historicalContextReferences: ["1980s cyberpunk sci-fi aesthetics", "retro-futurist tech-noir motifs"],
    tuning: { cfgScaleBias: 0.3, stepsBias: 2 },
    quality: { mustInclude: ["neon"] },
  },
  steampunk: {
    id: "steampunk",
    name: "Steampunk",
    category: "artistic",
    prefix: "steampunk illustration of",
    characteristicVisualElements: ["brass and copper machinery", "Victorian aesthetic", "gears and valves", "retro-futurist props"],
    recommendedColorPalettes: ["warm sepia and brass tones", "oxidized greens with warm highlights"],
    compositionGuidelines: ["detailed hero prop focus", "layered mechanical foreground elements", "balanced ornamental framing"],
    historicalContextReferences: ["Victorian industrial design cues", "retro-futurism and alternate-history motifs"],
    tuning: { cfgScaleBias: 0.1, stepsBias: 2 },
    quality: { mustInclude: ["brass"] },
  },
  storybook_illustration: {
    id: "storybook_illustration",
    name: "Storybook Illustration",
    category: "artistic",
    prefix: "storybook illustration of",
    characteristicVisualElements: ["whimsical shapes", "soft painterly shading", "charming character design", "gentle edge work"],
    recommendedColorPalettes: ["warm inviting palette", "soft contrast with friendly highlights"],
    compositionGuidelines: ["simple readable staging", "clear narrative focal point", "comfortable negative space"],
    historicalContextReferences: ["children's picture book illustration language", "storybook character design conventions"],
    tuning: { cfgScaleBias: -0.1, stepsBias: 2 },
    quality: { mustInclude: ["storybook"] },
  },
  pixel_art: {
    id: "pixel_art",
    name: "Pixel Art",
    category: "pixel",
    prefix: "pixel art of",
    characteristicVisualElements: ["crisp pixel edges", "tile-like shapes", "dithering patterns", "sprite readability", "pixelart", "pixel-art", "lowres"],
    recommendedColorPalettes: ["limited palette with clear ramps", "retro console-inspired hues with strong contrast control"],
    compositionGuidelines: ["simple silhouettes", "clear separation of forms", "iconic readable framing"],
    historicalContextReferences: ["classic 8-bit and 16-bit sprite aesthetics", "retro game art conventions"],
    tuning: { cfgScaleBias: -0.2, stepsBias: -6 },
    quality: { mustInclude: ["pixel"] },
  },
  "3d_render": {
    id: "3d_render",
    name: "3D Render",
    category: "3d",
    prefix: "3d render of",
    characteristicVisualElements: ["CGI materials", "global illumination", "ray tracing feel", "clean specular highlights", "rendered depth cues", "unreal engine 5", "octane render"],
    recommendedColorPalettes: ["cinematic neutral base palette", "physically plausible material colors"],
    compositionGuidelines: ["product-shot clarity or cinematic staging", "clean background separation", "strong lighting key/fill balance"],
    historicalContextReferences: ["modern CGI rendering conventions", "real-time engine and offline renderer aesthetics"],
    tuning: { cfgScaleBias: 0.3, stepsBias: 1 },
    quality: { mustInclude: ["CGI"] },
  },
};

export const STYLE_CATEGORIES: Record<string, string> = {
  anime: "anime",
  anime_manga: "anime",
  anime_screenshot: "anime",
  manga_panel: "anime",
  webtoon: "anime",
  studio_ghibli_style: "anime",
  cinematic: "realistic",
  realistic_cinematic: "realistic",
  realistic: "realistic",
  film_noir: "realistic",
  "3d_render": "3d",
  pixel_art: "pixel",
  watercolor: "artistic",
  oil: "artistic",
  comic: "artistic",
  vintage_comic: "artistic",
  digital_illustration: "artistic",
  fantasy: "artistic",
  minimalist: "artistic",
  storybook_illustration: "artistic",
  impressionism: "artistic",
  cyberpunk: "realistic",
  steampunk: "artistic",
};

export const STYLE_CONFLICTS: Record<string, string[]> = {
  anime: [
    "photorealistic", "realistic", "photo", "8k", "unreal engine", "octane render",
    "cinematic lighting", "photograph", "hyperrealistic", "live action", "movie still",
    "film grain", "depth of field", "bokeh" // These often push towards realism
  ],
  realistic: [
    "anime", "manga", "cartoon", "illustration", "painting", "drawing", "sketch",
    "cel shaded", "flat color", "vector", "pixel art", "low poly"
  ],
  artistic: [
    "photorealistic", "photograph", "live action", "8k photo", "raw photo", "3d render", "octane render"
  ],
  "3d": [
    "2d", "flat", "sketch", "drawing", "painting", "watercolor", "anime", "manga"
  ],
  pixel: [
    "smooth", "anti-aliased", "high resolution", "4k", "8k", "photorealistic", "vector", "photograph"
  ]
};

export function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const STYLE_ID_ALIASES: Record<string, string> = {
  oil_painting: "oil",
  pencil_drawing: "digital_illustration",
  ink_wash: "watercolor",
  anime_screenshot: "anime",
  manga_panel: "anime_manga",
  webtoon: "anime_manga",
  studio_ghibli_style: "anime",
  graphic_novel: "comic",
  comic_strip: "comic",
  comic_book: "comic",
  storyboard_sketch: "digital_illustration",
  vector_art: "minimalist",
  flat_design: "minimalist",
  isometric_3d: "3d_render",
  low_poly: "3d_render",
};

export function getStyleCategory(styleId: string): StyleCategory | null {
  const raw = String(styleId || "").trim() || "digital_illustration";
  if (raw === "none") return null;
  const canonical = STYLE_ID_ALIASES[raw] ?? raw;
  const direct = ART_STYLE_DEFINITIONS[canonical];
  if (direct) return direct.category;
  const mapped = STYLE_CATEGORIES[canonical];
  if (mapped === "anime" || mapped === "realistic" || mapped === "artistic" || mapped === "3d" || mapped === "pixel") return mapped;
  return inferStyleCategory(canonical);
}

const KNOWN_STYLE_PHRASES: Array<{ styleId: string; variants: string[]; prefixes: string[] }> = (() => {
  const byStyle: Record<string, { variants: Set<string>; prefixes: Set<string> }> = {};

  const ensure = (styleId: string) => {
    if (!byStyle[styleId]) byStyle[styleId] = { variants: new Set<string>(), prefixes: new Set<string>() };
    return byStyle[styleId]!;
  };

  const addVariant = (styleId: string, raw: string) => {
    const v = String(raw || "")
      .toLowerCase()
      .replace(/[_\s-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!v) return;
    ensure(styleId).variants.add(v);
    if (/\s+style$/.test(v)) ensure(styleId).variants.add(v.replace(/\s+style$/, "").trim());
  };

  const addPrefix = (styleId: string, raw: string) => {
    const p = String(raw || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (!p) return;
    ensure(styleId).prefixes.add(p);
  };

  for (const def of Object.values(ART_STYLE_DEFINITIONS)) {
    if (!def || def.id === "none") continue;
    addVariant(def.id, def.id);
    addVariant(def.id, def.name);
    addPrefix(def.id, def.prefix);
  }

  for (const [alias, canonical] of Object.entries(STYLE_ID_ALIASES)) {
    addVariant(canonical, alias);
  }

  return Object.entries(byStyle)
    .map(([styleId, data]) => ({
      styleId,
      variants: Array.from(data.variants).sort((a, b) => b.length - a.length),
      prefixes: Array.from(data.prefixes).sort((a, b) => b.length - a.length),
    }))
    .sort((a, b) => b.styleId.length - a.styleId.length);
})();

function styleIdToReadable(styleId: string) {
  return String(styleId || "").trim().replace(/_/g, " ");
}

function titleCaseWords(raw: string) {
  return raw
    .split(" ")
    .map((w) => (w.length === 0 ? "" : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ")
    .trim();
}

function inferStyleCategory(styleId: string): StyleCategory {
  const id = String(styleId || "").trim().toLowerCase();
  if (!id) return "artistic";

  const isAnimeLike =
    id.includes("anime") ||
    id.includes("manga") ||
    id.includes("webtoon") ||
    id.includes("ghibli") ||
    id.includes("cartoon") ||
    id.includes("pixar") ||
    id.includes("disney");

  const isComicLike = id.includes("comic") || id.includes("graphic_novel");
  const is3DLike = id.includes("3d") || id.includes("render") || id.includes("low_poly") || id.includes("isometric_3d");
  const isPixelLike = id.includes("pixel") || id.includes("minecraft") || id.includes("roblox") || id.includes("lego");
  const isNoirLike = id.includes("noir");
  const isCyberLike = id.includes("cyberpunk") || id.includes("neon");
  const isSteamLike = id.includes("steampunk");

  if (isAnimeLike) return "anime";
  if (isPixelLike) return "pixel";
  if (is3DLike) return "3d";
  if (isNoirLike) return "realistic";
  if (isCyberLike) return "realistic";
  if (isSteamLike) return "artistic";
  if (isComicLike) return "artistic";
  return "artistic";
}

function inferArtStyleDefinition(styleId: string): ArtStyleDefinition {
  const id = String(styleId || "").trim().toLowerCase();
  const readable = styleIdToReadable(id);
  const name = titleCaseWords(readable);
  const category = inferStyleCategory(id);

  const prefix =
    category === "anime"
      ? "anime style artwork of"
      : category === "pixel"
        ? "pixel art of"
        : category === "3d"
          ? "3d render of"
          : category === "realistic"
            ? "photograph of"
            : "digital illustration of";

  const sharedElements = ["high quality", "strong readability", `${readable} style`];
  const base: ArtStyleDefinition = {
    id,
    name,
    category,
    prefix,
    characteristicVisualElements:
      category === "anime"
        ? ["cel shading", "clean line art", "expressive faces", ...sharedElements]
        : category === "pixel"
          ? ["crisp pixel edges", "limited palette", "sprite readability", ...sharedElements]
          : category === "3d"
            ? ["CGI materials", "global illumination", "realistic shading", ...sharedElements]
            : category === "realistic"
              ? ["photorealistic detail", "realistic lighting", "natural materials", ...sharedElements]
              : ["clean linework", "painterly shading", "high detail", ...sharedElements],
    recommendedColorPalettes:
      category === "pixel"
        ? ["limited palette with clear value ramps", `palette inspired by ${readable}`]
        : category === "anime"
          ? ["saturated but controlled colors", `palette inspired by ${readable}`]
          : ["cohesive palette with clear value separation", `palette inspired by ${readable}`],
    compositionGuidelines: ["clear focal subject", "readable silhouettes", "balanced composition"],
    historicalContextReferences: [`influenced by ${readable}`, "recognized visual language cues of the style"],
    tuning: category === "pixel" ? { cfgScaleBias: -0.2, stepsBias: -6 } : undefined,
    quality: { mustInclude: [readable] },
  };
  return base;
}

function resolveArtStyleDefinition(styleId: string): {
  def: ArtStyleDefinition;
  usedFallback: boolean;
  appendStyleName: boolean;
} {
  const raw = String(styleId || "").trim() || "digital_illustration";
  if (raw === "none") return { def: ART_STYLE_DEFINITIONS.none, usedFallback: false, appendStyleName: false };

  const canonical = STYLE_ID_ALIASES[raw] ?? raw;
  const direct = ART_STYLE_DEFINITIONS[canonical];
  if (direct) {
    return { def: direct, usedFallback: false, appendStyleName: canonical !== raw };
  }
  return { def: inferArtStyleDefinition(canonical), usedFallback: true, appendStyleName: true };
}

export function styleStrengthText(intensity: number) {
  if (intensity >= 90) return "maximal and unmistakable";
  if (intensity >= 70) return "strong and clearly readable";
  if (intensity >= 40) return "moderate and balanced";
  if (intensity >= 15) return "subtle";
  return "minimal";
}

export function splitCommaParts(text: string): string[] {
  return String(text || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

export function joinCommaParts(parts: string[]): string {
  return parts.map((p) => String(p || "").trim()).filter(Boolean).join(", ");
}

export function takeCommaParts(text: string, count: number): string {
  return joinCommaParts(splitCommaParts(text).slice(0, Math.max(0, count)));
}

export function stripKnownStylePhrases(args: {
  prompt: string;
  keepStyleId?: string | null;
}): { prompt: string; removed: string[] } {
  let prompt = typeof args.prompt === "string" ? args.prompt : String(args.prompt ?? "");
  const removed: string[] = [];

  const keepRaw = typeof args.keepStyleId === "string" ? args.keepStyleId.trim().toLowerCase() : "";
  const keepStyleId = keepRaw ? (STYLE_ID_ALIASES[keepRaw] ?? keepRaw) : "";
  const WORD_SEP = "(?:\\s+|[-_]+)";
  const normalizePhrase = (raw: string) =>
    String(raw || "")
      .toLowerCase()
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const loosePattern = (raw: string) =>
    normalizePhrase(raw)
      .split(" ")
      .map((w) => w.trim())
      .filter(Boolean)
      .map(escapeRegExp)
      .join(WORD_SEP);

  const normalizePrompt = (raw: string) =>
    raw
      .replace(/\s+/g, " ")
      .replace(/\s+,/g, ",")
      .replace(/\s+;/g, ";")
      .replace(/\s+:/g, ":")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .replace(/,\s*,+/g, ", ")
      .trim();

  const removeWithRegex = (re: RegExp, label: string) => {
    prompt = prompt.replace(re, (_m, lead: string) => {
      removed.push(label);
      return lead || " ";
    });
  };

  for (const entry of KNOWN_STYLE_PHRASES) {
    if (keepStyleId && entry.styleId === keepStyleId) continue;

    for (const prefix of entry.prefixes) {
      const re = new RegExp(`^\\s*${loosePattern(prefix)}(?:\\b|\\s|,|:|;|\\.)\\s*`, "i");
      if (re.test(prompt)) {
        prompt = prompt.replace(re, "");
        removed.push(prefix);
      }
    }

    for (const v of entry.variants) {
      const variant = loosePattern(v);

      removeWithRegex(
        new RegExp(
          `(^|[\\s,;:(\\[])(?:in\\s+(?:the\\s+)?)?style${WORD_SEP}of${WORD_SEP}(?:an?\\s+)?${variant}\\b`,
          "ig",
        ),
        v,
      );
      removeWithRegex(new RegExp(`(^|[\\s,;:(\\[])(?:in\\s+)?(?:an?\\s+)?${variant}${WORD_SEP}style\\b`, "ig"), v);
      removeWithRegex(new RegExp(`(^|[\\s,;:(\\[])style\\s*:\\s*(?:an?\\s+)?${variant}\\b`, "ig"), v);
      removeWithRegex(
        new RegExp(
          `(^|[\\s,;:(\\[])(?:inspired${WORD_SEP}by|influence(?:d)?${WORD_SEP}by)${WORD_SEP}(?:an?\\s+)?${variant}\\b`,
          "ig",
        ),
        v,
      );
    }
  }

  prompt = normalizePrompt(prompt);
  return { prompt, removed };
}

export function buildStyleGuidance(args: {
  styleId: string;
  intensity: number;
  strict: boolean;
  disabledElements?: string[];
}): { positive: string; prefix?: string; usedFallback: boolean; styleName?: string; picked?: { elements: string[]; palettes: string[]; composition: string[]; context: string[] } } {
  const styleId = String(args.styleId || "").trim() || "digital_illustration";
  const intensity = clampNumber(args.intensity, 0, 100, 70);
  const strict = Boolean(args.strict);

  if (styleId === "none") return { positive: "", usedFallback: false };

  const resolved = resolveArtStyleDefinition(styleId);
  const def = resolved.def;
  const usedFallback = resolved.usedFallback;

  const disabled = Array.isArray(args.disabledElements)
    ? args.disabledElements.map((v) => String(v || "").trim()).filter(Boolean)
    : [];
  const disabledLower = new Set(disabled.map((d) => d.toLowerCase()));

  const elementsAll = def.characteristicVisualElements.filter((e) => !disabledLower.has(e.toLowerCase()));
  const paletteAll = def.recommendedColorPalettes;
  const compAll = def.compositionGuidelines;
  const ctxAll = def.historicalContextReferences;

  const strength = styleStrengthText(intensity);
  const countElements = intensity >= 90 ? 7 : intensity >= 70 ? 5 : intensity >= 40 ? 4 : intensity >= 20 ? 3 : 2;
  const countPalette = intensity >= 70 ? 2 : 1;
  const countComp = intensity >= 70 ? 2 : 1;
  const countCtx = intensity >= 85 ? 2 : intensity >= 35 ? 1 : 0;

  const readableName = styleId.replace(/_/g, " ").trim();
  const baseName = resolved.appendStyleName
    ? (/\bstyle\b/i.test(readableName) ? readableName : `${readableName} style`)
    : "";

  const baseNameLower = baseName.toLowerCase();
  const readableLower = readableName.toLowerCase();
  const prefixLower = String(def.prefix || "").toLowerCase();

  const pickedElementsRaw = elementsAll.slice(0, countElements);
  const pickedElements = pickedElementsRaw.filter((e) => {
    const el = String(e || "").trim();
    if (!el) return false;

    const elLower = el.toLowerCase();
    if (baseNameLower && elLower === baseNameLower) return false;

    if (readableLower && prefixLower.includes(readableLower) && prefixLower.includes("style")) {
      if (elLower.includes(readableLower) && elLower.includes("style")) return false;
    }

    return true;
  });
  const pickedPalettes = paletteAll.slice(0, countPalette);
  const pickedComp = compAll.slice(0, countComp);
  const pickedCtx = ctxAll.slice(0, countCtx);

  const mustInclude = (def.quality?.mustInclude ?? []).map((x) => String(x || "").trim()).filter(Boolean);
  const mustIncludeText = mustInclude.length > 0 ? mustInclude.join(", ") : "";
  const strictBlock = strict
    ? joinCommaParts([
        `strict ${def.name}`,
        `consistent parameters`,
        `${strength} stylization`,
        mustIncludeText ? `markers: ${mustIncludeText}` : "",
      ])
    : "";

  const out = joinCommaParts([
    baseName,
    joinCommaParts(pickedElements),
    joinCommaParts(pickedPalettes),
    joinCommaParts(pickedComp),
    joinCommaParts(pickedCtx),
    strictBlock,
  ]);

  return {
    positive: out,
    prefix: def.prefix || undefined,
    usedFallback,
    styleName: def.name,
    picked: { elements: pickedElements, palettes: pickedPalettes, composition: pickedComp, context: pickedCtx },
  };
}

export function computeStyleCfgScale(intensity: number) {
  const i = clampNumber(intensity, 0, 100, 70);
  return clampNumber(5.5 + i * 0.04, 4.5, 10, 7.5);
}

export function computeStyleSteps(intensity: number, strict: boolean) {
  const i = clampNumber(intensity, 0, 100, 70);
  const base = 26 + i * 0.1 + (strict ? 2 : 0);
  return Math.round(clampNumber(base, 20, 40, 30));
}

export function computeStyleCfgScaleForStyle(args: { styleId: string; intensity: number; strict: boolean }) {
  const styleId = String(args.styleId || "").trim() || "digital_illustration";
  const intensity = clampNumber(args.intensity, 0, 100, 70);
  const strict = Boolean(args.strict);
  const resolved = resolveArtStyleDefinition(styleId);
  const bias = clampNumber(resolved.def.tuning?.cfgScaleBias ?? 0, -2, 2, 0);
  const strictBonus = strict ? 0.3 : 0;
  return clampNumber(computeStyleCfgScale(intensity) + bias + strictBonus, 3.5, 12, 7.5);
}

export function computeStyleStepsForStyle(args: { styleId: string; intensity: number; strict: boolean }) {
  const styleId = String(args.styleId || "").trim() || "digital_illustration";
  const intensity = clampNumber(args.intensity, 0, 100, 70);
  const strict = Boolean(args.strict);
  const resolved = resolveArtStyleDefinition(styleId);
  const bias = clampNumber(resolved.def.tuning?.stepsBias ?? 0, -20, 20, 0);
  return Math.round(clampNumber(computeStyleSteps(intensity, strict) + bias, 10, 60, 30));
}

export function getAspectRatioLabel(width: number, height: number): "16:9" | "4:3" | "1:1" | "3:4" | "9:16" {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "1:1";
  const ratio = w / h;
  if (ratio >= 1.7) return "16:9";
  if (ratio >= 1.3) return "4:3";
  if (ratio <= 0.6) return "9:16";
  if (ratio <= 0.8) return "3:4";
  return "1:1";
}

function roundToMultiple(value: number, multiple: number) {
  if (!Number.isFinite(value)) return value;
  if (!Number.isFinite(multiple) || multiple <= 0) return Math.round(value);
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

export function coerceRequestedResolution(args: {
  model: string;
  width?: unknown;
  height?: unknown;
  fallback?: { width: number; height: number };
}): { width: number; height: number; issues: string[]; wasCoerced: boolean } {
  const issues: string[] = [];
  const fallback = args.fallback ?? { width: 1024, height: 576 };

  const parsedW = typeof args.width === "number" ? args.width : Number(args.width);
  const parsedH = typeof args.height === "number" ? args.height : Number(args.height);
  let width = Number.isFinite(parsedW) && parsedW > 0 ? Math.round(parsedW) : fallback.width;
  let height = Number.isFinite(parsedH) && parsedH > 0 ? Math.round(parsedH) : fallback.height;

  if (!Number.isFinite(parsedW) || !Number.isFinite(parsedH) || parsedW <= 0 || parsedH <= 0) {
    issues.push("resolution_missing_or_invalid");
  }

  const model = String(args.model || "").trim();
  const isGoogle = model === "gemini-2.5-flash" || model === "gemini-3-pro";

  if (model === "gemini-2.5-flash") {
    if (width !== 1024 || height !== 1024) {
      issues.push("resolution_coerced_for_model:gemini-2.5-flash");
      width = 1024;
      height = 1024;
    }
  } else if (!isGoogle) {
    const maxDim = 1536;
    const minDim = 512;
    const multiple = 64;

    const aspect = width / height;
    const currentMax = Math.max(width, height);
    const currentMin = Math.min(width, height);

    if (currentMax > maxDim) {
      const scale = maxDim / currentMax;
      const scaledW = Math.max(1, Math.round(width * scale));
      const scaledH = Math.max(1, Math.round(height * scale));
      width = scaledW;
      height = scaledH;
      issues.push("resolution_scaled_down");
    }

    if (currentMin < minDim) {
      const scale = minDim / Math.max(1, currentMin);
      const scaledW = Math.max(1, Math.round(width * scale));
      const scaledH = Math.max(1, Math.round(height * scale));
      width = scaledW;
      height = scaledH;
      issues.push("resolution_scaled_up");
    }

    width = roundToMultiple(width, multiple);
    height = roundToMultiple(height, multiple);

    const postAspect = width / height;
    if (Number.isFinite(aspect) && Number.isFinite(postAspect) && Math.abs(aspect - postAspect) > 0.02) {
      issues.push("resolution_aspect_drift");
    }
  } else {
    issues.push("resolution_used_for_aspect_ratio_only");
  }

  const wasCoerced = issues.some((i) => i !== "resolution_used_for_aspect_ratio_only");
  return { width, height, issues, wasCoerced };
}

export function validateStyleApplication(args: {
  styleId: string;
  strict: boolean;
  guidance: { positive: string; prefix?: string; usedFallback?: boolean; styleName?: string };
  disabledElements?: string[];
}): { ok: boolean; issues: string[] } {
  const styleId = String(args.styleId || "").trim() || "digital_illustration";
  if (styleId === "none") return { ok: true, issues: [] };

  const issues: string[] = [];
  const prefix = String(args.guidance.prefix || "").trim();
  const positive = String(args.guidance.positive || "").trim();
  if (!prefix && !positive) issues.push("style_guidance_empty");

  const resolved = resolveArtStyleDefinition(styleId);
  const mustInclude = (resolved.def.quality?.mustInclude ?? []).map((x) => String(x || "").trim()).filter(Boolean);
  const disabled = Array.isArray(args.disabledElements)
    ? args.disabledElements.map((v) => String(v || "").trim()).filter(Boolean)
    : [];
  const disabledLower = new Set(disabled.map((d) => d.toLowerCase()));

  for (const marker of mustInclude) {
    const markerLower = marker.toLowerCase();
    if (disabledLower.has(markerLower)) {
      issues.push(`style_must_include_disabled:${marker}`);
      continue;
    }
    if (args.strict) {
      const combined = `${prefix} ${positive}`.toLowerCase();
      if (!combined.includes(markerLower)) issues.push(`style_must_include_missing:${marker}`);
    }
  }

  const category = getStyleCategory(styleId);
  if (category === "anime") {
    const combined = `${prefix} ${positive}`.toLowerCase();
    if (!combined.includes("anime") && !combined.includes("manga")) issues.push("style_category_marker_missing:anime");
  } else if (category === "pixel") {
    const combined = `${prefix} ${positive}`.toLowerCase();
    if (!combined.includes("pixel")) issues.push("style_category_marker_missing:pixel");
  } else if (category === "3d") {
    const combined = `${prefix} ${positive}`.toLowerCase();
    if (!combined.includes("3d") && !combined.includes("cgi")) issues.push("style_category_marker_missing:3d");
  } else if (category === "realistic") {
    const combined = `${prefix} ${positive}`.toLowerCase();
    if (!combined.includes("photo") && !combined.includes("cinematic")) issues.push("style_category_marker_missing:realistic");
  }

  return { ok: issues.length === 0, issues };
}

function asPlainObject(val: unknown): Record<string, unknown> | null {
  if (!val || typeof val !== "object") return null;
  if (Array.isArray(val)) return null;
  return val as Record<string, unknown>;
}

function normalizeGuideText(val: unknown, maxLen: number) {
  if (typeof val !== "string") return "";
  const t = val.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

export function buildStoryStyleGuideGuidance(args: {
  guide: unknown;
  intensity: number;
  strict: boolean;
}): { positive: string; used: boolean; issues: string[] } {
  const intensity = clampNumber(args.intensity, 0, 100, 70);
  const strict = Boolean(args.strict);
  const issues: string[] = [];

  let guideRaw: unknown = args.guide;
  if (typeof guideRaw === "string") {
    const raw = guideRaw.trim();
    if (raw.startsWith("{") && raw.endsWith("}")) {
      try {
        guideRaw = JSON.parse(raw) as unknown;
      } catch {
        issues.push("style_guide_parse_failed");
      }
    }
  }

  const guide = asPlainObject(guideRaw);
  if (!guide) return { positive: "", used: false, issues: issues.length > 0 ? issues : ["style_guide_invalid"] };

  const rendering = normalizeGuideText(guide.rendering_techniques, 320);
  const lighting = normalizeGuideText(guide.lighting_and_shading, 320);
  const palette = normalizeGuideText(guide.color_palette, 280);
  const composition = normalizeGuideText(guide.perspective_and_composition, 320);
  const extraPositive = normalizeGuideText(guide.positive_prompt, 320) || normalizeGuideText(guide.prompt, 320);

  const ordered: Array<{ label: string; text: string }> = [
    { label: "rendering", text: rendering },
    { label: "lighting", text: lighting },
    { label: "palette", text: palette },
    { label: "composition", text: composition },
  ].filter((x) => Boolean(x.text));

  if (ordered.length === 0 && !extraPositive) {
    return { positive: "", used: false, issues: ["style_guide_empty"] };
  }

  const includeCount = intensity >= 85 ? 4 : intensity >= 55 ? 3 : intensity >= 25 ? 2 : 1;
  const picked = ordered.slice(0, includeCount).map((x) => `${x.label}: ${x.text}`);
  const basePositive = joinCommaParts([joinCommaParts(picked), extraPositive]);
  const positive = strict && basePositive ? joinCommaParts([basePositive, "consistent style guide adherence"]) : basePositive;

  return {
    positive,
    used: Boolean(positive),
    issues,
  };
}
