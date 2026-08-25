import type { ProviderGenerationRequest } from "../../contracts/src/provider.ts";
import { KieMarketAdapter } from "./kie-market-adapter.ts";
import { OpenRouterVideoAdapter } from "./openrouter-video-adapter.ts";
import { OpenRouterChatAdapter, OpenRouterImageAdapter, OpenRouterSttAdapter, OpenRouterTtsAdapter } from "./openrouter-sync-adapters.ts";
import { VersionedProviderAdapterFactoryRegistry } from "./provider-runtime-resolver.ts";

export const coreProviderAdapterKeys = {
  kieMarket: { providerId: "kie", adapterKey: "kie-market-job", adapterVersion: "kie-market.v1" },
  openRouterVideo: { providerId: "openrouter", adapterKey: "openrouter-video", adapterVersion: "openrouter-video.v1" },
  openRouterChat: { providerId: "openrouter", adapterKey: "openrouter-chat", adapterVersion: "openrouter-chat.v1" },
  openRouterImage: { providerId: "openrouter", adapterKey: "openrouter-image", adapterVersion: "openrouter-image.v1" },
  openRouterTts: { providerId: "openrouter", adapterKey: "openrouter-tts", adapterVersion: "openrouter-tts.v1" },
  openRouterStt: { providerId: "openrouter", adapterKey: "openrouter-stt", adapterVersion: "openrouter-stt.v1" },
} as const;

export type CoreProviderAdapterFactoryOptions = Readonly<{
  callbackUrl: string;
  openRouterCallbackUrl?: string;
  kieEstimateMaximum: (request: ProviderGenerationRequest) => number;
  openRouterVideoEstimateMaximumAtomic: (request: ProviderGenerationRequest) => bigint;
  fetch?: typeof fetch;
  kieBaseUrl?: string;
  openRouterBaseUrl?: string;
  timeoutMs?: number;
}>;

/**
 * Registers only real adapter implementations. They are constructed inside a
 * credential lease by ProviderRuntimeResolver, so this function has no API
 * call and does not hold a key in process state.
 */
export function registerCoreProviderAdapterFactories(
  registry: VersionedProviderAdapterFactoryRegistry,
  options: CoreProviderAdapterFactoryOptions,
): void {
  if (new URL(options.callbackUrl).protocol !== "https:") throw new TypeError("Provider callback URL must use HTTPS.");
  registry.register({
    ...coreProviderAdapterKeys.kieMarket,
    factory: ({ apiKey }) => new KieMarketAdapter({
      apiKey: new TextDecoder().decode(apiKey), callbackUrl: options.callbackUrl,
      estimateMaximum: options.kieEstimateMaximum, fetch: options.fetch,
      baseUrl: options.kieBaseUrl, timeoutMs: options.timeoutMs,
    }),
  });
  registry.register({
    ...coreProviderAdapterKeys.openRouterVideo,
    factory: ({ apiKey }) => new OpenRouterVideoAdapter({
      apiKey: new TextDecoder().decode(apiKey), callbackUrl: options.openRouterCallbackUrl,
      estimateMaximumAtomic: options.openRouterVideoEstimateMaximumAtomic, fetch: options.fetch,
      baseUrl: options.openRouterBaseUrl, timeoutMs: options.timeoutMs,
    }),
  });
  const openRouter = (apiKey: Uint8Array) => ({
    apiKey: new TextDecoder().decode(apiKey), fetch: options.fetch,
    baseUrl: options.openRouterBaseUrl, timeoutMs: options.timeoutMs,
  });
  registry.register({ ...coreProviderAdapterKeys.openRouterChat, factory: ({ apiKey }) => new OpenRouterChatAdapter(openRouter(apiKey)) });
  registry.register({ ...coreProviderAdapterKeys.openRouterImage, factory: ({ apiKey }) => new OpenRouterImageAdapter(openRouter(apiKey)) });
  registry.register({ ...coreProviderAdapterKeys.openRouterTts, factory: ({ apiKey }) => new OpenRouterTtsAdapter(openRouter(apiKey)) });
  registry.register({ ...coreProviderAdapterKeys.openRouterStt, factory: ({ apiKey }) => new OpenRouterSttAdapter(openRouter(apiKey)) });
}
