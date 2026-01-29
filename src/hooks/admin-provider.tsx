import { supabase } from "@/integrations/supabase/client";

export class AdminApiError extends Error {
  status: number;
  statusText: string;
  
  constructor(message: string, status: number, statusText: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.statusText = statusText;
  }
}

/**
 * Determines the correct base URL for admin API calls.
 * - In Development: Uses local proxy (/api/admin/...)
 * - In Production: Uses direct Supabase Edge Function URL to avoid Vercel rewrite issues.
 */
export function getAdminGatewayUrl(path: string): string {
  // Remove leading slash for consistency in joining
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  
  // In development, use the local proxy
  if (import.meta.env.DEV) {
    return `/api/admin/${cleanPath}`;
  }

  // Use the Vercel rewrite path as the primary production URL
  // This is safer because it avoids CORS preflight issues by proxying through Vercel
  // The vercel.json rewrite rule handles the forwarding to Supabase
  return `/api/admin/${cleanPath}`;
}

/**
 * Centralized fetcher for Admin API calls.
 * Handles authentication, base URL resolution, and JSON parsing safety.
 */
export async function adminApi<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  // Ensure path doesn't duplicate /api/admin if passed, but usually path is 'users', 'logs', etc.
  // If the caller passes '/api/admin/users', we should handle it, but getAdminGatewayUrl expects relative to admin root?
  // Let's assume 'path' is relative to /api/admin/, e.g., 'users' or 'stats'.
  
  // If path includes /api/admin, strip it?
  let relativePath = path;
  if (relativePath.startsWith("/api/admin/")) {
    relativePath = relativePath.replace("/api/admin/", "");
  } else if (relativePath.startsWith("api/admin/")) {
    relativePath = relativePath.replace("api/admin/", "");
  }

  const url = getAdminGatewayUrl(relativePath);
  
  const headers = new Headers(options.headers);
  const { data: { session } } = await supabase.auth.getSession();
  
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // 1. Check for HTML response (Vercel SPA Fallback)
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("text/html")) {
    throw new AdminApiError(
      "Received HTML instead of JSON. The request likely hit the SPA fallback (index.html) instead of the API.",
      response.status,
      response.statusText
    );
  }

  // 2. Handle generic non-OK responses
  if (!response.ok) {
    let errorMessage = `API Error: ${response.status} ${response.statusText}`;
    try {
      const errorBody = await response.json();
      if (errorBody.error) errorMessage = errorBody.error;
      else if (errorBody.message) errorMessage = errorBody.message;
    } catch {
      // Ignore JSON parse error for error body, stick to status text
    }
    throw new AdminApiError(errorMessage, response.status, response.statusText);
  }

  // 3. Safe JSON parse
  try {
    const text = await response.text();
    // Handle empty body
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  } catch (error) {
    throw new AdminApiError(
      `Failed to parse JSON response: ${(error as Error).message}`,
      response.status,
      response.statusText
    );
  }
}
