import { describe, it, expect, beforeEach } from "vitest";

// Mock Database Simulation
type MockCreditsRow = { monthly: number; bonus: number; reserved: number };
type MockReservationStatus = "reserved" | "committed" | "released";
type MockReservation = { user_id: string; amount: number; status: MockReservationStatus };
type MockTransactionType = "reservation" | "usage" | "refund" | "release";
type MockTransaction = {
    id: string;
    user_id: string;
    request_id: string;
    amount: number;
    transaction_type: MockTransactionType;
    description: string;
    created_at: Date;
};

class RobustMockDatabase {
    credits: Record<string, MockCreditsRow> = {
        "test-user": { monthly: 10, bonus: 5, reserved: 0 },
    };
    transactions: MockTransaction[] = [];
    reservations: Map<string, MockReservation> = new Map();

    reserveCredits(userId: string, requestId: string, amount: number) {
        const user = this.credits[userId];
        if (!user) return { ok: false, reason: "no_user_credits" };
        
        const available = user.monthly + user.bonus - user.reserved;
        if (available < amount) return { ok: false, reason: "insufficient_credits" };

        user.reserved += amount;
        this.reservations.set(requestId, { user_id: userId, amount, status: "reserved" });
        this.transactions.push({
            id: crypto.randomUUID(),
            user_id: userId,
            request_id: requestId,
            amount: -amount,
            transaction_type: "reservation",
            description: "Credit reserved",
            created_at: new Date()
        });
        return { ok: true };
    }

    forceRefundCredits(userId: string, requestId: string, reason: string) {
        // This simulates the robust PL/pgSQL function
        const reservation = this.reservations.get(requestId);
        
        // Check if usage exists (not implemented in this mock for brevity, focusing on reservation)
        const usageExists = this.transactions.some(t => t.request_id === requestId && t.transaction_type === "usage");

        if (usageExists) {
             // Refund usage
             const usageTx = this.transactions.find(t => t.request_id === requestId && t.transaction_type === "usage");
             if (!usageTx) return { ok: false, reason: "usage_missing" };
             
             // Restore credits
             const user = this.credits[userId];
             // Simplified restoration logic
             user.monthly += Math.abs(usageTx.amount); 
             
             this.transactions.push({
                 id: crypto.randomUUID(),
                 user_id: userId,
                 request_id: requestId,
                 amount: Math.abs(usageTx.amount),
                 transaction_type: "refund",
                 description: reason,
                 created_at: new Date()
             });
             return { ok: true, refunded: true };
        }

        if (reservation && reservation.status === "reserved") {
            // Release reservation
            const user = this.credits[userId];
            user.reserved -= reservation.amount;
            reservation.status = "released";

            // Update transaction to 'release' (amount 0)
            const tx = this.transactions.find(t => t.request_id === requestId && t.transaction_type === "reservation");
            if (tx) {
                tx.transaction_type = "release";
                tx.amount = 0;
                tx.description = reason;
            }

            return { ok: true, released: true };
        }

        return { ok: true, message: "nothing_to_refund" };
    }
}

describe("Robust Credit System Tests", () => {
    let db: RobustMockDatabase;

    beforeEach(() => {
        db = new RobustMockDatabase();
    });

    it("should transform reservation to release on failure (Net Cost: 0)", () => {
        const userId = "test-user";
        const requestId = "fail-gen-1";
        const failureReason = "Scene image generation failed: Invalid JSON from upstream provider (SyntaxError: Unexpected token)";

        // 1. Reserve
        db.reserveCredits(userId, requestId, 1);
        expect(db.credits[userId].reserved).toBe(1);
        
        // Verify Reservation Transaction
        const reserveTx = db.transactions.find(t => t.request_id === requestId);
        expect(reserveTx.transaction_type).toBe("reservation");
        expect(reserveTx.amount).toBe(-1);

        // 2. Fail & Refund
        const result = db.forceRefundCredits(userId, requestId, failureReason);
        expect(result.ok).toBe(true);
        expect(result.released).toBe(true);

        // 3. Verify State
        expect(db.credits[userId].reserved).toBe(0); // Reservation cleared

        // 4. Verify Transaction Transformation
        // The transaction should now be type 'release' with amount 0
        const finalTx = db.transactions.find(t => t.request_id === requestId);
        expect(finalTx.transaction_type).toBe("release");
        expect(finalTx.amount).toBe(0);
        expect(finalTx.description).toBe(failureReason);
    });

    it("should handle specific failure reasons correctly in logs", () => {
        const userId = "test-user";
        const requestId = "fail-gen-2";
        const specificError = "Scene image generation failed: Failed to store image (Error: Bucket full)";

        db.reserveCredits(userId, requestId, 1);
        db.forceRefundCredits(userId, requestId, specificError);

        const tx = db.transactions.find(t => t.request_id === requestId);
        expect(tx.description).toContain("Failed to store image");
        expect(tx.description).toContain("Bucket full");
    });
});
