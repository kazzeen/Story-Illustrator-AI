import { useMemo, useState, useEffect, useRef, useCallback, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent, type DragEvent as ReactDragEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { validateSceneReferenceImageCandidate } from "@/lib/reference-images";
import { SUPABASE_KEY, SUPABASE_URL, supabase } from "@/integrations/supabase/client";
import { buildVeniceEditPrompt, type ImageEditTool, inferImageMimeFromUrl, normalizeImageMime, type NormalizedRect, validateVeniceImageConstraints } from "@/lib/venice-image-edit";
import { Save, X, RefreshCw, Wand2, Copy, Download, Edit3, Undo2, Redo2, Check, Square, Loader2, Upload, Trash2, ZoomIn, ZoomOut, RotateCcw, ChevronDown } from "lucide-react";
import { Scene } from "@/hooks/useStories";
import { extractDetailedError, DetailedError } from "@/lib/error-reporting";
import { useToast } from "@/hooks/use-toast";
import { applyClothingColorsToCharacterStates, regenerateImagePromptFromCharacterStates, type SceneCharacterAppearanceState } from "@/lib/scene-character-appearance";
import { ensureClothingColors, validateClothingColorCoverage } from "@/lib/clothing-colors";
import { readBooleanPreference, writeBooleanPreference } from "@/lib/ui-preferences";

const EMPTY_APPEARANCE_STATE: SceneCharacterAppearanceState = {
  clothing: "",
  state: "",
  physical_attributes: "",
};

interface SceneDetailModalProps {
  scene: Scene | null;
  allScenes?: Scene[];
  isOpen: boolean;
  onClose: () => void;
  onSavePrompt: (sceneId: string, newPrompt: string) => Promise<void>;
  onSaveCharacterStates?: (sceneId: string, characterStates: Record<string, unknown>) => Promise<void>;
  onRegenerate: (sceneId: string, opts?: { forceFullPrompt?: string }) => Promise<void>;
  onRegenerateStrictStyle?: (sceneId: string, opts?: { forceFullPrompt?: string }) => Promise<void>;
  onFetchFullPrompt?: (sceneId: string) => Promise<{
    requestId?: string;
    stage?: string;
    model?: string;
    prompt?: string;
    promptFull?: string;
    promptHash?: string;
    maxLength?: number;
    truncated?: boolean;
    missingSubjects?: string[];
    parts?: unknown;
    warnings?: string[];
    preprocessingSteps?: string[];
    success?: boolean;
    error?: string;
  }>;
  onReportStyleMismatch?: (sceneId: string, message: string) => Promise<void>;
  onImageEdited?: (sceneId: string, imageUrl: string) => void;
  isGenerating?: boolean;
  debugInfo?: {
    headers?: Record<string, string>;
    redactedHeaders?: string[];
    timestamp: Date;
    requestId?: string;
    stage?: string;
    error?: string;
    suggestion?: string;
    size?: number;
    status?: number;
    statusText?: string;
    reasons?: string[];
    upstreamError?: string;
    prompt?: string;
    promptFull?: string;
    preprocessingSteps?: string[];
    model?: string;
    modelConfig?: unknown;
    promptHash?: string;
  };
}

type ReferenceImageItem = {
  id: string;
  fileName: string;
  status: "uploading" | "ready" | "error";
  progress: number;
  error?: string;
  url?: string;
  thumbUrl?: string;
  bucket?: string;
  objectPath?: string;
  thumbPath?: string;
  width?: number | null;
  height?: number | null;
  selected: boolean;
  zoom: number;
  panX: number;
  panY: number;
  localThumbUrl?: string;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asStringRecord = (value: unknown): Record<string, string> | null => {
  if (!isPlainObject(value)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
};

const normalizeHeaders = (value: Record<string, string> | null | undefined) => {
  if (!value) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) out[String(k).toLowerCase()] = String(v);
  return out;
};

const mergeHeaders = (...sources: Array<Record<string, string> | null | undefined>) => {
  const out: Record<string, string> = {};
  for (const src of sources) {
    const normalized = normalizeHeaders(src);
    if (!normalized) continue;
    for (const [k, v] of Object.entries(normalized)) {
      if (!(k in out)) out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const normalizeFullPromptText = (text: string) => {
  const raw = String(text || "");
  const normalizedNewlines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const withoutControls = Array.from(normalizedNewlines)
    .filter((ch) => {
      if (ch === "\n") return true;
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  const collapsedLines = withoutControls
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n");
  return collapsedLines.replace(/\n{3,}/g, "\n\n").trim();
};

const safeDate = (val: unknown): Date | undefined => {
  if (val instanceof Date) return !isNaN(val.getTime()) ? val : undefined;
  if (typeof val === "string") {
    const d = new Date(val);
    return !isNaN(d.getTime()) ? d : undefined;
  }
  return undefined;
};

const nonEmptyString = (val: unknown): string | undefined =>
  typeof val === "string" && val.trim().length > 0 ? val : undefined;

const pickGenerationDebug = (details: Record<string, unknown> | null | undefined): Record<string, unknown> | null => {
  if (!details) return null;
  const raw = details.generation_debug ?? details.generationDebug;
  if (isPlainObject(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
};

const DEBUG_PREF_KEY = "scene_modal_debug_expanded";

export function SceneDetailModal({
  scene,
  allScenes,
  isOpen,
  onClose,
  onSavePrompt,
  onSaveCharacterStates,
  onRegenerate,
  onRegenerateStrictStyle,
  onFetchFullPrompt,
  onReportStyleMismatch,
  onImageEdited,
  isGenerating = false,
  debugInfo,
}: SceneDetailModalProps) {
  const { toast } = useToast();
  const [isDebugExpanded, setIsDebugExpanded] = useState(() =>
    readBooleanPreference({
      storage: typeof window !== "undefined" ? window.localStorage : null,
      key: DEBUG_PREF_KEY,
      defaultValue: false,
    }),
  );
  const [editedPrompt, setEditedPrompt] = useState("");
  const [isUpdatingPrompt, setIsUpdatingPrompt] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [promptEditorMode, setPromptEditorMode] = useState<"base" | "full">("base");
  const [isLoadingFullPrompt, setIsLoadingFullPrompt] = useState(false);
  const [fullPromptOriginal, setFullPromptOriginal] = useState("");
  const [fullPromptEdited, setFullPromptEdited] = useState("");
  const [fullPromptOverride, setFullPromptOverride] = useState<string | null>(null);
  const [fullPromptHasChanges, setFullPromptHasChanges] = useState(false);
  const [fullPromptError, setFullPromptError] = useState<string | null>(null);
  const [fullPromptMeta, setFullPromptMeta] = useState<{
    requestId?: string;
    model?: string;
    promptHash?: string;
    maxLength?: number;
    truncated?: boolean;
    missingSubjects?: string[];
    parts?: unknown;
    warnings?: string[];
    preprocessingSteps?: string[];
  } | null>(null);
  const [styleFeedback, setStyleFeedback] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [characterStatesDraft, setCharacterStatesDraft] = useState<Record<string, SceneCharacterAppearanceState>>({});
  const [originalCharacterStates, setOriginalCharacterStates] = useState<Record<string, SceneCharacterAppearanceState>>({});
  const [hasCharacterStateChanges, setHasCharacterStateChanges] = useState(false);
  const [isImageEditorOpen, setIsImageEditorOpen] = useState(false);
  const [editTool, setEditTool] = useState<ImageEditTool>("inpaint");
  const [inpaintText, setInpaintText] = useState("");
  const [removeObjectText, setRemoveObjectText] = useState("");
  const [colorTargetText, setColorTargetText] = useState("");
  const [colorValueText, setColorValueText] = useState("");
  const [toneTargetText, setToneTargetText] = useState("");
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [selection, setSelection] = useState<NormalizedRect | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const imageContainerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [imageHistory, setImageHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [previewMode, setPreviewMode] = useState<"current" | "original">("current");
  const [isPreparingEditor, setIsPreparingEditor] = useState(false);
  const [isPreviewingEdit, setIsPreviewingEdit] = useState(false);
  const [isApplyingEdit, setIsApplyingEdit] = useState(false);
  const [referenceImages, setReferenceImages] = useState<ReferenceImageItem[]>([]);
  const [isReferenceDragging, setIsReferenceDragging] = useState(false);
  const [activeReferenceId, setActiveReferenceId] = useState<string | null>(null);
  const referencePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const referencePanStartRef = useRef<{ panX: number; panY: number; startX: number; startY: number; dist?: number; zoom?: number } | null>(null);
  const lastPersistedReferencesRef = useRef<string | null>(null);
  const referenceFileInputRef = useRef<HTMLInputElement | null>(null);

  const [directSceneDetails, setDirectSceneDetails] = useState<Record<string, unknown> | null>(null);
  const directFetchSeqRef = useRef(0);



  useEffect(() => {
    if (scene) {
      setEditedPrompt(scene.image_prompt || "");
      setHasChanges(false);
      setPromptEditorMode("base");
      setIsLoadingFullPrompt(false);
      setFullPromptOriginal("");
      setFullPromptEdited("");
      setFullPromptOverride(null);
      setFullPromptHasChanges(false);
      setFullPromptError(null);
      setFullPromptMeta(null);
      setStyleFeedback("");
      setIsImageEditorOpen(false);
      setEditTool("inpaint");
      setInpaintText("");
      setRemoveObjectText("");
      setColorTargetText("");
      setColorValueText("");
      setToneTargetText("");
      setBrightness(0);
      setContrast(0);
      setSelection(null);
      setIsSelecting(false);
      selectionStartRef.current = null;
      setNaturalSize(null);
      setImageHistory([]);
      setHistoryIndex(0);
      setPreviewMode("current");
      setIsPreparingEditor(false);
      setIsPreviewingEdit(false);
      setIsApplyingEdit(false);
      setReferenceImages([]);
      setIsReferenceDragging(false);
      setActiveReferenceId(null);
      referencePointersRef.current.clear();
      referencePanStartRef.current = null;

      const raw = scene.character_states;
      const rawObj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      const next: Record<string, SceneCharacterAppearanceState> = {};

      (scene.characters || []).forEach((name) => {
        const stateRaw = rawObj[name];
        const stateObj =
          stateRaw && typeof stateRaw === "object" && !Array.isArray(stateRaw)
            ? (stateRaw as Record<string, unknown>)
            : {};
        next[name] = {
          clothing: typeof stateObj.clothing === "string" ? normalizeField(stateObj.clothing, 400) : "",
          state:
            typeof stateObj.state === "string"
              ? normalizeField(stateObj.state, 400)
              : typeof stateObj.condition === "string"
                ? normalizeField(stateObj.condition, 400)
                : "",
          physical_attributes:
            typeof stateObj.physical_attributes === "string" ? normalizeField(stateObj.physical_attributes, 600) : "",
        };
      });

      const sceneText = [
        typeof scene.setting === "string" ? scene.setting : "",
        typeof scene.emotional_tone === "string" ? scene.emotional_tone : "",
        typeof scene.summary === "string" ? scene.summary : "",
        typeof scene.original_text === "string" ? scene.original_text : "",
      ]
        .filter(Boolean)
        .join(" • ");

      const colored = applyClothingColorsToCharacterStates({
        storyId: scene.story_id,
        sceneId: scene.id,
        sceneText,
        characterStates: next,
      });

      setCharacterStatesDraft(colored);
      setOriginalCharacterStates(colored);
      setHasCharacterStateChanges(false);
    }
  }, [scene]);

  useEffect(() => {
    setDirectSceneDetails(null);
  }, [scene?.id]);

  useEffect(() => {
    writeBooleanPreference({
      storage: typeof window !== "undefined" ? window.localStorage : null,
      key: DEBUG_PREF_KEY,
      value: isDebugExpanded,
    });
  }, [isDebugExpanded]);

  const PROMPT_CHAR_LIMIT = 500;

  const handlePromptChange = (value: string) => {
    const next = value.length > PROMPT_CHAR_LIMIT ? value.slice(0, PROMPT_CHAR_LIMIT) : value;
    setEditedPrompt(next);
    setHasChanges(next !== (scene?.image_prompt || ""));
  };

  const loadFullPrompt = async () => {
    if (!scene || !onFetchFullPrompt) return;
    if (isLoadingFullPrompt) return;
    setIsLoadingFullPrompt(true);
    setFullPromptError(null);
    try {
      const res = await onFetchFullPrompt(scene.id);
      if (res?.success === false) {
        throw new Error(res.error || "Failed to fetch full prompt");
      }
      const prompt =
        typeof res?.promptFull === "string" ? res.promptFull : typeof res?.prompt === "string" ? res.prompt : "";
      if (!prompt.trim()) {
        throw new Error("Full prompt is empty");
      }
      setFullPromptOriginal(prompt);
      setFullPromptEdited(prompt);
      setFullPromptOverride(null);
      setFullPromptHasChanges(false);
      setFullPromptMeta({
        requestId: typeof res?.requestId === "string" ? res.requestId : undefined,
        model: typeof res?.model === "string" ? res.model : undefined,
        promptHash: typeof res?.promptHash === "string" ? res.promptHash : undefined,
        maxLength: typeof res?.maxLength === "number" ? res.maxLength : undefined,
        truncated: typeof res?.truncated === "boolean" ? res.truncated : undefined,
        missingSubjects: Array.isArray(res?.missingSubjects)
          ? res.missingSubjects.filter((v): v is string => typeof v === "string")
          : undefined,
        parts: "parts" in (res || {}) ? res.parts : undefined,
        warnings: Array.isArray(res?.warnings) ? res.warnings.filter((v): v is string => typeof v === "string") : undefined,
        preprocessingSteps: Array.isArray(res?.preprocessingSteps)
          ? res.preprocessingSteps.filter((v): v is string => typeof v === "string")
          : undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load full prompt";
      setFullPromptError(msg);
      toast({ title: "Full prompt failed", description: msg, variant: "destructive" });
    } finally {
      setIsLoadingFullPrompt(false);
    }
  };

  const saveFullPromptOverride = () => {
    const normalized = normalizeFullPromptText(fullPromptEdited);
    if (!normalized) {
      toast({ title: "Prompt required", description: "Full scene prompt cannot be empty.", variant: "destructive" });
      return;
    }
    const maxLen = fullPromptMeta?.maxLength;
    const clamped =
      typeof maxLen === "number" && Number.isFinite(maxLen) && maxLen > 0 && normalized.length > maxLen
        ? normalized.slice(0, maxLen)
        : normalized;
    setFullPromptEdited(clamped);
    setFullPromptOverride(clamped);
    setFullPromptHasChanges(false);
    setFullPromptError(null);
    toast({ title: "Full prompt saved", description: "Next regeneration will use this full prompt." });
  };

  const resetFullPromptEditor = (mode?: "keep_tab" | "switch_to_base") => {
    setFullPromptEdited(fullPromptOriginal);
    setFullPromptOverride(null);
    setFullPromptHasChanges(false);
    setFullPromptError(null);
    if (mode === "switch_to_base") setPromptEditorMode("base");
  };

  const clampPromptPreservingAppearanceAppendix = (value: string) => {
    if (value.length <= PROMPT_CHAR_LIMIT) return value;
    const idx = value.toLowerCase().indexOf("character appearance:");
    if (idx < 0) return value.slice(0, PROMPT_CHAR_LIMIT);
    const appendix = value.slice(idx).trim();
    const remaining = PROMPT_CHAR_LIMIT - appendix.length - 2;
    if (remaining <= 0) return appendix.slice(0, PROMPT_CHAR_LIMIT);
    const base = value.slice(0, remaining).trim();
    return `${base}\n\n${appendix}`.slice(0, PROMPT_CHAR_LIMIT);
  };

  const handleUpdatePromptWithCharacterStates = async () => {
    if (!scene) return;
    if (isUpdatingPrompt) return;

    setIsUpdatingPrompt(true);
    try {
      const names = Array.isArray(scene.characters) ? scene.characters : [];
      const sceneText = [
        typeof scene.setting === "string" ? scene.setting : "",
        typeof scene.emotional_tone === "string" ? scene.emotional_tone : "",
        typeof scene.summary === "string" ? scene.summary : "",
        typeof scene.original_text === "string" ? scene.original_text : "",
      ]
        .filter(Boolean)
        .join(" • ");

      const normalizedDraft: Record<string, SceneCharacterAppearanceState> = {};
      for (const name of names) {
        normalizedDraft[name] = characterStatesDraft[name] ?? EMPTY_APPEARANCE_STATE;
      }

      const { prompt, coloredCharacterStates } = regenerateImagePromptFromCharacterStates({
        storyId: scene.story_id,
        sceneId: scene.id,
        sceneText,
        basePrompt: editedPrompt,
        characterNames: names,
        characterStates: normalizedDraft,
      });

      const changedStates = names.some((n) => {
        const curr = coloredCharacterStates[n] ?? EMPTY_APPEARANCE_STATE;
        const orig = originalCharacterStates[n] ?? EMPTY_APPEARANCE_STATE;
        return (
          (curr.clothing || "") !== (orig.clothing || "") ||
          (curr.state || "") !== (orig.state || "") ||
          (curr.physical_attributes || "") !== (orig.physical_attributes || "")
        );
      });

      setCharacterStatesDraft(coloredCharacterStates);
      setHasCharacterStateChanges(changedStates);

      const nextPrompt = clampPromptPreservingAppearanceAppendix(prompt);
      setEditedPrompt(nextPrompt);
      setHasChanges(nextPrompt !== (scene?.image_prompt || ""));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update prompt";
      toast({ title: "Prompt update failed", description: msg, variant: "destructive" });
    } finally {
      setIsUpdatingPrompt(false);
    }
  };

  const fetchLatestSceneDetails = useCallback(
    async (sceneId: string) => {
      const seq = (directFetchSeqRef.current += 1);
      try {
        const { data, error } = await supabase.from("scenes").select("consistency_details").eq("id", sceneId).single();
        if (directFetchSeqRef.current !== seq || error || !data) return;

        const raw = data.consistency_details;
        const parsed = isPlainObject(raw) ? raw : typeof raw === "string" ? (JSON.parse(raw) as unknown) : null;
        if (!isPlainObject(parsed)) return;

        setDirectSceneDetails(parsed);
      } catch {
        if (directFetchSeqRef.current !== seq) return;
      }
    },
    [],
  );

  const handleSave = async () => {
    if (!scene || (!hasChanges && !hasCharacterStateChanges)) return;
    
    setIsSaving(true);
    try {
      if (hasChanges) {
        await onSavePrompt(scene.id, editedPrompt);
        setHasChanges(false);
      }

      if (hasCharacterStateChanges && onSaveCharacterStates) {
        const toSave: Record<string, unknown> = {};
        const normalizedDraft: Record<string, SceneCharacterAppearanceState> = {};
        for (const [name, state] of Object.entries(characterStatesDraft)) {
          const clothingRaw = normalizeField(state.clothing || "", 400);
          const sceneText = [
            typeof scene.setting === "string" ? scene.setting : "",
            typeof scene.emotional_tone === "string" ? scene.emotional_tone : "",
            typeof scene.summary === "string" ? scene.summary : "",
            typeof scene.original_text === "string" ? scene.original_text : "",
          ]
            .filter(Boolean)
            .join(" • ");
          const clothingColored =
            clothingRaw.trim().length > 0
              ? ensureClothingColors(clothingRaw, {
                  seed: `${scene.story_id}:${scene.id}:${name}:save`,
                  scene_text: sceneText,
                  force_if_no_keywords: true,
                }).text || clothingRaw
              : "";
          const clothingValidation = validateClothingColorCoverage(clothingColored);
          if (!clothingValidation.ok) {
            toast({
              title: "Missing clothing colors",
              description: `${name}: add a color to each clothing item.`,
              variant: "destructive",
            });
            setIsSaving(false);
            return;
          }

          const condition = normalizeField(state.state || "", 400);
          const physicalAttributes = normalizeField(state.physical_attributes || "", 600);

          normalizedDraft[name] = {
            clothing: clothingColored,
            state: condition,
            physical_attributes: physicalAttributes,
          };

          const nextState: Record<string, string> = {};
          if (clothingColored) nextState.clothing = clothingColored;
          if (condition) nextState.state = condition;
          if (physicalAttributes) nextState.physical_attributes = physicalAttributes;
          if (Object.keys(nextState).length > 0) toSave[name] = nextState;
        }

        await onSaveCharacterStates(scene.id, toSave);
        setCharacterStatesDraft(normalizedDraft);
        setOriginalCharacterStates(normalizedDraft);
        setHasCharacterStateChanges(false);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleRegenerate = async () => {
    if (!scene) return;

    const hasSelectedReference = referenceImages.some((r) => r.status === "ready" && r.selected);
    if (editedPrompt.trim().length === 0 && !hasSelectedReference) {
      toast({
        title: "Prompt required",
        description: "Add an image prompt or select a reference image.",
        variant: "destructive",
      });
      return;
    }
    
    if (hasChanges || hasCharacterStateChanges) {
      await handleSave();
    }
    
    const force = fullPromptOverride && fullPromptOverride.trim() ? fullPromptOverride : undefined;
    await onRegenerate(scene.id, force ? { forceFullPrompt: force } : undefined);
  };

  const handleRegenerateStrictStyle = async () => {
    if (!scene || !onRegenerateStrictStyle) return;

    const hasSelectedReference = referenceImages.some((r) => r.status === "ready" && r.selected);
    if (editedPrompt.trim().length === 0 && !hasSelectedReference) {
      toast({
        title: "Prompt required",
        description: "Add an image prompt or select a reference image.",
        variant: "destructive",
      });
      return;
    }

    if (hasChanges || hasCharacterStateChanges) {
      await handleSave();
    }

    const force = fullPromptOverride && fullPromptOverride.trim() ? fullPromptOverride : undefined;
    await onRegenerateStrictStyle(scene.id, force ? { forceFullPrompt: force } : undefined);
  };

  const handleSubmitStyleMismatch = async () => {
    if (!scene || !onReportStyleMismatch) return;
    const message = styleFeedback.trim();
    if (!message) return;

    setIsSubmittingFeedback(true);
    try {
      await onReportStyleMismatch(scene.id, message);
      setStyleFeedback("");
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  useEffect(() => {
    if (!scene?.id || !isOpen) return;

    void (async () => {
      await fetchLatestSceneDetails(scene.id);
    })();
  }, [scene?.id, isOpen, fetchLatestSceneDetails]);

  const sceneDetails = (() => {
    const raw = scene?.consistency_details;
    if (isPlainObject(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as unknown;
        return isPlainObject(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  })();

  const persistedDetails = (() => {
    const direct = directSceneDetails;
    const fromScene = sceneDetails;
    if (!direct) return fromScene;
    if (!fromScene) return direct;

    const directGen = pickGenerationDebug(direct);
    const sceneGen = pickGenerationDebug(fromScene);

    const meaningful = (value: unknown) => {
      if (typeof value === "string") return value.trim().length > 0;
      if (typeof value === "number") return Number.isFinite(value);
      if (typeof value === "boolean") return true;
      if (Array.isArray(value)) return value.length > 0;
      if (isPlainObject(value)) return Object.keys(value).length > 0;
      return false;
    };

    const mergedGen = (() => {
      if (!directGen && !sceneGen) return null;
      const out: Record<string, unknown> = { ...(sceneGen ?? {}) };
      for (const [k, v] of Object.entries(directGen ?? {})) {
        if (meaningful(v)) out[k] = v;
      }

      return out;
    })();

    const merged: Record<string, unknown> = { ...fromScene, ...direct };
    if (mergedGen) merged.generation_debug = mergedGen;
    return merged;
  })();
  const persistedDebugRaw = (() => {
    return pickGenerationDebug(persistedDetails ?? undefined);
  })();

  const debugInfoRequestParams =
    debugInfo && "requestParams" in debugInfo && isPlainObject((debugInfo as Record<string, unknown>).requestParams)
      ? (debugInfo as Record<string, unknown>).requestParams
      : undefined;

  const requestParams =
    debugInfoRequestParams ?? (isPlainObject(persistedDebugRaw?.requestParams) ? persistedDebugRaw.requestParams : undefined);

  const debug = {
    headers:
      mergeHeaders(
        debugInfo?.headers,
        asStringRecord(persistedDebugRaw?.headers),
        asStringRecord(persistedDetails?.headers)
      ),
    timestamp:
      safeDate(debugInfo?.timestamp) ??
      safeDate(persistedDebugRaw?.timestamp) ??
      safeDate(persistedDetails?.timestamp) ??
      undefined,
    requestId: debugInfo?.requestId ?? (typeof persistedDebugRaw?.requestId === "string" ? persistedDebugRaw.requestId : undefined),
    stage:
      debugInfo?.stage ??
      (typeof persistedDebugRaw?.stage === "string" ? persistedDebugRaw.stage : undefined) ??
      (typeof persistedDetails?.stage === "string" ? persistedDetails.stage : undefined),
    error:
      debugInfo?.error ??
      (typeof persistedDebugRaw?.error === "string" ? persistedDebugRaw.error : undefined) ??
      (typeof persistedDetails?.error === "string" ? persistedDetails.error : undefined),
    suggestion:
      debugInfo?.suggestion ??
      (typeof persistedDebugRaw?.suggestion === "string" ? persistedDebugRaw.suggestion : undefined) ??
      (typeof persistedDetails?.suggestion === "string" ? persistedDetails.suggestion : undefined),
    size:
      typeof debugInfo?.size === "number"
        ? debugInfo.size
        : typeof persistedDebugRaw?.size === "number"
          ? persistedDebugRaw.size
          : typeof persistedDetails?.size === "number"
            ? persistedDetails.size
            : undefined,
    status:
      typeof debugInfo?.status === "number"
        ? debugInfo.status
        : typeof persistedDebugRaw?.status === "number"
          ? persistedDebugRaw.status
          : typeof persistedDetails?.status === "number"
            ? persistedDetails.status
            : undefined,
    statusText:
      debugInfo?.statusText ??
      (typeof persistedDebugRaw?.statusText === "string" ? persistedDebugRaw.statusText : undefined) ??
      (typeof persistedDetails?.statusText === "string" ? persistedDetails.statusText : undefined),
    reasons:
      debugInfo?.reasons ??
      (Array.isArray(persistedDebugRaw?.reasons) ? (persistedDebugRaw.reasons as unknown[]).filter((v): v is string => typeof v === "string") : undefined) ??
      (Array.isArray(persistedDetails?.reasons) ? (persistedDetails.reasons as unknown[]).filter((v): v is string => typeof v === "string") : undefined),
    redactedHeaders:
      debugInfo?.redactedHeaders ??
      (Array.isArray(persistedDebugRaw?.redactedHeaders)
        ? (persistedDebugRaw.redactedHeaders as unknown[]).filter((v): v is string => typeof v === "string")
        : undefined) ??
      (Array.isArray(persistedDetails?.redactedHeaders)
        ? (persistedDetails.redactedHeaders as unknown[]).filter((v): v is string => typeof v === "string")
        : undefined),
    upstreamError:
      debugInfo?.upstreamError ??
      (typeof persistedDebugRaw?.upstream_error === "string" ? persistedDebugRaw.upstream_error : undefined) ??
      (typeof persistedDebugRaw?.upstreamError === "string" ? persistedDebugRaw.upstreamError : undefined) ??
      (typeof persistedDetails?.upstream_error === "string" ? persistedDetails.upstream_error : undefined) ??
      (typeof persistedDetails?.upstreamError === "string" ? persistedDetails.upstreamError : undefined),
    preprocessingSteps:
      (debugInfo && "preprocessingSteps" in debugInfo && Array.isArray(debugInfo.preprocessingSteps)
        ? debugInfo.preprocessingSteps.filter((v): v is string => typeof v === "string")
        : undefined) ??
      (Array.isArray((persistedDebugRaw as Record<string, unknown> | null)?.preprocessingSteps)
        ? (((persistedDebugRaw as Record<string, unknown>).preprocessingSteps as unknown[]) || []).filter(
            (v): v is string => typeof v === "string",
          )
        : undefined),
    model:
      (debugInfo && "model" in debugInfo && typeof debugInfo.model === "string" ? debugInfo.model : undefined) ??
      (typeof (persistedDebugRaw as Record<string, unknown> | null)?.model === "string"
        ? ((persistedDebugRaw as Record<string, unknown>).model as string)
        : undefined),
    modelConfig:
      (debugInfo && "modelConfig" in debugInfo ? debugInfo.modelConfig : undefined) ??
      ((persistedDebugRaw as Record<string, unknown> | null)?.model_config ??
        (persistedDebugRaw as Record<string, unknown> | null)?.modelConfig),
  };

  let detailedError: DetailedError | null = null;
  try {
    if (typeof extractDetailedError === 'function' && (debug.status || debug.headers || debug.error)) {
      detailedError = extractDetailedError({
        status: debug.status,
        statusText: debug.statusText,
        headers: debug.headers,
        errorBody: debug.error,
        requestParams: requestParams as Record<string, unknown>,
      });
    }
  } catch (e) {
    console.error("Failed to extract detailed error:", e);
  }

  const updateCharacterState = (name: string, key: "clothing" | "state" | "physical_attributes", value: string) => {
    setCharacterStatesDraft((prev) => {
      const prevState = prev[name] ?? EMPTY_APPEARANCE_STATE;
      const nextState: SceneCharacterAppearanceState = { ...prevState, [key]: value };
      const next: Record<string, SceneCharacterAppearanceState> = { ...prev, [name]: nextState };

      const names = scene?.characters || [];
      const changed = names.some((n) => {
        const curr = next[n] ?? EMPTY_APPEARANCE_STATE;
        const orig = originalCharacterStates[n] ?? EMPTY_APPEARANCE_STATE;
        return (
          (curr.clothing || "") !== (orig.clothing || "") ||
          (curr.state || "") !== (orig.state || "") ||
          (curr.physical_attributes || "") !== (orig.physical_attributes || "")
        );
      });

      setHasCharacterStateChanges(changed);
      return next;
    });
  };

  const normalizeField = (val: string, maxLen: number) => {
    const collapsed = val.replace(/\s+/g, " ").trim();
    return collapsed.length > maxLen ? collapsed.slice(0, maxLen) : collapsed;
  };

  const parseSceneStatesByName = (s: Scene | null | undefined) => {
    const raw = s?.character_states;
    const rawObj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const out: Record<string, { clothing: string; state: string; physical_attributes: string }> = {};
    const names = s?.characters || [];

    names.forEach((name) => {
      const stateRaw = rawObj[name];
      const stateObj =
        stateRaw && typeof stateRaw === "object" && !Array.isArray(stateRaw)
          ? (stateRaw as Record<string, unknown>)
          : {};
      const clothing = typeof stateObj.clothing === "string" ? stateObj.clothing : "";
      const state =
        typeof stateObj.state === "string"
          ? stateObj.state
          : typeof stateObj.condition === "string"
            ? stateObj.condition
            : "";
      const physicalAttributes = typeof stateObj.physical_attributes === "string" ? stateObj.physical_attributes : "";
      out[name] = {
        clothing,
        state,
        physical_attributes: physicalAttributes,
      };
    });

    return out;
  };

  const copyText = async (label: string, text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("Clipboard API not available");
      }
      toast({ title: "Copied", description: label });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard access was blocked", variant: "destructive" });
    }
  };

  const downloadJson = (filename: string, data: unknown) => {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Downloaded", description: filename });
    } catch {
      toast({ title: "Download failed", description: "Could not create download", variant: "destructive" });
    }
  };

  const referencePersistKey = scene?.id ? `reference-images:${scene.id}` : null;

  useEffect(() => {
    if (!referencePersistKey) return;
    try {
      const raw = sessionStorage.getItem(referencePersistKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const next: ReferenceImageItem[] = parsed
        .filter((v) => typeof v === "object" && v !== null)
        .map((v) => v as Partial<ReferenceImageItem>)
        .filter((v) => typeof v.id === "string" && typeof v.fileName === "string")
        .map((v) => ({
          id: String(v.id),
          fileName: String(v.fileName),
          status: "ready",
          progress: 100,
          url: typeof v.url === "string" ? v.url : undefined,
          thumbUrl: typeof v.thumbUrl === "string" ? v.thumbUrl : undefined,
          bucket: typeof v.bucket === "string" ? v.bucket : undefined,
          objectPath: typeof v.objectPath === "string" ? v.objectPath : undefined,
          thumbPath: typeof v.thumbPath === "string" ? v.thumbPath : undefined,
          width: typeof v.width === "number" ? v.width : null,
          height: typeof v.height === "number" ? v.height : null,
          selected: typeof v.selected === "boolean" ? v.selected : false,
          zoom: typeof v.zoom === "number" ? v.zoom : 1,
          panX: typeof v.panX === "number" ? v.panX : 0,
          panY: typeof v.panY === "number" ? v.panY : 0,
        }));
      setReferenceImages(next);
      const firstSelected = next.find((r) => r.selected)?.id ?? next[0]?.id ?? null;
      setActiveReferenceId(firstSelected);
    } catch {
      sessionStorage.removeItem(referencePersistKey);
    }
  }, [referencePersistKey]);

  useEffect(() => {
    if (!referencePersistKey) return;
    const toSave = referenceImages
      .filter((r) => r.status === "ready")
      .map((r) => ({
        id: r.id,
        fileName: r.fileName,
        url: r.url,
        thumbUrl: r.thumbUrl,
        bucket: r.bucket,
        objectPath: r.objectPath,
        thumbPath: r.thumbPath,
        width: r.width ?? null,
        height: r.height ?? null,
        selected: r.selected,
        zoom: r.zoom,
        panX: r.panX,
        panY: r.panY,
      }));
    sessionStorage.setItem(referencePersistKey, JSON.stringify(toSave));
  }, [referenceImages, referencePersistKey]);

  useEffect(() => {
    if (!scene?.id) return;
    const details = isPlainObject(scene?.consistency_details) ? scene?.consistency_details : null;
    const refsRaw = details && "reference_images" in details ? (details as Record<string, unknown>).reference_images : null;
    const sceneRefs =
      Array.isArray(refsRaw)
        ? refsRaw
            .filter((v) => typeof v === "object" && v !== null)
            .map((v) => v as Record<string, unknown>)
            .filter((v) => typeof v.id === "string" && typeof v.fileName === "string")
            .map((v) => ({
              id: String(v.id),
              fileName: String(v.fileName),
              bucket: typeof v.bucket === "string" ? v.bucket : undefined,
              objectPath: typeof v.objectPath === "string" ? v.objectPath : undefined,
              thumbPath: typeof v.thumbPath === "string" ? v.thumbPath : undefined,
              width: typeof v.width === "number" ? v.width : null,
              height: typeof v.height === "number" ? v.height : null,
              selected: typeof v.selected === "boolean" ? v.selected : false,
            }))
        : [];
    if (sceneRefs.length === 0) return;

    const next: ReferenceImageItem[] = sceneRefs.map((v) => ({
      id: v.id,
      fileName: v.fileName,
      status: "ready",
      progress: 100,
      url: undefined,
      thumbUrl: undefined,
      bucket: v.bucket,
      objectPath: v.objectPath,
      thumbPath: v.thumbPath,
      width: v.width ?? null,
      height: v.height ?? null,
      selected: v.selected,
      zoom: 1,
      panX: 0,
      panY: 0,
    }));

    setReferenceImages((prev) => {
      const prevUploading = prev.filter((r) => r.status === "uploading");
      return [...next, ...prevUploading];
    });
    setActiveReferenceId((curr) => curr ?? next.find((r) => r.selected)?.id ?? next[0]?.id ?? null);
    lastPersistedReferencesRef.current = JSON.stringify(
      sceneRefs.map((r) => ({
        id: r.id,
        fileName: r.fileName,
        bucket: r.bucket,
        objectPath: r.objectPath,
        thumbPath: r.thumbPath,
        width: r.width ?? null,
        height: r.height ?? null,
        selected: r.selected,
      })),
    );

    const refresh = async () => {
      const toSign = sceneRefs.filter((r) => r.objectPath && r.thumbPath);
      if (toSign.length === 0) return;
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) return;

      const { data, error } = await supabase.functions.invoke("upload-reference-image", {
        body: {
          action: "sign",
          items: toSign.map((r) => ({
            id: r.id,
            bucket: r.bucket,
            objectPath: r.objectPath,
            thumbPath: r.thumbPath,
          })),
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) return;
      const resp = data as { success?: boolean; items?: Array<{ id: string; url?: string; thumbUrl?: string }> } | null;
      const signed = resp?.items ?? [];
      if (!Array.isArray(signed) || signed.length === 0) return;

      const byId = new Map(signed.filter((v) => v && typeof v.id === "string").map((v) => [v.id, v]));
      setReferenceImages((prev) =>
        prev.map((r) => {
          const nextItem = byId.get(r.id);
          if (!nextItem) return r;
          return {
            ...r,
            url: typeof nextItem.url === "string" ? nextItem.url : r.url,
            thumbUrl: typeof nextItem.thumbUrl === "string" ? nextItem.thumbUrl : r.thumbUrl,
          };
        }),
      );
    };
    void refresh();
  }, [scene?.id, scene?.consistency_details]);

  useEffect(() => {
    if (!scene?.id) return;
    const ready = referenceImages
      .filter((r) => r.status === "ready" && r.objectPath && r.thumbPath)
      .map((r) => ({
        id: r.id,
        fileName: r.fileName,
        bucket: r.bucket,
        objectPath: r.objectPath,
        thumbPath: r.thumbPath,
        width: r.width ?? null,
        height: r.height ?? null,
        selected: r.selected,
      }));
    const nextStr = JSON.stringify(ready);
    if (nextStr === lastPersistedReferencesRef.current) return;

    const timer = window.setTimeout(async () => {
      const existingFromState = persistedDetails;
      const existing =
        existingFromState ??
        (await (async () => {
          try {
            const { data } = await supabase.from("scenes").select("consistency_details").eq("id", scene.id).single();
            const raw = data?.consistency_details;
            if (isPlainObject(raw)) return raw;
            if (typeof raw === "string") {
              const parsed = JSON.parse(raw) as unknown;
              return isPlainObject(parsed) ? parsed : null;
            }
            return null;
          } catch {
            return null;
          }
        })());

      if (!existing) return;
      const merged = { ...existing, reference_images: ready };
      const { error } = await supabase.from("scenes").update({ consistency_details: merged }).eq("id", scene.id);
      if (error) return;
      lastPersistedReferencesRef.current = nextStr;
    }, 800);

    return () => window.clearTimeout(timer);
  }, [referenceImages, scene?.id, persistedDetails]);

  const updateReference = (id: string, patch: Partial<ReferenceImageItem>) => {
    setReferenceImages((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addReference = (item: ReferenceImageItem) => {
    setReferenceImages((prev) => [...prev, item]);
  };

  const removeReferenceLocal = (id: string) => {
    setReferenceImages((prev) => {
      const toRemove = prev.find((r) => r.id === id);
      if (toRemove?.localThumbUrl) URL.revokeObjectURL(toRemove.localThumbUrl);
      const next = prev.filter((r) => r.id !== id);
      setActiveReferenceId((curr) => (curr === id ? next.find((r) => r.selected)?.id ?? next[0]?.id ?? null : curr));
      return next;
    });
  };

  const uploadReferenceFile = async (sceneId: string, file: File, onProgress?: (pct: number) => void) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) throw new Error("Not authenticated");

    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? SUPABASE_URL) as string | undefined;
    const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_KEY) as string | undefined;
    if (!supabaseUrl || !supabaseAnonKey) throw new Error("Missing Supabase configuration");

    const endpoint = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/upload-reference-image`;
    const form = new FormData();
    form.append("action", "upload");
    form.append("sceneId", sceneId);
    form.append("file", file);

    return await new Promise<{
      success: boolean;
      id: string;
      bucket: string;
      objectPath: string;
      thumbPath: string;
      url: string;
      thumbUrl: string;
      width: number | null;
      height: number | null;
      originalName: string;
    }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", endpoint);
      xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
      xhr.setRequestHeader("apikey", supabaseAnonKey);
      xhr.responseType = "json";
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.max(0, Math.min(100, Math.round((e.loaded / e.total) * 100)));
        onProgress?.(pct);
      };
      xhr.onload = () => {
        const status = xhr.status;
        const body = xhr.response as unknown;
        if (status >= 200 && status < 300 && body && typeof body === "object") {
          resolve(body as {
            success: boolean;
            id: string;
            bucket: string;
            objectPath: string;
            thumbPath: string;
            url: string;
            thumbUrl: string;
            width: number | null;
            height: number | null;
            originalName: string;
          });
          return;
        }
        const errMsg = (() => {
          if (body && typeof body === "object" && "error" in body) {
            const msg = (body as { error?: unknown }).error;
            if (typeof msg === "string" && msg.trim()) return msg;
          }
          return `Upload failed (HTTP ${status})`;
        })();
        reject(new Error(errMsg));
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(form);
    });
  };

  const handleReferenceFiles = async (files: File[]) => {
    if (!scene?.id) return;
    for (const file of files) {
      const validation = validateSceneReferenceImageCandidate({ name: file.name, size: file.size, type: file.type });
      if (validation.ok === false) {
        toast({ title: validation.error, description: file.name, variant: "destructive" });
        continue;
      }

      const id = crypto.randomUUID();
      const localThumbUrl = URL.createObjectURL(file);
      addReference({
        id,
        fileName: file.name,
        status: "uploading",
        progress: 0,
        selected: true,
        zoom: 1,
        panX: 0,
        panY: 0,
        localThumbUrl,
      });
      setActiveReferenceId(id);

      try {
        const resp = await uploadReferenceFile(scene.id, file, (pct) => updateReference(id, { progress: pct }));
        updateReference(id, {
          status: "ready",
          progress: 100,
          url: resp.url,
          thumbUrl: resp.thumbUrl,
          bucket: resp.bucket,
          objectPath: resp.objectPath,
          thumbPath: resp.thumbPath,
          width: resp.width,
          height: resp.height,
          fileName: resp.originalName || file.name,
        });
      } catch (e) {
        updateReference(id, {
          status: "error",
          error: e instanceof Error ? e.message : "Upload failed",
          progress: 0,
        });
      }
    }
  };

  const deleteReferenceOnServer = async (item: ReferenceImageItem) => {
    if (!item.objectPath || !scene?.id) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) throw new Error("Not authenticated");

    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? SUPABASE_URL) as string | undefined;
    const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_KEY) as string | undefined;
    if (!supabaseUrl || !supabaseAnonKey) throw new Error("Missing Supabase configuration");

    const endpoint = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/upload-reference-image`;
    const form = new FormData();
    form.append("action", "delete");
    form.append("bucket", item.bucket || "reference-images");
    form.append("objectPath", item.objectPath);
    if (item.thumbPath) form.append("thumbPath", item.thumbPath);
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", endpoint);
      xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
      xhr.setRequestHeader("apikey", supabaseAnonKey);
      xhr.responseType = "json";
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        const body = xhr.response as unknown;
        const msg =
          body && typeof body === "object" && body !== null && "error" in body && typeof (body as { error?: unknown }).error === "string"
            ? String((body as { error?: unknown }).error)
            : `Delete failed (HTTP ${xhr.status})`;
        reject(new Error(msg));
      };
      xhr.onerror = () => reject(new Error("Network error during delete"));
      xhr.send(form);
    });
  };

  const toggleReferenceSelected = (id: string) => {
    setReferenceImages((prev) =>
      prev.map((r) => (r.id === id ? { ...r, selected: !r.selected } : r)),
    );
    setActiveReferenceId(id);
  };

  const zoomReference = (id: string, delta: number) => {
    setReferenceImages((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const nextZoom = Math.max(1, Math.min(6, Number.isFinite(r.zoom + delta) ? r.zoom + delta : r.zoom));
        return { ...r, zoom: nextZoom };
      }),
    );
  };

  const resetReferenceTransform = (id: string) => {
    updateReference(id, { zoom: 1, panX: 0, panY: 0 });
  };

  const onReferencePointerDown = (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
    const pt = { x: e.clientX, y: e.clientY };
    referencePointersRef.current.set(e.pointerId, pt);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pointers = Array.from(referencePointersRef.current.values());
    const item = referenceImages.find((r) => r.id === id);
    if (!item) return;
    if (pointers.length === 2) {
      const [a, b] = pointers;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      referencePanStartRef.current = { panX: item.panX, panY: item.panY, startX: e.clientX, startY: e.clientY, dist, zoom: item.zoom };
    } else {
      referencePanStartRef.current = { panX: item.panX, panY: item.panY, startX: e.clientX, startY: e.clientY };
    }
  };

  const onReferencePointerMove = (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (!referencePointersRef.current.has(e.pointerId)) return;
    referencePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pointers = Array.from(referencePointersRef.current.values());
    const start = referencePanStartRef.current;
    const item = referenceImages.find((r) => r.id === id);
    if (!start || !item) return;

    if (pointers.length === 2 && typeof start.dist === "number" && typeof start.zoom === "number") {
      const [a, b] = pointers;
      const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const ratio = dist / Math.max(1, start.dist);
      const nextZoom = Math.max(1, Math.min(6, start.zoom * ratio));
      updateReference(id, { zoom: nextZoom });
      return;
    }

    if (pointers.length === 1) {
      const dx = e.clientX - start.startX;
      const dy = e.clientY - start.startY;
      updateReference(id, { panX: start.panX + dx, panY: start.panY + dy });
    }
  };

  const onReferencePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    referencePointersRef.current.delete(e.pointerId);
    if (referencePointersRef.current.size === 0) {
      referencePanStartRef.current = null;
      return;
    }
    if (referencePointersRef.current.size === 1) {
      const remaining = Array.from(referencePointersRef.current.values())[0]!;
      const item = referenceImages.find((r) => r.id === activeReferenceId);
      if (item) {
        referencePanStartRef.current = { panX: item.panX, panY: item.panY, startX: remaining.x, startY: remaining.y };
      }
    }
  };

  const onReferenceWheel = (e: ReactWheelEvent<HTMLDivElement>, id: string) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    zoomReference(id, dir * 0.25);
  };

  const handleReferenceDrag = (e: ReactDragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setIsReferenceDragging(true);
    if (e.type === "dragleave") setIsReferenceDragging(false);
  };

  const handleReferenceDrop = (e: ReactDragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsReferenceDragging(false);
    const dropped = Array.from(e.dataTransfer.files || []);
    void handleReferenceFiles(dropped);
  };

  const parseDataUrl = (dataUrl: string) => {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) return null;
    return { mime: match[1], base64: match[2] };
  };

  const reencodeDataUrl = async (args: { dataUrl: string; targetMime: string; width?: number | null; height?: number | null }) => {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = args.dataUrl;
    });

    const width = typeof args.width === "number" && args.width > 0 ? Math.floor(args.width) : img.naturalWidth;
    const height = typeof args.height === "number" && args.height > 0 ? Math.floor(args.height) : img.naturalHeight;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      const quality = args.targetMime === "image/jpeg" ? 0.92 : undefined;
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Failed to encode image"))),
        args.targetMime,
        quality,
      );
    });

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    const base64 = btoa(binary);
    return { base64, mime: args.targetMime, byteSize: blob.size };
  };

  const blobToDataUrl = async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    const base64 = btoa(binary);
    const mime = blob.type || "image/png";
    return { dataUrl: `data:${mime};base64,${base64}`, byteSize: blob.size, mime };
  };

  const fetchImageAsDataUrl = async (url: string) => {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`Failed to load image (HTTP ${res.status})`);
    const blob = await res.blob();
    return blobToDataUrl(blob);
  };

  const getDisplayedImageRect = () => {
    const container = imageContainerRef.current;
    const nat = naturalSize;
    if (!container || !nat) return null;
    const rect = container.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    if (cw <= 0 || ch <= 0) return null;
    const ir = nat.w / nat.h;
    const cr = cw / ch;
    let dw = cw;
    let dh = ch;
    let dx = 0;
    let dy = 0;
    if (ir > cr) {
      dw = cw;
      dh = cw / ir;
      dy = (ch - dh) / 2;
    } else {
      dh = ch;
      dw = ch * ir;
      dx = (cw - dw) / 2;
    }
    return { left: rect.left + dx, top: rect.top + dy, width: dw, height: dh };
  };

  const clientToNormalized = (clientX: number, clientY: number) => {
    const r = getDisplayedImageRect();
    if (!r) return null;
    const x = (clientX - r.left) / r.width;
    const y = (clientY - r.top) / r.height;
    const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
    return { x: clamp01(x), y: clamp01(y) };
  };

  const startSelection = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isSelecting) return;
    const pt = clientToNormalized(e.clientX, e.clientY);
    if (!pt) return;
    selectionStartRef.current = pt;
    setSelection({ x: pt.x, y: pt.y, w: 0, h: 0 });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const moveSelection = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = selectionStartRef.current;
    if (!isSelecting || !start) return;
    const pt = clientToNormalized(e.clientX, e.clientY);
    if (!pt) return;
    setSelection({
      x: Math.min(start.x, pt.x),
      y: Math.min(start.y, pt.y),
      w: Math.abs(pt.x - start.x),
      h: Math.abs(pt.y - start.y),
    });
  };

  const endSelection = () => {
    selectionStartRef.current = null;
    setSelection((prev) => {
      if (!prev) return prev;
      if (prev.w <= 0.01 || prev.h <= 0.01) return null;
      return prev;
    });
  };

  const openImageEditor = async () => {
    if (!scene?.image_url) return;
    setIsImageEditorOpen(true);
    setPreviewMode("current");
    if (imageHistory.length > 0) return;
    setIsPreparingEditor(true);
    try {
      const { dataUrl, byteSize } = await fetchImageAsDataUrl(scene.image_url);
      const nat = naturalSize ?? (imageRef.current ? { w: imageRef.current.naturalWidth, h: imageRef.current.naturalHeight } : null);
      if (nat) {
        const check = validateVeniceImageConstraints({ width: nat.w, height: nat.h, byteSize });
        if (check.ok === false) {
          toast({ title: "Image cannot be edited", description: check.reason, variant: "destructive" });
          setIsImageEditorOpen(false);
          return;
        }
      }
      setImageHistory([dataUrl]);
      setHistoryIndex(0);
    } catch (e) {
      toast({ title: "Failed to load image", description: e instanceof Error ? e.message : "Could not prepare editor", variant: "destructive" });
      setIsImageEditorOpen(false);
    } finally {
      setIsPreparingEditor(false);
    }
  };

  const closeImageEditor = () => {
    setIsImageEditorOpen(false);
    setIsSelecting(false);
    selectionStartRef.current = null;
    setSelection(null);
    setPreviewMode("current");
    setImageHistory([]);
    setHistoryIndex(0);
  };

  const undoEdit = () => {
    setHistoryIndex((idx) => Math.max(0, idx - 1));
    setPreviewMode("current");
  };

  const redoEdit = () => {
    setHistoryIndex((idx) => Math.min(imageHistory.length - 1, idx + 1));
    setPreviewMode("current");
  };

  const generatePreview = async () => {
    if (!scene?.id || !scene.image_url) return;
    const baseDataUrl = imageHistory[historyIndex];
    if (!baseDataUrl) return;

    const prompt = buildVeniceEditPrompt({
      tool: editTool,
      selection,
      freeform: inpaintText,
      objectToRemove: removeObjectText,
      colorTarget: colorTargetText,
      newColor: colorValueText,
      toneTarget: toneTargetText,
      brightness,
      contrast,
    });

    if (!prompt.trim()) {
      toast({ title: "Missing instructions", description: "Add edit instructions before previewing", variant: "destructive" });
      return;
    }

    const parsed = parseDataUrl(baseDataUrl);
    if (!parsed) {
      toast({ title: "Invalid image", description: "Could not prepare image for editing", variant: "destructive" });
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      toast({ title: "Sign in required", description: "Please sign in to edit images", variant: "destructive" });
      return;
    }

    setIsPreviewingEdit(true);
    try {
      const { data, error } = await supabase.functions.invoke("edit-scene-image", {
        body: { mode: "preview", prompt, image_base64: parsed.base64 },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) {
        toast({ title: "Edit failed", description: error.message || "Failed to preview edit", variant: "destructive" });
        return;
      }

      const resp = data as { edited_image_base64?: string; mime?: string; upstreamError?: string; error?: string } | null;
      if (!resp?.edited_image_base64 || !resp.mime) {
        toast({ title: "Edit failed", description: resp?.error || resp?.upstreamError || "Invalid edit response", variant: "destructive" });
        return;
      }

      const nextDataUrl = `data:${resp.mime};base64,${resp.edited_image_base64}`;
      setImageHistory((prev) => {
        const base = prev.slice(0, historyIndex + 1);
        return [...base, nextDataUrl];
      });
      setHistoryIndex((idx) => idx + 1);
      setPreviewMode("current");
    } catch (e) {
      toast({ title: "Edit failed", description: e instanceof Error ? e.message : "Failed to preview edit", variant: "destructive" });
    } finally {
      setIsPreviewingEdit(false);
    }
  };

  const applyEdit = async () => {
    if (!scene?.id) return;
    if (historyIndex === 0) return;
    const current = imageHistory[historyIndex];
    const parsed = current ? parseDataUrl(current) : null;
    if (!parsed) return;

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      toast({ title: "Sign in required", description: "Please sign in to edit images", variant: "destructive" });
      return;
    }

    setIsApplyingEdit(true);
    try {
      const originalParsed = imageHistory[0] ? parseDataUrl(imageHistory[0]) : null;
      const targetMime =
        normalizeImageMime(originalParsed?.mime ?? "") ??
        inferImageMimeFromUrl(scene.image_url) ??
        normalizeImageMime(parsed.mime) ??
        "image/png";

      const currentMime = normalizeImageMime(parsed.mime) ?? parsed.mime;
      let commitBase64 = parsed.base64;
      let commitMime = currentMime;

      if (targetMime && targetMime !== currentMime) {
        try {
          const encoded = await reencodeDataUrl({
            dataUrl: current,
            targetMime,
            width: naturalSize?.w,
            height: naturalSize?.h,
          });
          commitBase64 = encoded.base64;
          commitMime = encoded.mime;
        } catch (e) {
          console.warn("[SceneDetailModal] Failed to re-encode edited image:", e);
        }
      }

      console.log("[SceneDetailModal] Applying edit", {
        sceneId: scene.id,
        historyIndex,
        currentMime,
        targetMime,
        commitMime,
        byteLen: commitBase64.length,
      });

      const { data, error } = await supabase.functions.invoke("edit-scene-image", {
        body: { mode: "commit", sceneId: scene.id, edited_image_base64: commitBase64, edited_mime: commitMime },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) {
        toast({ title: "Apply failed", description: error.message || "Failed to apply edit", variant: "destructive" });
        return;
      }

      const resp = data as { imageUrl?: string; success?: boolean } | null;
      if (!resp?.imageUrl) {
        toast({ title: "Apply failed", description: "No image URL returned", variant: "destructive" });
        return;
      }

      onImageEdited?.(scene.id, resp.imageUrl);
      toast({ title: "Image updated", description: "Edits applied to the scene image" });
      closeImageEditor();
    } catch (e) {
      toast({ title: "Apply failed", description: e instanceof Error ? e.message : "Failed to apply edit", variant: "destructive" });
    } finally {
      setIsApplyingEdit(false);
    }
  };

  const characterStateHistory = useMemo(() => {
    if (!scene) return {};
    const list = (allScenes || []).slice().sort((a, b) => a.scene_number - b.scene_number);
    const currentIndex = list.findIndex((s) => s.id === scene.id);
    const prior = currentIndex >= 0 ? list.slice(0, currentIndex) : list.filter((s) => s.scene_number < scene.scene_number);
    const priorByScene = prior.map((s) => ({ scene: s, byName: parseSceneStatesByName(s) }));

    const names = scene.characters || [];
    const out: Record<
      string,
      {
        prev: { clothing: string; state: string; physical_attributes: string };
        curr: { clothing: string; state: string; physical_attributes: string };
        changed: { clothing: boolean; state: boolean; physical_attributes: boolean };
        timeline: Array<{ scene_number: number; clothing: string; state: string; physical_attributes: string }>;
      }
    > = {};

    const getPrev = (name: string) => {
      for (let i = priorByScene.length - 1; i >= 0; i -= 1) {
        const state = priorByScene[i].byName[name];
        if (!state) continue;
        const clothing = state.clothing || "";
        const st = state.state || "";
        const phys = state.physical_attributes || "";
        if (clothing || st || phys) return { clothing, state: st, physical_attributes: phys };
      }
      return { clothing: "", state: "", physical_attributes: "" };
    };

    names.forEach((name) => {
      const prev = getPrev(name);
      const currRaw = characterStatesDraft[name] ?? EMPTY_APPEARANCE_STATE;
      const curr = {
        clothing: normalizeField(currRaw.clothing || "", 400),
        state: normalizeField(currRaw.state || "", 400),
        physical_attributes: normalizeField(currRaw.physical_attributes || "", 600),
      };

      const timeline = [
        ...priorByScene
          .map(({ scene: s, byName }) => {
            const st = byName[name];
            if (!st) return null;
            const clothing = normalizeField(st.clothing || "", 400);
            const state = normalizeField(st.state || "", 400);
            const physical_attributes = normalizeField(st.physical_attributes || "", 600);
            if (!clothing && !state && !physical_attributes) return null;
            return { scene_number: s.scene_number, clothing, state, physical_attributes };
          })
          .filter(Boolean),
        { scene_number: scene.scene_number, ...curr },
      ] as Array<{ scene_number: number; clothing: string; state: string; physical_attributes: string }>;

      out[name] = {
        prev,
        curr,
        changed: {
          clothing: (prev.clothing || "") !== (curr.clothing || ""),
          state: (prev.state || "") !== (curr.state || ""),
          physical_attributes: (prev.physical_attributes || "") !== (curr.physical_attributes || ""),
        },
        timeline,
      };
    });

    return out;
  }, [allScenes, characterStatesDraft, scene]);

  const editorOriginal = imageHistory.length > 0 ? imageHistory[0] : null;
  const editorCurrent = imageHistory.length > 0 ? imageHistory[historyIndex] : null;
  const displayedImageSrc =
    !isImageEditorOpen
      ? scene?.image_url
      : (previewMode === "original" ? editorOriginal : editorCurrent) ?? editorOriginal ?? scene?.image_url;

  const selectionBoxStyle = useMemo(() => {
    if (!isImageEditorOpen || !selection || !naturalSize) return null;
    const container = imageContainerRef.current;
    if (!container) return null;

    const rect = container.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    if (cw <= 0 || ch <= 0) return null;

    const ir = naturalSize.w / naturalSize.h;
    const cr = cw / ch;
    let dw = cw;
    let dh = ch;
    let dx = 0;
    let dy = 0;
    if (ir > cr) {
      dw = cw;
      dh = cw / ir;
      dy = (ch - dh) / 2;
    } else {
      dh = ch;
      dw = ch * ir;
      dx = (cw - dw) / 2;
    }

    return {
      left: dx + selection.x * dw,
      top: dy + selection.y * dh,
      width: selection.w * dw,
      height: selection.h * dh,
    } as const;
  }, [isImageEditorOpen, selection, naturalSize]);

  if (!scene) return null;

  const activeReference = referenceImages.find((r) => r.id === activeReferenceId) ?? null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[95vw] sm:w-[90vw] max-w-[78.5rem] max-h-[95vh] min-h-[60vh] sm:min-h-[70vh] lg:min-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Badge className="bg-primary/20 text-primary">
              Scene {scene.scene_number}
            </Badge>
            <DialogTitle className="font-display text-xl">
              {scene.title || `Scene ${scene.scene_number}`}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="grid gap-6 mt-4">
          {/* Image Section */}
          <div className="relative aspect-video rounded-lg overflow-hidden bg-secondary">
            {displayedImageSrc ? (
              <div ref={imageContainerRef} className="absolute inset-0">
                <img
                  ref={imageRef}
                  src={displayedImageSrc}
                  alt={scene.title || `Scene ${scene.scene_number}`}
                  className="w-full h-full object-contain"
                  draggable={false}
                  onLoad={() => {
                    const img = imageRef.current;
                    if (!img || !img.naturalWidth || !img.naturalHeight) return;
                    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                  }}
                />
                {isImageEditorOpen && isSelecting && (
                  <div
                    className="absolute inset-0 z-10 cursor-crosshair"
                    onPointerDown={startSelection}
                    onPointerMove={moveSelection}
                    onPointerUp={endSelection}
                    onPointerCancel={endSelection}
                    onPointerLeave={endSelection}
                  />
                )}
                {isImageEditorOpen && selectionBoxStyle && (
                  <div
                    className="absolute z-20 rounded-sm border border-primary bg-primary/10"
                    style={selectionBoxStyle}
                  />
                )}

                {scene.image_url && (
                  <div className="absolute top-2 right-2 z-30 flex items-center gap-2">
                    {!isImageEditorOpen ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => void openImageEditor()}
                        disabled={isGenerating || isPreparingEditor}
                      >
                        {isPreparingEditor ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Edit3 className="w-4 h-4 mr-2" />}
                        Edit
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={closeImageEditor}
                        disabled={isPreviewingEdit || isApplyingEdit}
                      >
                        <X className="w-4 h-4 mr-2" />
                        Exit
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center">
                  <Wand2 className="w-12 h-12 text-muted-foreground/50 mx-auto mb-2" />
                  <p className="text-muted-foreground">No image generated yet</p>
                </div>
              </div>
            )}
            
            {isGenerating && (
              <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center">
                <div className="text-center">
                  <RefreshCw className="w-8 h-8 text-primary animate-spin mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Generating image...</p>
                </div>
              </div>
            )}

            {isPreparingEditor && !isGenerating && (
              <div className="absolute inset-0 bg-background/70 backdrop-blur-sm flex items-center justify-center">
                <div className="text-center">
                  <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Preparing editor...</p>
                </div>
              </div>
            )}
          </div>

          {isImageEditorOpen && (
            <div className="rounded-lg border border-border/60 bg-secondary/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    Image Editor
                  </Badge>
                  {selection ? (
                    <Badge variant="secondary" className="text-xs">
                      Selection {Math.round(selection.w * 100)}% × {Math.round(selection.h * 100)}%
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">
                      No selection
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={undoEdit}
                    disabled={historyIndex <= 0 || isPreviewingEdit || isApplyingEdit}
                  >
                    <Undo2 className="w-4 h-4 mr-2" />
                    Undo
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={redoEdit}
                    disabled={historyIndex >= imageHistory.length - 1 || isPreviewingEdit || isApplyingEdit}
                  >
                    <Redo2 className="w-4 h-4 mr-2" />
                    Redo
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setPreviewMode((p) => (p === "original" ? "current" : "original"))}
                    disabled={!editorOriginal}
                  >
                    {previewMode === "original" ? (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Original
                      </>
                    ) : (
                      <>
                        <Square className="w-4 h-4 mr-2" />
                        Original
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={isSelecting ? "secondary" : "outline"}
                    onClick={() => setIsSelecting((v) => !v)}
                    disabled={isPreviewingEdit || isApplyingEdit}
                  >
                    <Square className="w-4 h-4 mr-2" />
                    {isSelecting ? "Selecting" : "Select area"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setSelection(null)}
                    disabled={!selection || isPreviewingEdit || isApplyingEdit}
                  >
                    Clear selection
                  </Button>
                </div>
              </div>

              <div className="mt-4">
                <Tabs value={editTool} onValueChange={(v) => setEditTool(v as ImageEditTool)}>
                  <TabsList className="flex flex-wrap">
                    <TabsTrigger value="inpaint">Inpaint</TabsTrigger>
                    <TabsTrigger value="remove">Remove</TabsTrigger>
                    <TabsTrigger value="color">Color</TabsTrigger>
                    <TabsTrigger value="tone">Tone</TabsTrigger>
                  </TabsList>

                  <TabsContent value="inpaint" className="mt-4 space-y-2">
                    <Label className="text-sm">Inpaint instructions</Label>
                    <Textarea
                      value={inpaintText}
                      onChange={(e) => setInpaintText(e.target.value)}
                      placeholder="Describe what to add/change in the selected area"
                      className="min-h-[90px] resize-none"
                      disabled={isPreviewingEdit || isApplyingEdit}
                    />
                  </TabsContent>

                  <TabsContent value="remove" className="mt-4 space-y-2">
                    <Label className="text-sm">Object to remove</Label>
                    <Input
                      value={removeObjectText}
                      onChange={(e) => setRemoveObjectText(e.target.value)}
                      placeholder="e.g., sign, person, watermark"
                      disabled={isPreviewingEdit || isApplyingEdit}
                    />
                  </TabsContent>

                  <TabsContent value="color" className="mt-4 space-y-3">
                    <div className="grid gap-2">
                      <Label className="text-sm">Target</Label>
                      <Input
                        value={colorTargetText}
                        onChange={(e) => setColorTargetText(e.target.value)}
                        placeholder="e.g., jacket, sky, neon sign"
                        disabled={isPreviewingEdit || isApplyingEdit}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-sm">New color</Label>
                      <Input
                        value={colorValueText}
                        onChange={(e) => setColorValueText(e.target.value)}
                        placeholder="e.g., deep red, pastel blue"
                        disabled={isPreviewingEdit || isApplyingEdit}
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="tone" className="mt-4 space-y-4">
                    <div className="grid gap-2">
                      <Label className="text-sm">Target area (optional)</Label>
                      <Input
                        value={toneTargetText}
                        onChange={(e) => setToneTargetText(e.target.value)}
                        placeholder="e.g., foreground, subject face, background"
                        disabled={isPreviewingEdit || isApplyingEdit}
                      />
                    </div>

                    <div className="grid gap-2">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-sm">Brightness</Label>
                        <Badge variant="secondary" className="text-xs">
                          {brightness}
                        </Badge>
                      </div>
                      <Slider
                        value={[brightness]}
                        onValueChange={(v) => setBrightness(v[0] ?? 0)}
                        min={-100}
                        max={100}
                        step={1}
                        disabled={isPreviewingEdit || isApplyingEdit}
                      />
                    </div>

                    <div className="grid gap-2">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-sm">Contrast</Label>
                        <Badge variant="secondary" className="text-xs">
                          {contrast}
                        </Badge>
                      </div>
                      <Slider
                        value={[contrast]}
                        onValueChange={(v) => setContrast(v[0] ?? 0)}
                        min={-100}
                        max={100}
                        step={1}
                        disabled={isPreviewingEdit || isApplyingEdit}
                      />
                    </div>
                  </TabsContent>
                </Tabs>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeImageEditor}
                  disabled={isPreviewingEdit || isApplyingEdit}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void generatePreview()}
                  disabled={isPreviewingEdit || isApplyingEdit || isPreparingEditor}
                >
                  {isPreviewingEdit ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
                  Preview
                </Button>
                <Button
                  type="button"
                  variant="hero"
                  onClick={() => void applyEdit()}
                  disabled={historyIndex === 0 || isPreviewingEdit || isApplyingEdit}
                >
                  {isApplyingEdit ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                  Apply
                </Button>
              </div>
            </div>
          )}

          {/* Scene Details */}
          <div className="grid gap-4">
            <div>
              <Label className="text-muted-foreground text-sm">Summary</Label>
              <p className="text-foreground mt-1">{scene.summary}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {scene.emotional_tone && (
                <Badge variant="outline">{scene.emotional_tone}</Badge>
              )}
              {scene.setting && (
                <Badge variant="secondary">{scene.setting}</Badge>
              )}
              {scene.consistency_status && (
                <Badge
                  variant="outline"
                  className={
                    scene.consistency_status === "pass"
                      ? "border-green-500/50 text-green-600"
                      : scene.consistency_status === "warn"
                        ? "border-yellow-500/50 text-yellow-600"
                        : "border-red-500/50 text-red-600"
                  }
                >
                  Consistency{" "}
                  {typeof scene.consistency_score === "number"
                    ? Math.round(scene.consistency_score)
                    : "--"}{" "}
                  ({scene.consistency_status.toUpperCase()})
                </Badge>
              )}
              {scene.characters?.map((char) => (
                <Badge key={char} variant="secondary" className="bg-primary/10 text-primary">
                  {char}
                </Badge>
              ))}
            </div>

            {scene.characters && scene.characters.length > 0 && (
              <div className="space-y-2">
                <Label className="text-muted-foreground text-sm">Character Appearance (This Scene)</Label>
                <div className="grid gap-3">
                  {scene.characters.map((name) => (
                    <div key={name} className="rounded-lg border border-border/60 bg-secondary/20 p-3">
                      <div className="font-medium mb-2">{name}</div>
                      <div className="grid gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Clothing</Label>
                          <Textarea
                            value={characterStatesDraft[name]?.clothing || ""}
                            onChange={(e) => updateCharacterState(name, "clothing", e.target.value)}
                            className="min-h-[60px] resize-none"
                            placeholder="e.g., red cloak, leather boots"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">State / Condition</Label>
                          <Textarea
                            value={characterStatesDraft[name]?.state || ""}
                            onChange={(e) => updateCharacterState(name, "state", e.target.value)}
                            className="min-h-[50px] resize-none"
                            placeholder="e.g., muddy, injured arm, terrified, soaked"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Physical Details (Optional)</Label>
                          <Textarea
                            value={characterStatesDraft[name]?.physical_attributes || ""}
                            onChange={(e) => updateCharacterState(name, "physical_attributes", e.target.value)}
                            className="min-h-[50px] resize-none"
                            placeholder="e.g., hair wet and messy, fresh bruise on cheek"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {scene.characters && scene.characters.length > 0 && (allScenes?.length || 0) > 1 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-muted-foreground text-sm">Character State History (Diff)</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const payload = {
                          scene_number: scene.scene_number,
                          scene_id: scene.id,
                          characters: Object.fromEntries(
                            (scene.characters || []).map((name) => [
                              name,
                              {
                                prev: characterStateHistory[name]?.prev,
                                curr: characterStateHistory[name]?.curr,
                                changed: characterStateHistory[name]?.changed,
                              },
                            ]),
                          ),
                        };
                        void copyText("Character state diff", JSON.stringify(payload, null, 2));
                      }}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Diff
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const payload = {
                          scene_number: scene.scene_number,
                          scene_id: scene.id,
                          characters: Object.fromEntries(
                            (scene.characters || []).map((name) => [name, characterStateHistory[name]?.timeline || []]),
                          ),
                        };
                        void copyText("Character state timeline", JSON.stringify(payload, null, 2));
                      }}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Timeline
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const payload = {
                          scene_number: scene.scene_number,
                          scene_id: scene.id,
                          characters: Object.fromEntries(
                            (scene.characters || []).map((name) => [name, characterStateHistory[name]?.timeline || []]),
                          ),
                        };
                        downloadJson(`scene-${scene.scene_number}-character-states.json`, payload);
                      }}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3">
                  {(scene.characters || []).map((name) => {
                    const entry = characterStateHistory[name];
                    if (!entry) return null;

                    const rowClass = (changed: boolean) =>
                      changed ? "rounded-md border border-yellow-500/30 bg-yellow-500/5 p-2" : "rounded-md border border-border/60 bg-secondary/20 p-2";

                    return (
                      <div key={name} className="rounded-lg border border-border/60 bg-secondary/10 p-3">
                        <div className="font-medium mb-2">{name}</div>
                        <div className="grid gap-2">
                          <div className={rowClass(entry.changed.clothing)}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs text-muted-foreground">Clothing</div>
                              {entry.changed.clothing && (
                                <Badge variant="outline" className="text-xs border-yellow-500/50 text-yellow-600">
                                  changed
                                </Badge>
                              )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 text-sm">
                              <div>
                                <div className="text-[10px] text-muted-foreground">Previous</div>
                                <div className="whitespace-pre-wrap break-words">{entry.prev.clothing || "—"}</div>
                              </div>
                              <div>
                                <div className="text-[10px] text-muted-foreground">This scene</div>
                                <div className="whitespace-pre-wrap break-words">{entry.curr.clothing || "—"}</div>
                              </div>
                            </div>
                          </div>

                          <div className={rowClass(entry.changed.state)}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs text-muted-foreground">State / Condition</div>
                              {entry.changed.state && (
                                <Badge variant="outline" className="text-xs border-yellow-500/50 text-yellow-600">
                                  changed
                                </Badge>
                              )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 text-sm">
                              <div>
                                <div className="text-[10px] text-muted-foreground">Previous</div>
                                <div className="whitespace-pre-wrap break-words">{entry.prev.state || "—"}</div>
                              </div>
                              <div>
                                <div className="text-[10px] text-muted-foreground">This scene</div>
                                <div className="whitespace-pre-wrap break-words">{entry.curr.state || "—"}</div>
                              </div>
                            </div>
                          </div>

                          <div className={rowClass(entry.changed.physical_attributes)}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs text-muted-foreground">Physical Details</div>
                              {entry.changed.physical_attributes && (
                                <Badge variant="outline" className="text-xs border-yellow-500/50 text-yellow-600">
                                  changed
                                </Badge>
                              )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 text-sm">
                              <div>
                                <div className="text-[10px] text-muted-foreground">Previous</div>
                                <div className="whitespace-pre-wrap break-words">{entry.prev.physical_attributes || "—"}</div>
                              </div>
                              <div>
                                <div className="text-[10px] text-muted-foreground">This scene</div>
                                <div className="whitespace-pre-wrap break-words">{entry.curr.physical_attributes || "—"}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {scene.consistency_details && scene.consistency_status && (
              <div className="space-y-2">
                <Label className="text-muted-foreground text-sm">Consistency Details</Label>
                <Textarea
                  readOnly
                  value={JSON.stringify(scene.consistency_details, null, 2)}
                  className="min-h-[140px] resize-none font-mono text-xs"
                />
              </div>
            )}

            <div className="border-t pt-4 mt-2">
              <div className="scene-debug-panel rounded-lg border border-border/60 bg-secondary/10">
                <button
                  type="button"
                  className="scene-debug-toggle w-full flex items-center justify-between gap-3 px-3 py-2 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-expanded={isDebugExpanded}
                  aria-controls={`scene-debug-panel-${scene.id}`}
                  onClick={() => setIsDebugExpanded((v) => !v)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-muted-foreground">Debug Info</span>
                    {debug.timestamp && (
                      <Badge variant="outline" className="text-xs font-mono">
                        {debug.timestamp.toLocaleTimeString()}
                      </Badge>
                    )}
                  </div>
                  <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", isDebugExpanded && "rotate-180")} />
                </button>

                <div
                  id={`scene-debug-panel-${scene.id}`}
                  className={cn(
                    "grid transition-[grid-template-rows] duration-300 ease-in-out",
                    isDebugExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
                  <div className="overflow-hidden px-3 pb-3">
                    <div className={cn("space-y-3 pt-1 transition-opacity duration-200", isDebugExpanded ? "opacity-100" : "opacity-0")}>
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={scene.generation_status === "error" ? "destructive" : "secondary"}>
                            Status: {scene.generation_status}
                          </Badge>
                          {debug.status !== undefined && (
                            <Badge variant="outline" className="text-xs font-mono">
                              HTTP {debug.status}
                              {debug.statusText ? ` ${debug.statusText}` : ""}
                            </Badge>
                          )}
                          {debug.stage && (
                            <Badge variant="outline" className="text-xs font-mono">
                              stage={debug.stage}
                            </Badge>
                          )}
                          {debug.requestId && (
                            <Badge variant="outline" className="text-xs font-mono">
                              requestId={debug.requestId}
                            </Badge>
                          )}
                          {debug.size !== undefined && (
                            <Badge variant="outline" className="text-xs font-mono">
                              size={debug.size}
                            </Badge>
                          )}
                          {debug.headers?.["content-type"] && (
                            <Badge variant="outline" className="text-xs font-mono">
                              content-type={debug.headers["content-type"]}
                            </Badge>
                          )}
                          {debug.headers?.["content-length"] && (
                            <Badge variant="outline" className="text-xs font-mono">
                              content-length={debug.headers["content-length"]}
                            </Badge>
                          )}
                          {debug.headers?.["x-venice-is-content-violation"] && (
                            <Badge
                              variant={
                                String(debug.headers["x-venice-is-content-violation"]).toLowerCase() === "true"
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              Content Violation: {debug.headers["x-venice-is-content-violation"]}
                            </Badge>
                          )}
                          {debug.headers?.["x-venice-contains-minor"] && (
                            <Badge
                              variant={
                                String(debug.headers["x-venice-contains-minor"]).toLowerCase() === "true"
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              Contains Minor: {debug.headers["x-venice-contains-minor"]}
                            </Badge>
                          )}
                        </div>

                        {detailedError && (
                          <div className={`rounded-md p-3 text-sm border ${
                            detailedError.category === 'validation' || detailedError.category === 'authentication' 
                              ? 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400' 
                              : 'bg-secondary/50 border-border'
                          }`}>
                            <div className="flex items-center gap-2 font-semibold mb-1">
                              <span>{detailedError.title}</span>
                              {detailedError.code && (
                                <Badge variant="outline" className="font-mono text-[10px] h-5">
                                  {detailedError.code}
                                </Badge>
                              )}
                            </div>
                            <p className="mb-2">{detailedError.description}</p>
                            
                            {detailedError.violationHeaders && detailedError.violationHeaders.length > 0 && (
                              <div className="mt-3 mb-2 bg-red-500/20 border border-red-500/30 rounded p-2">
                                <div className="text-xs font-bold text-red-600 dark:text-red-400 mb-1 uppercase tracking-wider">
                                  Relevant Error Headers
                                </div>
                                <ul className="list-disc list-inside text-xs font-mono text-red-700 dark:text-red-300">
                                  {detailedError.violationHeaders.map((header) => (
                                    <li key={header}>{header}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {detailedError.failureReason && (
                               <div className="mt-2 text-xs">
                                 <span className="font-semibold">Reason: </span>
                                 <span className="font-mono">{detailedError.failureReason}</span>
                               </div>
                            )}
                            
                            {detailedError.technicalDetails && (
                               <div className="mt-2 text-xs opacity-80">
                                 <span className="font-semibold">Technical: </span>
                                 <span className="font-mono break-all whitespace-pre-wrap">{detailedError.technicalDetails}</span>
                               </div>
                            )}
                          </div>
                        )}
                        
                        {requestParams && (
                          <div className="bg-secondary/30 rounded-md p-2 text-xs mt-2">
                             <div className="font-semibold mb-1">Request Parameters</div>
                             <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
                                {Object.entries(requestParams).map(([k, v]) => (
                                   <div key={k} className="flex justify-between border-b border-border/50 last:border-0 py-0.5">
                                      <span className="opacity-70">{k}:</span>
                                      <span>{String(v)}</span>
                                   </div>
                                ))}
                             </div>
                          </div>
                        )}

                        {!detailedError && debug.error && (
                          <div className="bg-secondary/50 rounded-md p-2 text-xs">
                            <div className="font-semibold">Failure Reason</div>
                            <div className="font-mono break-words">{debug.error}</div>
                          </div>
                        )}

                        {!detailedError && debug.upstreamError && (
                          <div className="bg-secondary/50 rounded-md p-2 text-xs">
                            <div className="font-semibold">Upstream Diagnostic</div>
                            <div className="font-mono break-words whitespace-pre-wrap">{debug.upstreamError}</div>
                          </div>
                        )}

                        {Array.isArray(debug.redactedHeaders) && debug.redactedHeaders.length > 0 && (
                          <div className="bg-secondary/50 rounded-md p-2 text-xs">
                            <div className="font-semibold">Redacted Headers</div>
                            <div className="font-mono break-words">{debug.redactedHeaders.join(", ")}</div>
                          </div>
                        )}

                        {debug.suggestion && (
                          <div className="bg-secondary/50 rounded-md p-2 text-xs">
                            <div className="font-semibold">Suggestion</div>
                            <div className="break-words">{debug.suggestion}</div>
                          </div>
                        )}

                        <div className="bg-secondary/50 rounded-md p-2 text-xs font-mono overflow-auto max-h-[300px]">
                          <pre>
                            {`[DEBUG] Image Generation Failure Headers:
${Object.entries(debug.headers ?? {})
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}
${debug.reasons && debug.reasons.length > 0 ? `\n[DEBUG] Failure Reasons:\n${debug.reasons.map(r => `- ${r}`).join("\n")}` : ""}
${debug.upstreamError ? `\n[DEBUG] Upstream Diagnostic:\n${debug.upstreamError}` : ""}
[Timestamp: ${debug.timestamp?.toISOString() ?? "N/A"}]`}
                          </pre>
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
              </div>
            </div>

          <div className="rounded-lg border border-border/60 bg-secondary/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  Reference Images
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {referenceImages.filter((r) => r.selected && r.status === "ready").length} selected
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={referenceFileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) void handleReferenceFiles(files);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => referenceFileInputRef.current?.click()}
                  disabled={isGenerating}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload
                </Button>
              </div>
            </div>

            <div
              className={cn(
                "mt-3 rounded-md border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground",
                isReferenceDragging && "border-primary/50 bg-primary/5",
              )}
              role="button"
              tabIndex={0}
              onClick={() => referenceFileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") referenceFileInputRef.current?.click();
              }}
              onDragEnter={handleReferenceDrag}
              onDragOver={handleReferenceDrag}
              onDragLeave={handleReferenceDrag}
              onDrop={handleReferenceDrop}
            >
              Drag & drop JPG/PNG/WEBP (max 5MB)
            </div>

            {referenceImages.length > 0 && (
              <div className="mt-4 grid gap-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {referenceImages.map((item) => {
                    const thumb = item.thumbUrl || item.localThumbUrl || item.url;
                    const isActive = item.id === activeReferenceId;
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          "rounded-md border bg-background/40 p-2",
                          isActive ? "border-primary/50" : "border-border/60",
                        )}
                        role="button"
                        tabIndex={0}
                        onClick={() => setActiveReferenceId(item.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") setActiveReferenceId(item.id);
                        }}
                      >
                        <div className="relative overflow-hidden rounded-sm bg-secondary/40 aspect-square">
                          {thumb ? (
                            <img
                              src={thumb}
                              alt={item.fileName}
                              className="absolute inset-0 h-full w-full object-cover"
                              loading="lazy"
                              draggable={false}
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                              No preview
                            </div>
                          )}
                          <div className="absolute top-1 left-1 flex items-center gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant={item.selected ? "secondary" : "outline"}
                              className="h-7 w-7"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleReferenceSelected(item.id);
                              }}
                              disabled={isGenerating}
                            >
                              {item.selected ? <Check className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                            </Button>
                          </div>
                          <div className="absolute top-1 right-1 flex items-center gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="h-7 w-7"
                              onClick={(e) => {
                                e.stopPropagation();
                                void (async () => {
                                  try {
                                    if (item.status === "ready" && item.objectPath) await deleteReferenceOnServer(item);
                                  } catch {
                                    toast({ title: "Delete failed", description: item.fileName, variant: "destructive" });
                                  } finally {
                                    removeReferenceLocal(item.id);
                                  }
                                })();
                              }}
                              disabled={isGenerating}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="mt-2 grid gap-1">
                          <div className="text-xs font-medium truncate">{item.fileName}</div>
                          {item.status === "uploading" && (
                            <div className="grid gap-1">
                              <Progress value={item.progress} />
                              <div className="text-[10px] text-muted-foreground">{item.progress}%</div>
                            </div>
                          )}
                          {item.status === "error" && (
                            <div className="text-[10px] text-destructive truncate">{item.error || "Upload failed"}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {activeReference && (activeReference.url || activeReference.localThumbUrl || activeReference.thumbUrl) && (
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium truncate">{activeReference.fileName}</div>
                      <div className="flex items-center gap-2">
                        <Button type="button" size="icon" variant="outline" onClick={() => zoomReference(activeReference.id, 0.25)}>
                          <ZoomIn className="w-4 h-4" />
                        </Button>
                        <Button type="button" size="icon" variant="outline" onClick={() => zoomReference(activeReference.id, -0.25)}>
                          <ZoomOut className="w-4 h-4" />
                        </Button>
                        <Button type="button" size="icon" variant="outline" onClick={() => resetReferenceTransform(activeReference.id)}>
                          <RotateCcw className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    <div
                      className="relative mx-auto h-[320px] w-full max-w-[512px] overflow-hidden rounded-md border border-border/60 bg-secondary/20 touch-none sm:h-[512px]"
                      aria-label="Reference image preview"
                      onPointerDown={(e) => onReferencePointerDown(e, activeReference.id)}
                      onPointerMove={(e) => onReferencePointerMove(e, activeReference.id)}
                      onPointerUp={onReferencePointerUp}
                      onPointerCancel={onReferencePointerUp}
                      onWheel={(e) => onReferenceWheel(e, activeReference.id)}
                    >
                      <img
                        src={activeReference.url || activeReference.localThumbUrl || activeReference.thumbUrl}
                        alt={activeReference.fileName}
                        className="absolute inset-0 h-full w-full object-contain"
                        style={{
                          transform: `translate(${activeReference.panX}px, ${activeReference.panY}px) scale(${activeReference.zoom})`,
                          transformOrigin: "center center",
                        }}
                        draggable={false}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Editable Prompt */}
          <div className="space-y-2">
            <Tabs value={promptEditorMode} onValueChange={(v) => setPromptEditorMode(v === "full" ? "full" : "base")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="base">Image Prompt</TabsTrigger>
                <TabsTrigger value="full" disabled={!onFetchFullPrompt}>
                  Full Scene Prompt
                </TabsTrigger>
              </TabsList>

              <TabsContent value="base" className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="prompt" className="text-sm font-medium">
                      Image Prompt
                    </Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleUpdatePromptWithCharacterStates()}
                      disabled={!scene || isUpdatingPrompt}
                    >
                      {isUpdatingPrompt ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Wand2 className="w-4 h-4 mr-2" />
                      )}
                      {isUpdatingPrompt ? "Updating..." : "Update"}
                    </Button>
                  </div>
                  {(hasChanges || hasCharacterStateChanges) && (
                    <Badge variant="outline" className="text-yellow-500 border-yellow-500/50">
                      Unsaved changes
                    </Badge>
                  )}
                </div>
                <Textarea
                  id="prompt"
                  value={editedPrompt}
                  onChange={(e) => handlePromptChange(e.target.value)}
                  placeholder="Enter the prompt used to generate this scene's image..."
                  className="min-h-[120px] resize-none"
                  maxLength={PROMPT_CHAR_LIMIT}
                />
                <div className="flex justify-end text-xs text-muted-foreground">
                  {editedPrompt.length}/{PROMPT_CHAR_LIMIT}
                </div>
              </TabsContent>

              <TabsContent value="full" className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="full-prompt" className="text-sm font-medium">
                      Full Scene Prompt
                    </Label>
                    {fullPromptOverride && (
                      <Badge variant="outline" className="text-green-600 border-green-600/40">
                        Override active
                      </Badge>
                    )}
                    {fullPromptHasChanges && (
                      <Badge variant="outline" className="text-yellow-500 border-yellow-500/50">
                        Unsaved changes
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void loadFullPrompt()}
                      disabled={!scene || isLoadingFullPrompt}
                    >
                      {isLoadingFullPrompt ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                      {isLoadingFullPrompt ? "Loading..." : "Load"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const toCopy = fullPromptEdited || fullPromptOriginal;
                        if (!toCopy.trim()) return;
                        void navigator.clipboard.writeText(toCopy);
                        toast({ title: "Copied", description: "Full scene prompt copied to clipboard." });
                      }}
                      disabled={!(fullPromptEdited || fullPromptOriginal).trim()}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        downloadJson(`scene-${scene?.scene_number ?? "prompt"}-full-prompt.json`, {
                          promptFull: fullPromptEdited || fullPromptOriginal,
                          model: fullPromptMeta?.model,
                          maxLength: fullPromptMeta?.maxLength,
                          promptHash: fullPromptMeta?.promptHash,
                          truncated: fullPromptMeta?.truncated,
                          missingSubjects: fullPromptMeta?.missingSubjects,
                          preprocessingSteps: fullPromptMeta?.preprocessingSteps,
                          warnings: fullPromptMeta?.warnings,
                          parts: fullPromptMeta?.parts,
                          requestId: fullPromptMeta?.requestId,
                        })
                      }
                      disabled={!(fullPromptEdited || fullPromptOriginal).trim()}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download
                    </Button>
                  </div>
                </div>

                {(fullPromptMeta?.model || typeof fullPromptMeta?.maxLength === "number" || fullPromptMeta?.promptHash) && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {fullPromptMeta?.model && <Badge variant="secondary">Model: {fullPromptMeta.model}</Badge>}
                    {typeof fullPromptMeta?.maxLength === "number" && <Badge variant="secondary">Max: {fullPromptMeta.maxLength}</Badge>}
                    {fullPromptMeta?.truncated && <Badge variant="secondary">Truncated</Badge>}
                    {Array.isArray(fullPromptMeta?.missingSubjects) && fullPromptMeta.missingSubjects.length > 0 && (
                      <Badge variant="secondary">Missing: {fullPromptMeta.missingSubjects.length}</Badge>
                    )}
                    {fullPromptMeta?.promptHash && <Badge variant="secondary">Hash: {fullPromptMeta.promptHash.slice(0, 10)}</Badge>}
                  </div>
                )}

                {fullPromptError && <div className="text-xs text-destructive">{fullPromptError}</div>}

                <Textarea
                  id="full-prompt"
                  value={fullPromptEdited}
                  onChange={(e) => {
                    const next = e.target.value;
                    setFullPromptEdited(next);
                    setFullPromptOverride(null);
                    setFullPromptHasChanges(next !== fullPromptOriginal);
                  }}
                  placeholder="Load the fully composed prompt, then edit it before generation..."
                  className="min-h-[160px] resize-y"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground">
                    {(fullPromptEdited || "").length}
                    {typeof fullPromptMeta?.maxLength === "number" ? `/${fullPromptMeta.maxLength}` : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => resetFullPromptEditor("keep_tab")}
                      disabled={!fullPromptOriginal.trim()}
                    >
                      Reset
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => resetFullPromptEditor("switch_to_base")}
                      disabled={!fullPromptOriginal.trim() && !fullPromptEdited.trim() && !fullPromptOverride}
                    >
                      Cancel
                    </Button>
                    <Button type="button" size="sm" variant="hero" onClick={saveFullPromptOverride} disabled={!fullPromptEdited.trim()}>
                      Save
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {onReportStyleMismatch && (
            <div className="space-y-2">
              <Label htmlFor="style-feedback" className="text-sm font-medium">
                Style Feedback
              </Label>
              <Textarea
                id="style-feedback"
                value={styleFeedback}
                onChange={(e) => setStyleFeedback(e.target.value)}
                placeholder="Describe what looks off about the style (palette, brushwork, composition, etc.)"
                className="min-h-[90px] resize-none"
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose}>
              <X className="w-4 h-4 mr-2" />
              Close
            </Button>
            {onReportStyleMismatch && (
              <Button
                variant="outline"
                onClick={handleSubmitStyleMismatch}
                disabled={isSubmittingFeedback || styleFeedback.trim().length === 0}
              >
                {isSubmittingFeedback ? "Submitting..." : "Report Style Mismatch"}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={handleSave}
              disabled={(!hasChanges && !hasCharacterStateChanges) || isSaving}
            >
              <Save className="w-4 h-4 mr-2" />
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
            {onRegenerateStrictStyle && (
              <Button
                variant="outline"
                onClick={handleRegenerateStrictStyle}
                disabled={isGenerating}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isGenerating ? "animate-spin" : ""}`} />
                {isGenerating ? "Generating..." : "Regenerate (Strict Style)"}
              </Button>
            )}
            <Button
              variant="hero"
              onClick={handleRegenerate}
              disabled={isGenerating}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isGenerating ? "animate-spin" : ""}`} />
              {isGenerating ? "Generating..." : "Regenerate Image"}
            </Button>
          </div>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
