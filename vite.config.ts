import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  
  return {
    define: {
      // Inject build timestamp for debugging stale builds
      "__BUILD_TIME__": JSON.stringify(new Date().toISOString()),
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        output: {
          entryFileNames: "assets/[name].[hash].js",
          chunkFileNames: "assets/[name].[hash].js",
          assetFileNames: "assets/[name].[hash].[ext]",
        },
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      allowedHosts: ["host.docker.internal"],
      watch: {
        ignored: [
          "**/*.test.*",
          "**/*.spec.*",
          "**/*.e2e.*",
          "**/__tests__/**",
        ],
      },
      proxy: {
        "/api/admin": {
          target: `${env.VITE_SUPABASE_URL}/functions/v1/api-admin`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/admin/, ""),
          secure: false,
        },
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
