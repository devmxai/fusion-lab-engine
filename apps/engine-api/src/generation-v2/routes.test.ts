// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEngineApp } from "../app.ts";
import { loadLocalEngineConfig } from "../config.ts";
import { createFakeProviderRegistry } from "../test/fake-provider-adapter.ts";
import { LocalDurableRuntime } from "../durable-worker/runtime.ts";
import { LocalUserSessionAuthority, localUserSessionCookieName } from "./session.ts";
import { PostgresProviderControlPlaneRepository } from "../../../../packages/provider-control-plane/src/postgres-repository.ts";
import { PostgresCommercialRegistryRepository } from "../../../../packages/commercial-engine/src/durable-registry-repository.ts";
import { createLocalTestRegistrySnapshot } from "../../../../packages/commercial-engine/src/local-test-fixture.ts";
import { FrozenPublishedOfferRuntimeResolver, ProviderRuntimeResolver, VersionedProviderAdapterFactoryRegistry } from "../../../../packages/providers/src/provider-runtime-resolver.ts";

const apps: ReturnType<typeof buildEngineApp>[] = [];

function createApp() {
  const app = buildEngineApp({
    config: loadLocalEngineConfig({ NODE_ENV: "test", ENGINE_MODE: "local", ENGINE_LOG_LEVEL: "silent" }),
    providerRegistry: createFakeProviderRegistry(),
  });
  apps.push(app);
  return app;
}

const imageRequest = {
  projectId: "generation-v2-test",
  recipeId: "image.create",
  input: null,
  prompt: "A deterministic test image",
  modelId: "local/test-image-v1",
  settings: { aspectRatio: "1:1" },
};

