import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localEnvironmentFile = path.join(root, ".env.local");
if (existsSync(localEnvironmentFile)) loadEnvFile(localEnvironmentFile);
const forbiddenCredentials = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "KIE_API_KEY",
  "KIE_AI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "INTERNAL_WORKER_HMAC_KEY",
  "VERCEL_TOKEN",
  "SUPABASE_ACCESS_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
];

if (process.env.NODE_ENV === "production" || process.env.ENGINE_MODE === "production") {
  throw new Error("Production mode is disabled for npm run dev.");
}

const exposedCredentials = forbiddenCredentials.filter((name) => process.env[name]?.trim());
if (exposedCredentials.length > 0) {
  throw new Error(
    `Local development refuses privileged credentials: ${exposedCredentials.join(", ")}`,
  );
}

const viteEntry = path.join(root, "node_modules", "vite", "bin", "vite.js");
const tsxEntry = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const sharedEnvironment = {
  ...process.env,
  NODE_ENV: "development",
  ENGINE_MODE: "local",
  VITE_PROVIDER_MODE: "local",
  VITE_LOCAL_PROVIDER_SCENARIO: process.env.VITE_LOCAL_PROVIDER_SCENARIO || "success",
  TEST_PROVIDER_BASE_URL: process.env.TEST_PROVIDER_BASE_URL || "http://127.0.0.1:8790",
  TEST_PROVIDER_PUBLIC_URL: process.env.TEST_PROVIDER_PUBLIC_URL || "http://127.0.0.1:8790",
  TEST_PROVIDER_API_KEY: process.env.TEST_PROVIDER_API_KEY || "fusionlab-local-test-key",
};

const children = [
  spawn(process.execPath, [viteEntry], {
    cwd: root,
    env: sharedEnvironment,
    stdio: "inherit",
  }),
  spawn(process.execPath, [tsxEntry, "watch", "apps/engine-api/src/server.ts"], {
    cwd: root,
    env: sharedEnvironment,
    stdio: "inherit",
  }),
  spawn(process.execPath, [tsxEntry, "watch", "apps/provider-test-api/src/server.ts"], {
    cwd: root,
    env: sharedEnvironment,
    stdio: "inherit",
  }),
];

let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exitCode = exitCode;
}

for (const child of children) {
  child.once("error", (error) => {
    console.error("Local service failed to start:", error.message);
    stop(1);
  });
  child.once("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      console.error(`Local service exited unexpectedly: code=${code} signal=${signal}`);
      stop(code ?? 1);
    }
  });
}

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));

console.log("FusionLab local development: web=:8080 engine=:8787 provider-test=:8790");
