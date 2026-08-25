import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api/engine": {
        target: "http://127.0.0.1:8787",
        changeOrigin: false,
        rewrite: (requestPath) => requestPath.replace(/^\/api\/engine/, ""),
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          const packagePath = id.replace(/\\/g, "/");
          if (packagePath.includes("/node_modules/@supabase/") || packagePath.includes("/node_modules/@tanstack/")) {
            return "vendor-data";
          }
          if (packagePath.includes("/node_modules/@xyflow/")) return "vendor-flow";
          return undefined;
        },
      },
    },
  },
}));
