import { ensureClothingColors } from "@/lib/clothing-colors";

export type SceneCharacterAppearanceState = {
  clothing: string;
  state: string;
  physical_attributes: string;
  accessories?: string;
  extra?: Record<string, string>;
};

export type SceneRowForAppearanceHistory = {
  id: string;
  scene_number: number;
  characters: string[] | null;
  character_states: unknown;
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
      accessories: typeof s.accessories === "string" ? String(s.accessories || "") : undefined,
      extra: s.extra && typeof s.extra === "object" && !Array.isArray(s.extra) ? s.extra : undefined,
    };
  }
  return out;
}

function normalizeStateField(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > maxLen ? collapsed.slice(0, maxLen) : collapsed;
}

function sanitizePrompt(text: string): string {
  const normalizedNewlines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const cleaned = Array.from(normalizedNewlines)
    .filter((ch) => {
      if (ch === "\n") return true;
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  const collapsedLines = cleaned
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n");
  return collapsedLines.replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeExtraKey(key: string): string {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .slice(0, 64);
}

function collectExtraAttributes(rec: Record<string, unknown>): Record<string, string> | undefined {
  const reserved = new Set(["clothing", "state", "condition", "physical_attributes", "accessories"]);
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(rec)) {
    if (reserved.has(key)) continue;
    if (typeof raw !== "string") continue;
    const normalizedKey = normalizeExtraKey(key);
    if (!normalizedKey) continue;
    const v = normalizeStateField(raw, 400);
    if (!v) continue;
    out[normalizedKey] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseSceneStatesByName(raw: unknown): Record<string, SceneCharacterAppearanceState> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, SceneCharacterAppearanceState> = {};
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const rec = v as Record<string, unknown>;
    out[String(name)] = {
      clothing: normalizeStateField(rec.clothing, 400),
      state: normalizeStateField(rec.state ?? rec.condition, 400),
      physical_attributes: normalizeStateField(rec.physical_attributes, 600),
      accessories: normalizeStateField(rec.accessories, 400) || undefined,
      extra: collectExtraAttributes(rec),
    };
  }
  return out;
}

export function computeEffectiveCharacterAppearanceFromHistory(args: {
  scenes: SceneRowForAppearanceHistory[];
  currentSceneId: string;
  characterNames: string[];
  defaultsByName?: Record<
    string,
    Pick<SceneCharacterAppearanceState, "clothing" | "physical_attributes"> &
      Partial<Pick<SceneCharacterAppearanceState, "accessories">>
  >;
}) {
  const list = args.scenes
    .slice()
    .filter((s) => typeof s.scene_number === "number" && Number.isFinite(s.scene_number))
    .sort((a, b) => a.scene_number - b.scene_number);
  const current = list.find((s) => s.id === args.currentSceneId) ?? null;
  const currentNumber = current?.scene_number ?? null;
  const eligible = currentNumber === null ? list : list.filter((s) => s.scene_number <= currentNumber);

  const last: Record<string, SceneCharacterAppearanceState> = {};
  for (const s of eligible) {
    const byName = parseSceneStatesByName(s.character_states);
    for (const [name, st] of Object.entries(byName)) {
      const key = name.toLowerCase();
      const prev = last[key] ?? { clothing: "", state: "", physical_attributes: "" };
      last[key] = {
        clothing: st.clothing ? st.clothing : prev.clothing,
        state: st.state ? st.state : prev.state,
        physical_attributes: st.physical_attributes ? st.physical_attributes : prev.physical_attributes,
        accessories: st.accessories ? st.accessories : prev.accessories,
        extra: st.extra ? { ...(prev.extra ?? {}), ...st.extra } : prev.extra,
      };
    }
  }

  const effective: Record<string, SceneCharacterAppearanceState> = {};
  const missingClothing: string[] = [];
  for (const name of args.characterNames) {
    const key = name.toLowerCase();
    const base = last[key] ?? { clothing: "", state: "", physical_attributes: "" };
    const def = args.defaultsByName?.[key];
    const merged: SceneCharacterAppearanceState = {
      clothing: base.clothing || def?.clothing || "",
      state: base.state || "",
      physical_attributes: base.physical_attributes || def?.physical_attributes || "",
      accessories: base.accessories || def?.accessories || "",
      extra: base.extra,
    };
    if (!merged.clothing) missingClothing.push(name);
    effective[name] = merged;
  }

  return { effective, missingClothing };
}

export function buildCharacterAppearanceAppendix(args: {
  characterNames: string[];
  effectiveStates: Record<string, SceneCharacterAppearanceState>;
}) {
  const parts: string[] = [];
  for (const name of args.characterNames) {
    const st = args.effectiveStates[name];
    if (!st) continue;
    const segs: string[] = [];
    if (st.clothing) segs.push(`wearing ${st.clothing}`);
    if (st.accessories) segs.push(`accessories: ${st.accessories}`);
    if (st.state) segs.push(`condition: ${st.state}`);
    if (st.physical_attributes) segs.push(`physical: ${st.physical_attributes}`);
    if (st.extra && typeof st.extra === "object" && !Array.isArray(st.extra)) {
      const entries = Object.entries(st.extra)
        .filter(([k, v]) => typeof k === "string" && typeof v === "string" && k.trim() && v.trim())
        .sort(([a], [b]) => a.localeCompare(b));
      if (entries.length > 0) {
        const extraText = entries.map(([k, v]) => `${k}: ${v}`).join("; ");
        if (extraText.trim()) segs.push(`details: ${extraText}`);
      }
    }
    if (segs.length > 0) parts.push(`${name} (${segs.join("; ")})`);
  }
  if (parts.length === 0) return "";
  return `Character appearance: ${parts.join(" | ")}`;
}

function stripExistingAppearanceAppendix(prompt: string): string {
  const lines = prompt.split(/\r?\n/);
  const kept = lines.filter((line) => !/^\s*Character appearance\s*:/i.test(line));
  const joined = kept.join("\n");
  return joined.replace(/\n{3,}/g, "\n\n").trim();
}

function buildEffectiveStatesForScene(args: {
  characterNames: string[];
  characterStates: unknown;
  defaultsByLowerName?: Record<string, Partial<SceneCharacterAppearanceState>>;
}) {
  const byName = parseSceneStatesByName(args.characterStates);
  const effective: Record<string, SceneCharacterAppearanceState> = {};
  for (const name of args.characterNames) {
    const key = name.toLowerCase();
    const base = byName[name] ?? byName[key] ?? { clothing: "", state: "", physical_attributes: "" };
    const def = args.defaultsByLowerName?.[key];
    effective[name] = {
      clothing: base.clothing || (typeof def?.clothing === "string" ? def.clothing : "") || "",
      state: base.state || (typeof def?.state === "string" ? def.state : "") || "",
      physical_attributes:
        base.physical_attributes || (typeof def?.physical_attributes === "string" ? def.physical_attributes : "") || "",
      accessories: base.accessories || (typeof def?.accessories === "string" ? def.accessories : "") || "",
      extra:
        base.extra ??
        (def?.extra && typeof def.extra === "object" && !Array.isArray(def.extra) ? (def.extra as Record<string, string>) : undefined),
    };
  }
  return effective;
}

export function updateImagePromptWithAttributes(args: {
  basePrompt: string | null | undefined;
  characterNames: string[] | null | undefined;
  characterStates: unknown;
  defaultsByLowerName?: Record<string, Partial<SceneCharacterAppearanceState>>;
}) {
  const names =
    Array.isArray(args.characterNames) ? args.characterNames.map((n) => String(n || "").trim()).filter(Boolean) : [];
  const base = sanitizePrompt(String(args.basePrompt || ""));
  const withoutAppendix = stripExistingAppearanceAppendix(base);

  if (names.length === 0) return withoutAppendix;

  const effectiveStates = buildEffectiveStatesForScene({
    characterNames: names,
    characterStates: args.characterStates,
    defaultsByLowerName: args.defaultsByLowerName,
  });
  const appendix = buildCharacterAppearanceAppendix({ characterNames: names, effectiveStates }).trim();
  if (!appendix) return withoutAppendix;

  if (!withoutAppendix) return appendix;
  return `${withoutAppendix}\n\n${appendix}`.trim();
}

export function regenerateImagePromptFromCharacterStates(args: {
  storyId: string;
  sceneId: string;
  sceneText: string;
  basePrompt: string | null | undefined;
  characterNames: string[] | null | undefined;
  characterStates: Record<string, SceneCharacterAppearanceState> | null | undefined;
  defaultsByLowerName?: Record<string, Partial<SceneCharacterAppearanceState>>;
}) {
  const names =
    Array.isArray(args.characterNames) ? args.characterNames.map((n) => String(n || "").trim()).filter(Boolean) : [];

  const normalized: Record<string, SceneCharacterAppearanceState> = {};
  for (const name of names) {
    const base = args.characterStates?.[name];
    normalized[name] = {
      clothing: String(base?.clothing || ""),
      state: String(base?.state || ""),
      physical_attributes: String(base?.physical_attributes || ""),
      accessories: typeof base?.accessories === "string" ? String(base.accessories || "") : undefined,
      extra: base?.extra && typeof base.extra === "object" && !Array.isArray(base.extra) ? base.extra : undefined,
    };
  }

  const colored = applyClothingColorsToCharacterStates({
    storyId: args.storyId,
    sceneId: args.sceneId,
    sceneText: args.sceneText,
    characterStates: normalized,
  });

  const prompt = updateImagePromptWithAttributes({
    basePrompt: args.basePrompt,
    characterNames: names,
    characterStates: colored,
    defaultsByLowerName: args.defaultsByLowerName,
  });

  return { prompt, coloredCharacterStates: colored };
}
