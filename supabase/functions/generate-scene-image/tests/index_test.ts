import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { asConsistencySettings, clampNumber, computeSampleLumaStatsFromBitmap, detectImageMime, shouldTryReserveAfterCommitFailure, truncateText } from "../index.ts";

Deno.test("clampNumber should restrict values within range", () => {
  assertEquals(clampNumber(50, 0, 100, 70), 50);
  assertEquals(clampNumber(-10, 0, 100, 70), 0);
  assertEquals(clampNumber(150, 0, 100, 70), 100);
  assertEquals(clampNumber("invalid", 0, 100, 70), 70);
});

Deno.test("truncateText should add ellipsis when truncated", () => {
  assertEquals(truncateText("hello", 10), "hello");
  assertEquals(truncateText("hello world", 5), "hello...");
});

Deno.test("asConsistencySettings should parse character image reference toggle", () => {
  const a = asConsistencySettings({ character_image_reference_enabled: true });
  assertEquals(a?.character_image_reference_enabled, true);

  const b = asConsistencySettings({ characterImageReferenceEnabled: true });
  assertEquals(b?.character_image_reference_enabled, true);

  const c = asConsistencySettings({ character_image_reference: true });
  assertEquals(c?.character_image_reference_enabled, true);

  const d = asConsistencySettings({ characterImageReference: true });
  assertEquals(d?.character_image_reference_enabled, true);
});

Deno.test("detectImageMime should identify PNG signature", () => {
  const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assertEquals(detectImageMime(pngSignature), "image/png");
});

Deno.test("detectImageMime should identify JPEG signature", () => {
  const jpgSignature = new Uint8Array([0xff, 0xd8, 0xff]);
  assertEquals(detectImageMime(jpgSignature), "image/jpeg");
});

Deno.test("detectImageMime should default to WebP for unknown", () => {
  const unknown = new Uint8Array([0x00, 0x00, 0x00]);
  assertEquals(detectImageMime(unknown), "image/webp");
});

Deno.test("shouldTryReserveAfterCommitFailure should return true for missing_reservation", () => {
  assertEquals(shouldTryReserveAfterCommitFailure("missing_reservation", null), true);
});

Deno.test("shouldTryReserveAfterCommitFailure should return true when commitErr present", () => {
  assertEquals(shouldTryReserveAfterCommitFailure(null, new Error("rpc failed")), true);
});

Deno.test("shouldTryReserveAfterCommitFailure should return false for other reasons without error", () => {
  assertEquals(shouldTryReserveAfterCommitFailure("not_allowed", null), false);
});

Deno.test("computeSampleLumaStatsFromBitmap returns zero stats for blank image", () => {
  const width = 8;
  const height = 8;
  const bitmap = new Uint8Array(width * height * 4);
  const stats = computeSampleLumaStatsFromBitmap({ bitmap, width, height, maxSamples: 256 });
  assertEquals(stats.mean, 0);
  assertEquals(stats.std, 0);
  assertEquals(stats.maxRgb, 0);
  assertEquals(stats.maxAlpha, 0);
  assertEquals(stats.samples > 0, true);
});

Deno.test("computeSampleLumaStatsFromBitmap detects non-blank pixels", () => {
  const width = 8;
  const height = 8;
  const bitmap = new Uint8Array(width * height * 4);
  const idx = (2 * width + 3) * 4;
  bitmap[idx] = 255;
  bitmap[idx + 3] = 255;
  const stats = computeSampleLumaStatsFromBitmap({ bitmap, width, height, maxSamples: 256 });
  assertEquals(stats.maxRgb > 0, true);
  assertEquals(stats.samples > 0, true);
});
