import { assertEquals, assertMatch } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { base64ToBytes, bytesToBase64, corsHeaders, decodeDataUrlOrBase64 } from "../index.ts";

Deno.test("corsHeaders includes allow methods", () => {
  assertEquals(typeof corsHeaders["Access-Control-Allow-Methods"], "string");
  assertMatch(String(corsHeaders["Access-Control-Allow-Methods"]), /POST/);
});

Deno.test("decodeDataUrlOrBase64 handles raw base64", () => {
  assertEquals(decodeDataUrlOrBase64("abc123").base64, "abc123");
});

Deno.test("decodeDataUrlOrBase64 parses data URL", () => {
  const decoded = decodeDataUrlOrBase64("data:image/png;base64,Zm9v");
  assertEquals(decoded.mime, "image/png");
  assertEquals(decoded.base64, "Zm9v");
});

Deno.test("base64ToBytes/bytesToBase64 roundtrip", () => {
  const original = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
  const b64 = bytesToBase64(original);
  const bytes = base64ToBytes(b64);
  assertEquals(Array.from(bytes), Array.from(original));
});

