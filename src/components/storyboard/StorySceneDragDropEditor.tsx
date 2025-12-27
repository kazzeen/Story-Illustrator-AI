import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { GripVertical, Redo2, Undo2 } from "lucide-react";
import { buildStoryBlocks } from "@/lib/story-html";

type SceneForStoryView = {
  id: string;
  scene_number: number;
  title: string | null;
  summary: string | null;
  original_text: string | null;
  image_url: string | null;
};

export type StorySceneAnchors = Record<string, number>;

export type StorySceneDragDropEditorProps = {
  originalContent: string;
  scenes: SceneForStoryView[];
  initialAnchors: StorySceneAnchors;
  updatedAt: string | null | undefined;
  onPersistAnchors: (args: {
    nextAnchors: StorySceneAnchors;
    baseUpdatedAt: string | null | undefined;
  }) => Promise<{ ok: true; updatedAt: string | null } | { ok: false; reason: string; updatedAt?: string | null }>;
  onToast?: (args: { title: string; description?: string; variant?: "destructive" }) => void;
};

type Sentence = {
  text: string;
  start: number;
  endExclusive: number;
  globalIndex: number;
};

type Paragraph = {
  sentences: Sentence[];
  start: number;
  endExclusive: number;
};

type ParsedStory = {
  paragraphs: Paragraph[];
  totalSentences: number;
  sentenceStarts: number[];
};

