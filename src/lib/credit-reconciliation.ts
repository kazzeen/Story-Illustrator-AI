
import { SupabaseClient } from "@supabase/supabase-js";
import { isRecord, UUID_REGEX } from "@/lib/type-guards";

export type ReconcileCreditsArgs = {
  requestId: string;
  reason: string;
  metadata?: Record<string, unknown>;
};

const inFlightReconciles = new Map<string, Promise<{ success: boolean; error?: string; reconcile?: unknown }>>();

export const reconcileFailedGenerationCredits = async (
  supabase: SupabaseClient,
  args: ReconcileCreditsArgs
) => {
  const { requestId, reason, metadata } = args;

  if (!requestId || !UUID_REGEX.test(requestId)) {
    return { success: false, error: "Invalid parameters" };
  }

  const existing = inFlightReconciles.get(requestId);
  if (existing) return await existing;

  const run = (async () => {
  const failureTimestamp = new Date().toISOString();
  const stageRaw =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).stage ?? (metadata as Record<string, unknown>).error_stage
      : undefined;
  const errorStage = typeof stageRaw === "string" && stageRaw.trim() ? stageRaw.trim() : "client_validation";
  const mergedMetadata = {
    ...(metadata ?? {}),
    failure_timestamp: failureTimestamp,
    failure_reason: reason,
  } as Record<string, unknown>;

  // 1. Mark the attempt as failed in DB (best effort)
  try {
    await supabase
      .from("image_generation_attempts")
      .update({
        status: "failed",
        error_stage: errorStage,
        error_message: reason || "Client validation failed",
        metadata: mergedMetadata,
      })
      .eq("request_id", requestId);
  } catch (e) {
    console.warn("Failed to update attempt status:", e);
  }

  let reconcileResult: unknown = null;
  try {
    const { data, error } = await supabase.rpc("reconcile_failed_generation_credits", {
      p_request_id: requestId,
      p_reason: reason,
      p_metadata: mergedMetadata,
    });
    if (!error) reconcileResult = data;
  } catch (e) {
    console.warn("Reconcile RPC failed:", e);
  }

  const rec =
    reconcileResult && typeof reconcileResult === "object" && !Array.isArray(reconcileResult)
      ? (reconcileResult as Record<string, unknown>)
      : null;

  const recOk = Boolean(rec && rec.ok === true);
  const release = rec && isRecord(rec.release) ? rec.release : null;
  const refund = rec && isRecord(rec.refund) ? rec.refund : null;
  const hasReleaseOrRefundInfo = Boolean(rec && ("release" in rec || "refund" in rec));
  const releaseOk =
    Boolean(release && release.ok === true) ||
    Boolean(release && (release.already_released === true || release.already_reconciled === true));
  const refundOk = Boolean(refund && refund.ok === true) || Boolean(refund && refund.already_refunded === true);
  const recEffectiveOk = recOk && (!hasReleaseOrRefundInfo || releaseOk || refundOk);

  let forcedRefundResult: unknown = null;
  if (!recEffectiveOk) {
    try {
      // Get user ID from the image generation attempt
      const { data: attemptData, error: attemptError } = await supabase
        .from("image_generation_attempts")
        .select("user_id")
        .eq("request_id", requestId)
        .single();
        
      if (!attemptError && attemptData) {
        const { data, error } = await supabase.rpc("force_refund_credits", {
          p_user_id: attemptData.user_id,
          p_request_id: requestId,
          p_reason: reason,
          p_metadata: mergedMetadata,
        });
        if (!error) forcedRefundResult = data;
      } else {
        // Fallback to old function if we can't get user ID
        const { data, error } = await supabase.rpc("force_refund_request", {
          p_request_id: requestId,
          p_reason: reason,
        });
        if (!error) forcedRefundResult = data;
      }
    } catch (e) {
      console.warn("Force refund RPC failed:", e);
      // Fallback to old function if new one doesn't exist
      try {
        const { data, error } = await supabase.rpc("force_refund_request", {
          p_request_id: requestId,
          p_reason: reason,
        });
        if (!error) forcedRefundResult = data;
      } catch (fallbackError) {
        console.warn("Fallback force refund RPC failed:", fallbackError);
      }
    }
  }

  const forced =
    forcedRefundResult && typeof forcedRefundResult === "object" && !Array.isArray(forcedRefundResult)
      ? (forcedRefundResult as Record<string, unknown>)
      : null;

  const combined =
    rec || forced
      ? {
          ...(rec ?? {}),
          ...(forced ? { force_refund: forced } : {}),
        }
      : null;

  return {
    success: Boolean(recEffectiveOk || (forced && forced.ok === true)),
    reconcile: combined ?? reconcileResult ?? forcedRefundResult,
  };
  })().finally(() => {
    inFlightReconciles.delete(requestId);
  });

  inFlightReconciles.set(requestId, run);
  return await run;
};
