import { describe, expect, it, vi } from "vitest";
import { registerCoreProviderAdapterFactories } from "./provider-adapter-factories.ts";
import { ProviderRuntimeResolver, VersionedProviderAdapterFactoryRegistry, type ReleasedProviderRuntimeRoute } from "./provider-runtime-resolver.ts";
import { KieMarketAdapter } from "./kie-market-adapter.ts";
import { OpenRouterVideoAdapter } from "./openrouter-video-adapter.ts";
import { OpenRouterChatAdapter, OpenRouterImageAdapter, OpenRouterSttAdapter, OpenRouterTtsAdapter } from "./openrouter-sync-adapters.ts";

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const route = (providerId: "kie" | "openrouter"): ReleasedProviderRuntimeRoute => providerId === "kie" ? {
  providerId, providerAccountId: "kie-main", routeId: "route.kie.image", providerModelId: "gpt-image-2-text-to-image",
  adapterKey: "kie-market-job", adapterVersion: "kie-market.v1", credentialReferenceId: "credential.kie.main.v1", credentialVersion: 1,
  providerCostVersionId: "cost.kie.1", customerPriceVersionId: "price.kie.1", releaseBundleId: "bundle.1", releaseBundleVersion: 1, lifecycle: "PUBLISHED",
} : {
  providerId, providerAccountId: "openrouter-main", routeId: "route.openrouter.video", providerModelId: "google/veo-3.1",
  adapterKey: "openrouter-video", adapterVersion: "openrouter-video.v1", credentialReferenceId: "credential.openrouter.main.v1", credentialVersion: 1,
  providerCostVersionId: "cost.openrouter.1", customerPriceVersionId: "price.openrouter.1", releaseBundleId: "bundle.1", releaseBundleVersion: 1, lifecycle: "PUBLISHED",
};

describe("core provider adapter factories", () => {
  it("constructs the KIE and OpenRouter adapters only inside the runtime secret lease", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer lease-key" });
      return url.includes("createTask") ? json({ code: 200, data: { taskId: "kie-task" } }) : json({ id: "video-task", status: "pending" });
    });
    const registry = new VersionedProviderAdapterFactoryRegistry();
    registerCoreProviderAdapterFactories(registry, { callbackUrl: "https://engine.example.test/webhooks/provider", kieEstimateMaximum: () => 3, openRouterVideoEstimateMaximumAtomic: () => 4n, fetch: fetch as typeof globalThis.fetch });
    let leaseCount = 0;
    const resolver = new ProviderRuntimeResolver(registry, { use: async (_lease, work) => { leaseCount += 1; return work(new TextEncoder().encode("lease-key")); } });
    await resolver.withAdapter(route("kie"), async (adapter) => {
      expect(adapter).toBeInstanceOf(KieMarketAdapter);
      await expect((adapter as KieMarketAdapter).submit({ operationId: "op", model: "gpt-image-2-text-to-image", mediaType: "image", scenario: "success", input: { prompt: "test", quantity: 1, resolution: "720p", audio: false } }, "no-idempotency-assumption")).resolves.toMatchObject({ taskId: "kie-task" });
    });
    await resolver.withAdapter(route("openrouter"), async (adapter) => {
      expect(adapter).toBeInstanceOf(OpenRouterVideoAdapter);
      await expect((adapter as OpenRouterVideoAdapter).submit({ operationId: "op", model: "google/veo-3.1", mediaType: "video", scenario: "success", input: { prompt: "test", quantity: 1, durationSeconds: 5, resolution: "720p", audio: false } }, "not-assumed")).resolves.toMatchObject({ taskId: "video-task" });
    });
    expect(leaseCount).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("registers each supported OpenRouter modality under an explicit versioned adapter key", async () => {
    const registry = new VersionedProviderAdapterFactoryRegistry();
    registerCoreProviderAdapterFactories(registry, { callbackUrl: "https://engine.example.test/webhooks/provider", kieEstimateMaximum: () => 3, openRouterVideoEstimateMaximumAtomic: () => 4n, fetch: (async () => json({})) as typeof globalThis.fetch });
    const resolver = new ProviderRuntimeResolver(registry, { use: async (_lease, work) => work(new TextEncoder().encode("lease-key")) });
    const cases: Array<[string, unknown]> = [["openrouter-chat", OpenRouterChatAdapter], ["openrouter-image", OpenRouterImageAdapter], ["openrouter-tts", OpenRouterTtsAdapter], ["openrouter-stt", OpenRouterSttAdapter]];
    for (const [adapterKey, Adapter] of cases) {
      await resolver.withAdapter({ ...route("openrouter"), adapterKey, adapterVersion: `${adapterKey}.v1` }, async (adapter) => {
        expect(adapter).toBeInstanceOf(Adapter as new () => object);
      });
    }
  });
});
