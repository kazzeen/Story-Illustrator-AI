export type NormalizedRect = { x: number; y: number; w: number; h: number };

export type ImageEditTool = "inpaint" | "remove" | "color" | "tone";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function normalizeImageMime(mime: string): "image/png" | "image/jpeg" | "image/webp" | null {
  const m = (mime || "").trim().toLowerCase();
  if (m === "image/jpg") return "image/jpeg";
  if (m === "image/jpeg") return "image/jpeg";
  if (m === "image/png") return "image/png";
  if (m === "image/webp") return "image/webp";
  return null;
}

export function inferImageMimeFromUrl(url: string | null | undefined): "image/png" | "image/jpeg" | "image/webp" | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  const withoutHash = raw.split("#")[0] ?? raw;
  const withoutQuery = (withoutHash.split("?")[0] ?? withoutHash).trim();
  const lastDot = withoutQuery.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const ext = withoutQuery.slice(lastDot + 1).toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return null;
}

export function normalizeRect(rect: NormalizedRect): NormalizedRect {
  const x1 = clamp01(rect.x);
  const y1 = clamp01(rect.y);
  const x2 = clamp01(rect.x + rect.w);
  const y2 = clamp01(rect.y + rect.h);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  return { x, y, w, h };
}

export function selectionHint(rect: NormalizedRect | null): string {
  if (!rect) return "";
  const r = normalizeRect(rect);
  if (r.w <= 0.001 || r.h <= 0.001) return "";
  const toPct = (v: number) => Math.round(v * 100);
  const x = toPct(r.x);
  const y = toPct(r.y);
  const w = toPct(r.w);
  const h = toPct(r.h);
  return `In the selected area (x=${x}%, y=${y}%, w=${w}%, h=${h}%),`;
}

function intensityWord(value: number) {
  const abs = Math.abs(value);
  if (abs <= 10) return "slightly";
  if (abs <= 35) return "moderately";
  return "significantly";
}

export function buildVeniceEditPrompt(args: {
  tool: ImageEditTool;
  selection: NormalizedRect | null;
  freeform?: string;
  objectToRemove?: string;
  colorTarget?: string;
  newColor?: string;
  toneTarget?: string;
  brightness?: number;
  contrast?: number;
}): string {
  const prefix = selectionHint(args.selection);
  const tool = args.tool;

  if (tool === "inpaint") {
    const body = (args.freeform ?? "").trim();
    return [prefix, body].filter(Boolean).join(" ").trim();
  }

  if (tool === "remove") {
    const obj = (args.objectToRemove ?? "").trim();
    const core = obj
      ? `remove the ${obj} and fill the background naturally to match the surroundings`
      : `remove the unwanted object and fill the background naturally to match the surroundings`;
    return [prefix, core].filter(Boolean).join(" ").trim();
  }

  if (tool === "color") {
    const target = (args.colorTarget ?? "").trim();
    const color = (args.newColor ?? "").trim();
    const core =
      target && color
        ? `change the color of ${target} to ${color}`
        : target
          ? `adjust the color of ${target}`
          : `adjust the colors`;
    return [prefix, core].filter(Boolean).join(" ").trim();
  }

  const brightness = typeof args.brightness === "number" ? Math.max(-100, Math.min(100, args.brightness)) : 0;
  const contrast = typeof args.contrast === "number" ? Math.max(-100, Math.min(100, args.contrast)) : 0;
  const target = (args.toneTarget ?? "").trim();
  const changes: string[] = [];
  if (brightness !== 0) {
    changes.push(`${brightness > 0 ? "increase" : "decrease"} brightness ${intensityWord(brightness)}`);
  }
  if (contrast !== 0) {
    changes.push(`${contrast > 0 ? "increase" : "decrease"} contrast ${intensityWord(contrast)}`);
  }
  const core =
    changes.length > 0
      ? `${changes.join(" and ")}${target ? ` for ${target}` : ""}`
      : target
        ? `adjust brightness and contrast for ${target}`
        : `adjust brightness and contrast`;
  return [prefix, core].filter(Boolean).join(" ").trim();
}

export function validateVeniceImageConstraints(args: {
  width: number;
  height: number;
  byteSize?: number | null;
}): { ok: true } | { ok: false; reason: string } {
  const width = Math.floor(args.width);
  const height = Math.floor(args.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ok: false, reason: "Invalid image dimensions" };
  }
  const pixels = width * height;
  if (pixels < 65536) return { ok: false, reason: "Image is too small for Venice edit (min 65536 pixels)" };
  if (pixels > 33177600) return { ok: false, reason: "Image is too large for Venice edit (max 33177600 pixels)" };
  const byteSize = typeof args.byteSize === "number" ? args.byteSize : null;
  if (byteSize !== null && byteSize > 10 * 1024 * 1024) {
    return { ok: false, reason: "Image is larger than 10MB and may be rejected" };
  }
  return { ok: true };
}
