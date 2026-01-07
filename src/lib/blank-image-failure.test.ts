
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
    const mockSupabase = {
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      })),
      rpc: vi.fn(),
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("calls release and refund RPCs on failure", async () => {
      mockSupabase.rpc.mockResolvedValue({ data: { ok: true }, error: null });

      const args = {
        requestId: "00000000-0000-0000-0000-000000000001",
        reason: "Blank image generation",
        userId: "user-123",
        metadata: { feature: "test" },
      };

      const result = await reconcileFailedGenerationCredits(
        mockSupabase as unknown as SupabaseClient,
        args
      );

      expect(result.success).toBe(true);
      
      // Verify DB status update
      expect(mockSupabase.from).toHaveBeenCalledWith("image_generation_attempts");
      
      // Verify Release called
      expect(mockSupabase.rpc).toHaveBeenCalledWith("release_reserved_credits", expect.objectContaining({
        p_request_id: args.requestId,
        p_reason: args.reason,
      }));

      // Verify Refund called
      expect(mockSupabase.rpc).toHaveBeenCalledWith("refund_consumed_credits", expect.objectContaining({
        p_request_id: args.requestId,
        p_reason: args.reason,
      }));
    });

    it("handles invalid parameters gracefully", async () => {
      const result = await reconcileFailedGenerationCredits(mockSupabase as unknown as SupabaseClient, {
        requestId: "invalid-uuid",
        reason: "fail",
        userId: "user-1",
      });
      expect(result.success).toBe(false);
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
    });
  });
});
