import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { StyleSelector } from "@/components/storyboard/StyleSelector";
import { ModelSelector } from "@/components/storyboard/ModelSelector";
import { imageModels } from "@/components/storyboard/model-data";
import { SceneDetailModal } from "@/components/storyboard/SceneDetailModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Download,
  Play,
  Wand2,
  ChevronDown,
  BookOpen,
  Loader2,
  RefreshCw,
  Image as ImageIcon,
  FileText,
  FolderArchive,
  Printer,
  Trash2,
  Square
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useScenes, useStories, Scene, Story } from "@/hooks/useStories";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import type { Json } from "@/integrations/supabase/types";
import { buildAnchoredStoryHtmlDocument, buildStoryHtmlDocument, validateStoryHtmlDocument, validateStoryHtmlSceneCoverage } from "@/lib/story-html";
import { StorySceneDragDropEditor, type StorySceneAnchors } from "@/components/storyboard/StorySceneDragDropEditor";

import { validateGeneratedImage } from "@/lib/image-validation";
import { reconcileFailedGenerationCredits } from "@/lib/credit-reconciliation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CharacterList } from "@/components/storyboard/CharacterList";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Storyboard() {
  const { storyId } = useParams();
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const { stories, deleteStory, updateStory, fetchStories } = useStories();
  const { scenes, loading: scenesLoading, fetchScenes, setScenes, updateScene, stopAllGeneration } = useScenes(storyId || null);
  const { toast } = useToast();

  type BatchMode = "generate" | "regenerate";

  const [story, setStory] = useState<Story | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingSceneId, setGeneratingSceneId] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState("cinematic");
  const [selectedModel, setSelectedModel] = useState("venice-sd35");
  const [selectedResolution, setSelectedResolution] = useState<{ width: number, height: number } | undefined>(undefined);
  const [styleIntensity, setStyleIntensity] = useState(70);
  const [characterIdentityLock, setCharacterIdentityLock] = useState(true);
  const [characterAnchorStrength, setCharacterAnchorStrength] = useState(70);
  const [consistencyMode, setConsistencyMode] = useState<"strict" | "balanced" | "flexible">("strict");
  const [autoCorrectEnabled, setAutoCorrectEnabled] = useState(false);
  const [characterImageReferenceEnabled, setCharacterImageReferenceEnabled] = useState(false);
  const [disabledStyleElementsByStyle, setDisabledStyleElementsByStyle] = useState<Record<string, string[]>>({});
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isStoryModalOpen, setIsStoryModalOpen] = useState(false);
  const [isStoryOpening, setIsStoryOpening] = useState(false);
  const [isStoryPrinting, setIsStoryPrinting] = useState(false);
  const [storyToDelete, setStoryToDelete] = useState<Story | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState("scenes");
  const [batchSceneIds, setBatchSceneIds] = useState<string[]>([]);
  const [batchMode, setBatchMode] = useState<BatchMode>("generate");
  const [isRegenerateAllDialogOpen, setIsRegenerateAllDialogOpen] = useState(false);
  const generateAllLockRef = useRef(false);
  const storyPrintResetTimerRef = useRef<number | null>(null);
  const selectedStyleRef = useRef(selectedStyle);
  const styleIntensityRef = useRef(styleIntensity);
  const consistencyModeRef = useRef(consistencyMode);
  const lastSyncedStoryIdRef = useRef<string | null>(null);
  const localStyleOverrideRef = useRef<{ storyId: string; styleId: string } | null>(null);
  const localModelOverrideRef = useRef<{ storyId: string; modelId: string } | null>(null);
  type SceneGenerationDebugInfo = {
    timestamp: Date;
    headers?: Record<string, string>;
    redactedHeaders?: string[];
    warnings?: string[];
    requestId?: string;
    stage?: string;
    error?: string;
    suggestion?: string;
    size?: number;
    status?: number;
    statusText?: string;
    reasons?: string[];
    upstreamError?: string;
    model?: string;
    modelConfig?: unknown;
    preprocessingSteps?: string[];
    prompt?: string;
    promptFull?: string;
    promptHash?: string;
    requestParams?: {
      model?: string;
      artStyle?: string;
      styleIntensity?: number;
      strictStyle?: boolean;
      characterImageReference?: boolean;
      disabledStyleElements?: string[];
      styleGuideId?: string;
      styleGuideVersion?: number;
      styleGuideStatus?: string;
    };
  };

  const [debugInfo, setDebugInfo] = useState<Record<string, SceneGenerationDebugInfo>>({});

  const batchSceneIdSet = useMemo(() => new Set(batchSceneIds), [batchSceneIds]);
  const batchDoneCount = useMemo(() => {
    if (batchSceneIds.length === 0) return 0;
    return scenes.reduce((acc, s) => {
      if (!batchSceneIdSet.has(s.id)) return acc;
      if (s.generation_status === "completed" || s.generation_status === "error") return acc + 1;
      return acc;
    }, 0);
  }, [batchSceneIds.length, batchSceneIdSet, scenes]);

  const batchFailedCount = useMemo(() => {
    if (batchSceneIds.length === 0) return 0;
    return scenes.reduce((acc, s) => {
      if (!batchSceneIdSet.has(s.id)) return acc;
      if (s.generation_status === "error") return acc + 1;
      return acc;
    }, 0);
  }, [batchSceneIds.length, batchSceneIdSet, scenes]);

  const normalizeHeaderRecord = (headers: Record<string, string> | undefined) => {
    if (!headers) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      const key = String(k).toLowerCase();
      out[key] = String(v);
    }
    return out;
  };

  const normalizeArtStyleId = (value: string | null | undefined) => {
    const trimmed = (value ?? "").trim();
    if (!trimmed) return "cinematic";
    const normalized = trimmed
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
      .replace(/_+/g, "_");
    const aliases: Record<string, string> = {
      no_specific_style: "none",
      nospecificstyle: "none",
      no_style: "none",
      nostyle: "none",
      comic_book: "comic",
      comicbook: "comic",
      oil_painting: "oil",
      oilpainting: "oil",
      digitalillustration: "digital_illustration",
      realisticcinematic: "realistic_cinematic",
      animemanga: "anime_manga",
      manga: "anime_manga",
    };
    return aliases[normalized] ?? normalized;
  };

  useEffect(() => {
    selectedStyleRef.current = selectedStyle;
  }, [selectedStyle]);

  useEffect(() => {
    styleIntensityRef.current = styleIntensity;
  }, [styleIntensity]);

  useEffect(() => {
    consistencyModeRef.current = consistencyMode;
  }, [consistencyMode]);

  const readInvokeBodyText = async (value: unknown) => {
    if (typeof value === "string") return value;
    if (value instanceof Uint8Array) return new TextDecoder().decode(value);
    if (!value || typeof value !== "object") return null;

    const rec = value as Record<string, unknown>;
    const maybeText = rec.text as unknown;
    if (typeof maybeText === "function") {
      try {
        return String(await (maybeText as () => Promise<unknown>)());
      } catch {
        return null;
      }
    }

    const maybeGetReader = rec.getReader as unknown;
    if (typeof maybeGetReader === "function") {
      try {
        const reader = (value as ReadableStream<Uint8Array>).getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          if (chunk) chunks.push(chunk);
        }
        const size = chunks.reduce((acc, c) => acc + c.length, 0);
        const merged = new Uint8Array(size);
        let offset = 0;
        for (const c of chunks) {
          merged.set(c, offset);
          offset += c.length;
        }
        return new TextDecoder().decode(merged);
      } catch {
        return null;
      }
    }

    return null;
  };

  const parseInvokeBodyObject = async (body: unknown) => {
    const bodyText = await readInvokeBodyText(body);
    const candidate = bodyText ?? body;
    if (typeof candidate !== "string") return candidate;
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      return candidate;
    }
  };

  const formatFunctionInvokeError = async (err: unknown, preParsedBody?: unknown) => {
    const e = err as unknown as {
      message?: string;
      context?: { status?: number; body?: unknown };
    };

    const status = typeof e?.context?.status === "number" ? e.context.status : null;
    const body = e?.context?.body;
    const bodyObj = preParsedBody !== undefined ? preParsedBody : await parseInvokeBodyObject(body);

    const bodyRec =
      bodyObj && typeof bodyObj === "object" && !Array.isArray(bodyObj)
        ? (bodyObj as Record<string, unknown>)
        : null;

    const serverError = bodyRec?.error ? String(bodyRec.error) : "";
    const serverStage = bodyRec?.stage ? String(bodyRec.stage) : "";
    const serverDbCode = bodyRec?.dbCode ? String(bodyRec.dbCode) : "";
    const serverDbMessage = bodyRec?.dbMessage ? String(bodyRec.dbMessage) : "";
    const serverDetails = (() => {
      const d = bodyRec?.details;
      if (!d) return "";
      if (typeof d === "string") return d;
      if (d && typeof d === "object" && !Array.isArray(d)) {
        const rec = d as Record<string, unknown>;

        // Handle content violation details
        if (rec.suggestion) {
          return String(rec.suggestion);
        }

        const code = rec.code ? String(rec.code) : "";
        const message = rec.message ? String(rec.message) : "";
        const details = rec.details ? String(rec.details) : "";
        const hint = rec.hint ? String(rec.hint) : "";
        return [code ? `code=${code}` : null, message ? `message=${message}` : null, details ? `details=${details}` : null, hint ? `hint=${hint}` : null]
          .filter(Boolean)
          .join(" ");
      }
      return String(d);
    })();
    const serverModel = bodyRec?.model ? String(bodyRec.model) : "";
    const serverRequestId = bodyRec?.requestId ? String(bodyRec.requestId) : "";

    const parts = [
      status ? `HTTP ${status}` : null,
      serverError || null,
      serverStage ? `stage=${serverStage}` : null,
      serverModel ? `model=${serverModel}` : null,
      serverRequestId ? `requestId=${serverRequestId}` : null,
      serverDbCode ? `db=${serverDbCode}` : null,
      serverDbMessage ? `dbMessage=${serverDbMessage}` : null,
      serverDetails || null,
      !serverError && typeof bodyObj === "string" ? bodyObj : null,
      !serverError && e?.message ? e.message : null,
    ].filter(Boolean);

    return parts.join(" • ") || "Request failed";
  };

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const applyCreditsFromResponse = useCallback(
    (credits: unknown) => {
      const rec = credits && typeof credits === "object" && !Array.isArray(credits) ? (credits as Record<string, unknown>) : null;
      const hasRemainingMonthly = typeof rec?.remaining_monthly === "number";
      const hasRemainingBonus = typeof rec?.remaining_bonus === "number";
      if (!hasRemainingMonthly && !hasRemainingBonus) return;
      void refreshProfile();
    },
    [refreshProfile],
  );

  const refundConsumedCredits = async (args: {
    requestId: string;
    reason: string;
    refresh?: boolean;
    metadata?: Record<string, unknown>;
  }) => {
    // Moved to lib/credit-reconciliation.ts but kept here if other components use it locally?
    // Actually, only used inside Storyboard.tsx for manual refund triggers (e.g. debug buttons)
    // We can keep it or refactor. Let's keep it as a wrapper around the lib function or direct RPC call.
    // The previous implementation was:
    if (!user?.id) return null;
    if (!args.requestId || !UUID_REGEX.test(args.requestId)) return null;

    try {
      const { data, error } = await supabase.rpc("refund_consumed_credits", {
        p_user_id: user.id,
        p_request_id: args.requestId,
        p_reason: args.reason,
        p_metadata: (args.metadata ?? {}) as Json,
      });
      if (error) return null;
      applyCreditsFromResponse(data);
      if (args.refresh !== false) await refreshProfile();
      return data;
    } catch {
      return null;
    }
  };

  const releaseReservedCredits = async (args: {
    requestId: string;
    reason: string;
    refresh?: boolean;
    metadata?: Record<string, unknown>;
  }) => {
    if (!user?.id) return null;
    if (!args.requestId || !UUID_REGEX.test(args.requestId)) return null;

    try {
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      }).rpc("release_reserved_credits", {
        p_user_id: user.id,
        p_request_id: args.requestId,
        p_reason: args.reason,
        p_metadata: (args.metadata ?? {}) as Json,
      });
      if (error) return null;
      applyCreditsFromResponse(data);
      if (args.refresh !== false) await refreshProfile();
      return data;
    } catch {
      return null;
    }
  };

  const handleReconcileCredits = async (args: {
    requestId: string;
    reason: string;
    refresh?: boolean;
    metadata?: Record<string, unknown>;
  }) => {
    if (!user?.id) return null;
    const result = await reconcileFailedGenerationCredits(supabase, {
      requestId: args.requestId,
      reason: args.reason,
      metadata: args.metadata,
    });

    if (!result?.success) {
      const [refund, release] = await Promise.all([
        refundConsumedCredits({
          requestId: args.requestId,
          reason: args.reason,
          refresh: false,
          metadata: args.metadata,
        }),
        releaseReservedCredits({
          requestId: args.requestId,
          reason: args.reason,
          refresh: false,
          metadata: args.metadata,
        }),
      ]);

      applyCreditsFromResponse(refund);
      applyCreditsFromResponse(release);
    }

    const reconcile =
      result &&
      typeof result === "object" &&
      "reconcile" in result &&
      (result as { reconcile?: unknown }).reconcile &&
      typeof (result as { reconcile?: unknown }).reconcile === "object" &&
      !Array.isArray((result as { reconcile?: unknown }).reconcile)
        ? ((result as { reconcile?: unknown }).reconcile as Record<string, unknown>)
        : null;
    const refund = reconcile?.refund;
    const release = reconcile?.release;
    applyCreditsFromResponse(refund);
    applyCreditsFromResponse(release);
    if (args.refresh !== false) await refreshProfile();
    return result;
  };

  const extractInvokeDebugInfo = async (error: unknown, preParsedBody?: unknown) => {
    try {
      const e = error as { context?: { body?: unknown; status?: unknown } } | null;
      const bodyObj = preParsedBody !== undefined ? preParsedBody : await parseInvokeBodyObject(e?.context?.body);

      if (bodyObj && typeof bodyObj === "object" && !Array.isArray(bodyObj)) {
        const rec = bodyObj as Record<string, unknown>;
        const detailsRaw = rec.details;
        const detailsObj =
          detailsRaw && typeof detailsRaw === "object" && !Array.isArray(detailsRaw)
            ? (detailsRaw as Record<string, unknown>)
            : typeof detailsRaw === "string"
              ? (() => {
                try {
                  const parsed = JSON.parse(detailsRaw) as unknown;
                  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                    ? (parsed as Record<string, unknown>)
                    : null;
                } catch {
                  return null;
                }
              })()
              : null;

        const headersObj =
          detailsObj?.headers && typeof detailsObj.headers === "object" && !Array.isArray(detailsObj.headers)
            ? (detailsObj.headers as Record<string, unknown>)
            : null;
        const headers = headersObj
          ? (() => {
            const out: Record<string, string> = {};
            for (const [k, v] of Object.entries(headersObj)) {
              if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
                out[String(k).toLowerCase()] = String(v);
              }
            }
            return out;
          })()
          : undefined;

        const requestId = typeof rec.requestId === "string" ? rec.requestId : undefined;
        const stage = typeof rec.stage === "string" ? rec.stage : undefined;
        const status = typeof e?.context?.status === "number" ? (e.context.status as number) : undefined;
        const serverError = typeof rec.error === "string" ? rec.error : undefined;
        const suggestion = typeof detailsObj?.suggestion === "string" ? detailsObj.suggestion : undefined;
        const size = typeof detailsObj?.size === "number" ? detailsObj.size : undefined;
        const statusText = typeof detailsObj?.statusText === "string" ? detailsObj.statusText : undefined;
        const upstreamError =
          typeof detailsObj?.upstream_error === "string"
            ? detailsObj.upstream_error
            : typeof detailsObj?.upstreamError === "string"
              ? detailsObj.upstreamError
              : undefined;
        const redactedHeaders = Array.isArray(detailsObj?.redactedHeaders)
          ? (detailsObj.redactedHeaders as unknown[]).filter((v): v is string => typeof v === "string")
          : undefined;
        const reasons = Array.isArray(detailsObj?.reasons)
          ? (detailsObj.reasons as unknown[]).filter((v): v is string => typeof v === "string")
          : undefined;

        return { headers, redactedHeaders, requestId, stage, status, statusText, serverError, suggestion, size, reasons, upstreamError };
      }
    } catch (e) {
      console.error("Failed to extract debug headers from error:", e);
    }
    return null;
  };

  const recordSceneDebugInfo = useCallback((sceneId: string, next: Partial<SceneGenerationDebugInfo>) => {
    setDebugInfo((prev) => {
      const prevEntry = prev[sceneId];
      const mergedHeaders =
        next.headers
          ? { ...(prevEntry?.headers ?? {}), ...normalizeHeaderRecord(next.headers) }
          : prevEntry?.headers;
      const prompt = typeof next.prompt === "string" ? next.prompt : prevEntry?.prompt;
      const promptFull = typeof next.promptFull === "string" ? next.promptFull : prevEntry?.promptFull;
      const promptHash = typeof next.promptHash === "string" ? next.promptHash : prevEntry?.promptHash;
      const model = typeof next.model === "string" ? next.model : prevEntry?.model;
      const modelConfig = next.modelConfig !== undefined ? next.modelConfig : prevEntry?.modelConfig;
      const preprocessingSteps =
        Array.isArray(next.preprocessingSteps)
          ? next.preprocessingSteps.filter((v): v is string => typeof v === "string")
          : prevEntry?.preprocessingSteps;
      return {
        ...prev,
        [sceneId]: {
          timestamp: next.timestamp ?? prevEntry?.timestamp ?? new Date(),
          headers: mergedHeaders,
          redactedHeaders: next.redactedHeaders ?? prevEntry?.redactedHeaders,
          requestId: next.requestId ?? prevEntry?.requestId,
          stage: next.stage ?? prevEntry?.stage,
          error: next.error ?? prevEntry?.error,
          suggestion: next.suggestion ?? prevEntry?.suggestion,
          size: next.size ?? prevEntry?.size,
          status: next.status ?? prevEntry?.status,
          statusText: next.statusText ?? prevEntry?.statusText,
          reasons: next.reasons ?? prevEntry?.reasons,
          upstreamError: next.upstreamError ?? prevEntry?.upstreamError,
          model,
          modelConfig,
          preprocessingSteps,
          prompt,
          promptFull,
          promptHash,
          requestParams: next.requestParams ?? prevEntry?.requestParams,
        },
      };
    });
  }, []);

  const hydrateSceneDebugFromDb = useCallback(async (sceneId: string) => {
    try {
      const { data, error } = await supabase
        .from("scenes")
        .select("id, generation_status, image_url, consistency_status, consistency_score, consistency_details, updated_at")
        .eq("id", sceneId)
        .single();

      if (error || !data) {
        if (error) {
          recordSceneDebugInfo(sceneId, {
            timestamp: new Date(),
            stage: "db_hydrate",
            suggestion: `Failed to load persisted prompt: ${error.message}`,
          });
        }
        return;
      }

      const patch = data as unknown as Partial<Scene>;
      setScenes((prev) => prev.map((s) => (s.id === sceneId ? { ...s, ...patch } : s)));
      setSelectedScene((prev) => (prev?.id === sceneId ? { ...prev, ...patch } : prev));

      const parseJsonIfString = (value: unknown) => {
        if (typeof value !== "string") return value;
        try {
          const parsed = JSON.parse(value);
          return typeof parsed === "object" && parsed !== null ? parsed : value;
        } catch {
          return value;
        }
      };

      const rawDetails = parseJsonIfString(data.consistency_details);
      const details =
        rawDetails && typeof rawDetails === "object" && !Array.isArray(rawDetails)
          ? (rawDetails as Record<string, unknown>)
          : null;

      const rawGen = details?.generation_debug;
      const parsedGen = parseJsonIfString(rawGen);
      const gen =
        parsedGen && typeof parsedGen === "object" && !Array.isArray(parsedGen)
          ? (parsedGen as Record<string, unknown>)
          : null;

      // Also try to read from root if generation_debug is missing/incomplete
      const rootDetails = details;

      if (!gen && !rootDetails) {
        if (data.generation_status !== "pending") {
          recordSceneDebugInfo(sceneId, {
            timestamp: new Date(),
            stage: "db_hydrate",
            suggestion: "No persisted generation_debug found for this scene.",
          });
        }
        return;
      }

      const prompt =
        typeof gen?.prompt === "string" ? gen.prompt :
          typeof gen?.prompt_used === "string" ? gen.prompt_used :
            typeof rootDetails?.prompt === "string" ? rootDetails.prompt :
              typeof rootDetails?.prompt_used === "string" ? rootDetails.prompt_used :
                undefined;

      const promptFull =
        typeof gen?.prompt_full === "string" ? gen.prompt_full :
          typeof gen?.promptFull === "string" ? gen.promptFull :
            typeof rootDetails?.prompt_full === "string" ? rootDetails.prompt_full :
              typeof rootDetails?.promptFull === "string" ? rootDetails.promptFull :
                undefined;

      const preprocessingSteps = Array.isArray(gen?.preprocessingSteps)
        ? (gen!.preprocessingSteps as unknown[]).filter((v): v is string => typeof v === "string")
        : undefined;

      const promptHash =
        typeof gen?.prompt_hash === "string" ? gen.prompt_hash :
          typeof gen?.promptHash === "string" ? gen.promptHash :
            undefined;

      const model = typeof gen?.model === "string" ? gen.model : undefined;
      const requestId = typeof gen?.requestId === "string" ? gen.requestId : undefined;
      const stage = typeof gen?.stage === "string" ? gen.stage : undefined;

      recordSceneDebugInfo(sceneId, {
        prompt,
        promptFull,
        preprocessingSteps,
        promptHash,
        model,
        requestId,
        stage,
      });
    } catch {
      return;
    }
  }, [recordSceneDebugInfo, setScenes, setSelectedScene]);

  useEffect(() => {
    if (!selectedScene?.id) return;
    const updated = scenes.find((s) => s.id === selectedScene.id);
    if (!updated) return;
    if (updated !== selectedScene) setSelectedScene(updated);
  }, [scenes, selectedScene]);

  useEffect(() => {
    if (!isModalOpen || !selectedScene?.id) return;
    void hydrateSceneDebugFromDb(selectedScene.id);
  }, [hydrateSceneDebugFromDb, isModalOpen, selectedScene?.id]);

  // Remove internal implementation of validateGeneratedImage since we now import it
  // validateGeneratedImage was previously defined here

  useEffect(() => {
    if (storyId && stories.length > 0) {
      const found = stories.find(s => s.id === storyId);
      if (found) {
        setStory(found);
        const syncedStoryId = lastSyncedStoryIdRef.current;
        const foundStyle = normalizeArtStyleId(found.art_style);
        const localOverride = localStyleOverrideRef.current;
        const localModelOverride = localModelOverrideRef.current;

        if (syncedStoryId !== storyId) {
          lastSyncedStoryIdRef.current = storyId;
          localStyleOverrideRef.current = null;
          localModelOverrideRef.current = null;
          setSelectedStyle(foundStyle);
        } else if (localOverride?.storyId === storyId) {
          if (localOverride.styleId === foundStyle) {
            localStyleOverrideRef.current = null;
          }
        } else {
          setSelectedStyle(foundStyle);
        }
        const settings =
          found.consistency_settings && typeof found.consistency_settings === "object" && !Array.isArray(found.consistency_settings)
            ? (found.consistency_settings as Record<string, unknown>)
            : {};
        const intensityRaw = settings.style_intensity;
        const intensity = typeof intensityRaw === "number" ? intensityRaw : Number(intensityRaw);
        setStyleIntensity(Number.isFinite(intensity) ? Math.max(0, Math.min(100, intensity)) : 70);

        const savedModel = settings.model;
        if (typeof savedModel === "string") {
          if (syncedStoryId !== storyId) {
            setSelectedModel(savedModel);
          } else if (localModelOverride?.storyId === storyId) {
            if (localModelOverride.modelId === savedModel) {
              localModelOverrideRef.current = null;
            }
          } else {
            setSelectedModel(savedModel);
          }
        }

        const lockRaw =
          typeof settings.character_identity_lock === "boolean"
            ? settings.character_identity_lock
            : typeof settings.identity_lock === "boolean"
              ? settings.identity_lock
              : typeof settings.identityLock === "boolean"
                ? settings.identityLock
                : undefined;
        setCharacterIdentityLock(lockRaw ?? true);

        const strengthRaw =
          settings.character_anchor_strength ?? settings.characterAnchorStrength ?? settings.anchor_strength ?? settings.anchorStrength;
        const strengthNum = typeof strengthRaw === "number" ? strengthRaw : Number(strengthRaw);
        setCharacterAnchorStrength(Number.isFinite(strengthNum) ? Math.max(0, Math.min(100, strengthNum)) : 70);

        const modeRaw = settings.mode;
        const mode =
          modeRaw === "strict" || modeRaw === "balanced" || modeRaw === "flexible"
            ? modeRaw
            : typeof modeRaw === "string" && modeRaw.trim() === ""
              ? "strict"
              : "strict";
        setConsistencyMode(mode);

        const autoCorrectRaw = settings.auto_correct;
        setAutoCorrectEnabled(typeof autoCorrectRaw === "boolean" ? autoCorrectRaw : false);

        const characterImageReferenceRaw =
          settings.character_image_reference_enabled ??
          settings.characterImageReferenceEnabled ??
          settings.character_image_reference ??
          settings.characterImageReference;
        setCharacterImageReferenceEnabled(typeof characterImageReferenceRaw === "boolean" ? characterImageReferenceRaw : false);
      }
    }
  }, [storyId, stories]);

  const updateConsistencySettings = async (updates: Record<string, unknown>) => {
    if (!storyId) return;
    const base =
      story?.consistency_settings && typeof story.consistency_settings === "object" && !Array.isArray(story.consistency_settings)
        ? (story.consistency_settings as Record<string, unknown>)
        : {};
    const next = { ...base, ...updates };
    const updated = await updateStory(storyId, { consistency_settings: next as Json });
    if (updated) setStory(updated);
  };

  const handleStyleChange = async (styleId: string) => {
    const normalized = normalizeArtStyleId(styleId);
    selectedStyleRef.current = normalized;
    setSelectedStyle(normalized);
    if (!storyId) return;
    localStyleOverrideRef.current = { storyId, styleId: normalized };
    const updated = await updateStory(storyId, { art_style: normalized });
    if (updated) setStory(updated);
  };

  const handleStyleIntensityChange = async (intensity: number) => {
    const clamped = Math.max(0, Math.min(100, intensity));
    styleIntensityRef.current = clamped;
    setStyleIntensity(clamped);
    await updateConsistencySettings({ style_intensity: clamped });
  };

  const handleDisabledStyleElementsChange = (styleId: string, disabledElements: string[]) => {
    setDisabledStyleElementsByStyle((prev) => {
      const next = { ...prev, [styleId]: disabledElements };
      return next;
    });
  };

  const handleModelChange = async (modelId: string) => {
    if (storyId) localModelOverrideRef.current = { storyId, modelId };
    setSelectedModel(modelId);

    // Set default resolution if supported
    const model = imageModels.find(m => m.id === modelId);
    if (model?.supportedResolutions && model.supportedResolutions.length > 0) {
      setSelectedResolution({ width: model.supportedResolutions[0].width, height: model.supportedResolutions[0].height });
    } else {
      setSelectedResolution(undefined);
    }

    await updateConsistencySettings({ model: modelId });
  };

  const handleCharacterIdentityLockChange = async (checked: boolean) => {
    setCharacterIdentityLock(checked);
    await updateConsistencySettings({ character_identity_lock: checked });
  };

  const handleCharacterAnchorStrengthChange = async (value: number) => {
    const clamped = Math.max(0, Math.min(100, value));
    setCharacterAnchorStrength(clamped);
    await updateConsistencySettings({ character_anchor_strength: clamped });
  };

  const handleConsistencyModeChange = async (mode: string) => {
    const next = mode === "strict" || mode === "balanced" || mode === "flexible" ? mode : "strict";
    consistencyModeRef.current = next;
    setConsistencyMode(next);
    await updateConsistencySettings({ mode: next });
  };

  const handleAutoCorrectChange = async (checked: boolean) => {
    setAutoCorrectEnabled(checked);
    await updateConsistencySettings({ auto_correct: checked });
  };

  const handleCharacterImageReferenceChange = async (checked: boolean) => {
    setCharacterImageReferenceEnabled(checked);
    await updateConsistencySettings({ character_image_reference_enabled: checked });
  };

  const handleDeleteStory = async () => {
    if (!storyToDelete) return;

    setIsDeleting(true);
    const success = await deleteStory(storyToDelete.id);
    setIsDeleting(false);
    setStoryToDelete(null);

    if (success) {
      toast({
        title: "Story deleted",
        description: `"${storyToDelete.title}" has been removed`,
      });
    }
  };

  const handleGenerateImage = async (
    sceneId: string,
    opts?: { artStyle?: string; styleIntensity?: number; strictStyle?: boolean; forceFullPrompt?: string },
  ) => {
    if (!user) {
      toast({ title: "Sign in required", description: "Please sign in to generate images", variant: "destructive" });
      return;
    }
    if (!storyId) {
      toast({ title: "Story unavailable", description: "Missing story id", variant: "destructive" });
      return;
    }

    const sceneRow = scenes.find((s) => s.id === sceneId);
    if (!sceneRow) {
      toast({ title: "Scene unavailable", description: "Could not find that scene", variant: "destructive" });
      return;
    }

    const artStyle = opts?.artStyle ?? selectedStyleRef.current;
    const intensity = opts?.styleIntensity ?? styleIntensityRef.current;
    const strictStyle = opts?.strictStyle ?? true;
    const forceFullPrompt =
      typeof opts?.forceFullPrompt === "string" && opts.forceFullPrompt.trim() ? opts.forceFullPrompt : undefined;
    const disabledStyleElements = disabledStyleElementsByStyle[artStyle] ?? [];
    const width = selectedResolution?.width;
    const height = selectedResolution?.height;

    const requestParams: Record<string, unknown> = {
      sceneId,
      storyId,
      model: selectedModel,
      artStyle,
      styleIntensity: intensity,
      strictStyle,
      width,
      height,
      disabledStyleElements,
      forceFullPrompt,
      characterImageReferenceEnabled,
    };

    setGeneratingSceneId(sceneId);
    setScenes((prev) => prev.map((s) => (s.id === sceneId ? { ...s, generation_status: "generating" } : s)));

    let clientRequestId: string | null = null;
    let reconciled = false;

    const lookupRequestIdFromAttempts = async (): Promise<string | null> => {
      try {
        const db = supabase as unknown as {
          from: (table: string) => {
            select: (columns: string) => unknown;
          };
        };
        const q = db.from("image_generation_attempts").select("request_id,created_at") as unknown as {
          eq: (column: string, value: string) => unknown;
        };
        const q1 = q.eq("user_id", user.id) as unknown as { eq: (column: string, value: string) => unknown };
        const q2 = q1.eq("feature", "generate-scene-image") as unknown as { eq: (column: string, value: string) => unknown };
        const q3 = q2.eq("metadata->>scene_id", sceneId) as unknown as {
          order: (column: string, opts: { ascending: boolean }) => unknown;
        };
        const q4 = q3.order("created_at", { ascending: false }) as unknown as { limit: (n: number) => unknown };
        const { data } = (await (q4.limit(3) as Promise<{ data: unknown }>)) ?? { data: null };

        if (!Array.isArray(data)) return null;
        for (const row of data) {
          const rec = row as unknown as { request_id?: unknown };
          const id = typeof rec?.request_id === "string" ? rec.request_id : null;
          if (id && UUID_REGEX.test(id)) return id;
        }
        return null;
      } catch {
        return null;
      }
    };

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Not authenticated", description: "Please sign in to generate images", variant: "destructive" });
        return;
      }

      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
      if (!supabaseUrl) {
        throw new Error("Missing VITE_SUPABASE_URL; cannot call Supabase Functions endpoint");
      }

      const apikey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();
      if (!apikey) {
        throw new Error("Missing VITE_SUPABASE_ANON_KEY; cannot call Supabase Functions endpoint");
      }

      clientRequestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null;
      const functionUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/generate-scene-image`;

      const rawResponse = await fetch(functionUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sceneId,
          clientRequestId: clientRequestId ?? undefined,
          artStyle,
          styleIntensity: intensity,
          strictStyle,
          model: selectedModel,
          width,
          height,
          disabledStyleElements,
          forceFullPrompt,
          characterImageReferenceEnabled,
        }),
      });

      const responseHeaders: Record<string, string> = {};
      rawResponse.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });

      const text = await rawResponse.text();
      let responseBody: unknown;
      try {
        responseBody = JSON.parse(text);
      } catch {
        responseBody = text;
      }

      const pickFirstUuid = (...candidates: Array<unknown>) => {
        for (const c of candidates) {
          if (typeof c === "string" && UUID_REGEX.test(c)) return c;
        }
        return undefined;
      };

      if (!rawResponse.ok) {
        const bodyObj = responseBody && typeof responseBody === "object" ? (responseBody as Record<string, unknown>) : null;
        const detailsObj = bodyObj?.details && typeof bodyObj.details === "object" ? (bodyObj.details as Record<string, unknown>) : null;

        applyCreditsFromResponse(bodyObj?.credits);
        applyCreditsFromResponse(detailsObj?.credits);

        let requestId = pickFirstUuid(bodyObj?.requestId, responseHeaders["x-request-id"], clientRequestId);
        if (!requestId) requestId = (await lookupRequestIdFromAttempts()) ?? undefined;

        const errorMsg =
          (typeof bodyObj?.error === "string" ? (bodyObj.error as string) : undefined) ||
          (typeof bodyObj?.message === "string" ? (bodyObj.message as string) : undefined) ||
          `HTTP ${rawResponse.status} ${rawResponse.statusText}`;

        if (requestId) {
          await handleReconcileCredits({
            requestId,
            reason: errorMsg, // Preserve the exact error message from server, including "Blank image generation (mean=0.0, std=0.0)"
            refresh: false,
            metadata: {
              feature: "generate-scene-image",
              stage: "http_error",
              scene_id: sceneId,
              story_id: storyId,
              http_status: rawResponse.status,
              error: errorMsg,
              timestamp: new Date().toISOString(),
            },
          });
          reconciled = true;
        }

        recordSceneDebugInfo(sceneId, {
          timestamp: new Date(),
          headers: responseHeaders,
          requestId,
          stage: "http_error",
          error: errorMsg,
          requestParams,
        });

        setScenes((prev) =>
          prev.map((s) => (s.id === sceneId ? { ...s, generation_status: "error", image_url: s.image_url ?? null } : s)),
        );
        throw new Error(errorMsg);
      }

      const responseObj = responseBody && typeof responseBody === "object" ? (responseBody as Record<string, unknown>) : null;
      const imageUrl = typeof responseObj?.imageUrl === "string" ? (responseObj.imageUrl as string) : null;
      let requestId = pickFirstUuid(responseObj?.requestId, responseHeaders["x-request-id"], clientRequestId);
      if (!requestId) requestId = (await lookupRequestIdFromAttempts()) ?? undefined;

      applyCreditsFromResponse(responseObj?.credits);

      if (!imageUrl) {
        const errorMsg =
          (typeof responseObj?.error === "string" ? (responseObj.error as string) : undefined) ||
          (typeof responseObj?.message === "string" ? (responseObj.message as string) : undefined) ||
          "No image URL returned";

        if (requestId) {
          await handleReconcileCredits({
            requestId,
            reason: errorMsg, // Preserve the exact error message from server
            metadata: {
              feature: "generate-scene-image",
              stage: "no_image_returned",
              scene_id: sceneId,
              story_id: storyId,
              error: errorMsg,
              timestamp: new Date().toISOString(),
            },
          });
          reconciled = true;
        }

        recordSceneDebugInfo(sceneId, {
          timestamp: new Date(),
          headers: responseHeaders,
          requestId,
          stage: "no_image_returned",
          error: errorMsg,
          requestParams,
        });

        setScenes((prev) =>
          prev.map((s) => (s.id === sceneId ? { ...s, generation_status: "error", image_url: null } : s)),
        );
        toast({ title: "Generation failed", description: errorMsg, variant: "destructive" });
        return;
      }

      const validation = await validateGeneratedImage(imageUrl);
      if (!validation.ok) {
        const reason = validation.reason || "Generated image failed client validation";

        if (requestId) {
          await handleReconcileCredits({
            requestId,
            reason: reason, // Preserve the exact validation failure reason
            metadata: {
              feature: "generate-scene-image",
              stage: "client_image_validation",
              scene_id: sceneId,
              story_id: storyId,
              size: validation.size,
              mean: validation.mean,
              std: validation.std,
              timestamp: new Date().toISOString(),
            },
          });
          reconciled = true;
        }
        recordSceneDebugInfo(sceneId, {
          timestamp: new Date(),
          headers: responseHeaders,
          requestId,
          stage: "client_image_validation",
          error: reason,
          size: validation.size,
          requestParams,
        });
        setScenes((prev) =>
          prev.map((s) =>
            s.id === sceneId
              ? { ...s, generation_status: "error", image_url: null, consistency_status: "fail" }
              : s,
          ),
        );
        void updateScene(sceneId, { image_url: null, generation_status: "error", consistency_status: "fail" });
        toast({ title: "Generation failed", description: reason, variant: "destructive" });
        return;
      }

      recordSceneDebugInfo(sceneId, {
        timestamp: new Date(),
        headers: responseHeaders,
        requestId,
        stage: "success",
        requestParams,
      });

      setScenes((prev) =>
        prev.map((s) =>
          s.id === sceneId
            ? { ...s, updated_at: new Date().toISOString(), generation_status: "completed", image_url: imageUrl }
            : s,
        ),
      );

      await fetchScenes();
      await refreshProfile();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Generation failed";
      const requestIdToReconcile = !reconciled ? await lookupRequestIdFromAttempts() : null;
      const fallbackRequestId =
        requestIdToReconcile && UUID_REGEX.test(requestIdToReconcile)
          ? requestIdToReconcile
          : clientRequestId && UUID_REGEX.test(clientRequestId)
            ? clientRequestId
            : null;
      if (!reconciled && fallbackRequestId) {
        try {
          await handleReconcileCredits({
            requestId: fallbackRequestId,
            reason: message, // Preserve the exact error message
            refresh: false,
            metadata: {
              feature: "generate-scene-image",
              stage: "client_exception",
              scene_id: sceneId,
              story_id: storyId,
              error: message,
              timestamp: new Date().toISOString(),
            },
          });
          reconciled = true;
        } catch {
          void 0;
        }
      }
      recordSceneDebugInfo(sceneId, { timestamp: new Date(), error: message, requestParams });
      setScenes((prev) => prev.map((s) => (s.id === sceneId ? { ...s, generation_status: "error" } : s)));
      toast({ title: "Generation failed", description: message, variant: "destructive" });
    } finally {
      setGeneratingSceneId((prev) => (prev === sceneId ? null : prev));
    }
  };

  const runBatchGeneration = async (
    scenesToGenerate: Scene[],
    mode: BatchMode,
    opts?: { resetFirst?: boolean },
  ) => {
    if (isGenerating || generateAllLockRef.current) return;
    if (!user || !storyId) return;
    if (scenesToGenerate.length === 0) return;

    generateAllLockRef.current = true;
    setIsGenerating(true);
    setBatchMode(mode);
    setBatchSceneIds(scenesToGenerate.map((s) => s.id));

    let failedCount = 0;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Not authenticated", description: "Please sign in to generate images", variant: "destructive" });
        return;
      }

      if (opts?.resetFirst) {
        const ok = await resetAllSceneGenerations(session.access_token);
        if (!ok) return;
      }

      for (const scene of scenesToGenerate) {
        if (!generateAllLockRef.current) break;
        try {
          await handleGenerateImage(scene.id);
        } catch {
          failedCount += 1;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      toast({
        title: mode === "regenerate" ? "Regeneration complete!" : "Generation complete!",
        description: `Finished ${scenesToGenerate.length} scenes (${failedCount} failed)`,
      });

      await fetchScenes();
      await refreshProfile();
    } catch (error) {
      console.error("Error in batch generation:", error);
      toast({
        title: mode === "regenerate" ? "Regeneration failed" : "Generation failed",
        description: "Some images failed to generate",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
      setGeneratingSceneId(null);
      setBatchSceneIds([]);
      setBatchMode("generate");
      generateAllLockRef.current = false;
    }
  };

  const resetAllSceneGenerations = async (accessToken: string) => {
    if (!storyId) return false;

    setScenes((prev) =>
      prev.map((s) => ({
        ...s,
        image_url: null,
        generation_status: "pending",
        consistency_score: null,
        consistency_status: null,
        consistency_details: {} as Json,
      })),
    );

    const failures: string[] = [];

    try {
      const { data, error } = await supabase.functions.invoke("generate-scene-image", {
        body: { action: "reset_story_scenes", storyId },
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!error) {
        const ok = Boolean((data as { success?: boolean } | null)?.success);
        if (ok) return true;
        failures.push("reset function returned no success");
      } else {
        failures.push(await formatFunctionInvokeError(error));
      }
    } catch (e) {
      failures.push(e instanceof Error ? e.message : "reset function failed");
    }

    const { error: dbError } = await supabase
      .from("scenes")
      .update({ image_url: null, generation_status: "pending" })
      .eq("story_id", storyId);

    if (!dbError) return true;
    failures.push(dbError.message || "database update failed");

    await fetchScenes();
    toast({
      title: "Reset failed",
      description: failures[0] ?? "Could not clear previous image generations",
      variant: "destructive",
    });
    return false;
  };

  const handleStopGenerating = async () => {
    // 1. Stop local batch loop if running
    if (generateAllLockRef.current) {
      // We can't easily "cancel" the running promise loop, but we can signal it to stop
      // Since `runBatchGeneration` checks `scenesToGenerate` loop, we can't break it from outside easily 
      // without an AbortController or a shared ref check inside the loop.
      // However, we can just reset the state and let the loop fail/finish.
      // Actually, we can just reload the page or force reset.
      // But a better way is to rely on `stopAllGeneration` to clear the DB state,
      // and the frontend will update via realtime or optimistic update.
    }

    // 2. Call backend to reset status
    await stopAllGeneration();

    // 3. Reset local state
    setIsGenerating(false);
    setGeneratingSceneId(null);
    setBatchSceneIds([]);
    setBatchMode("generate");
    generateAllLockRef.current = false;
  };

  const handleGenerateAll = async () => {
    if (isGenerating || generateAllLockRef.current) return;
    if (!user || scenes.length === 0) return;

    const eligible = scenes.filter(
      (s) => s.generation_status === "pending" || s.generation_status === "error",
    );

    const hasAnyGeneratedImages = scenes.some((s) => Boolean(s.image_url));
    if (hasAnyGeneratedImages) {
      setIsRegenerateAllDialogOpen(true);
      return;
    }

    if (eligible.length > 0) await runBatchGeneration(eligible, "generate");
    else setIsRegenerateAllDialogOpen(true);
  };

  const handleGenerateRemainingFromDialog = async () => {
    if (isGenerating || generateAllLockRef.current) return;
    if (!user || scenes.length === 0) return;

    setIsRegenerateAllDialogOpen(false);
    const eligible = scenes.filter(
      (s) => s.generation_status === "pending" || s.generation_status === "error",
    );
    await runBatchGeneration(eligible, "generate");
  };

  const handleConfirmRegenerateAll = async () => {
    if (isGenerating || generateAllLockRef.current) return;
    if (!user || scenes.length === 0) return;

    setIsRegenerateAllDialogOpen(false);
    await runBatchGeneration(scenes, "regenerate", { resetFirst: true });
  };

  const handleSceneClick = (scene: Scene) => {
    setSelectedScene(scene);
    setIsModalOpen(true);
  };

  const handleSavePrompt = async (sceneId: string, newPrompt: string) => {
    try {
      const updated = await updateScene(sceneId, { image_prompt: newPrompt });
      if (!updated) throw new Error("Failed to update scene");

      if (selectedScene?.id === sceneId) setSelectedScene(updated);

      toast({
        title: "Prompt saved",
        description: "Image prompt has been updated",
      });
    } catch (error) {
      console.error("Error saving prompt:", error);
      toast({
        title: "Save failed",
        description: "Failed to save the prompt",
        variant: "destructive",
      });
    }
  };

  const normalizeCharacterStateField = (value: unknown, maxLen: number) => {
    if (typeof value !== "string") return "";
    const collapsed = value.replace(/\s+/g, " ").trim();
    return collapsed.length > maxLen ? collapsed.slice(0, maxLen) : collapsed;
  };

  const normalizeCharacterStatesRecord = (value: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [name, rawState] of Object.entries(value)) {
      if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) continue;
      const state = rawState as Record<string, unknown>;
      const clothing = normalizeCharacterStateField(state.clothing, 400);
      const condition = normalizeCharacterStateField(state.state ?? state.condition, 400);
      const physicalAttributes = normalizeCharacterStateField(state.physical_attributes, 600);

      const next: Record<string, string> = {};
      if (clothing) next.clothing = clothing;
      if (condition) next.state = condition;
      if (physicalAttributes) next.physical_attributes = physicalAttributes;
      if (Object.keys(next).length > 0) out[name] = next;
    }
    return out;
  };

  const handleSaveCharacterStates = async (sceneId: string, characterStates: Record<string, unknown>) => {
    if (!storyId) return;
    try {
      const sceneRow = scenes.find((s) => s.id === sceneId);
      const allowedNames = new Set((sceneRow?.characters || []).map((n) => String(n || "").toLowerCase()).filter(Boolean));
      const normalizedInput = normalizeCharacterStatesRecord(characterStates);
      const normalizedForScene: Record<string, unknown> = {};
      for (const [name, state] of Object.entries(normalizedInput)) {
        if (!allowedNames.has(name.toLowerCase())) continue;
        normalizedForScene[name] = state;
      }

      const updated = await updateScene(sceneId, { character_states: normalizedForScene as Json });
      if (!updated) throw new Error("Failed to update scene");
      if (selectedScene?.id === sceneId) setSelectedScene(updated);

      const { data: storyCharacters, error: charError } = await supabase
        .from("characters")
        .select("id, name")
        .eq("story_id", storyId);
      if (charError) throw charError;

      const idByName = new Map<string, string>();
      (storyCharacters || []).forEach((c) => {
        const name = typeof c.name === "string" ? c.name : "";
        const id = typeof c.id === "string" ? c.id : "";
        if (name && id) idByName.set(name.toLowerCase(), id);
      });

      const storyContext = (sceneRow?.original_text || sceneRow?.summary || null) as string | null;

      const upsertRows: Array<{
        story_id: string;
        scene_id: string;
        character_id: string;
        state: Json;
        source: string;
        story_context: string | null;
      }> = [];

      for (const [name, rawState] of Object.entries(normalizedForScene)) {
        const characterId = idByName.get(name.toLowerCase());
        if (!characterId) continue;
        if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) continue;
        upsertRows.push({
          story_id: storyId,
          scene_id: sceneId,
          character_id: characterId,
          state: rawState as Json,
          source: "manual",
          story_context: storyContext,
        });
      }

      if (upsertRows.length > 0) {
        const { error: stateError } = await supabase
          .from("scene_character_states")
          .upsert(upsertRows, { onConflict: "scene_id,character_id" });
        if (stateError) throw stateError;
      }

      toast({
        title: "Character states saved",
        description: "Scene character appearance overrides have been updated",
      });
    } catch (error) {
      console.error("Error saving character states:", error);
      toast({
        title: "Save failed",
        description: "Failed to save character states",
        variant: "destructive",
      });
    }
  };

  const fetchFullScenePrompt = async (sceneId: string) => {
    if (!user) throw new Error("Sign in required");

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
    if (!supabaseUrl) {
      throw new Error("Missing VITE_SUPABASE_URL; cannot call Supabase Functions endpoint");
    }

    const apikey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();
    if (!apikey) {
      throw new Error("Missing VITE_SUPABASE_ANON_KEY; cannot call Supabase Functions endpoint");
    }

    const artStyle = selectedStyleRef.current;
    const intensity = styleIntensityRef.current;
    const strictStyle = true;
    const disabledStyleElements = disabledStyleElementsByStyle[artStyle] ?? [];
    const width = selectedResolution?.width;
    const height = selectedResolution?.height;

    const functionUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/generate-scene-image`;

    const rawResponse = await fetch(functionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sceneId,
        artStyle,
        styleIntensity: intensity,
        strictStyle,
        model: selectedModel,
        width,
        height,
        disabledStyleElements,
        characterImageReferenceEnabled,
        promptOnly: true,
      }),
    });

    let responseBody: unknown;
    const text = await rawResponse.text();
    try {
      responseBody = JSON.parse(text);
    } catch {
      responseBody = text;
    }

    if (!rawResponse.ok) {
      const bodyObj = responseBody && typeof responseBody === "object" ? (responseBody as Record<string, unknown>) : null;
      const errorMsg =
        typeof bodyObj?.error === "string"
          ? bodyObj.error
          : typeof bodyObj?.message === "string"
            ? bodyObj.message
            : `HTTP ${rawResponse.status} ${rawResponse.statusText}`;
      throw new Error(errorMsg);
    }

    const data =
      responseBody && typeof responseBody === "object" && !Array.isArray(responseBody)
        ? (responseBody as Record<string, unknown>)
        : null;
    if (!data || data.success !== true) {
      const errorMsg =
        typeof data?.error === "string"
          ? data.error
          : typeof data?.message === "string"
            ? data.message
            : "Failed to fetch full prompt";
      throw new Error(errorMsg);
    }

    return data;
  };

  const handleModalRegenerate = async (sceneId: string, opts?: { forceFullPrompt?: string }) => {
    await handleGenerateImage(sceneId, { artStyle: selectedStyleRef.current, forceFullPrompt: opts?.forceFullPrompt });
  };

  const handleModalRegenerateStrictStyle = async (sceneId: string, opts?: { forceFullPrompt?: string }) => {
    await handleGenerateImage(sceneId, {
      artStyle: selectedStyleRef.current,
      strictStyle: true,
      styleIntensity: 100,
      forceFullPrompt: opts?.forceFullPrompt,
    });
  };

  const handleReportStyleMismatch = async (sceneId: string, message: string) => {
    const sceneRow = scenes.find((s) => s.id === sceneId);
    if (!sceneRow) return;

    const existing =
      sceneRow.consistency_details && typeof sceneRow.consistency_details === "object" && !Array.isArray(sceneRow.consistency_details)
        ? (sceneRow.consistency_details as Record<string, unknown>)
        : {};

    const existingFeedback = Array.isArray(existing.style_feedback) ? (existing.style_feedback as unknown[]) : [];
    const nextFeedback = [
      ...existingFeedback,
      {
        created_at: new Date().toISOString(),
        message,
        requested_style: selectedStyleRef.current,
        style_intensity: styleIntensityRef.current,
      },
    ];

    const nextDetails = { ...existing, style_feedback: nextFeedback };
    await updateScene(sceneId, { consistency_details: nextDetails as Json, consistency_status: "warn" });
  };

  const illustratedCount = scenes.filter(s => s.generation_status === 'completed').length;
  const hasAnyGeneratedImages = scenes.some((s) => Boolean(s.image_url));
  const hasEligibleScenes = scenes.some(
    (s) => s.generation_status === "pending" || s.generation_status === "error",
  );

  const waitForPrintAssets = async (w: Window, args: { timeoutMs: number; sampleMs: number }) => {
    const startedAt = performance.now();
    const doc = w.document;
    const snapshotAt = args.sampleMs;
    let imagesLoadedAtSnapshot: number | null = null;

    const sample = async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, snapshotAt));
      const imgs = Array.from(doc.images ?? []);
      imagesLoadedAtSnapshot = imgs.filter((img) => img.complete && img.naturalWidth > 0).length;
    };

    const waitForLoad = new Promise<void>((resolve) => {
      if (doc.readyState === "complete") resolve();
      else w.addEventListener("load", () => resolve(), { once: true });
    });

    const waitForFonts =
      doc.fonts && typeof doc.fonts.ready?.then === "function" ? doc.fonts.ready.catch((e) => void e) : Promise.resolve();

    const waitForImages = async () => {
      const imgs = Array.from(doc.images ?? []);
      const total = imgs.length;
      const done = (img: HTMLImageElement) => img.complete && img.naturalWidth > 0;

      const promises = imgs.map(async (img) => {
        if (done(img)) return;
        const decode = (img as HTMLImageElement & { decode?: () => Promise<void> }).decode;
        if (typeof decode === "function") {
          try {
            await decode.call(img);
            return;
          } catch (e) {
            void e;
          }
        }
        await new Promise<void>((resolve) => {
          const finish = () => resolve();
          img.addEventListener("load", finish, { once: true });
          img.addEventListener("error", finish, { once: true });
        });
      });

      const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, args.timeoutMs));
      await Promise.race([Promise.all(promises).then(() => undefined), timeout]);
      const loaded = imgs.filter((img) => done(img)).length;
      return { total, loaded };
    };

    const samplePromise = sample();
    await waitForLoad;
    await waitForFonts;
    const imgResult = await waitForImages();
    await samplePromise;

    const elapsedMs = Math.round(performance.now() - startedAt);
    return {
      elapsedMs,
      imagesTotal: imgResult.total,
      imagesLoadedAtPrint: imgResult.loaded,
      imagesLoadedAtSample: imagesLoadedAtSnapshot ?? 0,
    };
  };

  const handleExportPDF = async () => {
    if (!story) {
      toast({ title: "Nothing to export", description: "Story is unavailable", variant: "destructive" });
      return;
    }
    if (!story.original_content) {
      toast({ title: "Nothing to export", description: "Story content is unavailable", variant: "destructive" });
      return;
    }

    toast({ title: "Generating PDF...", description: "Please wait while we create your PDF" });

    try {
      const printContent = buildAnchoredStoryHtmlDocument({
        title: story.title || "Story",
        originalContent: story.original_content,
        scenes: scenes.map((s) => ({
          id: s.id,
          scene_number: s.scene_number,
          title: s.title,
          original_text: s.original_text,
          summary: s.summary,
          image_url: s.image_url,
        })),
        sceneAnchors: storyAnchors,
      });

      const validation = validateStoryHtmlDocument(printContent);
      if (validation.ok === false) {
        toast({ title: "Export failed", description: validation.issues[0] ?? "Invalid export document.", variant: "destructive" });
        return;
      }

      const coverage = validateStoryHtmlSceneCoverage({
        html: printContent,
        scenes: scenes.map((s) => ({ id: s.id, scene_number: s.scene_number })),
      });
      if (coverage.ok === false) {
        toast({ title: "Export failed", description: `Missing scenes in export (${coverage.present}/${coverage.expected}, ${coverage.percentage}%).`, variant: "destructive" });
        return;
      }

      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        toast({ title: "Export failed", description: "Popup blocked. Allow popups to export PDF.", variant: "destructive" });
        return;
      }

      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();

      const assetMetrics = await waitForPrintAssets(printWindow, { timeoutMs: 15_000, sampleMs: 700 });
      toast({
        title: "PDF ready to print",
        description: `Scenes: ${coverage.present}/${coverage.expected} (${coverage.percentage}%). Images: ${assetMetrics.imagesLoadedAtPrint}/${assetMetrics.imagesTotal} (was ${assetMetrics.imagesLoadedAtSample}/${assetMetrics.imagesTotal} at 0.7s).`,
      });

      try {
        printWindow.print();
      } catch (error) {
        toast({ title: "Export failed", description: error instanceof Error ? error.message : "Failed to print PDF.", variant: "destructive" });
      }
    } catch (error) {
      console.error("Error exporting PDF:", error);
      toast({ title: "Export failed", description: "Failed to generate PDF", variant: "destructive" });
    }
  };

  const handleExportZIP = async () => {
    if (!story || scenes.length === 0) {
      toast({ title: "Nothing to export", description: "No scenes available", variant: "destructive" });
      return;
    }

    const scenesWithImages = scenes.filter(s => s.image_url);
    if (scenesWithImages.length === 0) {
      toast({ title: "No images to export", description: "Generate some images first", variant: "destructive" });
      return;
    }

    toast({ title: "Downloading images...", description: `Downloading ${scenesWithImages.length} images` });

    try {
      // Download each image individually since we can't create ZIPs client-side without a library
      for (const scene of scenesWithImages) {
        if (scene.image_url) {
          const response = await fetch(scene.image_url);
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${story.title.replace(/[^a-z0-9]/gi, '_')}_scene_${scene.scene_number}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          await new Promise(resolve => setTimeout(resolve, 300)); // Small delay between downloads
        }
      }
      toast({ title: "Download complete", description: `Downloaded ${scenesWithImages.length} images` });
    } catch (error) {
      console.error("Error downloading images:", error);
      toast({ title: "Download failed", description: "Failed to download images", variant: "destructive" });
    }
  };

  const handleExportPrint = () => {
    if (!story) {
      toast({ title: "Nothing to export", description: "Story is unavailable", variant: "destructive" });
      return;
    }
    if (!story.original_content) {
      toast({ title: "Nothing to export", description: "Story content is unavailable", variant: "destructive" });
      return;
    }

    const printContent = buildAnchoredStoryHtmlDocument({
      title: `${story.title || "Story"} - Print`,
      originalContent: story.original_content,
      scenes: scenes.map((s) => ({
        id: s.id,
        scene_number: s.scene_number,
        title: s.title,
        original_text: s.original_text,
        summary: s.summary,
        image_url: s.image_url,
      })),
      sceneAnchors: storyAnchors,
    });

    const validation = validateStoryHtmlDocument(printContent);
    if (validation.ok === false) {
      toast({ title: "Export failed", description: validation.issues[0] ?? "Invalid export document.", variant: "destructive" });
      return;
    }

    const coverage = validateStoryHtmlSceneCoverage({
      html: printContent,
      scenes: scenes.map((s) => ({ id: s.id, scene_number: s.scene_number })),
    });
    if (coverage.ok === false) {
      toast({ title: "Export failed", description: `Missing scenes in export (${coverage.present}/${coverage.expected}, ${coverage.percentage}%).`, variant: "destructive" });
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast({ title: "Print failed", description: "Popup blocked. Allow popups to print.", variant: "destructive" });
      return;
    }

    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();

    waitForPrintAssets(printWindow, { timeoutMs: 15_000, sampleMs: 700 })
      .then((assetMetrics) => {
        toast({
          title: "Print ready",
          description: `Scenes: ${coverage.present}/${coverage.expected} (${coverage.percentage}%). Images: ${assetMetrics.imagesLoadedAtPrint}/${assetMetrics.imagesTotal} (was ${assetMetrics.imagesLoadedAtSample}/${assetMetrics.imagesTotal} at 0.7s).`,
        });
        try {
          printWindow.print();
        } catch (error) {
          toast({ title: "Print failed", description: error instanceof Error ? error.message : "Printing failed.", variant: "destructive" });
        }
      })
      .catch((error) => {
        toast({ title: "Print failed", description: error instanceof Error ? error.message : "Printing failed.", variant: "destructive" });
      });
  };

  const handlePreview = () => {
    if (!story || scenes.length === 0) {
      toast({ title: "Nothing to preview", description: "No scenes available", variant: "destructive" });
      return;
    }

    const slidesHtml = scenes.map((scene, i) => {
      const imageHtml = scene.image_url
        ? '<img src="' + scene.image_url + '" alt="Scene ' + scene.scene_number + '" />'
        : '<div style="width:400px;height:300px;background:#222;display:flex;align-items:center;justify-content:center;border-radius:8px;">No image</div>';

      return '<div class="slide' + (i === 0 ? ' active' : '') + '" data-index="' + i + '">' +
        imageHtml +
        '<div class="slide-content">' +
        '<p class="slide-number">Scene ' + scene.scene_number + ' of ' + scenes.length + '</p>' +
        '<h2 class="slide-title">' + (scene.title || '') + '</h2>' +
        '<p class="slide-summary">' + (scene.summary || '') + '</p>' +
        '</div></div>';
    }).join('');

    const dotsHtml = scenes.map((_, i) =>
      '<div class="dot' + (i === 0 ? ' active' : '') + '" onclick="goToSlide(' + i + ')"></div>'
    ).join('');

    const previewContent = '<!DOCTYPE html><html><head><title>' + story.title + ' - Preview</title>' +
      '<style>' +
      '* { box-sizing: border-box; margin: 0; padding: 0; }' +
      'body { font-family: system-ui, sans-serif; background: #000; color: #fff; overflow: hidden; }' +
      '.container { width: 100vw; height: 100vh; display: flex; flex-direction: column; }' +
      '.main { flex: 1; display: flex; align-items: center; justify-content: center; position: relative; padding: 20px; }' +
      '.slide { display: none; flex-direction: column; align-items: center; max-width: 100%; max-height: 100%; }' +
      '.slide.active { display: flex; }' +
      '.slide img { max-width: 90vw; max-height: 60vh; object-fit: contain; border-radius: 8px; }' +
      '.slide-content { text-align: center; padding: 20px; max-width: 800px; }' +
      '.slide-number { font-size: 12px; color: #888; margin-bottom: 8px; }' +
      '.slide-title { font-size: 24px; font-weight: 600; margin-bottom: 10px; }' +
      '.slide-summary { color: #aaa; line-height: 1.6; }' +
      '.controls { display: flex; justify-content: center; gap: 10px; padding: 20px; }' +
      'button { background: #333; color: #fff; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 14px; }' +
      'button:hover { background: #444; }' +
      '.nav-btn { position: absolute; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,0.1); width: 50px; height: 50px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }' +
      '.nav-btn:hover { background: rgba(255,255,255,0.2); }' +
      '.prev { left: 20px; }' +
      '.next { right: 20px; }' +
      '.close { position: absolute; top: 20px; right: 20px; background: rgba(255,255,255,0.1); width: 40px; height: 40px; border-radius: 50%; }' +
      '.progress { display: flex; gap: 6px; justify-content: center; padding: 10px; }' +
      '.dot { width: 8px; height: 8px; border-radius: 50%; background: #444; cursor: pointer; }' +
      '.dot.active { background: #fff; }' +
      '</style></head><body>' +
      '<div class="container">' +
      '<button class="close" onclick="window.close()">✕</button>' +
      '<div class="main">' +
      '<button class="nav-btn prev" onclick="changeSlide(-1)">◀</button>' +
      slidesHtml +
      '<button class="nav-btn next" onclick="changeSlide(1)">▶</button>' +
      '</div>' +
      '<div class="progress">' + dotsHtml + '</div>' +
      '<div class="controls"><button onclick="toggleAutoplay()" id="autoplayBtn">▶ Autoplay</button></div>' +
      '</div>' +
      '<script>' +
      'let current = 0; let autoplayInterval = null;' +
      'const slides = document.querySelectorAll(".slide");' +
      'const dots = document.querySelectorAll(".dot");' +
      'function showSlide(index) { slides.forEach(s => s.classList.remove("active")); dots.forEach(d => d.classList.remove("active")); slides[index].classList.add("active"); dots[index].classList.add("active"); }' +
      'function changeSlide(dir) { current = (current + dir + slides.length) % slides.length; showSlide(current); }' +
      'function goToSlide(index) { current = index; showSlide(current); }' +
      'function toggleAutoplay() { const btn = document.getElementById("autoplayBtn"); if (autoplayInterval) { clearInterval(autoplayInterval); autoplayInterval = null; btn.textContent = "▶ Autoplay"; } else { autoplayInterval = setInterval(() => changeSlide(1), 3000); btn.textContent = "⏸ Pause"; } }' +
      'document.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") changeSlide(-1); if (e.key === "ArrowRight") changeSlide(1); if (e.key === "Escape") window.close(); });' +
      '</script></body></html>';

    const previewWindow = window.open('', '_blank');
    if (previewWindow) {
      previewWindow.document.write(previewContent);
      previewWindow.document.close();
    }
  };

  const openStoryInNewTab = () => {
    if (!story) {
      toast({ title: "Story unavailable", description: "No story is loaded", variant: "destructive" });
      return;
    }
    if (!story.original_content) {
      toast({ title: "Story content unavailable", description: "No imported text found for this story", variant: "destructive" });
      return;
    }

    try {
      const html = buildAnchoredStoryHtmlDocument({
        title: story.title || "Story",
        originalContent: story.original_content,
        scenes: scenes.map((s) => ({
          id: s.id,
          scene_number: s.scene_number,
          title: s.title,
          original_text: s.original_text,
          summary: s.summary,
          image_url: s.image_url,
        })),
        sceneAnchors: storyAnchors,
      });

      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const storyWindow = window.open(url, "_blank");

      if (!storyWindow) {
        URL.revokeObjectURL(url);
        toast({ title: "Popup blocked", description: "Allow popups to open the story view", variant: "destructive" });
        return;
      }

      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      storyWindow.focus();
    } catch (error) {
      console.error("Failed to open story view:", error);
      toast({ title: "Open failed", description: "Could not open the story view", variant: "destructive" });
    }
  };

  const handleStoryView = () => {
    setIsStoryOpening(true);
    try {
      setIsStoryModalOpen(true);
    } finally {
      setTimeout(() => setIsStoryOpening(false), 150);
    }
  };

  const clearStoryPrintResetTimer = () => {
    const t = storyPrintResetTimerRef.current;
    if (!t) return;
    window.clearTimeout(t);
    storyPrintResetTimerRef.current = null;
  };

  useEffect(() => {
    return () => clearStoryPrintResetTimer();
  }, []);

  useEffect(() => {
    if (!isStoryModalOpen) {
      setIsStoryPrinting(false);
      clearStoryPrintResetTimer();
      return;
    }

    const handleAfterPrint = () => {
      setIsStoryPrinting(false);
      clearStoryPrintResetTimer();
    };

    window.addEventListener("afterprint", handleAfterPrint);

    const mql = typeof window.matchMedia === "function" ? window.matchMedia("print") : null;
    const handleMqlChange = (e: MediaQueryListEvent) => {
      if (e.matches) return;
      setIsStoryPrinting(false);
      clearStoryPrintResetTimer();
    };

    if (mql) {
      const anyMql = mql as MediaQueryList & {
        addListener?: (listener: (e: MediaQueryListEvent) => void) => void;
      };
      if (typeof anyMql.addEventListener === "function") anyMql.addEventListener("change", handleMqlChange);
      else if (typeof anyMql.addListener === "function") anyMql.addListener(handleMqlChange);
    }

    return () => {
      window.removeEventListener("afterprint", handleAfterPrint);
      if (mql) {
        const anyMql = mql as MediaQueryList & {
          removeListener?: (listener: (e: MediaQueryListEvent) => void) => void;
        };
        if (typeof anyMql.removeEventListener === "function") anyMql.removeEventListener("change", handleMqlChange);
        else if (typeof anyMql.removeListener === "function") anyMql.removeListener(handleMqlChange);
      }
    };
  }, [isStoryModalOpen]);

  const handleStoryModalPrint = async () => {
    if (isStoryPrinting) return;
    if (!story) {
      toast({ title: "Nothing to print", description: "Story is unavailable", variant: "destructive" });
      return;
    }
    if (!story.original_content) {
      toast({ title: "Nothing to print", description: "Story content is unavailable", variant: "destructive" });
      return;
    }
    if (typeof window.print !== "function") {
      toast({ title: "Print unavailable", description: "This browser does not support printing.", variant: "destructive" });
      return;
    }

    setIsStoryPrinting(true);
    clearStoryPrintResetTimer();
    storyPrintResetTimerRef.current = window.setTimeout(() => {
      setIsStoryPrinting(false);
      storyPrintResetTimerRef.current = null;
    }, 20_000);

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setIsStoryPrinting(false);
      clearStoryPrintResetTimer();
      toast({ title: "Popup blocked", description: "Allow popups to print the story.", variant: "destructive" });
      return;
    }

    const html = buildAnchoredStoryHtmlDocument({
      title: `${story.title || "Story"} - Print`,
      originalContent: story.original_content,
      scenes: scenes.map((s) => ({
        id: s.id,
        scene_number: s.scene_number,
        title: s.title,
        original_text: s.original_text,
        summary: s.summary,
        image_url: s.image_url,
      })),
      sceneAnchors: storyAnchors,
    });

    const validation = validateStoryHtmlDocument(html);
    if (validation.ok === false) {
      setIsStoryPrinting(false);
      clearStoryPrintResetTimer();
      toast({ title: "Print failed", description: validation.issues[0] ?? "Invalid print document.", variant: "destructive" });
      try {
        printWindow.close();
      } catch (error) {
        void error;
      }
      return;
    }

    const coverage = validateStoryHtmlSceneCoverage({
      html,
      scenes: scenes.map((s) => ({ id: s.id, scene_number: s.scene_number })),
    });
    if (coverage.ok === false) {
      setIsStoryPrinting(false);
      clearStoryPrintResetTimer();
      toast({ title: "Print failed", description: `Missing scenes in print (${coverage.present}/${coverage.expected}, ${coverage.percentage}%).`, variant: "destructive" });
      try {
        printWindow.close();
      } catch (error) {
        void error;
      }
      return;
    }

    const handlePrinted = () => {
      setIsStoryPrinting(false);
      clearStoryPrintResetTimer();
    };

    try {
      if (typeof printWindow.addEventListener === "function") printWindow.addEventListener("afterprint", handlePrinted);
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      await waitForPrintAssets(printWindow, { timeoutMs: 15_000, sampleMs: 700 });
      printWindow.print();
    } catch (error) {
      handlePrinted();
      toast({ title: "Print failed", description: error instanceof Error ? error.message : "Printing failed.", variant: "destructive" });
      try {
        printWindow.close();
      } catch (closeError) {
        void closeError;
      }
    }
  };

  const sceneAnchorsKey = "scene_anchors_v1";

  const storyAnchors = useMemo((): StorySceneAnchors => {
    const base =
      story?.consistency_settings && typeof story.consistency_settings === "object" && !Array.isArray(story.consistency_settings)
        ? (story.consistency_settings as Record<string, unknown>)
        : {};
    const raw = base[sceneAnchorsKey];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const rec = raw as Record<string, unknown>;
    const next: StorySceneAnchors = {};
    for (const [k, v] of Object.entries(rec)) {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      if (!Number.isFinite(n)) continue;
      next[k] = Math.trunc(n);
    }
    return next;
  }, [sceneAnchorsKey, story?.consistency_settings]);

  const persistStoryAnchors = async (args: {
    nextAnchors: StorySceneAnchors;
    baseUpdatedAt: string | null | undefined;
  }): Promise<{ ok: true; updatedAt: string | null } | { ok: false; reason: string; updatedAt?: string | null }> => {
    if (!storyId) return { ok: false, reason: "Story unavailable" };

    const base =
      story?.consistency_settings && typeof story.consistency_settings === "object" && !Array.isArray(story.consistency_settings)
        ? (story.consistency_settings as Record<string, unknown>)
        : {};
    const nextSettings = { ...base, [sceneAnchorsKey]: args.nextAnchors };

    try {
      let query = supabase
        .from("stories")
        .update({ consistency_settings: nextSettings as Json })
        .eq("id", storyId);

      if (args.baseUpdatedAt) query = query.eq("updated_at", args.baseUpdatedAt);

      const { data, error } = await query.select("*").maybeSingle();
      if (error) throw error;

      if (!data) {
        return {
          ok: false,
          reason: "This story changed elsewhere. Reopen the story view and try again.",
          updatedAt: args.baseUpdatedAt ?? null,
        };
      }

      setStory(data as Story);
      await fetchStories();
      return { ok: true, updatedAt: (data as Story).updated_at ?? null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save scene positions";
      return { ok: false, reason: message, updatedAt: args.baseUpdatedAt ?? null };
    }
  };

  if (!storyId) {
    return (
      <Layout>
        <div className="container mx-auto px-6 py-12">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="font-display text-3xl font-bold text-foreground mb-2">
                Your Storyboards
              </h1>
              <p className="text-muted-foreground">
                Select a story to view its storyboard
              </p>
            </div>
            <Button variant="hero" onClick={() => navigate('/import')}>
              Import New Story
            </Button>
          </div>

          {stories.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {stories.map((s) => {
                const sceneCount = s.scene_count || 0;
                const completed = s.completed_scenes || 0;
                const progress =
                  sceneCount > 0 ? Math.max(0, Math.min(100, Math.round((completed / sceneCount) * 100))) : 0;
                const barColorClass = progress >= 100 ? "bg-green-500" : progress > 0 ? "bg-yellow-500" : "bg-red-500";
                const remaining = Math.max(0, sceneCount - completed);

                return (
                  <Card
                    key={s.id}
                    variant="interactive"
                    className="cursor-pointer p-6 hover:border-primary/50 transition-colors relative group"
                    onClick={() => navigate(`/storyboard/${s.id}`)}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        setStoryToDelete(s);
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <div className="flex items-start justify-between mb-3">
                      <BookOpen className="w-8 h-8 text-primary" />
                      <Badge
                        variant={s.status === 'analyzed' || s.status === 'completed' ? 'default' : 'outline'}
                        className={s.status === 'analyzed' || s.status === 'completed' ? 'bg-green-500/20 text-green-400' : ''}
                      >
                        {s.status}
                      </Badge>
                    </div>
                    <h3 className="font-semibold text-lg text-foreground mb-2 line-clamp-1">
                      {s.title}
                    </h3>
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                      {s.description || 'No description'}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{s.word_count?.toLocaleString() || 0} words</span>
                      <span>{s.scene_count || 0} scenes</span>
                    </div>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="mt-3">
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                            <span>{sceneCount} scenes</span>
                            <span>{progress}%</span>
                          </div>
                          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                            <div
                              className={`h-full ${barColorClass} rounded-full transition-all duration-500`}
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="space-y-1">
                          <div className="font-medium">Progress</div>
                          {sceneCount > 0 ? (
                            <>
                              <div className="text-xs text-muted-foreground">
                                Completed: {completed}/{sceneCount} scenes
                              </div>
                              <div className="text-xs text-muted-foreground">Remaining: {remaining}</div>
                            </>
                          ) : (
                            <div className="text-xs text-muted-foreground">No scenes yet</div>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>

                    <p className="text-xs text-muted-foreground mt-2">
                      Updated {new Date(s.updated_at).toLocaleDateString()}
                    </p>
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-16 bg-secondary/30 rounded-xl border border-border/50">
              <BookOpen className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-foreground mb-2">No Stories Yet</h2>
              <p className="text-muted-foreground mb-6">
                Import your first story to get started
              </p>
              <Button variant="hero" onClick={() => navigate('/import')}>
                Import Story
              </Button>
            </div>
          )}
        </div>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!storyToDelete} onOpenChange={(open) => !open && setStoryToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Story</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{storyToDelete?.title}"? This will permanently remove the story and all its scenes. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteStory}
                disabled={isDeleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-6 py-12">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <BookOpen className="w-6 h-6 text-primary" />
              <Badge variant="outline" className="text-primary border-primary">
                {scenes.length} Scenes
              </Badge>
              <Badge className="bg-green-500/20 text-green-400">
                {illustratedCount} Illustrated
              </Badge>
            </div>
            <h1 className="font-display text-4xl font-bold text-foreground mb-2">
              {story?.title || "Loading..."}
            </h1>
            <p className="text-muted-foreground">
              {story?.word_count?.toLocaleString()} words • Last edited {story ? new Date(story.updated_at).toLocaleDateString() : '...'}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="hero"
              size="lg"
              className="gap-2"
              onClick={handleGenerateAll}
              disabled={isGenerating || scenes.length === 0}
            >
              <Wand2 className={`w-5 h-5 ${isGenerating ? "animate-spin" : ""}`} />
              {isGenerating
                ? batchSceneIds.length > 0
                  ? `${batchMode === "regenerate" ? "Regenerating" : "Generating"} ${batchDoneCount}/${batchSceneIds.length}${batchFailedCount > 0 ? ` (${batchFailedCount} failed)` : ""}`
                  : batchMode === "regenerate"
                    ? "Regenerating..."
                    : "Generating..."
                : "Generate All"}
            </Button>
            {(isGenerating || scenes.some(s => s.generation_status === 'generating')) && (
              <Button
                variant="destructive"
                size="lg"
                className="gap-2"
                onClick={handleStopGenerating}
              >
                <Square className="w-5 h-5 fill-current" />
                Stop Generating
              </Button>
            )}
            <Button variant="outline" size="lg" className="gap-2" onClick={handlePreview}>
              <Play className="w-5 h-5" />
              Preview
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="gap-2"
              type="button"
              onClick={handleStoryView}
              aria-label="Open story view"
            >
              <BookOpen className="w-5 h-5" />
              Story
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="lg" className="gap-2">
                  <Download className="w-5 h-5" />
                  Export
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportPDF}>
                  <FileText className="w-4 h-4 mr-2" />
                  Export as PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportZIP}>
                  <FolderArchive className="w-4 h-4 mr-2" />
                  Download Images
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportPrint}>
                  <Printer className="w-4 h-4 mr-2" />
                  Export for Print
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Model Selector */}
        <div className="mb-10">
          <ModelSelector
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            selectedResolution={selectedResolution}
            onResolutionChange={setSelectedResolution}
          />
        </div>

        {/* Style Selector */}
        <div className="mb-10">
          <StyleSelector
            selectedStyle={selectedStyle}
            onStyleChange={handleStyleChange}
            styleIntensity={styleIntensity}
            onStyleIntensityChange={handleStyleIntensityChange}
            onDisabledStyleElementsChange={handleDisabledStyleElementsChange}
          />
        </div>

        <div className="mb-10 rounded-xl border border-border/50 bg-secondary/10 p-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label className="text-sm text-muted-foreground">Consistency Mode</Label>
              <Select value={consistencyMode} onValueChange={handleConsistencyModeChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="strict">Strict</SelectItem>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="flexible">Flexible</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between gap-3">
              <Label className="text-sm text-muted-foreground">Auto-correct minor inconsistencies</Label>
              <Switch checked={autoCorrectEnabled} onCheckedChange={handleAutoCorrectChange} />
            </div>

            <div className="flex items-center justify-between gap-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm text-muted-foreground">Character Image Reference</Label>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Use character images as visual references when generating scene illustrations.</p>
                </TooltipContent>
              </Tooltip>
              <Switch checked={characterImageReferenceEnabled} onCheckedChange={handleCharacterImageReferenceChange} />
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-8 w-full justify-start border-b rounded-none h-auto p-0 bg-transparent">
            <TabsTrigger
              value="scenes"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 py-3"
            >
              Scenes
            </TabsTrigger>
            <TabsTrigger
              value="characters"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 py-3"
            >
              Characters
            </TabsTrigger>
          </TabsList>

          <TabsContent value="characters">
            {storyId && (
              <CharacterList
                storyId={storyId}
                selectedArtStyle={selectedStyle}
                selectedModel={selectedModel}
                styleIntensity={styleIntensity}
                strictStyle={consistencyMode === "strict"}
                disabledStyleElements={disabledStyleElementsByStyle[selectedStyle] ?? []}
              />
            )}
          </TabsContent>

          <TabsContent value="scenes">
            {/* Scenes Grid */}
            {scenesLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Skeleton key={i} className="h-80 rounded-xl" />
                ))}
              </div>
            ) : scenes.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {scenes.map((scene) => {
                  const isSceneGenerating = scene.generation_status === "generating" || generatingSceneId === scene.id;
                  const isSceneError = scene.generation_status === "error";

                  return (
                    <Card
                      key={scene.id}
                      variant="interactive"
                      className="overflow-hidden cursor-pointer"
                      onClick={() => handleSceneClick(scene)}
                    >
                      {/* Image Area */}
                      <div className="aspect-video bg-secondary relative overflow-hidden">
                        {scene.image_url ? (
                          <img
                            src={scene.image_url}
                            alt={scene.title || `Scene ${scene.scene_number}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            {isSceneGenerating ? (
                              <div className="text-center">
                                <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-2" />
                                <p className="text-sm text-muted-foreground">Generating...</p>
                              </div>
                            ) : (
                              <div className="text-center">
                                <ImageIcon className="w-12 h-12 text-muted-foreground/50 mx-auto mb-2" />
                                {isSceneError && (
                                  <p className="text-sm text-destructive mb-2">Generation failed</p>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className={isSceneError ? "border-destructive/50 text-destructive hover:text-destructive" : undefined}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleGenerateImage(scene.id);
                                  }}
                                >
                                  <Wand2 className="w-4 h-4 mr-2" />
                                  {isSceneError ? "Retry" : "Generate"}
                                </Button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Scene number badge */}
                        <Badge className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm text-white border-white/20 shadow-sm">
                          Scene {scene.scene_number}
                        </Badge>

                        {scene.consistency_status && (
                          <Badge
                            className={`absolute bottom-2 left-2 bg-background/80 backdrop-blur-sm ${scene.consistency_status === "pass"
                              ? "text-green-600"
                              : scene.consistency_status === "warn"
                                ? "text-yellow-600"
                                : "text-red-600"
                              }`}
                          >
                            Consistency{" "}
                            {typeof scene.consistency_score === "number"
                              ? Math.round(scene.consistency_score)
                              : "--"}
                          </Badge>
                        )}

                        {/* Regenerate button */}
                        {scene.image_url && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="absolute top-2 right-2 bg-background/80 backdrop-blur-sm h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleGenerateImage(scene.id);
                            }}
                            disabled={isSceneGenerating}
                          >
                            <RefreshCw className={`w-4 h-4 ${isSceneGenerating ? 'animate-spin' : ''}`} />
                          </Button>
                        )}
                      </div>

                      {/* Scene Info */}
                      <div className="p-4">
                        <h3 className="font-semibold text-foreground mb-1">
                          {scene.title || `Scene ${scene.scene_number}`}
                        </h3>
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                          {scene.summary}
                        </p>

                        <div className="flex flex-wrap gap-2">
                          {scene.emotional_tone && (
                            <Badge variant="outline" className="text-xs">
                              {scene.emotional_tone}
                            </Badge>
                          )}
                          {scene.consistency_status && (
                            <Badge variant="outline" className="text-xs">
                              {scene.consistency_status.toUpperCase()}
                            </Badge>
                          )}
                          {scene.characters?.slice(0, 2).map((char) => (
                            <Badge key={char} variant="secondary" className="text-xs">
                              {char}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-16 bg-secondary/30 rounded-xl border border-border/50">
                <p className="text-muted-foreground mb-4">No scenes found</p>
                <p className="text-sm text-muted-foreground">
                  This story hasn't been analyzed yet
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog open={isRegenerateAllDialogOpen} onOpenChange={setIsRegenerateAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasEligibleScenes && hasAnyGeneratedImages
                ? "Generate remaining scenes or regenerate all?"
                : "Regenerate all scene images?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hasEligibleScenes && hasAnyGeneratedImages
                ? "Some scenes are still pending/failed. You can continue generating only the remaining scenes, or regenerate everything from scratch. Regenerating will clear all previously generated scene images for this story. This action cannot be undone."
                : "This will clear all previously generated scene images for this story and regenerate them from scratch. This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isGenerating}>Cancel</AlertDialogCancel>
            {hasEligibleScenes && hasAnyGeneratedImages && (
              <AlertDialogAction
                onClick={handleGenerateRemainingFromDialog}
                disabled={isGenerating}
                className="bg-secondary text-foreground hover:bg-secondary/80"
              >
                Generate Remaining
              </AlertDialogAction>
            )}
            <AlertDialogAction
              onClick={handleConfirmRegenerateAll}
              disabled={isGenerating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Regenerate All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Scene Detail Modal */}
      <SceneDetailModal
        scene={scenes.find(s => s.id === selectedScene?.id) || selectedScene}
        allScenes={scenes}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedScene(null);
        }}
        onSavePrompt={handleSavePrompt}
        onSaveCharacterStates={handleSaveCharacterStates}
        onRegenerate={handleModalRegenerate}
        onRegenerateStrictStyle={handleModalRegenerateStrictStyle}
        onFetchFullPrompt={fetchFullScenePrompt}
        onReportStyleMismatch={handleReportStyleMismatch}
        onImageEdited={(sceneId, imageUrl) => {
          setScenes((prev) => prev.map((s) => (s.id === sceneId ? { ...s, image_url: imageUrl } : s)));
          setSelectedScene((prev) => (prev?.id === sceneId ? { ...prev, image_url: imageUrl } : prev));
          void fetchScenes();
        }}
        isGenerating={
          (selectedScene?.generation_status === "generating") || generatingSceneId === selectedScene?.id
        }
        debugInfo={selectedScene ? debugInfo[selectedScene.id] : undefined}
      />

      <Dialog open={isStoryModalOpen} onOpenChange={setIsStoryModalOpen}>
        <DialogContent
          id="story-modal-print-root"
          className="w-[95vw] sm:w-[90vw] max-w-[78.5rem] max-h-[95vh] min-h-[60vh] sm:min-h-[70vh] lg:min-h-[80vh] overflow-y-auto"
        >
          <DialogHeader className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <DialogTitle className="font-display text-xl">{story?.title || "Story"}</DialogTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  type="button"
                  onClick={handleStoryModalPrint}
                  disabled={isStoryPrinting}
                  aria-label="Print"
                >
                  {isStoryPrinting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                  Print
                </Button>
                <Button variant="outline" size="sm" className="gap-2" type="button" onClick={openStoryInNewTab}>
                  <Play className="w-4 h-4" />
                  Open in Tab
                </Button>
              </div>
            </div>
            {isStoryOpening && <div className="text-sm text-muted-foreground">Loading…</div>}
            {isStoryPrinting && <div className="text-sm text-muted-foreground" aria-live="polite">Opening print dialog…</div>}
          </DialogHeader>

          {!story ? (
            <div className="text-sm text-muted-foreground">Story unavailable</div>
          ) : !story.original_content ? (
            <div className="text-sm text-muted-foreground">Story content is unavailable</div>
          ) : (
            <StorySceneDragDropEditor
              originalContent={story.original_content}
              scenes={scenes.map((s) => ({
                id: s.id,
                scene_number: s.scene_number,
                title: s.title,
                summary: s.summary,
                original_text: s.original_text,
                image_url: s.image_url,
              }))}
              initialAnchors={storyAnchors}
              updatedAt={story.updated_at}
              onPersistAnchors={persistStoryAnchors}
              onToast={(args) => toast(args)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
