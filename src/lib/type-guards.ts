/** Shared type-guard and parsing utilities. */

/** True when `value` is a non-null, non-array plain object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow `value` to `string` or return `null`. */
export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Parse a JSON string, returning the original value on failure or for non-strings. */
export function parseJsonIfString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** Detect abort-style errors from Supabase / fetch. */
export function isAbortedError(value: unknown): boolean {
  if (!value) return false;
  if (value instanceof Error) {
    const msg = (value.message || "").toLowerCase();
    return value.name === "AbortError" || msg.includes("aborted") || msg.includes("err_aborted");
  }
  if (isRecord(value)) {
    const name = typeof value.name === "string" ? value.name : "";
    const msg = typeof value.message === "string" ? value.message : "";
    const code = typeof value.code === "string" ? value.code : "";
    const status = typeof value.status === "number" ? value.status : null;
    const msgLower = msg.toLowerCase();
    return name === "AbortError" || code === "ABORTED" || status === 499 || msgLower.includes("request aborted") || msgLower.includes("aborted");
  }
  return false;
}

/** UUID v4 validation regex. */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
