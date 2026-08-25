import { describe, expect, it, vi } from "vitest";
import {
  ProviderNetworkDeniedError,
  createProviderNetworkDenyFetch,
  isBlockedProviderUrl,
} from "./provider-network-deny";

describe("provider network deny", () => {
  it("blocks every configured paid-provider origin before the upstream fetch executes", async () => {
    const upstream = vi.fn(async () => new Response("unexpected"));
    const guarded = createProviderNetworkDenyFetch(upstream as typeof fetch);

    for (const url of [
      "https://api.kie.ai/api/v1/jobs/createTask",
      "https://kieai.redpandaai.co/api/file-base64-upload",
      "https://openrouter.ai/api/v1/videos",
      "https://generativelanguage.googleapis.com/v1beta/models/example:generateContent",
    ]) {
      await expect(guarded(url)).rejects.toBeInstanceOf(ProviderNetworkDeniedError);
      expect(isBlockedProviderUrl(url)).toBe(true);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("allows local Engine API traffic and does not over-match unrelated hosts", async () => {
    const upstream = vi.fn(async () => new Response("ok"));
    const guarded = createProviderNetworkDenyFetch(upstream as typeof fetch, "http://127.0.0.1:8080");

    await expect(guarded("/api/engine/v1/dev/mock/quotes")).resolves.toMatchObject({ status: 200 });
    expect(isBlockedProviderUrl("https://notopenrouter.ai/api", "http://127.0.0.1:8080")).toBe(false);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
