import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";
import crypto from "node:crypto";

const supabaseUrl = process.env.SUPABASE_TEST_URL ?? process.env.SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anonKey = process.env.SUPABASE_TEST_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
const enabled = Boolean(supabaseUrl && serviceRoleKey && anonKey);

type SupabaseClient = ReturnType<typeof createClient>;

async function createConfirmedUser(admin: SupabaseClient) {
  const email = `admin-bypass-${crypto.randomUUID()}@example.com`;
  const password = `Pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error("Missing user id");
  return { email, password, userId };
}

async function setAdminFlag(admin: SupabaseClient, userId: string, isAdmin: boolean) {
  const { error } = await admin.from("profiles").update({ is_admin: isAdmin }).eq("user_id", userId);
  if (error) throw error;
}

async function signInUser(client: SupabaseClient, email: string, password: string) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const token = data.session?.access_token ?? null;
  if (!token) throw new Error("Missing access token");
  return token;
}

async function callBypass(supabaseUrl: string, anonKey: string, accessToken?: string) {
  const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/api-admin/bypass`;
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: anonKey };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const resp = await fetch(url, { method: "POST", headers, body: "{}" });
  const body = (await resp.json().catch(() => ({}))) as unknown;
  return { status: resp.status, body };
}

describe("admin bypass", () => {
  test.skipIf(!enabled)("allows bypass for is_admin user and logs event", async () => {
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const { email, password, userId } = await createConfirmedUser(admin);
    await setAdminFlag(admin, userId, true);
    const token = await signInUser(client, email, password);

    const bypass = await callBypass(supabaseUrl, anonKey, token);
    expect(bypass.status).toBe(200);
    expect((bypass.body as { ok?: unknown }).ok).toBe(true);

    const { data: logs, error } = await admin
      .from("audit_logs")
      .select("action_type, target_user_id, admin_username, after, created_at")
      .eq("action_type", "admin.bypass")
      .eq("target_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(logs)).toBe(true);
    expect(logs?.length).toBeGreaterThan(0);
    expect(logs?.[0]?.admin_username).toBe(email);
  });

  test.skipIf(!enabled)("denies bypass for non-admin user", async () => {
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const { email, password, userId } = await createConfirmedUser(admin);
    await setAdminFlag(admin, userId, false);
    const token = await signInUser(client, email, password);

    const bypass = await callBypass(supabaseUrl, anonKey, token);
    expect(bypass.status).toBe(403);
  });

  test.skipIf(!enabled)("denies bypass without auth", async () => {
    const bypass = await callBypass(supabaseUrl, anonKey);
    expect(bypass.status).toBe(401);
  });
});