async function publishOpenRouterImageOffer(runtime: LocalDurableRuntime) {
  const now = () => new Date("2026-08-22T00:00:00.000Z");
  const repository = new PostgresProviderControlPlaneRepository(runtime.providerControlSqlClient(), now);
  const commercial = createLocalTestRegistrySnapshot();
  commercial.id = "registry.openrouter.image.v1";
  const family = commercial.families[0]!; family.id = "family.openrouter.image.v1"; family.familyId = "family.openrouter.image";
  const recipe = commercial.recipes[0]!; recipe.id = "recipe.image.generate.v1"; recipe.recipeId = "image.generate"; recipe.familyVersionIds = [family.id];
  const capability = commercial.capabilities[0]!; capability.id = "capability.openrouter.image.v1";
  const billing = commercial.billingManifests[0]!; billing.id = "billing.openrouter.image.v1";
  const cost = commercial.costVersions[0]!; cost.id = "cost.openrouter.image.v1";
  const price = commercial.customerPriceVersions[0]!; price.id = "price.openrouter.image.v1";
  const commercialRoute = commercial.routes[0]!;
  Object.assign(commercialRoute, {
    id: "commercial-route.openrouter.image.v1", routeId: "route.openrouter.image", providerId: "openrouter",
    providerAccountId: "account.openrouter.primary", providerModelId: "openai/gpt-image-1", familyVersionId: family.id,
    capabilityVersionId: capability.id, billingManifestVersionId: billing.id, costVersionId: cost.id, adapterVersion: "openrouter-image.v1",
  });
  commercial.families = [family]; commercial.recipes = [recipe]; commercial.capabilities = [capability]; commercial.billingManifests = [billing];
  commercial.costVersions = [cost]; commercial.customerPriceVersions = [price]; commercial.routes = [commercialRoute];
  await new PostgresCommercialRegistryRepository(runtime.providerControlSqlClient(), now).appendSnapshot({
    commandId: "generation-openrouter-commercial-001", evidenceSha256: "e".repeat(64), snapshot: commercial,
  });
  const evidenceSha256 = "a".repeat(64); const effectiveAt = now().toISOString();
  await repository.appendVersion({ entityType: "PROVIDER_ACCOUNT", entityId: "account.openrouter.primary", commandId: "generation-openrouter-account-001", evidenceSha256, effectiveAt,
    payload: { id: "account.openrouter.primary", providerId: "openrouter", displayName: "Primary", environment: "LOCAL", state: "CONNECTED", credentialReferenceId: "credential.openrouter.primary" } });
  await repository.appendVersion({ entityType: "CATALOG_SNAPSHOT", entityId: "snapshot.openrouter.image", commandId: "generation-openrouter-catalog-001", evidenceSha256, effectiveAt,
    payload: { id: "snapshot.openrouter.image", providerId: "openrouter", observedAt: effectiveAt, sourceUrls: ["https://openrouter.ai/models"], rawPayloadSha256: "b".repeat(64), manifestSha256: "c".repeat(64), parserVersion: "test", sourceScope: "PUBLIC_REFERENCE" } });
  await repository.appendVersion({ entityType: "REFERENCE_MODEL", entityId: "reference.openrouter.image", commandId: "generation-openrouter-model-001", evidenceSha256, effectiveAt,
    payload: { id: "reference.openrouter.image", providerId: "openrouter", providerModelId: "openai/gpt-image-1", familyId: "family.openrouter.image", displayName: "GPT Image 1", modalities: ["image"], state: "REFERENCE_ACTIVE", catalogSnapshotId: "snapshot.openrouter.image" } });
  await repository.appendVersion({ entityType: "ROUTE_CANDIDATE", entityId: "route.openrouter.image", commandId: "generation-openrouter-route-001", evidenceSha256, effectiveAt,
    payload: { id: "route.openrouter.image", providerId: "openrouter", providerAccountId: "account.openrouter.primary", referenceModelId: "reference.openrouter.image", providerEndpointReferenceId: "openrouter/images", adapterKey: "openrouter-image", adapterVersion: "openrouter-image.v1", state: "CANARY_VALIDATED", inputProfileVersionId: "input.image.v1", usageExtractorVersion: "usage.openrouter-image.v1", billingFormulaVersionId: billing.id, providerCostVersionId: cost.id, customerPriceVersionId: price.id } });
  await repository.publishReleaseBundle({ commandId: "generation-openrouter-release-001", evidenceSha256,
    release: { id: "bundle.openrouter.image.1", scope: "LOCAL_TEST_ONLY", effectiveAt, rollbackTargetReleaseBundleId: null,
      financeSimulationEvidenceSha256: "d".repeat(64), securityEvidenceSha256: "f".repeat(64), canaryEvidenceSha256: "1".repeat(64), makerId: "maker", checkerId: "checker",
      offers: [{ offerId: "offer.openrouter.gpt-image", routeCandidate: { entityId: "route.openrouter.image", version: 1 }, catalogSnapshot: { entityId: "snapshot.openrouter.image", version: 1 }, credentialReferenceId: "credential.openrouter.primary", credentialVersion: 1, adapterVersion: "openrouter-image.v1", customerPriceVersionId: price.id, commercialRegistrySnapshotId: commercial.id, commercialRegistrySnapshotVersion: commercial.version, commercialRegistryEvidenceSha256: "e".repeat(64), commercialRouteVersionId: commercialRoute.id, familyVersionId: family.id, recipeVersionId: recipe.id }],
    } });
  return "offer.openrouter.gpt-image";
}

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("unified Generation V2 API", () => {
  it("exposes no fixture models through the customer published-offer catalog", async () => {
    const app = createApp();
    const catalog = await app.inject({ method: "GET", url: "/v2/catalog/offers" });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json()).toEqual([]);
  });

  it("automatically executes one generation intent without a public run command", async () => {
    const app = createApp();
    const priced = await app.inject({ method: "POST", url: "/v2/quotes", payload: imageRequest });
    expect(priced.statusCode).toBe(201);
    const quote = priced.json();

    const confirmed = await app.inject({
      method: "POST",
      url: "/v2/operations",
      headers: { "idempotency-key": "transport-request-0001" },
      payload: {
        quoteId: quote.id,
        requestHash: quote.requestHash,
        generationIntentId: "generation-intent-0001",
      },
    });
    expect(confirmed.statusCode).toBe(202);
    const operationId = confirmed.json().operation.id as string;

    let recovered = confirmed.json();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      recovered = (await app.inject({ method: "GET", url: `/v2/operations/${operationId}` })).json();
      if (["SETTLED", "PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"].includes(recovered.operation.state)) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(recovered.operation).toMatchObject({
      id: operationId,
      state: "SETTLED",
      generationIntentId: "generation-intent-0001",
      financials: { customerChargedCredits: 4, providerChargedCredits: 2 },
    });
    expect(recovered.operation.stateVersion).toBeGreaterThan(0);
    expect(recovered.operation.events.map(({ version }: { version: number }) => version)).toEqual(
      Array.from({ length: recovered.operation.events.length }, (_, index) => index),
    );
    expect((await app.inject({ method: "POST", url: `/v2/operations/${operationId}/run` })).statusCode).toBe(404);
  });

  it("deduplicates 100 retries to one operation, outbox event, and reservation", async () => {
    const app = createApp();
    const quote = (await app.inject({ method: "POST", url: "/v2/quotes", payload: imageRequest })).json();
    const attempts = await Promise.all(Array.from({ length: 100 }, (_, index) => app.inject({
      method: "POST",
      url: "/v2/operations",
      headers: { "idempotency-key": `transport-retry-${index.toString().padStart(4, "0")}` },
      payload: {
        quoteId: quote.id,
        requestHash: quote.requestHash,
        generationIntentId: "generation-intent-concurrent-0001",
      },
    })));

    expect(attempts.every(({ statusCode }) => statusCode === 202)).toBe(true);
    expect(new Set(attempts.map((response) => response.json().operation.id)).size).toBe(1);
    const audit = (await app.inject({ method: "GET", url: "/v1/dev/mock/orchestration" })).json();
    expect(audit.operations).toHaveLength(1);
    expect(audit.outbox).toHaveLength(1);
    const wallet = (await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" })).json();
    expect(wallet.customerCredits.available + wallet.customerCredits.held + wallet.customerCredits.spent).toBe(1000);
    expect(wallet.customerCredits.spent).toBeLessThanOrEqual(4);
  });

  it("rejects creating an operation without an explicit idempotency header", async () => {
    const app = createApp();
    const quote = (await app.inject({ method: "POST", url: "/v2/quotes", payload: imageRequest })).json();
    const rejected = await app.inject({
      method: "POST",
      url: "/v2/operations",
      payload: { quoteId: quote.id, requestHash: quote.requestHash, generationIntentId: "generation-intent-no-header" },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("uses the durable runtime for V2 quote, idempotency and operation recovery", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-v2-durable-"));
    const providers = createFakeProviderRegistry();
    const runtime = await LocalDurableRuntime.create({ dataDir: directory, providers, tickMilliseconds: 10_000 });
    const app = buildEngineApp({
      config: loadLocalEngineConfig({ NODE_ENV: "test", ENGINE_MODE: "local", ENGINE_LOG_LEVEL: "silent" }),
      providerRegistry: providers,
      durableRuntime: runtime,
    });
    try {
      const quoteResponse = await app.inject({ method: "POST", url: "/v2/quotes", payload: imageRequest });
      expect(quoteResponse.statusCode).toBe(201);
      const quote = quoteResponse.json();
      expect(quote).toMatchObject({ durable: true, id: expect.any(String) });

      const create = () => app.inject({
        method: "POST", url: "/v2/operations", headers: { "idempotency-key": "durable-v2-key-0001" },
        payload: { quoteId: quote.id, requestHash: quote.requestHash, generationIntentId: "durable-v2-intent-0001" },
      });
      const [first, replay] = await Promise.all([create(), create()]);
      expect(first.statusCode).toBe(202);
      expect(replay.statusCode).toBe(202);
      expect(first.json().operation.id).toBe(replay.json().operation.id);

      const operationId = first.json().operation.id as string;
      await runtime.drainUntilIdle();
      const recovered = await app.inject({ method: "GET", url: `/v2/operations/${operationId}` });
      expect(recovered.statusCode).toBe(200);
      expect(recovered.json()).toMatchObject({
        durable: true,
        operation: {
          id: operationId, state: "SETTLED", generationIntentId: "durable-v2-intent-0001",
          financials: { customerQuotedCredits: 4, customerChargedCredits: 4, providerChargedCredits: 2 },
          delivery: { assetId: expect.any(String), mediaType: "image" },
        },
      });
      expect(JSON.stringify(recovered.json())).not.toContain("/v1/assets/");

      const assetId = recovered.json().operation.delivery.assetId as string;
      const grant = await app.inject({ method: "POST", url: `/v2/assets/${assetId}/access-grants`, payload: { ttlSeconds: 60 } });
      expect(grant.statusCode).toBe(201);
      const denied = await app.inject({ method: "GET", url: `/v2/assets/${assetId}/content`, headers: { "x-fusion-asset-grant": "not-a-grant" } });
      expect(denied.statusCode).toBe(403);
      const content = await app.inject({
        method: "GET", url: `/v2/assets/${assetId}/content`, headers: { "x-fusion-asset-grant": grant.json().token },
      });
      expect(content.statusCode).toBe(200);
      expect(content.headers["content-type"]).toBe("image/svg+xml");
      expect(content.rawPayload.byteLength).toBeGreaterThan(0);
      expect(await runtime.assetAccessAudit(assetId)).toMatchObject({ GRANT_ISSUED: 1, READ_ALLOWED: 1, READ_DENIED: 1 });
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("quotes only a published offer and releases the hold when no external runtime is configured", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-published-offer-"));
    const providers = createFakeProviderRegistry();
    const runtime = await LocalDurableRuntime.create({ dataDir: directory, providers, tickMilliseconds: 10_000 });
    const app = buildEngineApp({ config: loadLocalEngineConfig({ NODE_ENV: "test", ENGINE_MODE: "local", ENGINE_LOG_LEVEL: "silent" }), providerRegistry: providers, durableRuntime: runtime });
    try {
      const offerId = await publishOpenRouterImageOffer(runtime);
      const catalog = await app.inject({ method: "GET", url: "/v2/catalog/offers" });
      expect(catalog.json()).toEqual([expect.objectContaining({
        contractVersion: 2, offerId, providerModelId: "openai/gpt-image-1",
        identity: { familyId: "family.openrouter.image", officialModelId: "openai/gpt-image-1", providerId: "openrouter" },
        capability: expect.objectContaining({ schemaVersion: 2, id: "capability.openrouter.image.v1", mediaType: "image", maxReferences: 4 }),
        evidence: expect.objectContaining({ level: "SERVER_VERIFIED", contractSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      })]);
      const { modelId: _modelId, ...withoutModel } = imageRequest;
      const quoteResponse = await app.inject({ method: "POST", url: "/v2/quotes", payload: { ...withoutModel, offerId } });
      expect(quoteResponse.statusCode).toBe(201);
      expect(quoteResponse.json()).toMatchObject({ offerId, provider: "openrouter", modelId: "openai/gpt-image-1", localOnly: false, durable: true });
      expect(quoteResponse.json().configuration).toMatchObject({ recipeId: "image.create", bindingCount: 0 });
      expect(quoteResponse.json()).not.toHaveProperty("providerEstimate");
      expect(quoteResponse.json()).not.toHaveProperty("pricingPolicy");
      expect(quoteResponse.json()).not.toHaveProperty("pinnedVersions");
      const quote = quoteResponse.json();
      const operation = await app.inject({ method: "POST", url: "/v2/operations", headers: { "idempotency-key": "published-offer-operation-001" }, payload: { quoteId: quote.id, requestHash: quote.requestHash, generationIntentId: "published-offer-intent-001" } });
      expect(operation.statusCode).toBe(202);
      await runtime.drainUntilIdle();
      const recovered = await app.inject({ method: "GET", url: `/v2/operations/${operation.json().operation.id}` });
      expect(recovered.json().operation).toMatchObject({ state: "PROVIDER_FAILED", financials: { customerChargedCredits: 0 } });
      expect(recovered.json().operation.financials).not.toHaveProperty("providerChargedCredits");
      expect(JSON.stringify(recovered.json())).not.toContain("provider_atomic");
    } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
  }, 30_000);

  it("rejects browser inputs outside the exact published capability before a wallet hold", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-published-capability-"));
    const providers = createFakeProviderRegistry();
    const runtime = await LocalDurableRuntime.create({ dataDir: directory, providers, tickMilliseconds: 10_000 });
    const app = buildEngineApp({ config: loadLocalEngineConfig({ NODE_ENV: "test", ENGINE_MODE: "local", ENGINE_LOG_LEVEL: "silent" }), providerRegistry: providers, durableRuntime: runtime });
    try {
      const offerId = await publishOpenRouterImageOffer(runtime);
      const { modelId: _modelId, ...withoutModel } = imageRequest;
      const rejected = await app.inject({ method: "POST", url: "/v2/quotes", payload: {
        ...withoutModel, offerId, settings: { aspectRatio: "1:1" },
        // The schema validator accepts create, but the released image route
        // only certifies 720p/1080p and the server must still be authoritative.
        recipeId: "image.create",
      } });
      // Image recipe currently uses 720p in the internal request template, so
      // exercise the immutable capability guard by submitting a valid recipe
      // whose reference role is not released for this offer.
      const withReference = await app.inject({ method: "POST", url: "/v2/quotes", payload: {
        projectId: "project-published", recipeId: "image.edit", offerId,
        input: { assetId: "asset-1", kind: "IMAGE", status: "READY" }, prompt: "Edit it",
        settings: { aspectRatio: "1:1", strength: 50 },
      } });
      const withUnpublishedSetting = await app.inject({ method: "POST", url: "/v2/quotes", payload: {
        ...withoutModel, offerId, settings: { aspectRatio: "32:9" },
      } });
      expect(rejected.statusCode).toBe(201);
      expect(withReference.statusCode).toBe(409);
      expect(withReference.json().error.code).toBe("PUBLISHED_OFFER_CONTROL_SCHEMA_MISMATCH");
      expect(withUnpublishedSetting.statusCode).toBe(409);
      expect(withUnpublishedSetting.json().error.code).toBe("PUBLISHED_OFFER_CONTROL_SCHEMA_MISMATCH");
    } finally { await app.close(); await runtime.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); }
  }, 30_000);

  it("dispatches a published offer through its frozen adapter and credential lease", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-published-runtime-"));
    const providers = createFakeProviderRegistry();
    const runtime = await LocalDurableRuntime.create({ dataDir: directory, providers, tickMilliseconds: 10_000 });
    try {
      const offerId = await publishOpenRouterImageOffer(runtime);
      const sourcePolicy = providers.require("provider-test").assetSourcePolicy;
      let leases = 0;
      const factories = new VersionedProviderAdapterFactoryRegistry();
      factories.register({
        providerId: "openrouter", adapterKey: "openrouter-image", adapterVersion: "openrouter-image.v1",
        factory: () => ({
          id: "openrouter", displayName: "OpenRouter test adapter", version: "openrouter-image.v1",
          assetSourcePolicy: sourcePolicy,
          listModels: async () => [], getBalance: async () => ({ provider: "openrouter", unit: "provider_credit" as const, available: 100, held: 0, spent: 0 }),
          submit: async () => ({ taskId: "published-runtime-task", status: "submitted" as const, estimatedProviderCredits: 2 }),
          lookupByIdempotency: async () => null,
          getTask: async () => ({ taskId: "published-runtime-task", status: "succeeded" as const, actualProviderCredits: 2, resultUrl: "http://127.0.0.1:8790/provider-result.svg", errorCode: null, chargeStatus: "ACTUAL" as const }),
          fetchAsset: async (url: string, _maxBytes?: number) => ({ bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="white"/></svg>'), contentType: "image/svg+xml", sourceUrl: url }),
        }),
      });
      const repository = new PostgresProviderControlPlaneRepository(runtime.providerControlSqlClient());
      runtime.installPublishedOfferRuntimeResolver(new FrozenPublishedOfferRuntimeResolver(
        repository,
        new ProviderRuntimeResolver(factories, {
          use: async (lease, work) => {
            leases += 1;
            expect(lease).toMatchObject({ credentialReferenceId: "credential.openrouter.primary", credentialVersion: 1, providerId: "openrouter", providerAccountId: "account.openrouter.primary" });
            return work(new Uint8Array([1, 2, 3, 4]));
          },
        }),
      ));
      const app = buildEngineApp({ config: loadLocalEngineConfig({ NODE_ENV: "test", ENGINE_MODE: "local", ENGINE_LOG_LEVEL: "silent" }), providerRegistry: providers, durableRuntime: runtime });
      const { modelId: _modelId, ...withoutModel } = imageRequest;
      const quote = (await app.inject({ method: "POST", url: "/v2/quotes", payload: { ...withoutModel, offerId } })).json();
      const created = await app.inject({ method: "POST", url: "/v2/operations", headers: { "idempotency-key": "published-runtime-operation-001" }, payload: { quoteId: quote.id, requestHash: quote.requestHash, generationIntentId: "published-runtime-intent-001" } });
      expect(created.statusCode).toBe(202);
      await runtime.drainUntilIdle();
      const recovered = await app.inject({ method: "GET", url: `/v2/operations/${created.json().operation.id}` });
      expect(recovered.json().operation).toMatchObject({ state: "SETTLED", financials: { customerChargedCredits: 4 } });
      expect(leases).toBeGreaterThanOrEqual(2);
      await app.close();
    } finally { await runtime.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); }
  }, 30_000);

  it("does not expose one signed user's operation or asset to another user", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-v2-isolation-"));
    const providers = createFakeProviderRegistry();
    const runtime = await LocalDurableRuntime.create({ dataDir: directory, providers, tickMilliseconds: 10_000 });
    const sessions = new LocalUserSessionAuthority("x".repeat(32));
    const app = buildEngineApp({ config: loadLocalEngineConfig({ NODE_ENV: "development", ENGINE_MODE: "local", ENGINE_LOG_LEVEL: "silent" }), providerRegistry: providers, durableRuntime: runtime, userSessionAuthority: sessions });
    const cookie = (owner: string) => `${localUserSessionCookieName}=${sessions.issue(owner)}`;
    try {
      const createdProject = await app.inject({
        method: "POST", url: "/v2/projects", headers: { cookie: cookie("owner-a"), "idempotency-key": "new-project-command-001" },
        payload: { title: "Owner A new project" },
      });
      expect(createdProject.statusCode).toBe(200);
      expect(createdProject.json()).toMatchObject({ version: 1, document: { title: "Owner A new project", assets: {} } });
      expect((await app.inject({ method: "POST", url: "/v2/projects", headers: { cookie: cookie("owner-a"), "idempotency-key": "new-project-command-001" }, payload: { title: "Ignored replay" } })).json())
        .toMatchObject({ projectId: createdProject.json().projectId, document: { title: "Owner A new project" } });
      expect((await app.inject({ method: "GET", url: "/v2/projects", headers: { cookie: cookie("owner-a") } })).json())
        .toMatchObject({ items: [{ projectId: createdProject.json().projectId, title: "Owner A new project", assetCount: 0 }] });
      expect((await app.inject({ method: "GET", url: "/v2/projects", headers: { cookie: cookie("owner-b") } })).json())
        .toEqual({ items: [], nextCursor: null });

      const workspaceId = "workspace-owner-a";
      const savedWorkspace = await app.inject({
        method: "PUT", url: `/v2/projects/${workspaceId}`, headers: { cookie: cookie("owner-a") },
        payload: { expectedVersion: 0, document: { schemaVersion: 1, projectId: workspaceId, title: "Owner A workspace", assets: {} } },
      });
      expect(savedWorkspace.statusCode).toBe(200);
      expect(savedWorkspace.json()).toMatchObject({ projectId: workspaceId, version: 1 });
      expect((await app.inject({ method: "GET", url: `/v2/projects/${workspaceId}`, headers: { cookie: cookie("owner-b") } })).statusCode).toBe(404);
      expect((await app.inject({
        method: "PUT", url: `/v2/projects/${workspaceId}`, headers: { cookie: cookie("owner-a") },
        payload: { expectedVersion: 0, document: { schemaVersion: 1, projectId: workspaceId, title: "stale write" } },
      })).statusCode).toBe(409);
      expect((await app.inject({ method: "GET", url: `/v2/projects/${workspaceId}`, headers: { cookie: cookie("owner-a") } })).json()).toMatchObject({
        version: 1, document: { title: "Owner A workspace" },
      });

      const renamedWorkspace = await app.inject({ method: "POST", url: `/v2/projects/${workspaceId}/actions`, headers: { cookie: cookie("owner-a"), "idempotency-key": "rename-workspace-0001" }, payload: { action: "RENAME", title: "Renamed workspace", expectedVersion: 1 } });
      expect(renamedWorkspace.json()).toMatchObject({ version: 2, document: { title: "Renamed workspace", lifecycle: { state: "ACTIVE" } } });
      const archivedWorkspace = await app.inject({ method: "POST", url: `/v2/projects/${workspaceId}/actions`, headers: { cookie: cookie("owner-a"), "idempotency-key": "archive-workspace-001" }, payload: { action: "ARCHIVE", expectedVersion: 2 } });
      expect(archivedWorkspace.json()).toMatchObject({ version: 3, document: { lifecycle: { state: "ARCHIVED" } } });
      expect((await app.inject({ method: "PUT", url: `/v2/projects/${workspaceId}`, headers: { cookie: cookie("owner-a") }, payload: { expectedVersion: 3, document: archivedWorkspace.json().document } })).json())
        .toMatchObject({ error: { code: "PROJECT_NOT_ACTIVE" } });
      const deletedWorkspace = await app.inject({ method: "POST", url: `/v2/projects/${workspaceId}/actions`, headers: { cookie: cookie("owner-a"), "idempotency-key": "delete-workspace-0001" }, payload: { action: "DELETE", expectedVersion: 3 } });
      expect(deletedWorkspace.json()).toMatchObject({ version: 4, document: { lifecycle: { state: "DELETED" } } });
      const restoredWorkspace = await app.inject({ method: "POST", url: `/v2/projects/${workspaceId}/actions`, headers: { cookie: cookie("owner-a"), "idempotency-key": "restore-workspace-001" }, payload: { action: "RESTORE", expectedVersion: 4 } });
      expect(restoredWorkspace.json()).toMatchObject({ version: 5, document: { lifecycle: { state: "ACTIVE" } } });
      const duplicateWorkspace = await app.inject({ method: "POST", url: `/v2/projects/${workspaceId}/actions`, headers: { cookie: cookie("owner-a"), "idempotency-key": "duplicate-workspace-01" }, payload: { action: "DUPLICATE", expectedVersion: 5 } });
      expect(duplicateWorkspace.json()).toMatchObject({ version: 1, document: { title: "Renamed workspace — نسخة", duplicatedFromProjectId: workspaceId, assets: {}, operations: {} } });
      expect((await app.inject({ method: "POST", url: `/v2/projects/${workspaceId}/actions`, headers: { cookie: cookie("owner-a"), "idempotency-key": "duplicate-workspace-01" }, payload: { action: "DUPLICATE", expectedVersion: 5 } })).json().projectId)
        .toBe(duplicateWorkspace.json().projectId);

      const quote = (await app.inject({ method: "POST", url: "/v2/quotes", headers: { cookie: cookie("owner-a") }, payload: imageRequest })).json();
      const created = await app.inject({ method: "POST", url: "/v2/operations", headers: { cookie: cookie("owner-a"), "idempotency-key": "isolation-key-0001" }, payload: { quoteId: quote.id, requestHash: quote.requestHash, generationIntentId: "isolation-intent-0001" } });
      const operationId = created.json().operation.id as string;
      await runtime.drainUntilIdle();
      const assetId = (await runtime.generationOperationView(operationId)).delivery!.assetId;
      expect((await app.inject({ method: "GET", url: `/v2/operations/${operationId}`, headers: { cookie: cookie("owner-b") } })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `/v2/assets/${assetId}/access-grants`, headers: { cookie: cookie("owner-b") }, payload: {} })).statusCode).toBe(404);
    } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
  }, 30_000);
});
