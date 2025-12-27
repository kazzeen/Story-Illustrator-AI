import type { KeyboardEventHandler, MouseEventHandler } from "react";
import { useEffect, useMemo, useReducer, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, ImageOff, LayoutGrid, Redo2, RotateCw, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CircularStyleSelector } from "./CircularStyleSelector";
import { Button } from "@/components/ui/button";

export interface ArtStyle {
  id: string;
  name: string;
  description: string;
  preview: string;
  elements: string[];
  palette: string;
  composition: string;
  texture: string;
  status: "approved" | "draft";
}

export const DISABLED_STYLE_ELEMENTS_STORAGE_KEY = "styleSelector.disabledStyleElementsByStyle";

export type StyleElementToggleEntry = { word: string; prevDisabled: boolean };
export type StyleElementToggleState = {
  disabled: Set<string>;
  undo: StyleElementToggleEntry[];
  redo: StyleElementToggleEntry[];
};
export type StyleElementToggleAction =
  | { type: "load"; disabled: Set<string> }
  | { type: "toggle"; word: string }
  | { type: "undo" }
  | { type: "redo" };

export function styleElementToggleReducer(
  state: StyleElementToggleState,
  action: StyleElementToggleAction,
): StyleElementToggleState {
  if (action.type === "load") return { disabled: action.disabled, undo: [], redo: [] };

  if (action.type === "toggle") {
    const prevDisabled = state.disabled.has(action.word);
    const disabled = new Set(state.disabled);
    if (prevDisabled) disabled.delete(action.word);
    else disabled.add(action.word);
    return { disabled, undo: [...state.undo, { word: action.word, prevDisabled }], redo: [] };
  }

  if (action.type === "undo") {
    const last = state.undo[state.undo.length - 1];
    if (!last) return state;
    const disabled = new Set(state.disabled);
    if (last.prevDisabled) disabled.add(last.word);
    else disabled.delete(last.word);
    return { disabled, undo: state.undo.slice(0, -1), redo: [...state.redo, last] };
  }

  if (action.type === "redo") {
    const last = state.redo[state.redo.length - 1];
    if (!last) return state;
    const disabled = new Set(state.disabled);
    if (last.prevDisabled) disabled.delete(last.word);
    else disabled.add(last.word);
    return { disabled, undo: [...state.undo, last], redo: state.redo.slice(0, -1) };
  }

  return state;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readStoredDisabledStyleElements(
  styleId: string,
  storage?: StorageLike | null,
) {
  const resolved = storage ?? (typeof sessionStorage === "undefined" ? null : sessionStorage);
  if (!resolved) return new Set<string>();

  try {
    const raw = resolved.getItem(DISABLED_STYLE_ELEMENTS_STORAGE_KEY);
    if (!raw) return new Set<string>();
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const arr = obj && typeof obj === "object" ? (obj[styleId] as unknown) : undefined;
    if (!Array.isArray(arr)) return new Set<string>();
    const out = new Set<string>();
    for (const v of arr) if (typeof v === "string") out.add(v);
    return out;
  } catch {
    return new Set<string>();
  }
}

export function writeStoredDisabledStyleElements(
  styleId: string,
  disabled: Set<string>,
  storage?: StorageLike | null,
) {
  const resolved = storage ?? (typeof sessionStorage === "undefined" ? null : sessionStorage);
  if (!resolved) return;

  try {
    const raw = resolved.getItem(DISABLED_STYLE_ELEMENTS_STORAGE_KEY);
    const base = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const next: Record<string, unknown> = { ...(base && typeof base === "object" ? base : {}) };
    next[styleId] = Array.from(disabled);
    resolved.setItem(DISABLED_STYLE_ELEMENTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return;
  }
}

function StylePreviewImage({ src, alt }: { src: string; alt: string }) {
  const [status, setStatus] = useState<"loading" | "error" | "loaded">("loading");

  return (
    <>
      {status === "loading" && <Skeleton className="absolute inset-0 w-full h-full" />}
      {status === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground">
          <ImageOff className="w-8 h-8 opacity-50" />
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          className={cn(
            "w-full h-full object-cover transition-opacity duration-500",
            status === "loading" ? "opacity-0" : "opacity-100"
          )}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
        />
      )}
    </>
  );
}

const artStyles: ArtStyle[] = [
  {
    id: "none",
    name: "No Specific Style",
    description: "Pure LLM generation without any artistic style constraints or filters.",
    preview: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400",
    elements: ["Unfiltered", "Raw generation", "Default model output"],
    palette: "Variable based on prompt",
    composition: "Variable based on prompt",
    texture: "Default model texture",
    status: "approved",
  },
  {
    id: "cinematic",
    name: "Cinematic",
    description: "Film-still look with dramatic lighting and controlled color grading.",
    preview: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400",
    elements: ["Dramatic key light", "Depth of field", "Atmospheric haze", "Crisp silhouettes"],
    palette: "Teal/orange grading with deep shadows and controlled highlights.",
    composition: "Rule of thirds, leading lines, strong foreground/midground/background separation.",
    texture: "Clean digital finish, subtle film grain, soft bloom on highlights.",
    status: "approved",
  },
  {
    id: "watercolor",
    name: "Watercolor",
    description: "Soft washes, paper texture, translucent pigments with gentle edges.",
    preview: "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=400",
    elements: ["Translucent washes", "Soft gradients", "Bleed edges", "Light pencil underdrawing"],
    palette: "Harmonized pastel-to-mid tones with airy whites; avoid harsh neon contrast.",
    composition: "Simplified shapes, breathable negative space, focal area with stronger pigment.",
    texture: "Cold-press paper grain, watery blooms, layered glazing.",
    status: "approved",
  },
  {
    id: "anime",
    name: "Anime",
    description: "Clean linework, expressive faces, stylized proportions, cel shading.",
    preview: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400",
    elements: ["Crisp line art", "Cel shading", "Expressive eyes", "Stylized hair shapes"],
    palette: "Saturated but controlled colors; clean shadow shapes; avoid muddy gradients.",
    composition: "Dynamic camera angles, readable silhouettes, strong focal character framing.",
    texture: "Minimal brush texture; smooth fills with sharp shadow boundaries.",
    status: "approved",
  },
  {
    id: "comic",
    name: "Comic Book",
    description: "Bold inks, punchy colors, halftone accents, graphic contrast.",
    preview: "https://images.unsplash.com/photo-1612036782180-6f0b6cd846fe?w=400",
    elements: ["Bold outlines", "Graphic shadows", "Halftone dots", "High contrast highlights"],
    palette: "Vibrant primaries with strong contrast; avoid photorealistic grading.",
    composition: "Dynamic action framing, strong diagonals, clear subject separation.",
    texture: "Ink line texture, halftone shading, print-like dot patterns.",
    status: "approved",
  },
  {
    id: "oil",
    name: "Oil Painting",
    description: "Rich pigments, visible brushwork, classical painterly lighting.",
    preview: "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=400",
    elements: ["Painterly edges", "Rich pigment", "Chiaroscuro lighting", "Canvas depth"],
    palette: "Warm earth tones with deep values; controlled saturation; rich color mixing.",
    composition: "Classical balance, strong value structure, focal emphasis via contrast.",
    texture: "Visible brushstrokes, impasto highlights, canvas texture.",
    status: "approved",
  },
  {
    id: "minimalist",
    name: "Minimalist",
    description: "Simple shapes, limited palette, generous negative space, clean design.",
    preview: "https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?w=400",
    elements: ["Flat shapes", "Minimal detail", "Large negative space", "Simple lighting cues"],
    palette: "Limited 2–4 colors, muted or monochrome, avoid complex gradients.",
    composition: "Centered or asymmetrical balance, strong geometry, uncluttered focal point.",
    texture: "Flat fills or subtle grain only; avoid brushy painterly noise.",
    status: "approved",
  },
  {
    id: "realistic",
    name: "Realistic",
    description: "Photorealistic rendering with natural lighting and lifelike materials.",
    preview: "https://images.unsplash.com/photo-1520975916090-3105956dac38?w=400",
    elements: ["Natural materials", "Realistic lighting", "High detail", "Accurate proportions"],
    palette: "Naturalistic colors; true-to-life skin tones; physically plausible lighting.",
    composition: "Photographic framing, realistic depth, subtle lens perspective.",
    texture: "Fine detail, natural micro-textures, realistic bokeh where appropriate.",
    status: "approved",
  },
  {
    id: "fantasy",
    name: "Fantasy",
    description: "Mythic atmosphere with magical lighting, ornate detail, and epic scale.",
    preview: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400",
    elements: ["Ethereal glow", "Mythic motifs", "Ornate shapes", "Ambient magical effects"],
    palette: "Luminous accents with cohesive palette; controlled saturation; dramatic contrast.",
    composition: "Epic establishing shots, layered depth, cinematic staging of scale.",
    texture: "Painterly detail, soft glow, atmospheric particles and mist.",
    status: "approved",
  },
];

interface StyleSelectorProps {
  selectedStyle?: string;
  onStyleSelect?: (styleId: string) => void;
  onStyleChange?: (styleId: string) => void;
  styleIntensity?: number;
  onStyleIntensityChange?: (intensity: number) => void;
  onDisabledStyleElementsChange?: (styleId: string, disabledElements: string[]) => void;
}

export function StyleSelector({
  selectedStyle,
  onStyleSelect,
  onStyleChange,
  styleIntensity = 70,
  onStyleIntensityChange,
  onDisabledStyleElementsChange,
}: StyleSelectorProps) {
  const [selected, setSelected] = useState(selectedStyle || "cinematic");
  const [viewMode, setViewMode] = useState<"grid" | "carousel">("carousel");
  const selectedMeta = artStyles.find((s) => s.id === selected);
  const visibleStyles = artStyles.filter((s) => s.status === "approved");

  const [toggleState, dispatchToggle] = useReducer(styleElementToggleReducer, {
    disabled: new Set<string>(),
    undo: [],
    redo: [],
  });

  useEffect(() => {
    if (selectedStyle && selectedStyle !== selected) setSelected(selectedStyle);
  }, [selected, selectedStyle]);

  useEffect(() => {
    dispatchToggle({ type: "load", disabled: readStoredDisabledStyleElements(selected) });
  }, [selected]);

  useEffect(() => {
    writeStoredDisabledStyleElements(selected, toggleState.disabled);
    onDisabledStyleElementsChange?.(selected, Array.from(toggleState.disabled));
  }, [selected, toggleState.disabled, onDisabledStyleElementsChange]);

  const handleSelect = (styleId: string) => {
    setSelected(styleId);
    onStyleSelect?.(styleId);
    onStyleChange?.(styleId);
  };

  const enabledElements = useMemo(() => {
    const elements = selectedMeta?.elements ?? [];
    if (elements.length === 0) return [];
    return elements.filter((e) => !toggleState.disabled.has(e));
  }, [selectedMeta?.elements, toggleState.disabled]);

  const handleElementsContainerClick: MouseEventHandler<HTMLDivElement> = (e) => {
    const target = e.target as HTMLElement | null;
    const button = target?.closest?.("[data-style-element]") as HTMLElement | null;
    if (!button) return;
    const word = button.getAttribute("data-style-element");
    if (!word) return;
    dispatchToggle({ type: "toggle", word });
  };

  const handleElementsKeyDown: KeyboardEventHandler<HTMLDivElement> = (e) => {
    const key = e.key.toLowerCase();
    const isMod = e.ctrlKey || e.metaKey;
    if (!isMod) return;

    if (key === "z" && e.shiftKey) {
      e.preventDefault();
      dispatchToggle({ type: "redo" });
      return;
    }

    if (key === "z") {
      e.preventDefault();
      dispatchToggle({ type: "undo" });
      return;
    }

    if (key === "y") {
      e.preventDefault();
      dispatchToggle({ type: "redo" });
      return;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-display text-xl font-semibold text-foreground">
            Art Style
          </h3>
          <Badge variant="outline" className="text-primary border-primary">
            {selectedMeta?.name}
          </Badge>
        </div>
        <div className="flex items-center border border-border rounded-lg p-1 bg-background/50">
          <Button
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setViewMode("grid")}
            aria-label="Grid View"
          >
            <LayoutGrid className="w-4 h-4" />
          </Button>
          <Button
            variant={viewMode === "carousel" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setViewMode("carousel")}
            aria-label="Carousel View"
          >
            <RotateCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {viewMode === "carousel" ? (
        <CircularStyleSelector
          styles={artStyles}
          selectedStyle={selected}
          onStyleSelect={handleSelect}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {visibleStyles.map((style) => (
            <Card
              key={style.id}
              variant="interactive"
              className={cn(
                "cursor-pointer overflow-hidden",
                selected === style.id && "ring-2 ring-primary"
              )}
              onClick={() => handleSelect(style.id)}
            >
              <div className="relative aspect-square">
                <StylePreviewImage src={style.preview} alt={style.name} />
                <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent" />
                
                {selected === style.id && (
                  <div className="absolute top-2 right-2 w-6 h-6 rounded-full gradient-primary flex items-center justify-center">
                    <Check className="w-4 h-4 text-primary-foreground" />
                  </div>
                )}
              </div>
              <CardContent className="p-3">
                <p className="font-semibold text-sm text-foreground">{style.name}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {style.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card variant="glass" className="border-border/50">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-foreground">Style Intensity</p>
            <Badge variant="outline" className="text-primary border-primary">
              {styleIntensity}%
            </Badge>
          </div>
          <Slider
            value={[styleIntensity]}
            min={0}
            max={100}
            step={5}
            onValueChange={(v) => onStyleIntensityChange?.(v[0] ?? 70)}
          />

          {selectedMeta && (
            <div className="grid gap-2">
              <p className="text-sm text-muted-foreground">{selectedMeta.description}</p>
              <div className="grid gap-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2" onClick={handleElementsContainerClick} onKeyDown={handleElementsKeyDown} aria-label="Style elements">
                  {selectedMeta.elements.map((e) => (
                    <button
                      key={e}
                      type="button"
                      data-style-element={e}
                      aria-pressed={!toggleState.disabled.has(e)}
                      className={cn(
                        badgeVariants({ variant: "secondary" }),
                        "bg-primary/10 text-primary select-none touch-manipulation transition-opacity hover:bg-primary/15 active:opacity-80",
                        toggleState.disabled.has(e) && "opacity-40 line-through"
                      )}
                    >
                      {e}
                    </button>
                  ))}
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => dispatchToggle({ type: "undo" })}
                      disabled={toggleState.undo.length === 0}
                      aria-label="Undo"
                    >
                      <Undo2 className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => dispatchToggle({ type: "redo" })}
                      disabled={toggleState.redo.length === 0}
                      aria-label="Redo"
                    >
                      <Redo2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {enabledElements.length !== selectedMeta.elements.length && (
                  <div className="text-xs text-muted-foreground">
                    Using {enabledElements.length} of {selectedMeta.elements.length} elements
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Palette:</span>{" "}
                  <span className="text-foreground">{selectedMeta.palette}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Composition:</span>{" "}
                  <span className="text-foreground">{selectedMeta.composition}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Texture:</span>{" "}
                  <span className="text-foreground">{selectedMeta.texture}</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
