/** Shared utility helpers for Supabase Edge Functions. */

export type JsonObject = Record<string, unknown>;

/** True when `value` is a non-null, non-array plain object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow `value` to `string` or return `null`. */
export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** UUID v4 validation regex. */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Build a JSON Response with the supplied CORS headers. */
export function jsonResponse(
  status: number,
  body: unknown,
  corsHeaders: Record<string, string>,
  extraHeaders?: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(extraHeaders ?? {}) },
  });
}

/** Escape special regex characters in a string. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
