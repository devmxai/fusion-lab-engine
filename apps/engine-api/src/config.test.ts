// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  LocalEngineConfigurationError,
  loadLocalEngineConfig,
} from "./config.ts";

describe("local Engine configuration", () => {
  it("defaults to loopback-only local mode", () => {
    expect(loadLocalEngineConfig({ NODE_ENV: "test" })).toMatchObject({
      NODE_ENV: "test",
      ENGINE_MODE: "local",
      ENGINE_HOST: "127.0.0.1",
      ENGINE_PORT: 8787,
      ENGINE_LOCAL_PROVIDER_MARKUP_BPS: 10_000,
    });
  });

  it("accepts an explicit local pricing markup in basis points", () => {
    expect(loadLocalEngineConfig({
      NODE_ENV: "test",
      ENGINE_LOCAL_PROVIDER_MARKUP_BPS: "7500",
    }).ENGINE_LOCAL_PROVIDER_MARKUP_BPS).toBe(7_500);
  });

  it.each(["-1", "100001", "not-a-number"])(
    "rejects invalid local pricing markup %s",
    (markup) => {
      expect(() => loadLocalEngineConfig({
        NODE_ENV: "test",
        ENGINE_LOCAL_PROVIDER_MARKUP_BPS: markup,
      })).toThrow(LocalEngineConfigurationError);
    },
  );

  it("rejects production mode", () => {
    expect(() => loadLocalEngineConfig({ NODE_ENV: "production" })).toThrow(
      LocalEngineConfigurationError,
    );
  });

  it.each([
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
  ])("rejects privileged local credential %s", (credentialName) => {
    expect(() => loadLocalEngineConfig({
      NODE_ENV: "test",
      [credentialName]: "must-not-be-local",
    })).toThrow(credentialName);
  });
});
