import { describe, expect, test } from "vitest";
import { validateReferenceImageCandidate, validateSceneReferenceImageCandidate } from "./reference-images";

describe("validateReferenceImageCandidate", () => {
  test("accepts JPEG/PNG/GIF/WEBP under 10MB", () => {
    expect(validateReferenceImageCandidate({ size: 1024, type: "image/jpeg" })).toEqual({ ok: true });
    expect(validateReferenceImageCandidate({ size: 1024, type: "image/png" })).toEqual({ ok: true });
    expect(validateReferenceImageCandidate({ size: 1024, type: "image/gif" })).toEqual({ ok: true });
    expect(validateReferenceImageCandidate({ size: 1024, type: "image/webp" })).toEqual({ ok: true });
  });

  test("rejects empty files", () => {
    expect(validateReferenceImageCandidate({ size: 0, type: "image/png" })).toEqual({ ok: false, error: "Empty file" });
  });

  test("rejects oversized files", () => {
    expect(validateReferenceImageCandidate({ size: 10 * 1024 * 1024 + 1, type: "image/png" })).toEqual({
      ok: false,
      error: "File too large (max 10MB)",
    });
  });

  test("rejects unsupported MIME types", () => {
    expect(validateReferenceImageCandidate({ size: 1024, type: "image/bmp" })).toEqual({ ok: false, error: "Unsupported file type" });
  });
});

describe("validateSceneReferenceImageCandidate", () => {
  test("accepts JPEG/PNG/WEBP under 5MB", () => {
    expect(validateSceneReferenceImageCandidate({ size: 1024, type: "image/jpeg" })).toEqual({ ok: true });
    expect(validateSceneReferenceImageCandidate({ size: 1024, type: "image/png" })).toEqual({ ok: true });
    expect(validateSceneReferenceImageCandidate({ size: 1024, type: "image/webp" })).toEqual({ ok: true });
  });

  test("rejects GIF", () => {
    expect(validateSceneReferenceImageCandidate({ size: 1024, type: "image/gif" })).toEqual({ ok: false, error: "Unsupported file type" });
  });

  test("rejects oversized files", () => {
    expect(validateSceneReferenceImageCandidate({ size: 5 * 1024 * 1024 + 1, type: "image/png" })).toEqual({
      ok: false,
      error: "File too large (max 5MB)",
    });
  });
});
