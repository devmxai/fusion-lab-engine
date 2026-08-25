import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "apps/**/*.{test,spec}.{ts,tsx}",
      "packages/**/*.{test,spec}.{ts,tsx}",
    ],
    // Several contract tests open real local PGlite files. Their work is
    // deterministic but can exceed Vitest's 5s unit-test default when the
    // browser/dev servers are also running; do not misreport that as a domain
    // failure. Individual tests still set tighter limits where required.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // These suites use deterministic on-disk PGlite fixtures. Parallel files
    // contend for the same local resources on Windows and turn valid engine
    // assertions into timeout noise, so retain isolated, serial file runs.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
});