export const parseStoryIntoSentences = (input: string): ParsedStory => {
  const text = input.replace(/\r\n/g, "\n");
  const paragraphsRaw = text.split(/\n\s*\n/g);
  const paragraphs: Paragraph[] = [];
  const sentenceStarts: number[] = [];
  let globalIndex = 0;

  let scanIndex = 0;
  for (const rawPara of paragraphsRaw) {
    const paraStart = text.indexOf(rawPara, scanIndex);
    const paraEndExclusive = paraStart >= 0 ? paraStart + rawPara.length : scanIndex;
    scanIndex = Math.max(0, paraEndExclusive);

    const trimmed = rawPara.trim();
    if (!trimmed) continue;

    const sentences: Sentence[] = [];
    const para = rawPara;
    const sentenceRegex = /[^.!?]+[.!?]+(?:["')\]]+)?|\S+$/g;
    let match: RegExpExecArray | null;
    while ((match = sentenceRegex.exec(para)) !== null) {
      const s = match[0];
      const leadingWsMatch = /^\s*/.exec(s);
      const leadingWsLen = leadingWsMatch ? leadingWsMatch[0].length : 0;
      const startLocal = match.index + leadingWsLen;
      const endLocal = match.index + s.length;
      const slice = para.slice(startLocal, endLocal).trim();
      if (!slice) {
        continue;
      }
      const start = (paraStart >= 0 ? paraStart : 0) + startLocal;
      const endExclusive = (paraStart >= 0 ? paraStart : 0) + endLocal;
      sentences.push({ text: slice, start, endExclusive, globalIndex });
      sentenceStarts.push(start);
      globalIndex += 1;
    }

    if (sentences.length > 0) paragraphs.push({ sentences, start: paraStart >= 0 ? paraStart : 0, endExclusive: paraEndExclusive });
  }

  return { paragraphs, totalSentences: globalIndex, sentenceStarts };
};

export const getRenderedAnchors = (parsed: ParsedStory) => {
  const anchors: number[] = [];
  parsed.paragraphs.forEach((p) => {
    p.sentences.forEach((s) => anchors.push(s.globalIndex));
  });
  anchors.push(parsed.totalSentences);
  return anchors;
};

export const getAfterScenesForSentence = (args: {
  parsed: ParsedStory;
  scenesAtAnchor: Map<number, SceneForStoryView[]>;
  sentenceGlobalIndex: number;
}) => {
  if (args.sentenceGlobalIndex !== args.parsed.totalSentences - 1) return [];
  return args.scenesAtAnchor.get(args.sentenceGlobalIndex + 1) ?? [];
};

const clampAnchor = (anchor: number, totalSentences: number) => Math.max(0, Math.min(totalSentences, anchor));

const computeDefaultAnchors = (args: {
  originalContent: string;
  scenes: SceneForStoryView[];
  parsed: ParsedStory;
}): Record<string, number> => {
  const { originalContent, scenes, parsed } = args;
  const defaultAnchors: Record<string, number> = {};

  const { blocks } = buildStoryBlocks({
    originalContent,
    scenes: scenes.map((s) => ({
      scene_number: s.scene_number,
      title: s.title,
      original_text: s.original_text,
      summary: s.summary,
      image_url: s.image_url,
    })),
  });

  const bySceneNumber = new Map<number, SceneForStoryView>();
  scenes.forEach((s) => bySceneNumber.set(s.scene_number, s));

  const sentenceRanges: Array<{ start: number; endExclusive: number; index: number }> = [];
  parsed.paragraphs.forEach((p) => {
    p.sentences.forEach((s) => {
      sentenceRanges.push({ start: s.start, endExclusive: s.endExclusive, index: s.globalIndex });
    });
  });

  const sentenceIndexAtChar = (pos: number) => {
    if (sentenceRanges.length === 0) return 0;
    let lo = 0;
    let hi = sentenceRanges.length - 1;
    let best = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const r = sentenceRanges[mid];
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

  let cursor = 0;
  for (const block of blocks) {
    if (block.kind === "text") {
      cursor += block.text.length;
      continue;
    }

    const scene = bySceneNumber.get(block.scene.scene_number);
    if (scene) {
      defaultAnchors[scene.id] = clampAnchor(sentenceIndexAtChar(cursor), parsed.totalSentences);
    }
    cursor += block.text.length;
  }

  return defaultAnchors;
};

export const validateAnchorsContinuity = (args: {
  scenes: SceneForStoryView[];
  anchors: StorySceneAnchors;
  defaultAnchors: Record<string, number>;
  totalSentences: number;
  movingSceneId?: string;
}): { ok: true } | { ok: false; reason: string } => {
  const { scenes, anchors, defaultAnchors, totalSentences, movingSceneId } = args;
  const list = scenes
    .map((s) => {
      const raw = anchors[s.id];
      const base = defaultAnchors[s.id];
      const anchor = clampAnchor(typeof raw === "number" ? raw : typeof base === "number" ? base : totalSentences, totalSentences);
      return { id: s.id, scene_number: s.scene_number, anchor };
    })
    .sort((a, b) => (a.anchor - b.anchor) || (a.scene_number - b.scene_number));

  for (let i = 1; i < list.length; i += 1) {
    if (list[i].scene_number < list[i - 1].scene_number) {
      const focused = movingSceneId ? list.find((x) => x.id === movingSceneId) : null;
      const label = focused ? `Scene ${focused.scene_number}` : "Scene";
      return { ok: false, reason: `${label} placement breaks chronological continuity.` };
    }
  }

  return { ok: true };
};

export type UndoRedoState = {
  anchors: StorySceneAnchors;
  past: StorySceneAnchors[];
  future: StorySceneAnchors[];
};

export const applyUndo = (state: UndoRedoState): { ok: false } | { ok: true; next: UndoRedoState } => {
  const prev = state.past[state.past.length - 1];
  if (!prev) return { ok: false };
  return {
    ok: true,
    next: {
      anchors: prev,
      past: state.past.slice(0, -1),
      future: [state.anchors, ...state.future],
    },
  };
};

export const applyRedo = (state: UndoRedoState): { ok: false } | { ok: true; next: UndoRedoState } => {
  const nextAnchors = state.future[0];
  if (!nextAnchors) return { ok: false };
  return {
    ok: true,
    next: {
      anchors: nextAnchors,
      past: [...state.past, state.anchors],
      future: state.future.slice(1),
    },
  };
};

type DragState = {
  sceneId: string;
  pointerId: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
};

const pickAnchorFromPoint = (x: number, y: number) => {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const target = (el.closest?.("[data-story-anchor]") as HTMLElement | null) ?? null;
  if (!target) return null;
  const raw = target.getAttribute("data-story-anchor");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

const pickSceneIdFromPoint = (x: number, y: number) => {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const target = (el.closest?.("[data-story-scene-id]") as HTMLElement | null) ?? null;
  if (!target) return null;
  return target.getAttribute("data-story-scene-id");
};

export function StorySceneDragDropEditor(props: StorySceneDragDropEditorProps) {
  const { originalContent, scenes, initialAnchors, updatedAt, onPersistAnchors, onToast } = props;

  const parsed = useMemo(() => parseStoryIntoSentences(originalContent), [originalContent]);
  const sortedScenes = useMemo(() => scenes.slice().sort((a, b) => a.scene_number - b.scene_number), [scenes]);
  const defaultAnchors = useMemo(
    () => computeDefaultAnchors({ originalContent, scenes: sortedScenes, parsed }),
    [originalContent, parsed, sortedScenes],
  );

  const [anchors, setAnchors] = useState<StorySceneAnchors>(initialAnchors);
  const [past, setPast] = useState<StorySceneAnchors[]>([]);
  const [future, setFuture] = useState<StorySceneAnchors[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [savingUpdatedAt, setSavingUpdatedAt] = useState<string | null | undefined>(updatedAt);
  const [flash, setFlash] = useState<{ id: number; label: string } | null>(null);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [activeAnchor, setActiveAnchor] = useState<number | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const hasHistory = past.length > 0 || future.length > 0;
    if (hasHistory) return;
    if (isSaving) return;
    if (drag) return;
    setSavingUpdatedAt(updatedAt);
    setAnchors(initialAnchors);
  }, [drag, future.length, initialAnchors, isSaving, past.length, updatedAt]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(t);
  }, [flash]);

  const scenesById = useMemo(() => {
    const map = new Map<string, SceneForStoryView>();
    sortedScenes.forEach((s) => map.set(s.id, s));
    return map;
  }, [sortedScenes]);

  const anchorsWithDefaults = useMemo(() => {
    const next: Record<string, number> = {};
    for (const scene of sortedScenes) {
      const explicit = anchors[scene.id];
      const base = defaultAnchors[scene.id];
      next[scene.id] = clampAnchor(typeof explicit === "number" ? explicit : typeof base === "number" ? base : parsed.totalSentences, parsed.totalSentences);
    }
    return next;
  }, [anchors, defaultAnchors, parsed.totalSentences, sortedScenes]);

  const scenesAtAnchor = useMemo(() => {
    const map = new Map<number, SceneForStoryView[]>();
    for (const scene of sortedScenes) {
      const a = anchorsWithDefaults[scene.id] ?? parsed.totalSentences;
      const list = map.get(a) ?? [];
      list.push(scene);
      map.set(a, list);
    }
    map.forEach((list) => list.sort((a, b) => a.scene_number - b.scene_number));
    return map;
  }, [anchorsWithDefaults, parsed.totalSentences, sortedScenes]);

  const uniqueFallbackScenes = useMemo(() => {
    const base = scenesAtAnchor.get(0) ?? sortedScenes;
    const seen = new Set<string>();
    return base.filter((scene) => {
      if (seen.has(scene.id)) return false;
      seen.add(scene.id);
      return true;
    });
  }, [scenesAtAnchor, sortedScenes]);

  const commitAnchors = useCallback(
    async (next: UndoRedoState, actionLabel: string, errorTitle: string) => {
      const prevAnchors = anchors;
      const prevPast = past;
      const prevFuture = future;
      const prevUpdatedAt = savingUpdatedAt;

      setAnchors(next.anchors);
      setPast(next.past);
      setFuture(next.future);
      setIsSaving(true);
      setFlash({ id: Date.now(), label: actionLabel });

      try {
        const persisted = await onPersistAnchors({ nextAnchors: next.anchors, baseUpdatedAt: savingUpdatedAt });
        if (persisted.ok === false) {
          setAnchors(prevAnchors);
          setPast(prevPast);
          setFuture(prevFuture);
          setSavingUpdatedAt(prevUpdatedAt);
          onToast?.({ title: errorTitle, description: persisted.reason, variant: "destructive" });
          setFlash({ id: Date.now(), label: "Reverted" });
          return;
        }
        setSavingUpdatedAt(persisted.updatedAt);
      } finally {
        setIsSaving(false);
      }
    },
    [anchors, future, onPersistAnchors, onToast, past, savingUpdatedAt],
  );

  const handleUndo = async () => {
    if (isSaving) return;
    const next = applyUndo({ anchors, past, future });
    if (!next.ok) return;
    await commitAnchors(next.next, "Undid move", "Undo failed");
  };

  const handleRedo = async () => {
    if (isSaving) return;
    const next = applyRedo({ anchors, past, future });
    if (!next.ok) return;
    await commitAnchors(next.next, "Redid move", "Redo failed");
  };

  useEffect(() => {
    if (!drag) return;

    const handleMove = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      const x = e.clientX;
      const y = e.clientY;
      const anchor = pickAnchorFromPoint(x, y);
      const sceneId = pickSceneIdFromPoint(x, y);
      setDrag((d) => (d ? { ...d, x, y } : null));
      setActiveAnchor(anchor);
      setActiveSceneId(sceneId);
    };

    const finish = async (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);

      const currentDrag = drag;
      const dropAnchor = activeAnchor;
      setDrag(null);
      setActiveAnchor(null);
      setActiveSceneId(null);

      if (typeof dropAnchor !== "number") return;

      const scene = scenesById.get(currentDrag.sceneId);
      if (!scene) return;

      const clamped = clampAnchor(dropAnchor, parsed.totalSentences);
      const next = { ...anchors, [scene.id]: clamped };

      const validation = validateAnchorsContinuity({
        scenes: sortedScenes,
        anchors: next,
        defaultAnchors,
        totalSentences: parsed.totalSentences,
        movingSceneId: scene.id,
      });

      if (validation.ok === false) {
        onToast?.({ title: "Invalid placement", description: validation.reason, variant: "destructive" });
        return;
      }

      await commitAnchors(
        { anchors: next, past: [...past, anchors], future: [] },
        "Moved scene",
        "Save failed",
      );
    };

    window.addEventListener("pointermove", handleMove, { passive: true });
    window.addEventListener("pointerup", finish, { passive: true });
    window.addEventListener("pointercancel", finish, { passive: true });

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [
    activeAnchor,
    anchors,
    commitAnchors,
    defaultAnchors,
    drag,
    onToast,
    parsed.totalSentences,
    past,
    scenesById,
    sortedScenes,
  ]);

  const renderSceneCard = (scene: SceneForStoryView) => {
    const heading = `Scene ${scene.scene_number}${scene.title ? `: ${scene.title}` : ""}`;
    const isDragging = drag?.sceneId === scene.id;
    const isHover = activeSceneId === scene.id && Boolean(drag);

    return (
      <section
        key={scene.id}
        data-story-scene-id={scene.id}
        aria-label={heading}
        className={cn(
          "border rounded-xl bg-secondary/15 p-3 sm:p-4 transition-colors",
          isHover ? "border-primary/60 bg-primary/5" : "border-border",
          isDragging ? "opacity-50" : "opacity-100",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-base truncate">{heading}</h3>
              <Badge variant="outline" className="text-xs">
                Draggable
              </Badge>
            </div>
            {scene.summary ? (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{scene.summary}</p>
            ) : null}
          </div>

          <button
            type="button"
            className="shrink-0 rounded-md border bg-background px-2 py-1 text-muted-foreground hover:text-foreground transition-colors select-none touch-none"
            aria-label={`Drag ${heading}`}
            onPointerDown={(e) => {
              const target = e.currentTarget.getBoundingClientRect();
              const offsetX = e.clientX - target.left;
              const offsetY = e.clientY - target.top;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag({
                sceneId: scene.id,
                pointerId: e.pointerId,
                x: e.clientX,
                y: e.clientY,
                offsetX,
                offsetY,
              });
              setActiveAnchor(pickAnchorFromPoint(e.clientX, e.clientY));
              setActiveSceneId(pickSceneIdFromPoint(e.clientX, e.clientY));
            }}
          >
            <GripVertical className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px] gap-4 items-start">
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              {scene.original_text ? scene.original_text.slice(0, 220) : "No scene text available."}
              {scene.original_text && scene.original_text.length > 220 ? "…" : ""}
            </div>
          </div>
          <div>
            {scene.image_url ? (
              <img
                src={scene.image_url}
                alt={heading}
                className="w-full h-auto rounded-lg border bg-background object-contain"
                loading="lazy"
              />
            ) : (
              <div
                className="w-full min-h-[240px] rounded-lg border border-dashed bg-background/40 grid place-items-center text-sm text-muted-foreground"
                aria-label="No image available"
              >
                No image
              </div>
            )}
          </div>
        </div>
      </section>
    );
  };

  const dropZone = (anchor: number) => {
    const isActive = drag && activeAnchor === anchor;
    return (
      <span
        key={`dz-${anchor}`}
        data-story-anchor={anchor}
        className={cn(
          "relative inline-block align-baseline select-none",
          "h-4 w-[0.5rem] sm:w-3",
        )}
      >
        <span
          className={cn(
            "absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2",
            "h-2 w-2 rounded-full transition-all duration-150",
            drag ? "bg-muted-foreground/30" : "bg-transparent",
            isActive ? "bg-primary h-2.5 w-2.5" : "",
          )}
        />
        <span
          className={cn(
            "absolute left-0 right-0 top-1/2 -translate-y-1/2",
            "h-[2px] rounded-full transition-all duration-150",
            isActive ? "bg-primary" : "bg-transparent",
          )}
        />
      </span>
    );
  };

  return (
      <div ref={rootRef} className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" type="button" onClick={handleUndo} disabled={past.length === 0 || isSaving}>
            <Undo2 className="w-4 h-4 mr-2" />
            Undo
          </Button>
          <Button variant="outline" size="sm" type="button" onClick={handleRedo} disabled={future.length === 0 || isSaving}>
            <Redo2 className="w-4 h-4 mr-2" />
            Redo
          </Button>
        </div>
        <div className="text-sm text-muted-foreground">{isSaving ? "Saving…" : flash?.label ?? "Saved"}</div>
      </div>

      <div className={cn("space-y-6", drag ? "cursor-grabbing select-none" : "cursor-default")}>
        {parsed.paragraphs.length === 0 ? (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">No story text detected.</div>
            <div className="border rounded-xl bg-secondary/10 p-4">
              <div className="flex items-center gap-2">
                {dropZone(0)}
                <span className="text-sm text-muted-foreground">Drop scenes here</span>
              </div>
              <div className="mt-4 space-y-3">{uniqueFallbackScenes.map((sc) => renderSceneCard(sc))}</div>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {parsed.paragraphs.map((p) => (
              <p key={`${p.start}-${p.endExclusive}`} className="leading-relaxed text-foreground">
                {dropZone(p.sentences[0]?.globalIndex ?? 0)}
                {p.sentences.map((s, idx) => {
                  const beforeScenes = scenesAtAnchor.get(s.globalIndex) ?? [];
                  const afterScenes = getAfterScenesForSentence({ parsed, scenesAtAnchor, sentenceGlobalIndex: s.globalIndex });
                  return (
                    <span key={`s-${s.globalIndex}`} className="align-baseline">
                      {beforeScenes.length > 0 ? (
                        <span className="block my-3 space-y-3">
                          {beforeScenes.map((sc) => renderSceneCard(sc))}
                        </span>
                      ) : null}
                      <span className="align-baseline">{s.text}</span>
                      {idx < p.sentences.length - 1 ? <span> </span> : null}
                      {dropZone(s.globalIndex + 1)}
                      {afterScenes.length > 0 && idx === p.sentences.length - 1 ? (
                        <span className="block my-3 space-y-3">
                          {afterScenes.map((sc) => renderSceneCard(sc))}
                        </span>
                      ) : null}
                    </span>
                  );
                })}
              </p>
            ))}
          </div>
        )}
      </div>

      {drag ? (
        <div
          className="fixed z-[60] pointer-events-none"
          style={{
            left: drag.x - drag.offsetX,
            top: drag.y - drag.offsetY,
            width: "min(520px, 92vw)",
          }}
          aria-hidden="true"
        >
          <div className="rounded-xl border bg-background shadow-lg p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <GripVertical className="w-4 h-4" />
              Dragging scene…
            </div>
            <div className="mt-2 font-medium">
              {(() => {
                const s = scenesById.get(drag.sceneId);
                return s ? `Scene ${s.scene_number}${s.title ? `: ${s.title}` : ""}` : "Scene";
              })()}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
