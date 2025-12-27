import { useMemo, useState, useEffect } from "react";
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
import { Save, X, RefreshCw, Wand2, AlertTriangle, Copy, Download } from "lucide-react";
import { Scene } from "@/hooks/useStories";
import { extractDetailedError, DetailedError } from "@/lib/error-reporting";
import { useToast } from "@/hooks/use-toast";

interface SceneDetailModalProps {
  scene: Scene | null;
  allScenes?: Scene[];
  isOpen: boolean;
  onClose: () => void;
  onSavePrompt: (sceneId: string, newPrompt: string) => Promise<void>;
  onSaveCharacterStates?: (sceneId: string, characterStates: Record<string, unknown>) => Promise<void>;
  onRegenerate: (sceneId: string) => Promise<void>;
  onRegenerateStrictStyle?: (sceneId: string) => Promise<void>;
  onReportStyleMismatch?: (sceneId: string, message: string) => Promise<void>;
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
  };
}

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

const safeDate = (val: unknown): Date | undefined => {
  if (val instanceof Date) return !isNaN(val.getTime()) ? val : undefined;
  if (typeof val === "string") {
    const d = new Date(val);
    return !isNaN(d.getTime()) ? d : undefined;
  }
  return undefined;
};

export function SceneDetailModal({
  scene,
  allScenes,
  isOpen,
  onClose,
  onSavePrompt,
  onSaveCharacterStates,
  onRegenerate,
  onRegenerateStrictStyle,
  onReportStyleMismatch,
  isGenerating = false,
  debugInfo,
}: SceneDetailModalProps) {
  const { toast } = useToast();
  const [editedPrompt, setEditedPrompt] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [styleFeedback, setStyleFeedback] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [characterStatesDraft, setCharacterStatesDraft] = useState<Record<string, Record<string, string>>>({});
  const [originalCharacterStates, setOriginalCharacterStates] = useState<Record<string, Record<string, string>>>({});
  const [hasCharacterStateChanges, setHasCharacterStateChanges] = useState(false);

  useEffect(() => {
    if (scene) {
      setEditedPrompt(scene.image_prompt || "");
      setHasChanges(false);
      setStyleFeedback("");

      const raw = scene.character_states;
      const rawObj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      const next: Record<string, Record<string, string>> = {};

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

      setCharacterStatesDraft(next);
      setOriginalCharacterStates(next);
      setHasCharacterStateChanges(false);
    }
  }, [scene]);

  const handlePromptChange = (value: string) => {
    setEditedPrompt(value);
    setHasChanges(value !== (scene?.image_prompt || ""));
  };

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
        const normalizedDraft: Record<string, Record<string, string>> = {};
        for (const [name, state] of Object.entries(characterStatesDraft)) {
          const clothing = normalizeField(state.clothing || "", 400);
          const condition = normalizeField(state.state || "", 400);
          const physicalAttributes = normalizeField(state.physical_attributes || "", 600);

          normalizedDraft[name] = {
            clothing,
            state: condition,
            physical_attributes: physicalAttributes,
          };

          const nextState: Record<string, string> = {};
          if (clothing) nextState.clothing = clothing;
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
    
    if (hasChanges || hasCharacterStateChanges) {
      await handleSave();
    }
    
    await onRegenerate(scene.id);
  };

  const handleRegenerateStrictStyle = async () => {
    if (!scene || !onRegenerateStrictStyle) return;

    if (hasChanges || hasCharacterStateChanges) {
      await handleSave();
    }

    await onRegenerateStrictStyle(scene.id);
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

  const persistedDetails = isPlainObject(scene?.consistency_details) ? scene.consistency_details : null;
  const persistedDebugRaw = isPlainObject(persistedDetails?.generation_debug) ? persistedDetails.generation_debug : null;

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
    prompt:
      (debugInfo && 'prompt' in debugInfo && typeof debugInfo.prompt === "string" ? debugInfo.prompt : undefined) ??
      (typeof persistedDebugRaw?.prompt === "string" ? persistedDebugRaw.prompt : undefined) ??
      (typeof persistedDebugRaw?.prompt_used === "string" ? persistedDebugRaw.prompt_used : undefined) ??
      (typeof persistedDetails?.prompt === "string" ? persistedDetails.prompt : undefined),
  };

  const [failedPromptEdit, setFailedPromptEdit] = useState("");
  
  useEffect(() => {
    if (debug.prompt) {
      setFailedPromptEdit(debug.prompt);
    }
  }, [debug.prompt]);

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

  const handleApplyFailedPrompt = () => {
    setEditedPrompt(failedPromptEdit);
    setHasChanges(true);
    toast({
      title: "Prompt Updated",
      description: "The failed system prompt has been copied to the editor. Review and modify it, then save and retry.",
    });
  };

  const updateCharacterState = (name: string, key: string, value: string) => {
    setCharacterStatesDraft((prev) => {
      const next = {
        ...prev,
        [name]: {
          ...(prev[name] || {}),
          [key]: value,
        },
      };

      const names = scene?.characters || [];
      const changed = names.some((n) => {
        const curr = next[n] || {};
        const orig = originalCharacterStates[n] || {};
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
      const currRaw = characterStatesDraft[name] || {};
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

  if (!scene) return null;

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
            {scene.image_url ? (
              <img
                src={scene.image_url}
                alt={scene.title || `Scene ${scene.scene_number}`}
                className="w-full h-full object-contain"
              />
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
          </div>

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

            {/* Debug Information */}
            <div className="space-y-2 border-t pt-4 mt-2">
              <Label className="text-muted-foreground text-sm flex items-center gap-2">
                Debug Information
                {debug.timestamp && (
                  <Badge variant="outline" className="text-xs font-mono">
                    {debug.timestamp.toLocaleTimeString()}
                  </Badge>
                )}
              </Label>

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

                {/* Legacy debug info fallback */}
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

          {/* Failed Prompt View */}
          {debug.prompt && (
            <div className="space-y-2 border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-900/10 rounded-md p-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-2 text-red-700 dark:text-red-400">
                  <AlertTriangle className="w-4 h-4" />
                  Failed System Prompt
                </Label>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleApplyFailedPrompt}>
                  Copy to Editor
                </Button>
              </div>
              <Textarea
                value={failedPromptEdit}
                onChange={(e) => setFailedPromptEdit(e.target.value)}
                className="min-h-[100px] resize-none font-mono text-xs bg-transparent border-red-200 dark:border-red-900/30 focus-visible:ring-red-500"
              />
              <p className="text-[10px] text-muted-foreground">
                This is the exact prompt sent to the model that caused the failure. You can edit it here or copy it to the main editor below.
              </p>
            </div>
          )}

          {/* Editable Prompt */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="prompt" className="text-sm font-medium">
                Image Prompt
              </Label>
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
            />
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
      </DialogContent>
    </Dialog>
  );
}
