
export type ImageValidationResult = {
  ok: boolean;
  reason?: string;
  size?: number;
  mean?: number;
  std?: number;
};

export const validateGeneratedImage = async (url: string): Promise<ImageValidationResult> => {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) {
      return {
        ok: false,
        reason: `Failed to load generated image (HTTP ${res.status})`,
      };
    }

    const blob = await res.blob();
    const size = blob.size;

    // In a real browser, we use createImageBitmap.
    // In tests/Node, this might not exist. We can try/catch or check existence.
    if (typeof createImageBitmap === "undefined") {
      // Fallback for non-browser environments (e.g. tests) if not polyfilled.
      // We assume it's valid if we can't check pixels, unless size is suspicious.
      if (size < 100) return { ok: false, reason: "Image too small (mock check)" };
      return { ok: true, size };
    }

    const bitmap = await createImageBitmap(blob);

    const canvas = document.createElement("canvas");
    const w = 64;
    const h = 64;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return { ok: true, size };
    }

    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const data = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    let sumSq = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += 16) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += lum;
      sumSq += lum * lum;
      count += 1;
    }

    const mean = count > 0 ? sum / count : 0;
    const variance = count > 0 ? sumSq / count - mean * mean : 0;
    const std = Math.sqrt(Math.max(0, variance));
    
    // Blank detection thresholds:
    // Low variance (std < 2.5) AND (very dark OR very bright)
    const blank = std < 2.5 && (mean < 6 || mean > 249);

    return {
      ok: !blank,
      reason: blank ? `Blank image generation (mean=${mean.toFixed(1)}, std=${std.toFixed(1)})` : undefined,
      size,
      mean,
      std,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `Failed to validate generated image: ${msg}` };
  }
};
