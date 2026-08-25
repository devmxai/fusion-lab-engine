import { describe, expect, it } from "vitest";
import type { ProviderAdapter } from "./types.ts";
import { ProviderRegistry } from "./registry.ts";
import { localTestRouteManifests } from "./local-test-route-catalog.ts";
import type { ProviderRouteManifest } from "../../contracts/src/provider-catalog.ts";

const HASH = "c".repeat(64);

const adapter: ProviderAdapter = {
  id: "provider-test",
  displayName: "Provider For Test",
  version: "1.0.0",
  assetSourcePolicy: { allowedOrigins: [], allowHttpLoopbackForLocalTest: true, allowPrivateLoopbackForLocalTest: true },
  listModels: async () => [],
  getBalance: async () => ({ provider: "provider-test", unit: "provider_credit", available: 0, held: 0, spent: 0 }),
  submit: async () => ({ taskId: "unused", status: "submitted", estimatedProviderCredits: 0 }),
  lookupByIdempotency: async () => null,
  getTask: async () => ({ taskId: "unused", status: "failed", actualProviderCredits: null, resultUrl: null, errorCode: null }),
  fetchAsset: async () => ({ bytes: new Uint8Array(), contentType: "application/octet-stream", sourceUrl: "http://127.0.0.1/unused" }),
};

const route: ProviderRouteManifest = {
  routeId: "route.provider-test.audio-v1", providerId: "provider-test", protocol: "TTS",
  publisher: { id: "fusionlab-test", displayName: "FusionLab Test" },
  modelFamily: { id: "test-audio", publisherId: "fusionlab-test", displayName: "Test Audio", mediaType: "audio" },
  canonicalModel: { id: "test-audio-v1", familyId: "test-audio", displayName: "Test Audio v1" },
  providerAccount: { id: "provider-test-local-account", providerId: "provider-test", scope: "LOCAL_TEST_ONLY", displayName: "Local test account", credentialReference: "credential.provider-test.local" },
  providerModel: { id: "provider-test-audio-v1", providerId: "provider-test", canonicalModelId: "test-audio-v1", providerModelId: "test/audio-v1", metadataVersion: "fixture-1" },
  hostingEndpoint: { id: "provider-test-audio-local", providerId: "provider-test", providerModelBindingId: "provider-test-audio-v1", hostingProviderId: "fusionlab-test", endpointReference: "endpoint.provider-test.local.audio" },
  capability: { mediaType: "audio", capabilityVersion: "fixture-1", inputSchemaVersion: "fixture-1", outputSchemaVersion: "fixture-1", supportsAsync: true, supportsWebhook: false },
  sourceSnapshot: { id: "snapshot.provider-test.audio-fixture-1", sourceUrl: "https://fixtures.fusionlab.test/provider-test/audio.json", observedAt: "2026-08-21T00:00:00.000Z", rawPayloadSha256: HASH, parserVersion: "fixture-parser-1" },
  providerCostVersion: { id: "provider-test-audio-cost-v1", version: "fixture-1", pricingKind: "STATIC", nativeUnit: "provider_credit", nativeScale: "1", sourceSnapshotId: "snapshot.provider-test.audio-fixture-1", effectiveAt: "2026-08-21T00:00:00.000Z" },
  costGuard: { kind: "INTERNAL_CERTIFIED_MAX", maximumNativeAtomic: "2", reason: "Local fixture maximum" },
  usageExtractorVersion: "fixture-1", certification: { lifecycle: "VALIDATED", scope: "LOCAL_TEST_ONLY" },
};

describe("provider registry route boundary", () => {
  it("only accepts a route for a registered provider and never promotes it to production", () => {
    const registry = new ProviderRegistry();
    expect(() => registry.registerRoute(route)).toThrow("provider_adapter_not_registered:provider-test");
    registry.register(adapter);
    registry.registerRoute(route);
    expect(registry.listRoutes({ providerId: "provider-test" })).toEqual([route]);
    expect(() => registry.requirePublishedRoute(route.routeId)).toThrow("provider_route_not_published");
  });

  it("keeps offline fixtures visibly local and never publishable", () => {
    const registry = new ProviderRegistry();
    registry.register(adapter);
    for (const fixture of localTestRouteManifests()) registry.registerRoute(fixture);
    expect(registry.listRoutes({ scope: "LOCAL_TEST_ONLY" })).toHaveLength(3);
    expect(registry.listRoutes().every((route) => route.certification.lifecycle === "VALIDATED")).toBe(true);
  });
});
