import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { clampInt, detectMime } from "../index.ts";

Deno.test("clampInt clamps and floors", () => {
  assertEquals(clampInt(10.9, 0, 10), 10);
  assertEquals(clampInt(-5, 0, 10), 0);
  assertEquals(clampInt(999, 0, 10), 10);
});

Deno.test("detectMime identifies JPEG", () => {
  assertEquals(detectMime(new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])), "image/jpeg");
});

Deno.test("detectMime identifies PNG", () => {
  assertEquals(
    detectMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00])),
    "image/png",
  );
});

Deno.test("detectMime identifies GIF", () => {
  assertEquals(detectMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])), "image/gif");
});

Deno.test("detectMime identifies WebP", () => {
  assertEquals(
    detectMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])),
    "image/webp",
  );
});

