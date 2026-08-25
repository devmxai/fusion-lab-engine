import type { ProviderGenerationRequest } from "../../contracts/src/provider.ts";
import type { ProviderRouteManifest } from "../../contracts/src/provider-catalog.ts";

/** Explicit offline target matrix; no entry represents a published KIE product. */
export const kieOfflineRouteFixtures = [
  { routeId: "kie-fixture-image-v1", model: "kie/fixture-image-v1", mediaType: "image", nativeScale: 100n, input: { prompt: "fixture", quantity: 1, resolution: "720p", audio: false } },
  { routeId: "kie-fixture-video-v1", model: "kie/fixture-video-v1", mediaType: "video", nativeScale: 100n, input: { prompt: "fixture", quantity: 1, durationSeconds: 5, resolution: "720p", audio: false, aspectRatio: "16:9" } },
] as const;

export function kieFixtureRequest(routeId: string): ProviderGenerationRequest {
  const route = kieOfflineRouteFixtures.find((candidate) => candidate.routeId === routeId);
  if (!route) throw new Error(`kie_fixture_route_not_found:${routeId}`);
  return { operationId: `operation-${route.routeId}`, model: route.model, mediaType: route.mediaType, scenario: "success", input: route.input } as ProviderGenerationRequest;
}

export function kieCatalogRouteManifests(): ProviderRouteManifest[] {
  return kieOfflineRouteFixtures.map((route) => ({
    routeId: `route.${route.routeId}`, providerId: "kie", protocol: route.mediaType === "video" ? "MARKET_JOB" : "IMAGE",
    publisher: { id: "kie-fixture-publisher", displayName: "KIE Offline Fixture Publisher" },
    modelFamily: { id: `family.${route.routeId}`, publisherId: "kie-fixture-publisher", displayName: route.routeId, mediaType: route.mediaType },
    canonicalModel: { id: `model.${route.routeId}`, familyId: `family.${route.routeId}`, displayName: route.model },
    providerAccount: { id: "kie-local-fixture-account", providerId: "kie", scope: "LOCAL_TEST_ONLY", displayName: "KIE fixture account", credentialReference: "credential.kie.fixture" },
    providerModel: { id: `binding.${route.routeId}`, providerId: "kie", canonicalModelId: `model.${route.routeId}`, providerModelId: route.model, metadataVersion: "fixture-1" },
    hostingEndpoint: { id: `endpoint.${route.routeId}`, providerId: "kie", providerModelBindingId: `binding.${route.routeId}`, hostingProviderId: "kie", endpointReference: "kie.market.fixture" },
    capability: { mediaType: route.mediaType, capabilityVersion: "fixture-1", inputSchemaVersion: "fixture-1", outputSchemaVersion: "fixture-1", supportsAsync: true, supportsWebhook: true },
    sourceSnapshot: { id: `source.${route.routeId}`, sourceUrl: "https://fixtures.fusionlab.test/kie/offline.json", observedAt: "2026-08-21T00:00:00.000Z", rawPayloadSha256: "a".repeat(64), parserVersion: "fixture-parser-1" },
    providerCostVersion: { id: `cost.${route.routeId}`, version: "fixture-1", pricingKind: "DIMENSIONAL", nativeUnit: "kie_credit", nativeScale: route.nativeScale.toString(), sourceSnapshotId: `source.${route.routeId}`, effectiveAt: "2026-08-21T00:00:00.000Z" },
    costGuard: { kind: "INTERNAL_CERTIFIED_MAX", maximumNativeAtomic: "100000", reason: "Offline fixture bound" }, usageExtractorVersion: "kie-market-creditsConsumed.v1", certification: { lifecycle: "VALIDATED", scope: "LOCAL_TEST_ONLY" },
  }));
}
