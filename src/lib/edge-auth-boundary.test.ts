import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

const edgeFunctions = {
  "start-generation": {
    file: "supabase/functions/start-generation/index.ts",
    mustContain: ["supabase.auth.getUser()", "signInternalWorkloadRequest", "INTERNAL_WORKER_HMAC_KEY"],
  },
  "kie-ai": {
    file: "supabase/functions/kie-ai/index.ts",
    mustContain: ["supabaseClient.auth.getUser()", "verifyInternalWorkloadRequest", "INTERNAL_WORKER_HMAC_KEY"],
  },
  "gemini-tts": {
    file: "supabase/functions/gemini-tts/index.ts",
    mustContain: ["supabaseClient.auth.getUser()", "verifyInternalWorkloadRequest", "INTERNAL_WORKER_HMAC_KEY"],
  },
  "complete-generation": {
    file: "supabase/functions/complete-generation/index.ts",
    mustContain: ["verifyInternalWorkloadRequest", "internal_workload_required", "INTERNAL_WORKER_HMAC_KEY"],
  },
  "system-jobs": {
    file: "supabase/functions/system-jobs/index.ts",
    mustContain: ["verifyInternalWorkloadRequest", "internal_workload_required", "INTERNAL_WORKER_HMAC_KEY"],
  },
} as const;

describe("verify_jwt=false Edge Function security boundary", () => {
  it("lists exactly the manually authenticated functions in local Supabase config", () => {
    const config = source("supabase/config.toml").replace(/\r\n/g, "\n");
    for (const name of Object.keys(edgeFunctions)) {
      expect(config).toContain(`[functions.${name}]\nverify_jwt = false`);
    }
  });

  it("requires the correct fail-closed authentication contract for every listed function", () => {
    for (const [name, contract] of Object.entries(edgeFunctions)) {
      const content = source(contract.file);
      for (const requiredText of contract.mustContain) {
        expect(content, `${name} missing ${requiredText}`).toContain(requiredText);
      }
      expect(content, `${name} must not accept the legacy shared credential header`).not.toContain("x-internal-caller");
    }
  });

  it("does not make workload-signature headers available through browser CORS", () => {
    for (const [name, contract] of Object.entries(edgeFunctions)) {
      const allowedHeaders = source(contract.file).match(/"Access-Control-Allow-Headers"\s*:\s*"([^"]*)"/)?.[1] ?? "";
      expect(allowedHeaders, `${name} CORS`).not.toContain("x-fusionlab-workload-signature");
      expect(allowedHeaders, `${name} CORS`).not.toContain("x-fusionlab-workload-timestamp");
    }
  });
});
