import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { clampNumber, detectImageMime, STYLE_LIBRARY } from "../index.ts";

Deno.test("clampNumber should restrict values within range", () => {
  assertEquals(clampNumber(50, 0, 100, 70), 50);
  assertEquals(clampNumber(-10, 0, 100, 70), 0);
  assertEquals(clampNumber(150, 0, 100, 70), 100);
  assertEquals(clampNumber("invalid", 0, 100, 70), 70);
});

Deno.test("STYLE_LIBRARY should contain 'none' style", () => {
  const noneStyle = STYLE_LIBRARY["none"];
  assertEquals(noneStyle !== undefined, true);
  assertEquals(noneStyle.id, "none");
  assertEquals(noneStyle.name, "No Specific Style");
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
