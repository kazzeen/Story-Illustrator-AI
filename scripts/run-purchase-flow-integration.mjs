import "dotenv/config";
import { spawnSync } from "node:child_process";

process.env.SUPABASE_TEST_URL ||= process.env.SUPABASE_URL || "";
process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ||= process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!process.env.SUPABASE_TEST_URL || !process.env.SUPABASE_TEST_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_TEST_URL or SUPABASE_TEST_SERVICE_ROLE_KEY");
  process.exit(1);
}

const result = spawnSync("npx", ["vitest", "run", "src/lib/purchase-flow.integration.test.ts"], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(typeof result.status === "number" ? result.status : 1);
