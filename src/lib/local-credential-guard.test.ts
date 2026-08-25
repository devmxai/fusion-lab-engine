import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

const privilegedCredentialNames = [
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

describe("local credential guard", () => {
  it("rejects every privileged credential in both the launcher and Engine", () => {
    const launcher = source("scripts/dev-local.mjs");
    const engineConfig = source("apps/engine-api/src/config.ts");

    for (const credentialName of privilegedCredentialNames) {
      expect(launcher, `launcher missing ${credentialName}`).toContain(`"${credentialName}"`);
      expect(engineConfig, `engine config missing ${credentialName}`).toContain(`"${credentialName}"`);
    }
  });
});
