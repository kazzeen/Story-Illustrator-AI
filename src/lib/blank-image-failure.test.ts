import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateGeneratedImage } from "./image-validation";
import { reconcileFailedGenerationCredits } from "./credit-reconciliation";

// Mock createImageBitmap and Canvas for non-browser environment
const mockContext = {
  drawImage: vi.fn(),
  getImageData: vi.fn(),
};
const mockCanvas = {
  width: 0,
  height: 0,
  getContext: vi.fn(() => mockContext),
};

// Polyfill minimal browser APIs needed for image validation
vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close: vi.fn() })));
vi.stubGlobal("document", {
  createElement: vi.fn(() => mockCanvas),
});

describe("Blank Image Failure Handling", () => {
  describe("validateGeneratedImage", () => {
    it("detects blank (all black) images", async () => {
      // Mock fetch response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(["fake-image-data"], { type: "image/png" }),
      });

      // Mock canvas data: All zeros (black)
      mockContext.getImageData.mockReturnValue({
        data: new Uint8ClampedArray(64 * 64 * 4).fill(0), // All 0
      });

      const result = await validateGeneratedImage("http://fake.url/image.png");
      
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("Blank image generation");
      expect(result.mean).toBe(0);
      expect(result.std).toBe(0);
    });

    it("detects blank (all white) images", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(["fake-image-data"], { type: "image/png" }),
      });

      // Mock canvas data: All 255 (white)
      mockContext.getImageData.mockReturnValue({
        data: new Uint8ClampedArray(64 * 64 * 4).fill(255),
      });

      const result = await validateGeneratedImage("http://fake.url/image.png");
      
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("Blank image generation");
      // Mean ~255 (depends on luminance calc), std ~0
      expect(result.mean).toBeGreaterThan(250);
      expect(result.std).toBeLessThan(1);
    });

    it("accepts valid images (noise/content)", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(["fake-image-data"], { type: "image/png" }),
      });

      // Mock canvas data: Random noise
      const data = new Uint8ClampedArray(64 * 64 * 4);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.floor(Math.random() * 256);
      }
      mockContext.getImageData.mockReturnValue({ data });

      const result = await validateGeneratedImage("http://fake.url/image.png");
      
      expect(result.ok).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  describe("reconcileFailedGenerationCredits", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("calls reconcile RPC on failure", async () => {
      const eqMock = vi.fn().mockResolvedValue({ error: null });
      const updateMock = vi.fn(() => ({ eq: eqMock }));
      const fromMock = vi.fn(() => ({ update: updateMock }));
      const rpcMock = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });

      const mockSupabase = {
        from: fromMock,
        rpc: rpcMock,
      };

      const args = {
        requestId: "00000000-0000-0000-0000-000000000001",
        reason: "Blank image generation",
        metadata: { feature: "test" },
      };

      const result = await reconcileFailedGenerationCredits(
        mockSupabase as unknown as SupabaseClient,
        args
      );

      expect(result.success).toBe(true);
      
      // Verify DB status update
      expect(mockSupabase.from).toHaveBeenCalledWith("image_generation_attempts");
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          error_message: args.reason,
          metadata: expect.objectContaining({
            failure_timestamp: expect.any(String),
            failure_reason: args.reason,
          }),
        }),
      );
      
      expect(mockSupabase.rpc).toHaveBeenCalledWith("reconcile_failed_generation_credits", expect.objectContaining({
        p_request_id: args.requestId,
        p_reason: args.reason,
        p_metadata: expect.objectContaining({
          failure_timestamp: expect.any(String),
          failure_reason: args.reason,
          feature: "test",
        }),
      }));
    });

    it("correctly handles credit balance updates from response", async () => {
        // Mock updated RPC response structure
        const rpcMock = vi.fn().mockResolvedValue({ 
            data: { 
                ok: true, 
                refunded_monthly: 1,
                refunded_bonus: 0,
                remaining_monthly: 9,
                remaining_bonus: 5,
            }, 
            error: null 
        });

        const mockSupabase = {
            from: vi.fn(() => ({ update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({}) })) })),
            rpc: rpcMock,
        };

        const result = await reconcileFailedGenerationCredits(
            mockSupabase as unknown as SupabaseClient,
            {
                requestId: "00000000-0000-0000-0000-000000000005",
                reason: "Validation failed",
            }
        );

        expect(result.success).toBe(true);
        const rec = result.reconcile as Record<string, unknown>;
        expect(rec.remaining_monthly).toBe(9);
        expect(rec.refunded_monthly).toBe(1);
    });

    it("handles invalid parameters gracefully", async () => {
      const mockSupabase = {
        from: vi.fn(),
        rpc: vi.fn(),
      };

      const result = await reconcileFailedGenerationCredits(mockSupabase as unknown as SupabaseClient, {
        requestId: "invalid-uuid",
        reason: "fail",
      });
      expect(result.success).toBe(false);
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
    });

    it("dedupes concurrent reconciliation calls per requestId", async () => {
      const eqMock = vi.fn().mockResolvedValue({ error: null });
      const updateMock = vi.fn(() => ({ eq: eqMock }));
      const fromMock = vi.fn(() => ({ update: updateMock }));

      let resolveRpc: ((value: { data: unknown; error: null }) => void) | null = null;
      const rpcPromise = new Promise<{ data: unknown; error: null }>((resolve) => {
        resolveRpc = resolve;
      });
      const rpcMock = vi.fn(() => rpcPromise);

      const mockSupabase = {
        from: fromMock,
        rpc: rpcMock,
      };

      const args = {
        requestId: "00000000-0000-0000-0000-000000000002",
        reason: "Generated image appears blank (mean=0, std=0)",
        metadata: { feature: "test" },
      };

      const p1 = reconcileFailedGenerationCredits(mockSupabase as unknown as SupabaseClient, args);
      const p2 = reconcileFailedGenerationCredits(mockSupabase as unknown as SupabaseClient, args);

      if (!resolveRpc) throw new Error("rpc resolver missing");
      resolveRpc({ data: { ok: true }, error: null });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(updateMock).toHaveBeenCalledTimes(1);
      expect(rpcMock).toHaveBeenCalledTimes(1);
    });

    it("does not dedupe across different requestIds", async () => {
      const eqMock = vi.fn().mockResolvedValue({ error: null });
      const updateMock = vi.fn(() => ({ eq: eqMock }));
      const fromMock = vi.fn(() => ({ update: updateMock }));
      const rpcMock = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });

      const mockSupabase = {
        from: fromMock,
        rpc: rpcMock,
      };

      const a1 = reconcileFailedGenerationCredits(mockSupabase as unknown as SupabaseClient, {
        requestId: "00000000-0000-0000-0000-000000000010",
        reason: "Blank image generation",
        metadata: { feature: "test" },
      });
      const a2 = reconcileFailedGenerationCredits(mockSupabase as unknown as SupabaseClient, {
        requestId: "00000000-0000-0000-0000-000000000011",
        reason: "No image data returned",
        metadata: { feature: "test" },
      });

      const [r1, r2] = await Promise.all([a1, a2]);
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(updateMock).toHaveBeenCalledTimes(2);
      expect(rpcMock).toHaveBeenCalledTimes(2);
    });

    it("logs specific failure reasons including blank image stats", async () => {
      const eqMock = vi.fn().mockResolvedValue({ error: null });
      const updateMock = vi.fn(() => ({ eq: eqMock }));
      const fromMock = vi.fn(() => ({ update: updateMock }));
      const rpcMock = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });

      const mockSupabase = {
        from: fromMock,
        rpc: rpcMock,
      };

      const blankStats = "mean=0, std=0";
      const reason = `Generated image appears blank (${blankStats})`;
      const args = {
        requestId: "00000000-0000-0000-0000-000000000099",
        reason: reason,
        metadata: { blank_mean: 0, blank_std: 0 },
      };

      await reconcileFailedGenerationCredits(
        mockSupabase as unknown as SupabaseClient,
        args
      );

      expect(mockSupabase.rpc).toHaveBeenCalledWith("reconcile_failed_generation_credits", expect.objectContaining({
        p_reason: expect.stringContaining(blankStats),
        p_metadata: expect.objectContaining({
            blank_mean: 0,
            blank_std: 0
        })
      }));
    });

    it("updates local state with restored balance from RPC response", async () => {
        // Mock a response where a credit was refunded
        const rpcMock = vi.fn().mockResolvedValue({ 
            data: { 
                ok: true, 
                refunded_monthly: 1,
                remaining_monthly: 10, // Restored to full
                remaining_bonus: 5,
            }, 
            error: null 
        });

        const mockSupabase = {
            from: vi.fn(() => ({ update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({}) })) })),
            rpc: rpcMock,
        };

        const result = await reconcileFailedGenerationCredits(
            mockSupabase as unknown as SupabaseClient,
            {
                requestId: "00000000-0000-0000-0000-000000000088",
                reason: "Test refund",
            }
        );

        expect(result.success).toBe(true);
        const rec = result.reconcile as Record<string, unknown>;
        expect(rec.remaining_monthly).toBe(10);
        expect(rec.refunded_monthly).toBe(1);
    });
  });
});
