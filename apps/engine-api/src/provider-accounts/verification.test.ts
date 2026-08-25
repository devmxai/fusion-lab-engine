// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { verifyProviderConnection } from "./verification.ts";

const bytes = (value: string) => new TextEncoder().encode(value);
const now = () => new Date("2026-08-22T00:00:00.000Z");

describe("provider read-only connection verification", () => {
  it("uses only KIE's documented credit endpoint and returns a balance snapshot", async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.kie.ai/api/v1/chat/credit");
      expect(init.method).toBe("GET"); expect(init.redirect).toBe("error");
      expect(init.headers).toMatchObject({ authorization: "Bearer kie-local-test-key", accept: "application/json" });
      return new Response(JSON.stringify({ code: 200, msg: "success", data: 80 }), { status: 200 });
    });
    await expect(verifyProviderConnection({ providerId: "kie", credentialPurpose: "PROVIDER_GENERATION_KEY", secret: bytes("kie-local-test-key"), fetcher, now }))
      .resolves.toMatchObject({ providerId: "kie", connected: true, balance: { available: "80", unit: "KIE_CREDIT" } });
  });

  it("uses only OpenRouter's current-key endpoint and redacts key details to operational metadata", async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://openrouter.ai/api/v1/key");
      expect(init.method).toBe("GET"); expect(init.redirect).toBe("error");
      return new Response(JSON.stringify({ data: { label: "sk-or-v1...890", limit: 100, limit_remaining: 74.5, limit_reset: "monthly", is_management_key: false } }), { status: 200 });
    });
    await expect(verifyProviderConnection({ providerId: "openrouter", credentialPurpose: "PROVIDER_GENERATION_KEY", secret: bytes("openrouter-local-test-key"), fetcher, now }))
      .resolves.toMatchObject({ providerId: "openrouter", connected: true, accountLabel: "sk-or-v1...890", keyLimit: { limit: 100, remaining: 74.5, reset: "monthly" } });
  });

  it("fails closed on rejected credentials, malformed payloads, unsupported purposes, and network failure", async () => {
    await expect(verifyProviderConnection({ providerId: "kie", credentialPurpose: "PROVIDER_GENERATION_KEY", secret: bytes("bad-key-credential"), fetcher: async () => new Response("{}", { status: 401 }) })).rejects.toMatchObject({ code: "CONNECTION_UNAUTHORIZED" });
    await expect(verifyProviderConnection({ providerId: "openrouter", credentialPurpose: "PROVIDER_GENERATION_KEY", secret: bytes("bad-key-credential"), fetcher: async () => new Response(JSON.stringify({ data: {} }), { status: 200 }) })).rejects.toMatchObject({ code: "CONNECTION_PROTOCOL" });
    await expect(verifyProviderConnection({ providerId: "kie", credentialPurpose: "PROVIDER_WEBHOOK_HMAC", secret: bytes("not-a-provider-key"), fetcher: async () => new Response() })).rejects.toMatchObject({ code: "UNSUPPORTED_CREDENTIAL_PURPOSE" });
    await expect(verifyProviderConnection({ providerId: "openrouter", credentialPurpose: "PROVIDER_GENERATION_KEY", secret: bytes("bad-key-credential"), fetcher: async () => { throw new Error("offline"); } })).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
  });
});
