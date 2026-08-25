import type { ProviderRouteManifest } from "../../contracts/src/provider-catalog.ts";
import { ProviderRegistry } from "./registry.ts";

const FIXTURE_HASH = "d".repeat(64);

const localModels = [
  { suffix: "image", modelId: "local/test-image-v1", displayName: "Test Image V1", mediaType: "image", protocol: "IMAGE" },
  { suffix: "video", modelId: "local/test-video-v1", displayName: "Test Video V1", mediaType: "video", protocol: "VIDEO" },
  { suffix: "audio", modelId: "local/test-audio-v1", displayName: "Test Audio V1", mediaType: "audio", protocol: "TTS" },
] as const;

/** Offline fixtures only; these must never be imported into a commercial catalog. */
export function localTestRouteManifests(): ProviderRouteManifest[] {
  return localModels.map((model) => {
    const familyId = `fusionlab-test-${model.suffix}`;
    const canonicalModelId = `${familyId}-v1`;
    const bindingId = `provider-test-${model.suffix}-v1`;
    const snapshotId = `snapshot.provider-test.${model.suffix}.fixture-1`;
    return {
      routeId: `route.provider-test.${model.suffix}-v1`,
      providerId: "provider-test",
      protocol: model.protocol,
      publisher: { id: "fusionlab-test", displayName: "FusionLab Test Fixtures" },
      modelFamily: { id: familyId, publisherId: "fusionlab-test", displayName: `Test ${model.suffix}`, mediaType: model.mediaType },
      canonicalModel: { id: canonicalModelId, familyId, displayName: model.displayName },
      providerAccount: {
        id: "provider-test-local-account",
        providerId: "provider-test",
        scope: "LOCAL_TEST_ONLY",
        displayName: "Provider For Test local account",
        credentialReference: "credential.provider-test.local",
      },
      providerModel: { id: bindingId, providerId: "provider-test", canonicalModelId, providerModelId: model.modelId, metadataVersion: "fixture-1" },
      hostingEndpoint: {
        id: `endpoint.provider-test.${model.suffix}.local`,
        providerId: "provider-test",
        providerModelBindingId: bindingId,
        hostingProviderId: "fusionlab-test",
        endpointReference: `endpoint.provider-test.local.${model.suffix}`,
      },
      capability: { mediaType: model.mediaType, capabilityVersion: "fixture-1", inputSchemaVersion: "fixture-1", outputSchemaVersion: "fixture-1", supportsAsync: true, supportsWebhook: false },
      sourceSnapshot: {
        id: snapshotId,
        sourceUrl: `https://fixtures.fusionlab.test/provider-test/${model.suffix}.json`,
        observedAt: "2026-08-21T00:00:00.000Z",
        rawPayloadSha256: FIXTURE_HASH,
        parserVersion: "fixture-parser-1",
      },
      providerCostVersion: { id: `provider-test-${model.suffix}-cost-v1`, version: "fixture-1", pricingKind: "DIMENSIONAL", nativeUnit: "provider_credit", nativeScale: "1", sourceSnapshotId: snapshotId, effectiveAt: "2026-08-21T00:00:00.000Z" },
      costGuard: { kind: "INTERNAL_CERTIFIED_MAX", maximumNativeAtomic: "100000", reason: "Bounded local test fixture" },
      usageExtractorVersion: "fixture-1",
      certification: { lifecycle: "VALIDATED", scope: "LOCAL_TEST_ONLY" },
    };
  });
}

export function registerLocalTestRouteManifests(registry: ProviderRegistry): void {
  for (const route of localTestRouteManifests()) registry.registerRoute(route);
}
