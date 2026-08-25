import { describe, expect, it } from "vitest";
import { ProviderRouteCatalog, ProviderRouteManifestSchema, type ProviderRouteManifest } from "./provider-catalog.ts";

const HASH = "b".repeat(64);

function localRoute(): ProviderRouteManifest {
  return {
    routeId: "route.provider-test.image-v1",
    providerId: "provider-test",
    protocol: "IMAGE",
    publisher: { id: "fusionlab-test", displayName: "FusionLab Test" },
    modelFamily: { id: "test-image", publisherId: "fusionlab-test", displayName: "Test Image", mediaType: "image" },
    canonicalModel: { id: "test-image-v1", familyId: "test-image", displayName: "Test Image v1" },
    providerAccount: {
      id: "provider-test-local-account",
      providerId: "provider-test",
      scope: "LOCAL_TEST_ONLY",
      displayName: "Local test account",
      credentialReference: "credential.provider-test.local",
    },
    providerModel: {
      id: "provider-test-image-v1",
      providerId: "provider-test",
      canonicalModelId: "test-image-v1",
      providerModelId: "test/image-v1",
      metadataVersion: "fixture-1",
    },
    hostingEndpoint: {
      id: "provider-test-image-local",
      providerId: "provider-test",
      providerModelBindingId: "provider-test-image-v1",
      hostingProviderId: "fusionlab-test",
      endpointReference: "endpoint.provider-test.local.image",
    },
    capability: {
      mediaType: "image",
      capabilityVersion: "fixture-1",
      inputSchemaVersion: "fixture-1",
      outputSchemaVersion: "fixture-1",
      supportsAsync: true,
      supportsWebhook: false,
    },
    sourceSnapshot: {
      id: "snapshot.provider-test.fixture-1",
      sourceUrl: "https://fixtures.fusionlab.test/provider-test/catalog.json",
      observedAt: "2026-08-21T00:00:00.000Z",
      rawPayloadSha256: HASH,
      parserVersion: "fixture-parser-1",
    },
    providerCostVersion: {
      id: "provider-test-image-cost-v1",
      version: "fixture-1",
      pricingKind: "STATIC",
      nativeUnit: "provider_credit",
      nativeScale: "1",
      sourceSnapshotId: "snapshot.provider-test.fixture-1",
      effectiveAt: "2026-08-21T00:00:00.000Z",
    },
    costGuard: { kind: "INTERNAL_CERTIFIED_MAX", maximumNativeAtomic: "2", reason: "Local fixture maximum" },
    usageExtractorVersion: "fixture-1",
    certification: { lifecycle: "VALIDATED", scope: "LOCAL_TEST_ONLY" },
  };
}

describe("provider catalog route contract", () => {
  it("models the complete route relation without treating publisher as provider", () => {
    const route = ProviderRouteManifestSchema.parse(localRoute());
    expect(route.publisher.id).not.toBe(route.providerId);
    expect(route.hostingEndpoint.providerModelBindingId).toBe(route.providerModel.id);
    expect(route.providerCostVersion.sourceSnapshotId).toBe(route.sourceSnapshot.id);
  });

  it("rejects unsafe cost guards, broken references and an invalid local publication", () => {
    expect(ProviderRouteManifestSchema.safeParse({
      ...localRoute(),
      costGuard: { kind: "PINNED_ENDPOINT_MAX", reason: "Missing maximum" },
    }).success).toBe(false);
    expect(ProviderRouteManifestSchema.safeParse({
      ...localRoute(),
      canonicalModel: { ...localRoute().canonicalModel, familyId: "wrong-family" },
    }).success).toBe(false);
    expect(ProviderRouteManifestSchema.safeParse({
      ...localRoute(),
      certification: { lifecycle: "PUBLISHED", scope: "LOCAL_TEST_ONLY", evidenceSha256: HASH, certifiedAt: "2026-08-21T00:00:00.000Z" },
    }).success).toBe(false);
  });

  it("keeps a local validated route non-publishable and prevents duplicate registrations", () => {
    const catalog = new ProviderRouteCatalog();
    catalog.register(localRoute());
    expect(catalog.list({ scope: "LOCAL_TEST_ONLY" })).toHaveLength(1);
    expect(() => catalog.requirePublished("route.provider-test.image-v1"))
      .toThrow("provider_route_not_published:route.provider-test.image-v1");
    expect(() => catalog.register(localRoute()))
      .toThrow("provider_route_already_registered:route.provider-test.image-v1");
  });
});
