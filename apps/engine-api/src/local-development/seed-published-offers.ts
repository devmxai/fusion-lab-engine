import type { LocalDurableRuntime } from "../durable-worker/runtime.ts";
import { PostgresCommercialRegistryRepository } from "../../../../packages/commercial-engine/src/durable-registry-repository.ts";
import { createLocalTestRegistrySnapshot } from "../../../../packages/commercial-engine/src/local-test-fixture.ts";
import { PostgresProviderControlPlaneRepository } from "../../../../packages/provider-control-plane/src/postgres-repository.ts";

const hash = (value: string) => value.repeat(64).slice(0, 64);
const effectiveAt = "2026-08-22T00:00:00.000Z";
const seedVersion = "v2";

/**
 * Development-only, restart-safe release bootstrap. This is deliberately not
 * an Admin shortcut: it writes the same immutable catalog, commercial
 * snapshot, route candidates, and atomic Release Bundle used by production.
 * Its only credential reference is the loopback Provider For Test adapter.
 */
export async function seedLocalPublishedTestOffers(runtime: LocalDurableRuntime): Promise<void> {
  const database = runtime.providerControlSqlClient();
  const commercialRepository = new PostgresCommercialRegistryRepository(database, () => new Date(effectiveAt));
  const controlPlane = new PostgresProviderControlPlaneRepository(database, () => new Date(effectiveAt));
  const snapshot = createLocalTestRegistrySnapshot({ snapshotVersion: 2 });
  await commercialRepository.appendSnapshot({
    commandId: `local-test-commercial-${seedVersion}`,
    evidenceSha256: hash("c"),
    snapshot,
  });

  const accountId = `account.provider-test.local.${seedVersion}`;
  const catalogId = `catalog.provider-test.local.${seedVersion}`;
  const credentialReferenceId = `credential.provider-test.local.${seedVersion}`;
  await controlPlane.appendVersion({
    entityType: "PROVIDER_ACCOUNT", entityId: accountId,
    commandId: `local-test-account-${seedVersion}`, evidenceSha256: hash("a"), effectiveAt,
    payload: { id: accountId, providerId: "provider-test", displayName: "Provider For Test", environment: "LOCAL", state: "CONNECTED", credentialReferenceId },
  });
  await controlPlane.appendVersion({
    entityType: "CATALOG_SNAPSHOT", entityId: catalogId,
    commandId: `local-test-catalog-${seedVersion}`, evidenceSha256: hash("b"), effectiveAt,
    payload: { id: catalogId, providerId: "provider-test", observedAt: effectiveAt, sourceUrls: ["https://fixtures.fusionlab.test/provider-test/catalog.json"], rawPayloadSha256: hash("d"), manifestSha256: hash("e"), parserVersion: "local-test-fixture-v2", sourceScope: "PUBLIC_REFERENCE" },
  });

  const offers = [] as Array<{
    offerId: string; routeCandidate: { entityId: string; version: number }; catalogSnapshot: { entityId: string; version: number }; referenceModel: { entityId: string; version: number };
    credentialReferenceId: string; credentialVersion: number; adapterVersion: string; customerPriceVersionId: string;
    commercialRegistrySnapshotId: string; commercialRegistrySnapshotVersion: number; commercialRegistryEvidenceSha256: string;
    commercialRouteVersionId: string; familyVersionId: string; recipeVersionId: string;
  }>;
  for (const route of snapshot.routes) {
    const family = snapshot.families.find((candidate) => candidate.id === route.familyVersionId)!;
    const recipe = snapshot.recipes.find((candidate) => candidate.familyVersionIds.includes(family.id))!;
    const referenceId = `reference.${route.providerModelId.replace(/[^a-z0-9]+/gi, ".")}.${seedVersion}`;
    const routeCandidateId = `route-candidate.${route.providerModelId.replace(/[^a-z0-9]+/gi, ".")}.${seedVersion}`;
    await controlPlane.appendVersion({
      entityType: "REFERENCE_MODEL", entityId: referenceId,
      commandId: `local-test-reference-${route.providerModelId}-${seedVersion}`, evidenceSha256: hash("f"), effectiveAt,
      payload: { id: referenceId, providerId: "provider-test", providerModelId: route.providerModelId, familyId: family.familyId, displayName: family.displayName, modalities: [family.mediaType], state: "REFERENCE_ACTIVE", catalogSnapshotId: catalogId },
    });
    await controlPlane.appendVersion({
      entityType: "ROUTE_CANDIDATE", entityId: routeCandidateId,
      commandId: `local-test-route-${route.providerModelId}-${seedVersion}`, evidenceSha256: hash("1"), effectiveAt,
      payload: {
        id: routeCandidateId, providerId: "provider-test", providerAccountId: accountId, referenceModelId: referenceId,
        providerEndpointReferenceId: `provider-test/${family.mediaType}`, adapterKey: "provider-test-http", adapterVersion: route.adapterVersion,
        state: "CANARY_VALIDATED", inputProfileVersionId: `input.${family.mediaType}.v1`, usageExtractorVersion: route.billingManifestVersionId,
        billingFormulaVersionId: route.billingManifestVersionId, providerCostVersionId: route.costVersionId, customerPriceVersionId: snapshot.customerPriceVersions[0]!.id,
      },
    });
    offers.push({
      offerId: `offer.provider-test.${family.mediaType}.${seedVersion}`,
      routeCandidate: { entityId: routeCandidateId, version: 1 }, catalogSnapshot: { entityId: catalogId, version: 1 }, referenceModel: { entityId: referenceId, version: 1 }, credentialReferenceId, credentialVersion: 1,
      adapterVersion: route.adapterVersion, customerPriceVersionId: snapshot.customerPriceVersions[0]!.id,
      commercialRegistrySnapshotId: snapshot.id, commercialRegistrySnapshotVersion: snapshot.version, commercialRegistryEvidenceSha256: hash("c"),
      commercialRouteVersionId: route.id, familyVersionId: family.id, recipeVersionId: recipe.id,
    });
  }
  await controlPlane.publishReleaseBundle({
    commandId: `local-test-release-${seedVersion}`, evidenceSha256: hash("2"),
    release: {
      id: `bundle.provider-test.${seedVersion}`, scope: "LOCAL_TEST_ONLY", effectiveAt, rollbackTargetReleaseBundleId: null,
      financeSimulationEvidenceSha256: hash("3"), securityEvidenceSha256: hash("4"), canaryEvidenceSha256: hash("5"), makerId: "local-maker", checkerId: "local-checker", offers,
    },
  });
}
