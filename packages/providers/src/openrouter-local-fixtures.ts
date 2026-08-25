import type { ProviderRouteManifest } from "../../contracts/src/provider-catalog.ts";

/** Named only for offline contract coverage; no row represents a live OpenRouter route. */
export const openRouterOfflineRouteFixtures = [
  { id: "chat", protocol: "CHAT", mediaType: "text" },
  { id: "image", protocol: "IMAGE", mediaType: "image" },
  { id: "video", protocol: "VIDEO", mediaType: "video" },
  { id: "tts", protocol: "TTS", mediaType: "audio" },
  { id: "stt", protocol: "STT", mediaType: "text" },
] as const;

export function openRouterCatalogRouteManifests(): ProviderRouteManifest[] {
  return openRouterOfflineRouteFixtures.map((route) => ({
    routeId: `route.openrouter.fixture.${route.id}`, providerId: "openrouter", protocol: route.protocol,
    publisher: { id: "openrouter-fixture-publisher", displayName: "OpenRouter Offline Fixture Publisher" },
    modelFamily: { id: `family.openrouter.fixture.${route.id}`, publisherId: "openrouter-fixture-publisher", displayName: `OpenRouter Fixture ${route.id.toUpperCase()}`, mediaType: route.mediaType },
    canonicalModel: { id: `model.openrouter.fixture.${route.id}`, familyId: `family.openrouter.fixture.${route.id}`, displayName: `openrouter/fixture-${route.id}-v1` },
    providerAccount: { id: "openrouter-local-fixture-account", providerId: "openrouter", scope: "LOCAL_TEST_ONLY", displayName: "OpenRouter fixture account", credentialReference: "credential.openrouter.fixture" },
    providerModel: { id: `binding.openrouter.fixture.${route.id}`, providerId: "openrouter", canonicalModelId: `model.openrouter.fixture.${route.id}`, providerModelId: `openrouter/fixture-${route.id}-v1`, metadataVersion: "fixture-1" },
    hostingEndpoint: { id: `endpoint.openrouter.fixture.${route.id}`, providerId: "openrouter", providerModelBindingId: `binding.openrouter.fixture.${route.id}`, hostingProviderId: "openrouter-fixture-host", endpointReference: `openrouter.fixture.${route.protocol.toLowerCase()}` },
    capability: { mediaType: route.mediaType, capabilityVersion: "fixture-1", inputSchemaVersion: "fixture-1", outputSchemaVersion: "fixture-1", supportsAsync: route.protocol === "VIDEO", supportsWebhook: route.protocol === "VIDEO" },
    sourceSnapshot: { id: `source.openrouter.fixture.${route.id}`, sourceUrl: "https://fixtures.fusionlab.test/openrouter/offline.json", observedAt: "2026-08-21T00:00:00.000Z", rawPayloadSha256: "b".repeat(64), parserVersion: "fixture-parser-1" },
    providerCostVersion: { id: `cost.openrouter.fixture.${route.id}`, version: "fixture-1", pricingKind: route.protocol === "VIDEO" ? "DIMENSIONAL" : "METERED", nativeUnit: "openrouter_usd", nativeScale: "1000000", sourceSnapshotId: `source.openrouter.fixture.${route.id}`, effectiveAt: "2026-08-21T00:00:00.000Z" },
    costGuard: { kind: "PINNED_ENDPOINT_MAX", maximumNativeAtomic: "100000", reason: "Offline fixture bound" }, usageExtractorVersion: `openrouter-${route.id}.fixture.v1`, certification: { lifecycle: "VALIDATED", scope: "LOCAL_TEST_ONLY" },
  }));
}
