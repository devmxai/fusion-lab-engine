import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    // Browser tests must never contend with the developer's durable local
    // database. A dedicated E2E store also guarantees that mocked browser
    // scenarios cannot read or mutate a real local project/operation.
    env: {
      ENGINE_DURABLE_DB_PATH: ".local/fusionlab-e2e-pglite",
    },
    // Readiness must prove that Vite's proxy and the local Engine are both
    // available; /healthz alone is handled by Vite's SPA fallback.
    url: "http://127.0.0.1:8080/api/engine/readyz",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
