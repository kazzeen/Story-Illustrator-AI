import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const email = `test-${crypto.randomUUID()}@example.com`;
  const password = `pw-${crypto.randomUUID()}`;

  const create = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  console.log({
    createOk: !create.error,
    createError: create.error ? { name: create.error.name, status: create.error.status, message: create.error.message } : null,
    userId: create.data?.user?.id ?? null,
  });

  const list = await supabase.auth.admin.listUsers({ perPage: 1, page: 1 });
  console.log({
    listOk: !list.error,
    listError: list.error ? { name: list.error.name, status: list.error.status, message: list.error.message } : null,
    sampleUserId: list.data?.users?.[0]?.id ?? null,
  });

  const sampleUserId = list.data?.users?.[0]?.id;
  if (sampleUserId) {
    const ensure = await supabase.rpc("ensure_user_credits_v2", { p_user_id: sampleUserId });
    console.log({
      ensureOk: !ensure.error,
      ensureError: ensure.error ? { code: ensure.error.code, message: ensure.error.message } : null,
      ensureData: ensure.data ?? null,
    });
  }
}

main().catch((e) => {
  console.error(e?.message ?? String(e));
  process.exit(1);
});

