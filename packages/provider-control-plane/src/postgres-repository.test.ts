// @vitest-environment node
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import type { TransactionalSqlClient } from "../../durable-execution/src/postgres-atomic.ts";
import { createLocalTestRegistrySnapshot } from "../../commercial-engine/src/local-test-fixture.ts";
import { PostgresCommercialRegistryRepository } from "../../commercial-engine/src/durable-registry-repository.ts";
import { ImmutableAdminAuditLog } from "../../admin-control-plane/src/audit.ts";
import { VersionedAdminChangeService } from "../../admin-control-plane/src/change-service.ts";
import type { AdminIdentity } from "../../admin-control-plane/src/types.ts";
import { ProviderControlPlaneChangePublisher } from "./admin-change-publisher.ts";
import { PostgresProviderControlPlaneRepository } from "./postgres-repository.ts";

const sql = await readFile(new URL("../../durable-execution/sql/001_generation_v2_durability.sql", import.meta.url), "utf8");
const databases: PGlite[] = [];
const directories: string[] = [];
const HASH = "a".repeat(64);
const identity = (actorId: string, roles: AdminIdentity["roles"]): AdminIdentity => ({ actorId, roles: ["ADMIN_VIEWER", ...roles], assuranceLevel: 2 });
const providerPayload = (id: string, displayName: string) => ({ id, displayName, lifecycle: "REFERENCE_ONLY", documentationUrl: `https://docs.example.test/${id}` });
const catalogSnapshotPayload = (id: string, providerId: string) => ({
  id, providerId, observedAt: "2026-08-22T00:00:00.000Z", sourceUrls: [`https://docs.example.test/${providerId}`],
  rawPayloadSha256: "b".repeat(64), manifestSha256: "c".repeat(64), parserVersion: "catalog-parser-v1", sourceScope: "PUBLIC_REFERENCE" as const,
});
function commercialSnapshotForOpenRouter() {
  const snapshot = createLocalTestRegistrySnapshot();
  snapshot.id = "commercial.openrouter.image.v1";
  const family = snapshot.families[0]!;
  family.id = "family.openrouter.image.v1"; family.familyId = "family.openrouter.image"; family.displayName = "GPT Image";
  const recipe = snapshot.recipes[0]!;
  recipe.id = "recipe.image.generate.v1"; recipe.recipeId = "image.generate"; recipe.familyVersionIds = [family.id];
  const capability = snapshot.capabilities[0]!;
  capability.id = "capability.openrouter.image.v1";
  const billing = snapshot.billingManifests[0]!;
  billing.id = "billing.openrouter.image.v1";
  const cost = snapshot.costVersions[0]!;
  cost.id = "cost.openrouter.image.v1";
  const price = snapshot.customerPriceVersions[0]!;
  price.id = "price.image.v1";
  const route = snapshot.routes[0]!;
  route.id = "commercial-route.openrouter.image.v1"; route.routeId = "route.openrouter.image";
  route.providerId = "openrouter"; route.providerAccountId = "account.openrouter.primary"; route.providerModelId = "openai/gpt-image-1";
  route.familyVersionId = family.id; route.capabilityVersionId = capability.id; route.billingManifestVersionId = billing.id;
  route.costVersionId = cost.id; route.adapterVersion = "openrouter-image.v1";
  snapshot.families = [family]; snapshot.recipes = [recipe]; snapshot.capabilities = [capability]; snapshot.billingManifests = [billing];
  snapshot.costVersions = [cost]; snapshot.customerPriceVersions = [price]; snapshot.routes = [route];
  return snapshot;
}
afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (database) => {
    try { await database.close(); } catch { /* closed intentionally by restart proof */ }
  }));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("durable Provider Control Plane repository", () => {
  it("only accepts a reviewed customer taxonomy pinned to the same catalog snapshot", async () => {
    const database = await PGlite.create(); databases.push(database); await database.exec(sql);
    const repository = new PostgresProviderControlPlaneRepository(database as unknown as TransactionalSqlClient, () => new Date("2026-08-22T00:00:00.000Z"));
    const common = { evidenceSha256: HASH, effectiveAt: "2026-08-22T00:00:00.000Z" };
    await repository.appendVersion({
      entityType: "CATALOG_SNAPSHOT", entityId: "snapshot.kie.reviewed", commandId: "catalog-kie-reviewed-001", ...common,
      payload: catalogSnapshotPayload("snapshot.kie.reviewed", "kie"),
    });
    await repository.appendVersion({
      entityType: "REFERENCE_MODEL", entityId: "reference.kie.kling-3", commandId: "model-kie-kling-review-001", ...common,
      payload: {
        id: "reference.kie.kling-3", providerId: "kie", providerModelId: "kling/v3-image-to-video", familyId: "kling", displayName: "Kling - V3 Image To Video",
        modalities: ["image", "video"], state: "REVIEWED", catalogSnapshotId: "snapshot.kie.reviewed",
        reviewedTaxonomy: {
          schemaVersion: 1, reviewState: "REVIEWED", sourceCatalogSnapshotId: "snapshot.kie.reviewed",
          productFamily: { id: "kling", displayName: "Kling" }, version: { id: "3", displayName: "3.0" }, edition: { id: "turbo", displayName: "Turbo" },
          experienceCategories: ["VIDEO"],
        },
      },
    });
    await expect(repository.appendVersion({
      entityType: "REFERENCE_MODEL", entityId: "reference.kie.kling-wrong-snapshot", commandId: "model-kie-kling-review-002", ...common,
      payload: {
        id: "reference.kie.kling-wrong-snapshot", providerId: "kie", providerModelId: "kling/v3-text-to-video", familyId: "kling", displayName: "Kling - V3 Text To Video",
        modalities: ["text", "video"], state: "REVIEWED", catalogSnapshotId: "snapshot.kie.reviewed",
        reviewedTaxonomy: {
          schemaVersion: 1, reviewState: "REVIEWED", sourceCatalogSnapshotId: "snapshot.kie.other",
          productFamily: { id: "kling", displayName: "Kling" }, experienceCategories: ["VIDEO"],
        },
      },
    })).rejects.toMatchObject({ code: "INVALID_REFERENCE" });
  });

  it("creates immutable idempotent versions for multiple providers without schema changes", async () => {
    const database = await PGlite.create(); databases.push(database); await database.exec(sql);
    const repository = new PostgresProviderControlPlaneRepository(database as unknown as TransactionalSqlClient, () => new Date("2026-08-22T00:00:00.000Z"));
    const common = { evidenceSha256: HASH, effectiveAt: "2026-08-22T00:00:00.000Z" };
    const kie = await repository.appendVersion({ entityType: "PROVIDER", entityId: "kie", commandId: "provider-kie-create-001", payload: providerPayload("kie", "KIE.ai"), ...common });
    const openrouter = await repository.appendVersion({ entityType: "PROVIDER", entityId: "openrouter", commandId: "provider-openrouter-create-001", payload: providerPayload("openrouter", "OpenRouter"), ...common });
    const third = await repository.appendVersion({ entityType: "PROVIDER", entityId: "third-provider", commandId: "provider-third-create-001", payload: providerPayload("third-provider", "Third Provider"), ...common });
    expect([kie, openrouter, third].map((value) => value.version)).toEqual([1, 1, 1]);
    await expect(repository.appendVersion({ entityType: "PROVIDER", entityId: "kie", commandId: "provider-kie-create-001", payload: providerPayload("kie", "KIE.ai"), ...common })).resolves.toEqual(kie);
    await expect(repository.appendVersion({ entityType: "PROVIDER", entityId: "kie", commandId: "provider-kie-create-001", payload: providerPayload("kie", "changed"), ...common })).rejects.toMatchObject({ code: "IMMUTABLE_VERSION" });
    const kieV2 = await repository.appendVersion({ entityType: "PROVIDER", entityId: "kie", commandId: "provider-kie-update-002", payload: providerPayload("kie", "KIE.ai Updated"), ...common });
    await expect(repository.diff({ entityType: "PROVIDER", entityId: "kie", fromVersion: 1, toVersion: kieV2.version }))
      .resolves.toEqual([{ path: "$.displayName", before: "KIE.ai", after: "KIE.ai Updated" }]);
    await expect(database.query<{ last_sequence: number; last_hash: string }>(
      "SELECT last_sequence, last_hash FROM fusion_engine.provider_control_audit_head WHERE singleton = true",
    )).resolves.toMatchObject({ rows: [{ last_sequence: 4, last_hash: expect.stringMatching(/^[a-f0-9]{64}$/) }] });
    await expect(repository.verifyAuditChain()).resolves.toBe(true);
  });

  it("publishes a release bundle and its complete visible offer set atomically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-release-bundle-")); directories.push(directory);
    const database = await PGlite.create(directory); databases.push(database); await database.exec(sql);
    const repository = new PostgresProviderControlPlaneRepository(database as unknown as TransactionalSqlClient, () => new Date("2026-08-22T00:00:00.000Z"));
    const common = { evidenceSha256: HASH, effectiveAt: "2026-08-22T00:00:00.000Z" };
    await repository.appendVersion({
      entityType: "PROVIDER_ACCOUNT", entityId: "account.openrouter.primary", commandId: "account-openrouter-primary-001", ...common,
      payload: { id: "account.openrouter.primary", providerId: "openrouter", displayName: "Primary", environment: "LOCAL", state: "CONNECTED", credentialReferenceId: "credential.openrouter.primary" },
    });
    await repository.appendVersion({
      entityType: "CATALOG_SNAPSHOT", entityId: "snapshot.openrouter.release", commandId: "catalog-openrouter-release-001", ...common,
      payload: catalogSnapshotPayload("snapshot.openrouter.release", "openrouter"),
    });
    await repository.appendVersion({
      entityType: "REFERENCE_MODEL", entityId: "reference.openrouter.image", commandId: "model-openrouter-image-release-001", ...common,
      payload: { id: "reference.openrouter.image", providerId: "openrouter", providerModelId: "openai/gpt-image-1", familyId: "openai", displayName: "GPT Image", modalities: ["image"], state: "REFERENCE_ACTIVE", catalogSnapshotId: "snapshot.openrouter.release" },
    });
    await repository.appendVersion({
      entityType: "ROUTE_CANDIDATE", entityId: "route.openrouter.image", commandId: "route-openrouter-image-release-001", ...common,
      payload: {
        id: "route.openrouter.image", providerId: "openrouter", providerAccountId: "account.openrouter.primary", referenceModelId: "reference.openrouter.image",
        providerEndpointReferenceId: "openrouter/images", adapterKey: "openrouter-image", adapterVersion: "openrouter-image.v1", state: "CANARY_VALIDATED", inputProfileVersionId: "input.image.v1",
        usageExtractorVersion: "usage.image.v1", billingFormulaVersionId: "billing.image.v1", providerCostVersionId: "cost.image.v1", customerPriceVersionId: "price.image.v1",
      },
    });
    const release = {
      id: "bundle.openrouter.image.001", scope: "LOCAL_TEST_ONLY" as const, effectiveAt: "2026-08-22T00:00:00.000Z", rollbackTargetReleaseBundleId: null,
      financeSimulationEvidenceSha256: "b".repeat(64), securityEvidenceSha256: "c".repeat(64), canaryEvidenceSha256: "d".repeat(64),
      makerId: "route-maker", checkerId: "finance-checker",
      offers: [{
        offerId: "offer.image.gpt", routeCandidate: { entityId: "route.openrouter.image", version: 1 }, catalogSnapshot: { entityId: "snapshot.openrouter.release", version: 1 }, referenceModel: { entityId: "reference.openrouter.image", version: 1 },
        credentialReferenceId: "credential.openrouter.primary", credentialVersion: 1, adapterVersion: "openrouter-image.v1", customerPriceVersionId: "price.image.v1",
        commercialRegistrySnapshotId: "commercial.openrouter.image.v1", commercialRegistrySnapshotVersion: 1, commercialRegistryEvidenceSha256: "e".repeat(64),
        commercialRouteVersionId: "commercial-route.openrouter.image.v1", familyVersionId: "family.openrouter.image.v1", recipeVersionId: "recipe.image.generate.v1",
      }],
    };
    await new PostgresCommercialRegistryRepository(database as unknown as TransactionalSqlClient, () => new Date("2026-08-22T00:00:00.000Z")).appendSnapshot({
      commandId: "commercial-openrouter-image-001", evidenceSha256: "e".repeat(64), snapshot: commercialSnapshotForOpenRouter(),
    });
    const published = await repository.publishReleaseBundle({ commandId: "release-bundle-openrouter-image-001", evidenceSha256: HASH, release });
    await expect(repository.publishReleaseBundle({ commandId: "release-bundle-openrouter-image-001", evidenceSha256: HASH, release })).resolves.toEqual(published);
    const pointer = await database.query<{ offer_version: number; release_bundle_id: string }>(
      "SELECT offer_version, release_bundle_id FROM fusion_engine.provider_published_offer_pointers WHERE offer_id = $1", ["offer.image.gpt"],
    );
    expect(published.bundle.version).toBe(1);
    expect(published.offers).toHaveLength(1);
    expect(pointer.rows[0]).toEqual({ offer_version: 1, release_bundle_id: "bundle.openrouter.image.001" });
    await expect(repository.activeReleaseBundle()).resolves.toMatchObject({ entityId: "bundle.openrouter.image.001", version: 1 });
    await expect(repository.activePublishedOffers()).resolves.toMatchObject([{ payload: { id: "offer.image.gpt", releaseBundleId: "bundle.openrouter.image.001" } }]);
    const replacementRelease = { ...release, offers: [{ ...release.offers[0]!, offerId: "offer.image.gpt.replacement" }] };
    await repository.publishReleaseBundle({ commandId: "release-bundle-openrouter-image-002", evidenceSha256: HASH, release: replacementRelease });
    // The old pointer still exists as audit evidence, but cannot leak into the
    // active catalog because its bundle *version* no longer matches.
    await expect(repository.activePublishedOffers()).resolves.toMatchObject([
      { payload: { id: "offer.image.gpt.replacement", releaseBundleId: "bundle.openrouter.image.001" } },
    ]);
    await expect(repository.activePublishedOfferCatalog()).resolves.toMatchObject([
      {
        offer: { payload: { id: "offer.image.gpt.replacement", releaseBundleVersion: 2 } },
        releaseBundle: { version: 2 },
        releaseEntry: { offerId: "offer.image.gpt.replacement", customerPriceVersionId: "price.image.v1" },
      },
    ]);
    await expect(repository.activePublishedRuntimeRoutes()).resolves.toMatchObject([
      {
        offerId: "offer.image.gpt.replacement", providerId: "openrouter", providerAccountId: "account.openrouter.primary",
        routeId: "route.openrouter.image", providerModelId: "openai/gpt-image-1", adapterKey: "openrouter-image",
        adapterVersion: "openrouter-image.v1", credentialReferenceId: "credential.openrouter.primary", credentialVersion: 1,
        providerCostVersionId: "cost.image.v1", customerPriceVersionId: "price.image.v1",
        releaseBundleId: "bundle.openrouter.image.001", releaseBundleVersion: 2, lifecycle: "PUBLISHED",
      },
    ]);
    await expect(repository.activePublishedCommercialOffers()).resolves.toMatchObject([
      {
        offerId: "offer.image.gpt.replacement", commercialRegistrySnapshotId: "commercial.openrouter.image.v1",
        commercialRouteVersionId: "commercial-route.openrouter.image.v1", familyVersionId: "family.openrouter.image.v1",
        recipeVersionId: "recipe.image.generate.v1", customerPriceVersionId: "price.image.v1",
        providerId: "openrouter", providerModelId: "openai/gpt-image-1", releaseBundleVersion: 2,
      },
    ]);
    await expect(repository.activeCustomerPublishedOffers()).resolves.toEqual([
      expect.objectContaining({
        contractVersion: 2,
        offerId: "offer.image.gpt.replacement", displayName: "GPT Image", providerId: "openrouter",
        providerModelId: "openai/gpt-image-1", modalities: ["image"], customerPriceVersionId: "price.image.v1",
        commercialRecipeVersionId: "recipe.image.generate.v1", releaseBundleVersion: 2,
        identity: { familyId: "openai", officialModelId: "openai/gpt-image-1", providerId: "openrouter" },
        capability: expect.objectContaining({ schemaVersion: 2 }),
        evidence: expect.objectContaining({
          level: "SERVER_VERIFIED", capabilityVersionId: "capability.openrouter.image.v1",
          commercialRegistryEvidenceSha256: "e".repeat(64), contractSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    ]);
    // A later catalog-presentation review is a new immutable reference-model
    // version. It must not alter the already-released customer catalog until
    // a successor Release Bundle explicitly pins that new version.
    await repository.appendVersion({
      entityType: "REFERENCE_MODEL", entityId: "reference.openrouter.image", commandId: "model-openrouter-image-review-002", ...common,
      payload: {
        id: "reference.openrouter.image", providerId: "openrouter", providerModelId: "openai/gpt-image-1", familyId: "openai", displayName: "GPT Image renamed",
        modalities: ["image"], state: "REVIEWED", catalogSnapshotId: "snapshot.openrouter.release",
        reviewedTaxonomy: { schemaVersion: 1, reviewState: "REVIEWED", sourceCatalogSnapshotId: "snapshot.openrouter.release", productFamily: { id: "image-studio", displayName: "Image Studio" }, version: { id: "1", displayName: "1" }, experienceCategories: ["IMAGE"] },
      },
    });
    await expect(repository.activeCustomerPublishedOffers()).resolves.toEqual([
      expect.objectContaining({ displayName: "GPT Image" }),
    ]);
    await expect(repository.activeCustomerPublishedOffers()).resolves.toEqual([
      expect.not.objectContaining({ presentation: expect.anything() }),
    ]);
    await expect(repository.activateReleaseBundle({
      commandId: "rollback-bundle-openrouter-image-001", releaseBundleId: "bundle.openrouter.image.001", releaseBundleVersion: 1, reasonCode: "ROLLBACK_TEST",
    })).resolves.toMatchObject({ entityId: "bundle.openrouter.image.001", version: 1 });
    await expect(repository.activePublishedOfferCatalog()).resolves.toMatchObject([
      { offer: { payload: { id: "offer.image.gpt", releaseBundleVersion: 1 } }, releaseBundle: { version: 1 } },
    ]);
    await expect(repository.publishOffer({
      commandId: "direct-offer-command-001", evidenceSha256: HASH,
      offer: { id: "offer.image.gpt", routeCandidateVersionId: "route:gpt:v1", releaseBundleId: "bundle-001", releaseBundleVersion: 1, customerPriceVersionId: "price:gpt:v1", publishedAt: "2026-08-22T00:00:00.000Z" },
    })).rejects.toMatchObject({ code: "PUBLISHED_OFFER_INVALID" });
    const overview = await repository.adminOverview();
    expect(overview.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "RELEASE_BUNDLE", entityId: "bundle.openrouter.image.001", currentVersion: 2 }),
      expect.objectContaining({ entityType: "PUBLISHED_OFFER", entityId: "offer.image.gpt", currentVersion: 1 }),
    ]));
    expect(overview.publishedOffers).toEqual(expect.arrayContaining([
      expect.objectContaining({ offerId: "offer.image.gpt", offerVersion: 1, releaseBundleId: "bundle.openrouter.image.001" }),
    ]));
    await database.close();
    const restarted = await PGlite.create(directory); databases.push(restarted);
    const recovered = new PostgresProviderControlPlaneRepository(restarted as unknown as TransactionalSqlClient, () => new Date("2026-08-22T00:00:00.000Z"));
    await expect(recovered.activePublishedOfferCatalog()).resolves.toMatchObject([
      { offer: { payload: { id: "offer.image.gpt", releaseBundleVersion: 1 } }, releaseBundle: { version: 1 } },
    ]);
    await expect(recovered.verifyAuditChain()).resolves.toBe(true);
  });

  it("fails closed before changing the active pointer when a release dependency is not certified", async () => {
    const database = await PGlite.create(); databases.push(database); await database.exec(sql);
    const repository = new PostgresProviderControlPlaneRepository(database as unknown as TransactionalSqlClient, () => new Date("2026-08-22T00:00:00.000Z"));
    const common = { evidenceSha256: HASH, effectiveAt: "2026-08-22T00:00:00.000Z" };
    await repository.appendVersion({ entityType: "PROVIDER_ACCOUNT", entityId: "account.kie.primary", commandId: "account-kie-primary-001", ...common, payload: { id: "account.kie.primary", providerId: "kie", displayName: "Primary", environment: "LOCAL", state: "CONNECTED", credentialReferenceId: "credential.kie.primary" } });
    await repository.appendVersion({ entityType: "CATALOG_SNAPSHOT", entityId: "snapshot.kie.release", commandId: "catalog-kie-release-001", ...common, payload: catalogSnapshotPayload("snapshot.kie.release", "kie") });
    await repository.appendVersion({ entityType: "REFERENCE_MODEL", entityId: "reference.kie.image", commandId: "model-kie-image-release-001", ...common, payload: { id: "reference.kie.image", providerId: "kie", providerModelId: "model-id", familyId: "kie", displayName: "Image", modalities: ["image"], state: "REFERENCE_ACTIVE", catalogSnapshotId: "snapshot.kie.release" } });
    await repository.appendVersion({ entityType: "ROUTE_CANDIDATE", entityId: "route.kie.image", commandId: "route-kie-image-release-001", ...common, payload: { id: "route.kie.image", providerId: "kie", providerAccountId: "account.kie.primary", referenceModelId: "reference.kie.image", providerEndpointReferenceId: "kie/generate", adapterKey: "kie-market-job", adapterVersion: "kie-market.v1", state: "APPROVED", inputProfileVersionId: "input.image.v1", usageExtractorVersion: "usage.kie.v1", billingFormulaVersionId: "billing.image.v1", providerCostVersionId: "cost.image.v1", customerPriceVersionId: "price.image.v1" } });
    await expect(repository.publishReleaseBundle({
      commandId: "release-bundle-kie-rejected-001", evidenceSha256: HASH,
      release: { id: "bundle.kie.rejected", scope: "LOCAL_TEST_ONLY", effectiveAt: "2026-08-22T00:00:00.000Z", rollbackTargetReleaseBundleId: null, financeSimulationEvidenceSha256: "b".repeat(64), securityEvidenceSha256: "c".repeat(64), canaryEvidenceSha256: "d".repeat(64), makerId: "maker", checkerId: "checker", offers: [{ offerId: "offer.kie.image", routeCandidate: { entityId: "route.kie.image", version: 1 }, catalogSnapshot: { entityId: "snapshot.kie.release", version: 1 }, credentialReferenceId: "credential.kie.primary", credentialVersion: 1, adapterVersion: "kie-market.v1", customerPriceVersionId: "price.image.v1", commercialRegistrySnapshotId: "commercial.kie.v1", commercialRegistrySnapshotVersion: 1, commercialRegistryEvidenceSha256: "e".repeat(64), commercialRouteVersionId: "commercial-route.kie.image.v1", familyVersionId: "family.kie.image.v1", recipeVersionId: "recipe.image.generate.v1" }] },
    })).rejects.toMatchObject({ code: "RELEASE_BUNDLE_INVALID" });
    await expect(repository.activeReleaseBundle()).resolves.toBeNull();
    await expect(repository.activePublishedOffers()).resolves.toEqual([]);
    await expect(repository.current("RELEASE_BUNDLE", "bundle.kie.rejected")).resolves.toBeNull();
  });

  it("retains public-source catalog snapshots separately from account and route records", async () => {
    const database = await PGlite.create(); databases.push(database); await database.exec(sql);
    const repository = new PostgresProviderControlPlaneRepository(database as unknown as TransactionalSqlClient, () => new Date("2026-08-22T00:00:00.000Z"));
    const snapshot = await repository.appendVersion({
      entityType: "CATALOG_SNAPSHOT", entityId: "snapshot.openrouter.public.20260822", commandId: "snapshot-openrouter-001",
      payload: catalogSnapshotPayload("snapshot.openrouter.public.20260822", "openrouter"), evidenceSha256: HASH, effectiveAt: "2026-08-22T00:00:00.000Z",
    });
    expect(snapshot).toMatchObject({ entityId: "snapshot.openrouter.public.20260822", version: 1 });
    await expect(repository.appendVersion({
      entityType: "CATALOG_SNAPSHOT", entityId: "snapshot.kie.invalid", commandId: "snapshot-kie-invalid-001",
      payload: { ...catalogSnapshotPayload("snapshot.kie.invalid", "kie"), sourceUrls: [] }, evidenceSha256: HASH, effectiveAt: "2026-08-22T00:00:00.000Z",
    })).rejects.toMatchObject({ code: "INVALID_REFERENCE" });
  });

  it("atomically materializes a reviewed snapshot and its reference models", async () => {
    const database = await PGlite.create(); databases.push(database); await database.exec(sql);
    const repository = new PostgresProviderControlPlaneRepository(database as unknown as TransactionalSqlClient, () => new Date("2026-08-22T00:00:00.000Z"));
    const result = await repository.appendReferenceCatalog({
      commandId: "reference-catalog-bundle-001", approvalEvidenceSha256: HASH, effectiveAt: "2026-08-22T00:00:00.000Z",
      snapshot: catalogSnapshotPayload("snapshot.openrouter.public.bundle-001", "openrouter"),
      models: [{
        id: "reference.openrouter.gpt-image-1", providerId: "openrouter", providerModelId: "openai/gpt-image-1", familyId: "family.openrouter.openai",
        displayName: "GPT Image 1", modalities: ["image", "text"], state: "REFERENCE_ACTIVE", catalogSnapshotId: "snapshot.openrouter.public.bundle-001",
        sourceEvidenceSha256: "d".repeat(64), canonicalSlug: "openai-gpt-image-1", supportedParameters: ["prompt", "size"], sourceUrls: ["https://openrouter.ai/api/v1/models"],
      }],
    });
    expect(result).toMatchObject({ snapshot: { entityId: "snapshot.openrouter.public.bundle-001", version: 1 }, models: [{ entityId: "reference.openrouter.gpt-image-1", version: 1 }] });
    await expect(repository.current("REFERENCE_MODEL", "reference.openrouter.gpt-image-1")).resolves.toMatchObject({
      payload: expect.objectContaining({ catalogSnapshotId: "snapshot.openrouter.public.bundle-001", supportedParameters: ["prompt", "size"] }),
    });
    await expect(repository.verifyAuditChain()).resolves.toBe(true);
  });

  it("only materializes a published independently approved Admin change", async () => {
    const database = await PGlite.create(); databases.push(database); await database.exec(sql);
    const now = () => new Date("2026-08-22T00:00:00.000Z");
    let sequence = 0;
    const id = () => `00000000-0000-4000-8000-${(++sequence).toString().padStart(12, "0")}`;
    const changes = new VersionedAdminChangeService(new ImmutableAdminAuditLog(now, id), now, id);
    const repository = new PostgresProviderControlPlaneRepository(database as unknown as TransactionalSqlClient, now);
    const publisher = new ProviderControlPlaneChangePublisher(repository);
    const maker = identity("provider-maker", ["SECURITY_OPERATOR"]);
    const checker = identity("provider-checker", ["SECURITY_OPERATOR", "ROUTE_APPROVER"]);
    let change = changes.createDraft(maker, "provider-draft-command-001", {
      resourceType: "PROVIDER", resourceId: "kie",
      payload: { ...providerPayload("kie", "KIE.ai"), evidenceSha256: HASH },
      reasonCode: "INITIAL_REFERENCE",
    });
    await expect(publisher.materialize(change, "materialize-provider-001")).rejects.toMatchObject({ code: "INVALID_REFERENCE" });
    change = changes.validate(checker, "provider-validate-command-001", change.id, HASH);
    change = changes.simulate(checker, "provider-simulate-command-001", change.id, HASH);
    change = changes.approve(checker, "provider-approve-command-001", change.id, HASH);
    change = changes.publish(identity("provider-publisher", ["PUBLISHER"]), "provider-publish-command-001", change.id);
    const version = await publisher.materialize(change, "materialize-provider-001");
    expect(version).toMatchObject({ entityId: "kie", version: 1, evidenceSha256: HASH });
    expect(version.payload).not.toHaveProperty("evidenceSha256");
    await expect(publisher.materialize(change, "materialize-provider-001")).resolves.toEqual(version);
    await expect(repository.verifyAuditChain()).resolves.toBe(true);
  });

  it("materializes a reviewed public reference snapshot without creating an account or route", async () => {
    const database = await PGlite.create(); databases.push(database); await database.exec(sql);
    const now = () => new Date("2026-08-22T00:00:00.000Z");
    let sequence = 0;
    const id = () => `00000000-0000-4000-8000-${(++sequence).toString().padStart(12, "0")}`;
    const changes = new VersionedAdminChangeService(new ImmutableAdminAuditLog(now, id), now, id);
    const repository = new PostgresProviderControlPlaneRepository(database as unknown as TransactionalSqlClient, now);
    const publisher = new ProviderControlPlaneChangePublisher(repository);
    const maker = identity("catalog-maker", ["ROUTE_MAKER"]);
    const checker = identity("catalog-checker", ["ROUTE_APPROVER"]);
    let change = changes.createDraft(maker, "snapshot-draft-command-001", {
      resourceType: "REFERENCE_CATALOG_SNAPSHOT", resourceId: "snapshot.openrouter.public.20260822",
      payload: { ...catalogSnapshotPayload("snapshot.openrouter.public.20260822", "openrouter"), evidenceSha256: HASH },
      reasonCode: "PUBLIC_CATALOG_REFRESH",
    });
    change = changes.validate(checker, "snapshot-validate-command-001", change.id, HASH);
    change = changes.simulate(checker, "snapshot-simulate-command-001", change.id, HASH);
    change = changes.approve(checker, "snapshot-approve-command-001", change.id, HASH);
    change = changes.publish(identity("snapshot-publisher", ["PUBLISHER"]), "snapshot-publish-command-001", change.id);
    await expect(publisher.materialize(change, "snapshot-materialize-command-001"))
      .resolves.toMatchObject({ entityId: "snapshot.openrouter.public.20260822", version: 1 });
    await expect(repository.adminOverview()).resolves.toMatchObject({
      entities: [expect.objectContaining({ entityType: "CATALOG_SNAPSHOT", entityId: "snapshot.openrouter.public.20260822" })],
    });
  });

  it("retains immutable versions and the audit head across a local database restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-provider-control-"));
    try {
      const first = await PGlite.create(directory); databases.push(first); await first.exec(sql);
      const firstRepository = new PostgresProviderControlPlaneRepository(first as unknown as TransactionalSqlClient, () => new Date("2026-08-22T00:00:00.000Z"));
      await firstRepository.appendVersion({
        entityType: "PROVIDER", entityId: "openrouter", commandId: "openrouter-restart-proof-001",
        payload: providerPayload("openrouter", "OpenRouter"), evidenceSha256: HASH, effectiveAt: "2026-08-22T00:00:00.000Z",
      });
      await first.close();
      const second = await PGlite.create(directory); databases.push(second);
      const recovered = new PostgresProviderControlPlaneRepository(second as unknown as TransactionalSqlClient, () => new Date("2026-08-22T00:00:00.000Z"));
      await expect(recovered.current("PROVIDER", "openrouter")).resolves.toMatchObject({ version: 1, payload: providerPayload("openrouter", "OpenRouter") });
      await expect(recovered.verifyAuditChain()).resolves.toBe(true);
      await second.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
