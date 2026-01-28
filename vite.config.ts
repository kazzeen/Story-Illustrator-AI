import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseUrl = (env.VITE_SUPABASE_URL ?? "").trim();
  let functionsBase: string | null = null;
  try {
    if (supabaseUrl) {
      const ref = new URL(supabaseUrl).hostname.split(".")[0];
      if (ref) functionsBase = `https://${ref}.functions.supabase.co`;
    }
  } catch {
    functionsBase = null;
  }

  return {
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      allowedHosts: ["host.docker.internal"],
      proxy: functionsBase
        ? {
            "/api/admin": {
              target: functionsBase,
              changeOrigin: true,
              rewrite: (p) => p.replace(/^\/api\/admin/, "/api-admin"),
            },
          }
        : undefined,
      watch: {
        ignored: [
          "**/*.test.*",
          "**/*.spec.*",
          "**/*.e2e.*",
          "**/__tests__/**",
        ],
      },
    },
  optimizeDeps: {
    include: ["@radix-ui/react-select", "@radix-ui/react-switch"],
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  };
});
