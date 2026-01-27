import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
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
}));
