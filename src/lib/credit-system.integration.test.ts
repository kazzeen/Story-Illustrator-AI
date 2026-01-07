/**
 * Credit System Integration Tests (E2E simulation)
 * 
 * These tests verify the end-to-end credit handling flow:
 * 1. Credit reservation before generation
 * 2. Credit commit on success
 * 3. Credit release on failure
 * 4. Compensation for missed releases
 * 
 * Note: These are simulation-based tests that verify the logic flow.
 * For actual E2E tests against a real Supabase instance, use a separate test database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Simulated database state
interface CreditReservation {
    request_id: string;
    user_id: string;
    amount: number;
    monthly_amount: number;
    bonus_amount: number;
    status: "reserved" | "committed" | "released";
    metadata: Record<string, unknown>;
}

interface UserCredits {
    user_id: string;
    monthly_credits_per_cycle: number;
    monthly_credits_used: number;
    reserved_monthly: number;
    bonus_credits_total: number;
    bonus_credits_used: number;
    reserved_bonus: number;
}

interface CreditTransaction {
    id: string;
    user_id: string;
    amount: number;
    transaction_type: "reservation" | "usage" | "release" | "refund";
    description: string;
    request_id: string;
    created_at: Date;
}

interface ImageGenerationAttempt {
    request_id: string;
    user_id: string;
    feature: string;
    status: "started" | "succeeded" | "failed";
    credits_amount: number;
    error_stage?: string;
    error_message?: string;
}

// Simulated database
class MockDatabase {
    reservations: Map<string, CreditReservation> = new Map();
    userCredits: Map<string, UserCredits> = new Map();
    transactions: CreditTransaction[] = [];
    attempts: Map<string, ImageGenerationAttempt> = new Map();
    monitoringEvents: Array<{ event_type: string; details: Record<string, unknown> }> = [];

    constructor() {
        this.reset();
    }

    reset() {
        this.reservations.clear();
        this.userCredits.clear();
        this.transactions = [];
        this.attempts.clear();
        this.monitoringEvents = [];

        // Set up a default user with credits
        this.userCredits.set("test-user", {
            user_id: "test-user",
            monthly_credits_per_cycle: 10,
            monthly_credits_used: 0,
            reserved_monthly: 0,
            bonus_credits_total: 5,
            bonus_credits_used: 0,
            reserved_bonus: 0,
        });
    }

    getAvailableCredits(userId: string): number {
        const credits = this.userCredits.get(userId);
        if (!credits) return 0;
        const monthlyAvailable = credits.monthly_credits_per_cycle - credits.monthly_credits_used - credits.reserved_monthly;
        const bonusAvailable = credits.bonus_credits_total - credits.bonus_credits_used - credits.reserved_bonus;
        return Math.max(0, monthlyAvailable) + Math.max(0, bonusAvailable);
    }

    reserveCredits(userId: string, requestId: string, amount: number): { ok: boolean; reason?: string } {
        const credits = this.userCredits.get(userId);
        if (!credits) return { ok: false, reason: "missing_credit_account" };

        // Check for existing reservation (idempotency)
        const existing = this.reservations.get(requestId);
        if (existing && existing.user_id === userId) {
            return { ok: true }; // Idempotent
        }

        const available = this.getAvailableCredits(userId);
        if (available < amount) {
            return { ok: false, reason: "insufficient_credits" };
        }

        // Reserve from monthly first, then bonus
        const monthlyAvailable = credits.monthly_credits_per_cycle - credits.monthly_credits_used - credits.reserved_monthly;
        const monthlyReserve = Math.min(amount, monthlyAvailable);
        const bonusReserve = amount - monthlyReserve;

        credits.reserved_monthly += monthlyReserve;
        credits.reserved_bonus += bonusReserve;

        this.reservations.set(requestId, {
            request_id: requestId,
            user_id: userId,
            amount,
            monthly_amount: monthlyReserve,
            bonus_amount: bonusReserve,
            status: "reserved",
            metadata: {},
        });

        this.transactions.push({
            id: crypto.randomUUID(),
            user_id: userId,
            amount: -amount,
            transaction_type: "reservation",
            description: "Credit reservation",
            request_id: requestId,
            created_at: new Date(),
        });

        return { ok: true };
    }

    commitReservedCredits(userId: string, requestId: string): { ok: boolean; reason?: string } {
        const reservation = this.reservations.get(requestId);
        if (!reservation || reservation.user_id !== userId) {
            return { ok: false, reason: "missing_reservation" };
        }

        if (reservation.status === "committed") {
            return { ok: true }; // Idempotent
        }

        if (reservation.status !== "reserved") {
            return { ok: false, reason: "invalid_reservation_state" };
        }

        const credits = this.userCredits.get(userId);
        if (!credits) return { ok: false, reason: "missing_credit_account" };

        // Move from reserved to used
        credits.reserved_monthly = Math.max(0, credits.reserved_monthly - reservation.monthly_amount);
        credits.reserved_bonus = Math.max(0, credits.reserved_bonus - reservation.bonus_amount);
        credits.monthly_credits_used += reservation.monthly_amount;
        credits.bonus_credits_used += reservation.bonus_amount;

        reservation.status = "committed";

        this.transactions.push({
            id: crypto.randomUUID(),
            user_id: userId,
            amount: -reservation.amount,
            transaction_type: "usage",
            description: "Credit usage",
            request_id: requestId,
            created_at: new Date(),
        });

        return { ok: true };
    }

    releaseReservedCredits(userId: string, requestId: string, reason: string): { ok: boolean; already_released?: boolean; reason?: string } {
        const reservation = this.reservations.get(requestId);
        if (!reservation || reservation.user_id !== userId) {
            return { ok: false, reason: "missing_reservation" };
        }

        if (reservation.status === "released") {
            return { ok: true, already_released: true };
        }

        if (reservation.status !== "reserved") {
            return { ok: false, reason: "invalid_reservation_state" };
        }

        const credits = this.userCredits.get(userId);
        if (!credits) return { ok: false, reason: "missing_credit_account" };

        // Release the reserved credits
        credits.reserved_monthly = Math.max(0, credits.reserved_monthly - reservation.monthly_amount);
        credits.reserved_bonus = Math.max(0, credits.reserved_bonus - reservation.bonus_amount);

        reservation.status = "released";
        reservation.metadata = { ...reservation.metadata, release_reason: reason };

        this.transactions.push({
            id: crypto.randomUUID(),
            user_id: userId,
            amount: reservation.amount,
            transaction_type: "release",
            description: reason,
            request_id: requestId,
            created_at: new Date(),
        });

        return { ok: true };
    }

    refundConsumedCredits(userId: string, requestId: string, reason: string): { ok: boolean; reason?: string } {
        // Check if already refunded
        const existingRefund = this.transactions.find(
            t => t.user_id === userId && t.request_id === requestId && t.transaction_type === "refund"
        );
        if (existingRefund) {
            return { ok: true }; // Already refunded
        }

        // Find usage transactions for this request
        const usageTransactions = this.transactions.filter(
            t => t.user_id === userId && t.request_id === requestId && t.transaction_type === "usage"
        );

        if (usageTransactions.length === 0) {
            return { ok: false, reason: "no_usage_to_refund" };
        }

        const totalToRefund = usageTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

        const credits = this.userCredits.get(userId);
        if (!credits) return { ok: false, reason: "missing_credit_account" };

        // Refund to monthly first
        const monthlyRefund = Math.min(totalToRefund, credits.monthly_credits_used);
        const bonusRefund = totalToRefund - monthlyRefund;

        credits.monthly_credits_used = Math.max(0, credits.monthly_credits_used - monthlyRefund);
        credits.bonus_credits_used = Math.max(0, credits.bonus_credits_used - bonusRefund);

        this.transactions.push({
            id: crypto.randomUUID(),
            user_id: userId,
            amount: totalToRefund,
            transaction_type: "refund",
            description: reason,
            request_id: requestId,
            created_at: new Date(),
        });

        return { ok: true };
    }

    logMonitoringEvent(eventType: string, details: Record<string, unknown>) {
        this.monitoringEvents.push({ event_type: eventType, details });
    }
}

describe("Credit System Integration (E2E Simulation)", () => {
    let db: MockDatabase;

    beforeEach(() => {
        db = new MockDatabase();
    });

    describe("Happy Path: Successful Image Generation", () => {
        it("should reserve, commit, and correctly update user credits", () => {
            const userId = "test-user";
            const requestId = "gen-001";

            // Initial state
            expect(db.getAvailableCredits(userId)).toBe(15);

            // Reserve credits
            const reserveResult = db.reserveCredits(userId, requestId, 1);
            expect(reserveResult.ok).toBe(true);
            expect(db.getAvailableCredits(userId)).toBe(14);

            // Simulate successful generation and commit
            const commitResult = db.commitReservedCredits(userId, requestId);
            expect(commitResult.ok).toBe(true);
            expect(db.getAvailableCredits(userId)).toBe(14); // Still 14 (used, not reserved)

            // Verify transaction history
            expect(db.transactions).toHaveLength(2);
            expect(db.transactions[0].transaction_type).toBe("reservation");
            expect(db.transactions[1].transaction_type).toBe("usage");
        });
    });

    describe("Failure Path: Generation Fails After Reservation", () => {
        it("should release credits when generation fails", () => {
            const userId = "test-user";
            const requestId = "gen-002";

            // Reserve credits
            const reserveResult = db.reserveCredits(userId, requestId, 1);
            expect(reserveResult.ok).toBe(true);
            expect(db.getAvailableCredits(userId)).toBe(14);

            // Simulate generation failure and release
            const releaseResult = db.releaseReservedCredits(userId, requestId, "Generation failed: API error");
            expect(releaseResult.ok).toBe(true);
            expect(releaseResult.already_released).toBeUndefined();

            // Credits should be fully restored
            expect(db.getAvailableCredits(userId)).toBe(15);

            // Verify transaction history
            expect(db.transactions).toHaveLength(2);
            expect(db.transactions[1].transaction_type).toBe("release");
        });

        it("should handle double-release attempts gracefully", () => {
            const userId = "test-user";
            const requestId = "gen-003";

            // Reserve and release
            db.reserveCredits(userId, requestId, 1);
            db.releaseReservedCredits(userId, requestId, "First release");

            // Try to release again
            const secondRelease = db.releaseReservedCredits(userId, requestId, "Second release");
            expect(secondRelease.ok).toBe(true);
            expect(secondRelease.already_released).toBe(true);

            // Should still have the same credit count
            expect(db.getAvailableCredits(userId)).toBe(15);
        });
    });

    describe("Compensation: Committed Credits for Failed Generation", () => {
        it("should refund credits that were committed for a failed generation", () => {
            const userId = "test-user";
            const requestId = "gen-004";

            // Reserve and commit
            db.reserveCredits(userId, requestId, 1);
            db.commitReservedCredits(userId, requestId);

            // Record the attempt as failed (simulating a bug where commit happened before we knew it failed)
            db.attempts.set(requestId, {
                request_id: requestId,
                user_id: userId,
                feature: "generate-scene-image",
                status: "failed",
                credits_amount: 1,
                error_stage: "storage_upload",
                error_message: "Upload failed",
            });

            // Run compensation
            const refundResult = db.refundConsumedCredits(userId, requestId, "Compensation for failed generation");
            expect(refundResult.ok).toBe(true);

            // Credits should be restored
            expect(db.getAvailableCredits(userId)).toBe(15);

            // Verify refund transaction
            const refundTx = db.transactions.find(t => t.transaction_type === "refund");
            expect(refundTx).toBeDefined();
            expect(refundTx?.amount).toBe(1);
        });

        it("should not double-refund already refunded credits", () => {
            const userId = "test-user";
            const requestId = "gen-005";

            // Reserve, commit, and refund
            db.reserveCredits(userId, requestId, 1);
            db.commitReservedCredits(userId, requestId);
            db.refundConsumedCredits(userId, requestId, "First refund");

            // Try to refund again
            const secondRefund = db.refundConsumedCredits(userId, requestId, "Second refund");
            expect(secondRefund.ok).toBe(true); // Idempotent

            // Should not have extra credits
            expect(db.getAvailableCredits(userId)).toBe(15);

            // Should only have one refund transaction
            const refundTxs = db.transactions.filter(t => t.transaction_type === "refund");
            expect(refundTxs).toHaveLength(1);
        });
    });

    describe("Audit Trail", () => {
        it("should maintain complete transaction history for all credit operations", () => {
            const userId = "test-user";

            // Perform multiple operations
            db.reserveCredits(userId, "req-1", 1);
            db.commitReservedCredits(userId, "req-1");

            db.reserveCredits(userId, "req-2", 1);
            db.releaseReservedCredits(userId, "req-2", "Failed");

            db.reserveCredits(userId, "req-3", 1);
            db.commitReservedCredits(userId, "req-3");
            db.refundConsumedCredits(userId, "req-3", "Compensation");

            // Verify audit trail
            expect(db.transactions).toHaveLength(7);

            // Group by request_id
            const byRequest = db.transactions.reduce((acc, t) => {
                if (!acc[t.request_id]) acc[t.request_id] = [];
                acc[t.request_id].push(t.transaction_type);
                return acc;
            }, {} as Record<string, string[]>);

            expect(byRequest["req-1"]).toEqual(["reservation", "usage"]);
            expect(byRequest["req-2"]).toEqual(["reservation", "release"]);
            expect(byRequest["req-3"]).toEqual(["reservation", "usage", "refund"]);
        });
    });

    describe("Edge Cases", () => {
        it("should handle insufficient credits", () => {
            const userId = "test-user";

            // Exhaust all credits
            for (let i = 0; i < 15; i++) {
                db.reserveCredits(userId, `req-${i}`, 1);
                db.commitReservedCredits(userId, `req-${i}`);
            }

            expect(db.getAvailableCredits(userId)).toBe(0);

            // Try to reserve more
            const result = db.reserveCredits(userId, "req-extra", 1);
            expect(result.ok).toBe(false);
            expect(result.reason).toBe("insufficient_credits");
        });

        it("should handle reservation for non-existent user", () => {
            const result = db.reserveCredits("non-existent-user", "req-x", 1);
            expect(result.ok).toBe(false);
            expect(result.reason).toBe("missing_credit_account");
        });

        it("should handle commit for non-existent reservation", () => {
            const result = db.commitReservedCredits("test-user", "non-existent-req");
            expect(result.ok).toBe(false);
            expect(result.reason).toBe("missing_reservation");
        });

        it("should handle release for non-existent reservation", () => {
            const result = db.releaseReservedCredits("test-user", "non-existent-req", "Test");
            expect(result.ok).toBe(false);
            expect(result.reason).toBe("missing_reservation");
        });
    });

    describe("Monitoring and Alerting", () => {
        it("should log monitoring events for credit issues", () => {
            const userId = "test-user";
            const requestId = "gen-monitor-001";

            // Reserve and simulate failure
            db.reserveCredits(userId, requestId, 1);
            db.releaseReservedCredits(userId, requestId, "Generation failed");

            // Log monitoring event
            db.logMonitoringEvent("credit_release_trigger_success", {
                user_id: userId,
                request_id: requestId,
                feature: "generate-scene-image",
                triggered_at: new Date().toISOString(),
            });

            expect(db.monitoringEvents).toHaveLength(1);
            expect(db.monitoringEvents[0].event_type).toBe("credit_release_trigger_success");
        });
    });
});
