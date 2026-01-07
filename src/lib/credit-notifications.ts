/**
 * Credit notification utilities
 * 
 * Provides real-time user feedback when credits are restored or deducted.
 * Used by image generation components to inform users of credit status changes.
 */

import { toast } from "@/hooks/use-toast";

export interface CreditRestoreInfo {
    remaining_monthly?: number;
    remaining_bonus?: number;
    tier?: string;
    restored_amount?: number;
    reason?: string;
    feature?: string;
}

export interface CreditDeductInfo {
    consumed: number;
    remaining_monthly?: number;
    remaining_bonus?: number;
    tier?: string;
}

/**
 * Shows a notification when credits have been restored (e.g., after a failed generation)
 */
export function notifyCreditsRestored(info: CreditRestoreInfo): void {
    const totalRemaining = (info.remaining_monthly ?? 0) + (info.remaining_bonus ?? 0);

    // Build a user-friendly reason
    let reasonText = "Credits have been restored";
    if (info.reason) {
        const lowerReason = info.reason.toLowerCase();
        if (lowerReason.includes("failed") || lowerReason.includes("error")) {
            reasonText = "Generation failed - credits refunded";
        } else if (lowerReason.includes("timeout")) {
            reasonText = "Generation timed out - credits refunded";
        } else if (lowerReason.includes("api") || lowerReason.includes("upstream")) {
            reasonText = "Service issue - credits refunded";
        }
    }

    toast({
        title: "💰 Credits Restored",
        description: `${reasonText}. You now have ${totalRemaining} credits remaining.`,
    });
}

/**
 * Shows a notification when credits have been deducted for a successful operation
 */
export function notifyCreditsDeducted(info: CreditDeductInfo): void {
    const totalRemaining = (info.remaining_monthly ?? 0) + (info.remaining_bonus ?? 0);

    // Don't show toast for every successful deduction - could be too noisy
    // Instead, this is available for explicit use when needed
    if (totalRemaining <= 3 && totalRemaining > 0) {
        toast({
            title: "⚠️ Low Credits",
            description: `You have ${totalRemaining} credits remaining.`,
            variant: "default",
        });
    } else if (totalRemaining === 0) {
        toast({
            title: "🛑 Out of Credits",
            description: "You've used all your credits. Purchase more to continue.",
            variant: "destructive",
        });
    }
}

/**
 * Parse credits info from an API response and notify if credits were restored
 */
export function handleCreditResponseNotification(response: unknown): void {
    if (!response || typeof response !== "object") return;

    const res = response as Record<string, unknown>;

    // Check if this is a failure response with credits info (meaning credits were restored)
    if (res.error && res.credits) {
        const credits = res.credits as Record<string, unknown>;
        notifyCreditsRestored({
            remaining_monthly: typeof credits.remaining_monthly === "number" ? credits.remaining_monthly : undefined,
            remaining_bonus: typeof credits.remaining_bonus === "number" ? credits.remaining_bonus : undefined,
            tier: typeof credits.tier === "string" ? credits.tier : undefined,
            reason: typeof res.error === "string" ? res.error : undefined,
        });
    }

    // Check if this is a success response with credits info
    if (res.success && res.credits) {
        const credits = res.credits as Record<string, unknown>;
        const consumed = typeof credits.consumed === "number" ? credits.consumed : 1;
        notifyCreditsDeducted({
            consumed,
            remaining_monthly: typeof credits.remaining_monthly === "number" ? credits.remaining_monthly : undefined,
            remaining_bonus: typeof credits.remaining_bonus === "number" ? credits.remaining_bonus : undefined,
            tier: typeof credits.tier === "string" ? credits.tier : undefined,
        });
    }
}

/**
 * Extracts credit information from a response object for display
 */
export function extractCreditInfo(response: unknown): {
    hasCredits: boolean;
    remaining: number;
    tier?: string;
    restored?: boolean;
} {
    if (!response || typeof response !== "object") {
        return { hasCredits: false, remaining: 0 };
    }

    const res = response as Record<string, unknown>;

    if (!res.credits || typeof res.credits !== "object") {
        return { hasCredits: false, remaining: 0 };
    }

    const credits = res.credits as Record<string, unknown>;
    const remainingMonthly = typeof credits.remaining_monthly === "number" ? credits.remaining_monthly : 0;
    const remainingBonus = typeof credits.remaining_bonus === "number" ? credits.remaining_bonus : 0;
    const tier = typeof credits.tier === "string" ? credits.tier : undefined;

    // If there's an error, credits were restored
    const restored = Boolean(res.error);

    return {
        hasCredits: true,
        remaining: remainingMonthly + remainingBonus,
        tier,
        restored,
    };
}
