// @vitest-environment node
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { DurablePublishedOfferQuoteEngine, PublishedOfferQuoteEngine } from "../../commercial-engine/src/published-offer-quote.ts";
import { createLocalTestRegistrySnapshot, localFamilyVersionId } from "../../commercial-engine/src/local-test-fixture.ts";
import { PostgresCommercialRegistryRepository } from "../../commercial-engine/src/durable-registry-repository.ts";
import { VersionedCommercialRegistry } from "../../commercial-engine/src/registry.ts";
import type { TransactionalSqlClient } from "../../durable-execution/src/postgres-atomic.ts";
import { PostgresProviderControlPlaneRepository } from "./postgres-repository.ts";

const sql = await readFile(new URL("../../durable-execution/sql/001_generation_v2_durability.sql", import.meta.url), "utf8");
const databases: PGlite[] = [];
const directories: string[] = [];
const HASH = "a".repeat(64);
const NOW = () => new Date("2026-08-22T12:00:00.000Z");

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (database) => { try { await database.close(); } catch { /* intentional */ } }));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Release Bundle commercial bridge", () => {
  it("quotes a customer offer from the same active Bundle that froze its runtime route", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-release-commercial-")); directories.push(directory);
    const database = await PGlite.create(directory); databases.push(database); await database.exec(sql);
    const repository = new PostgresProviderControlPlaneRepository(database as unknown as TransactionalSqlClient, NOW);
    const commercial = createLocalTestRegistrySnapshot();
    const commercialRegistry = new VersionedCommercialRegistry();
    commercialRegistry.registerSnapshot(commercial);
    await new PostgresCommercialRegistryRepository(database as unknown as TransactionalSqlClient, NOW).appendSnapshot({
      commandId: "bridge-commercial-registry-001", evidenceSha256: "1".repeat(64), snapshot: commercial,
    });
    const common = { evidenceSha256: HASH, effectiveAt: NOW().toISOString() };
    await repository.appendVersion({ entityType: "PROVIDER_ACCOUNT", entityId: "provider-test:local-development", commandId: "bridge-account-provider-test-001", ...common, payload: { id: "provider-test:local-development", providerId: "provider-test", displayName: "Provider For Test", environment: "LOCAL", state: "CONNECTED", credentialReferenceId: "credential.provider-test.v1" } });
    await repository.appendVersion({ entityType: "CATALOG_SNAPSHOT", entityId: "snapshot.provider-test.bridge", commandId: "bridge-catalog-provider-test-001", ...common, payload: { id: "snapshot.provider-test.bridge", providerId: "provider-test", observedAt: NOW().toISOString(), sourceUrls: ["https://fixtures.example.test/provider-test"], rawPayloadSha256: "b".repeat(64), manifestSha256: "c".repeat(64), parserVersion: "local-fixture-v1", sourceScope: "PUBLIC_REFERENCE" } });
    await repository.appendVersion({ entityType: "REFERENCE_MODEL", entityId: "reference.provider-test.image", commandId: "bridge-model-provider-test-001", ...common, payload: { id: "reference.provider-test.image", providerId: "provider-test", providerModelId: "local/test-image-v1", familyId: "family:local/test-image-v1", displayName: "Test image", modalities: ["image"], state: "REFERENCE_ACTIVE", catalogSnapshotId: "snapshot.provider-test.bridge" } });
    await repository.appendVersion({ entityType: "ROUTE_CANDIDATE", entityId: "route.provider-test.image", commandId: "bridge-route-provider-test-001", ...common, payload: { id: "route.provider-test.image", providerId: "provider-test", providerAccountId: "provider-test:local-development", referenceModelId: "reference.provider-test.image", providerEndpointReferenceId: "local/provider-test-image", adapterKey: "provider-test-http", adapterVersion: "provider-test-http.v1", state: "CANARY_VALIDATED", inputProfileVersionId: "input.image.v1", usageExtractorVersion: "usage:provider-test-http:v1", billingFormulaVersionId: "billing:local/test-image-v1:v1", providerCostVersionId: "cost:provider-test-credit:v1", customerPriceVersionId: commercial.customerPriceVersions[0]!.id } });
    await repository.publishReleaseBundle({
      commandId: "bridge-release-provider-test-001", evidenceSha256: HASH,
      release: {
        id: "bundle.provider-test.image.1", scope: "LOCAL_TEST_ONLY", effectiveAt: NOW().toISOString(), rollbackTargetReleaseBundleId: null,
        financeSimulationEvidenceSha256: "d".repeat(64), securityEvidenceSha256: "e".repeat(64), canaryEvidenceSha256: "f".repeat(64), makerId: "maker", checkerId: "checker",
        offers: [{
          offerId: "offer.provider-test.image", routeCandidate: { entityId: "route.provider-test.image", version: 1 }, catalogSnapshot: { entityId: "snapshot.provider-test.bridge", version: 1 },
          credentialReferenceId: "credential.provider-test.v1", credentialVersion: 1, adapterVersion: "provider-test-http.v1",
          customerPriceVersionId: commercial.customerPriceVersions[0]!.id, commercialRegistrySnapshotId: commercial.id, commercialRegistrySnapshotVersion: commercial.version, commercialRegistryEvidenceSha256: "1".repeat(64),
          commercialRouteVersionId: "route:local/test-image-v1:v1", familyVersionId: localFamilyVersionId("local/test-image-v1"), recipeVersionId: "recipe:image.generate:v1",
        }],
      },
    });
    const quote = await new PublishedOfferQuoteEngine(repository, commercialRegistry, NOW, () => "bridge-quote-001").quote({
      offerId: "offer.provider-test.image", projectId: "project-1", mode: "exact", quantity: 1, resolution: "720p", audio: false, referenceCount: 0,
    });
    expect(quote).toMatchObject({
      id: "bridge-quote-001", offerId: "offer.provider-test.image", releaseBundleId: "bundle.provider-test.image.1", releaseBundleVersion: 1,
      customerCredits: 4n, pins: { routeVersionId: "route:local/test-image-v1:v1", customerPriceVersionId: commercial.customerPriceVersions[0]!.id },
    });
    const durableQuote = await new DurablePublishedOfferQuoteEngine(
      repository,
      new PostgresCommercialRegistryRepository(database as unknown as TransactionalSqlClient, NOW),
      NOW,
      () => "durable-bridge-quote-001",
    ).quote({
      offerId: "offer.provider-test.image", projectId: "project-1", mode: "exact", quantity: 1, resolution: "720p", audio: false, referenceCount: 0,
    });
    expect(durableQuote).toMatchObject({ id: "durable-bridge-quote-001", customerCredits: 4n, releaseBundleVersion: 1 });
  });
});
