export const REFERENCE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export const REFERENCE_IMAGE_ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export const SCENE_REFERENCE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const SCENE_REFERENCE_IMAGE_ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ReferenceImageCandidate = {
  name?: string;
  size: number;
  type: string;
};

export function validateReferenceImageCandidate(file: ReferenceImageCandidate): { ok: true } | { ok: false; error: string } {
  if (!REFERENCE_IMAGE_ALLOWED_MIME.has(file.type)) return { ok: false, error: "Unsupported file type" };
  if (file.size <= 0) return { ok: false, error: "Empty file" };
  if (file.size > REFERENCE_IMAGE_MAX_BYTES) return { ok: false, error: "File too large (max 10MB)" };
  return { ok: true };
}

export function validateSceneReferenceImageCandidate(file: ReferenceImageCandidate): { ok: true } | { ok: false; error: string } {
  if (!SCENE_REFERENCE_IMAGE_ALLOWED_MIME.has(file.type)) return { ok: false, error: "Unsupported file type" };
  if (file.size <= 0) return { ok: false, error: "Empty file" };
  if (file.size > SCENE_REFERENCE_IMAGE_MAX_BYTES) return { ok: false, error: "File too large (max 5MB)" };
  return { ok: true };
}
