
import { SupabaseClient } from "@supabase/supabase-js";

export type ReconcileCreditsArgs = {
  requestId: string;
  reason: string;
  metadata?: Record<string, unknown>;
  userId: string;
};

export const reconcileFailedGenerationCredits = async (
  supabase: SupabaseClient,
  args: ReconcileCreditsArgs
) => {
  const { requestId, reason, metadata, userId } = args;
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!userId || !requestId || !UUID_REGEX.test(requestId)) {
    return { success: false, error: "Invalid parameters" };
  }

  // 1. Mark the attempt as failed in DB (best effort)
  try {
    await supabase
      .from("image_generation_attempts")
      .update({
        status: "failed",
        error_message: reason || "Client validation failed",
      })
      .eq("request_id", requestId);
  } catch (e) {
    console.warn("Failed to update attempt status:", e);
  }

  // 2. Release any reservation
  let releaseResult = null;
  try {
    const { data, error } = await supabase.rpc("release_reserved_credits", {
      p_user_id: userId,
      p_request_id: requestId,
      p_reason: reason,
      p_metadata: (metadata ?? {}) as Record<string, unknown>,
    });
    if (!error) releaseResult = data;
  } catch (e) {
    console.warn("Release RPC failed:", e);
  }

  // 3. Refund if already consumed
  let refundResult = null;
  try {
    const { data, error } = await supabase.rpc("refund_consumed_credits", {
      p_user_id: userId,
      p_request_id: requestId,
      p_reason: reason,
      p_metadata: (metadata ?? {}) as Record<string, unknown>,
    });
    if (!error) refundResult = data;
  } catch (e) {
    console.warn("Refund RPC failed:", e);
  }

  return {
    success: true,
    release: releaseResult,
    refund: refundResult,
    finalAction: refundResult ? "refund" : releaseResult ? "release" : "none"
  };
};
