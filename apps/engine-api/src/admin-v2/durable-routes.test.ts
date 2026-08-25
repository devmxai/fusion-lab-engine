// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildEngineApp } from "../app.ts";
import { loadLocalEngineConfig } from "../config.ts";
import { createFakeProviderRegistry } from "../test/fake-provider-adapter.ts";
import { LocalDurableRuntime } from "../durable-worker/runtime.ts";
import { LocalAdminSessionAuthority, localAdminSessionCookieName } from "./session.ts";
import { localTestRouteManifests } from "../../../../packages/providers/src/local-test-route-catalog.ts";
import type { AdminRole } from "../../../../packages/admin-control-plane/src/types.ts";

const apps: ReturnType<typeof buildEngineApp>[] = [];
const runtimes: LocalDurableRuntime[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("durable Admin read projections", () => {
  it("requires the existing signed Admin session and exposes no mutable command", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-durable-admin-"));
    directories.push(directory);
    const providers = createFakeProviderRegistry();
    const runtime = await LocalDurableRuntime.create({ dataDir: directory, providers });
    runtimes.push(runtime);
    const app = buildEngineApp({
      config: loadLocalEngineConfig({ NODE_ENV: "test", ENGINE_MODE: "local", ENGINE_LOG_LEVEL: "silent" }),
      providerRegistry: providers,
      durableRuntime: runtime,
    });
    apps.push(app);

    const denied = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/durable/overview" });
    expect(denied.statusCode).toBe(401);

    const bootstrap = await app.inject({ method: "POST", url: "/v1/dev/admin-v2/session/bootstrap" });
    const cookie = bootstrap.headers["set-cookie"] as string;
    const overview = await app.inject({
      method: "GET",
      url: "/v1/dev/admin-v2/durable/overview",
      headers: { cookie },
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({ enabled: true, runtime: { database: "ready" }, audit: { operationCounts: {} } });
    const operations = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/durable/operations?limit=20", headers: { cookie } });
    expect(operations.statusCode).toBe(200);
    expect(operations.json()).toEqual([]);
    const owners = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/durable/owners?limit=20", headers: { cookie } });
    expect(owners.statusCode).toBe(200);
    expect(owners.json()).toEqual([]);
    const exceptions = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/durable/exceptions?limit=20", headers: { cookie } });
    expect(exceptions.statusCode).toBe(200);
    expect(exceptions.json()).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/v1/dev/admin-v2/durable/owners/missing-owner", headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({
      method: "GET",
      url: "/v1/dev/admin-v2/durable/operations/00000000-0000-0000-0000-000000000000",
      headers: { cookie },
    })).statusCode).toBe(404);
  }, 30_000);

  it("restores catalog snapshot, change set and immutable audit evidence after a local Engine restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-durable-admin-state-"));
    const sessions = new LocalAdminSessionAuthority("p".repeat(32));
    const providers = createFakeProviderRegistry();
    const headers = (actor: string, roles: AdminRole[], command?: string) => ({
      cookie: `${localAdminSessionCookieName}=${sessions.issue({ actorId: actor, roles, assuranceLevel: 2 })}`,
      ...(command ? { "idempotency-key": command } : {}),
    });
    let firstApp: ReturnType<typeof buildEngineApp> | null = null;
    let secondApp: ReturnType<typeof buildEngineApp> | null = null;
    try {
      const firstRuntime = await LocalDurableRuntime.create({ dataDir: directory, providers });
      firstApp = buildEngineApp({ config: loadLocalEngineConfig({ NODE_ENV: "test", ENGINE_MODE: "local", ENGINE_LOG_LEVEL: "silent" }), providerRegistry: providers, durableRuntime: firstRuntime, adminSessionAuthority: sessions });
      const staged = await firstApp.inject({
        method: "POST", url: "/v1/dev/admin-v2/catalog/snapshots",
        headers: headers("catalog-maker", ["ROUTE_MAKER"], "durable-catalog-snapshot-1"),
        payload: { reasonCode: "LOCAL_DURABLE_RESTART", snapshot: {
          snapshotId: "snapshot.provider-test.durable-1", providerId: "provider-test", scope: "LOCAL_TEST_ONLY",
          sourceLabel: "Provider For Test durable fixture", observedAt: "2026-08-21T00:00:00.000Z",
          rawPayloadSha256: "e".repeat(64), parserVersion: "fixture-parser-1", routes: localTestRouteManifests(),
        } },
      });
      expect(staged.statusCode).toBe(201);
      const reference = await firstApp.inject({
        method: "POST", url: "/v1/dev/admin-v2/catalog/reference-snapshots",
        headers: headers("reference-maker", ["ROUTE_MAKER"], "durable-reference-catalog-1"),
        payload: { reasonCode: "PUBLIC_REFERENCE_RESTART", snapshot: {
          id: "snapshot.openrouter.public.durable-1", providerId: "openrouter", observedAt: "2026-08-22T00:00:00.000Z",
          sourceUrls: ["https://openrouter.ai/api/v1/models"], rawPayloadSha256: "a".repeat(64), manifestSha256: "b".repeat(64),
          parserVersion: "openrouter-public-models.v1", sourceScope: "PUBLIC_REFERENCE",
          models: [{ id: "reference.openrouter.image-1", providerId: "openrouter", providerModelId: "openai/gpt-image-1", canonicalSlug: "openai-gpt-image-1", familyId: "family.openrouter.openai", displayName: "GPT Image 1", modalities: ["image"], supportedParameters: ["prompt"], sourceUrls: ["https://openrouter.ai/api/v1/models"], sourceEvidenceSha256: "c".repeat(64), state: "REFERENCE_ACTIVE" }],
        } },
      });
      expect(reference.statusCode).toBe(201);
      for (const stage of ["validate", "simulate", "approve"] as const) {
        const transition = await firstApp.inject({
          method: "POST", url: `/v1/dev/admin-v2/changes/${reference.json().change.id}/${stage}`,
          headers: headers("reference-checker", ["ROUTE_APPROVER"], `durable-reference-${stage}-1`),
          payload: { evidenceHash: "d".repeat(64) },
        });
        expect(transition.statusCode).toBe(200);
      }
      const publishedReference = await firstApp.inject({
        method: "POST", url: `/v1/dev/admin-v2/changes/${reference.json().change.id}/publish`,
        headers: headers("reference-publisher", ["PUBLISHER"], "durable-reference-publish-1"),
      });
      expect(publishedReference.statusCode).toBe(200);
      await expect(firstRuntime.providerControlSqlClient().query<{ entity_type: string; entity_id: string; current_version: number }>(
        "SELECT entity_type, entity_id, current_version FROM fusion_engine.provider_control_entities WHERE entity_id IN ($1, $2) ORDER BY entity_type",
        ["snapshot.openrouter.public.durable-1", "reference.openrouter.image-1"],
      )).resolves.toMatchObject({ rows: [
        { entity_type: "CATALOG_SNAPSHOT", entity_id: "snapshot.openrouter.public.durable-1", current_version: 1 },
        { entity_type: "REFERENCE_MODEL", entity_id: "reference.openrouter.image-1", current_version: 1 },
      ] });
      const pricing = await firstApp.inject({
        method: "POST", url: "/v1/dev/admin-v2/changes",
        headers: headers("pricing-maker", ["PRICING_MAKER"], "durable-pricing-policy-1"),
        payload: {
          resourceType: "PRICING_POLICY", resourceId: "route.provider-test.image-v1",
          payload: { customerCredits: 6, hardFloorMarginBps: 2500, providerCostVersion: "fixture-1" },
          reasonCode: "LOCAL_DURABLE_PRICE_REVIEW",
        },
      });
      expect(pricing.statusCode).toBe(201);
      await firstApp.close(); firstApp = null;

      const restartedProviders = createFakeProviderRegistry();
      const restartedRuntime = await LocalDurableRuntime.create({ dataDir: directory, providers: restartedProviders });
      secondApp = buildEngineApp({ config: loadLocalEngineConfig({ NODE_ENV: "test", ENGINE_MODE: "local", ENGINE_LOG_LEVEL: "silent" }), providerRegistry: restartedProviders, durableRuntime: restartedRuntime, adminSessionAuthority: sessions });
      const viewer = headers("auditor", ["AUDITOR"]);
      const [changes, snapshots, referenceSnapshots, audit] = await Promise.all([
        secondApp.inject({ method: "GET", url: "/v1/dev/admin-v2/changes", headers: viewer }),
        secondApp.inject({ method: "GET", url: "/v1/dev/admin-v2/catalog/snapshots", headers: viewer }),
        secondApp.inject({ method: "GET", url: "/v1/dev/admin-v2/catalog/reference-snapshots", headers: viewer }),
        secondApp.inject({ method: "GET", url: "/v1/dev/admin-v2/audit", headers: viewer }),
      ]);
      expect(changes.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({ resourceType: "CATALOG_SNAPSHOT", state: "DRAFT" }),
        expect.objectContaining({ resourceType: "PRICING_POLICY", resourceId: "route.provider-test.image-v1", state: "DRAFT" }),
        expect.objectContaining({ resourceType: "REFERENCE_CATALOG_SNAPSHOT", resourceId: "snapshot.openrouter.public.durable-1", state: "PUBLISHED" }),
      ]));
      expect(snapshots.json()).toEqual(expect.arrayContaining([expect.objectContaining({ snapshotId: "snapshot.provider-test.durable-1", manifestSha256: expect.any(String) })]));
      expect(referenceSnapshots.json()).toEqual([expect.objectContaining({ snapshotId: "snapshot.openrouter.public.durable-1", modelCount: 1 })]);
      expect(audit.json()).toMatchObject({ chainValid: true, records: { length: 7 } });
      await expect(restartedRuntime.providerControlSqlClient().query<{ entity_type: string; entity_id: string; current_version: number }>(
        "SELECT entity_type, entity_id, current_version FROM fusion_engine.provider_control_entities WHERE entity_id IN ($1, $2) ORDER BY entity_type",
        ["snapshot.openrouter.public.durable-1", "reference.openrouter.image-1"],
      )).resolves.toMatchObject({ rows: [
        { entity_type: "CATALOG_SNAPSHOT", entity_id: "snapshot.openrouter.public.durable-1", current_version: 1 },
        { entity_type: "REFERENCE_MODEL", entity_id: "reference.openrouter.image-1", current_version: 1 },
      ] });
    } finally {
      await firstApp?.close();
      await secondApp?.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("restores credential metadata and account-health evidence after restart without persisting secret plaintext in Admin state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-durable-admin-secret-"));
    const sessions = new LocalAdminSessionAuthority("k".repeat(32));
    const providers = createFakeProviderRegistry();
    const configuration = () => loadLocalEngineConfig({
      NODE_ENV: "test", ENGINE_MODE: "local", ENGINE_LOG_LEVEL: "silent", ENGINE_DURABLE_DB_PATH: directory,
      ADMIN_LOCAL_SECRET_STORE_KEY: "2".repeat(64),
    });
    const headers = (actor: string, roles: AdminRole[], command?: string) => ({
      cookie: `${localAdminSessionCookieName}=${sessions.issue({ actorId: actor, roles, assuranceLevel: 2 })}`,
      ...(command ? { "idempotency-key": command } : {}),
    });
    let first: ReturnType<typeof buildEngineApp> | null = null;
    let second: ReturnType<typeof buildEngineApp> | null = null;
    try {
      const firstRuntime = await LocalDurableRuntime.create({ dataDir: directory, providers });
      first = buildEngineApp({ config: configuration(), providerRegistry: providers, durableRuntime: firstRuntime, adminSessionAuthority: sessions });
      const written = await first.inject({
        method: "POST", url: "/v1/dev/admin-v2/credentials",
        headers: headers("credential-maker", ["SECURITY_OPERATOR"], "durable-secret-write-001"),
        payload: { providerId: "provider-test", accountId: "local-main", environment: "LOCAL", secret: "offline-secret-never-in-admin-state" },
      });
      expect(written.statusCode).toBe(201);
      const tested = await first.inject({
        method: "POST", url: `/v1/dev/admin-v2/credentials/${written.json().id}/test`,
        headers: headers("credential-checker", ["SECURITY_OPERATOR"], "durable-secret-test-001"),
      });
      expect(tested.statusCode).toBe(200);
      await first.close(); first = null;

      const restartedRuntime = await LocalDurableRuntime.create({ dataDir: directory, providers: createFakeProviderRegistry() });
      second = buildEngineApp({ config: configuration(), providerRegistry: createFakeProviderRegistry(), durableRuntime: restartedRuntime, adminSessionAuthority: sessions });
      const listed = await second.inject({ method: "GET", url: "/v1/dev/admin-v2/credentials", headers: headers("auditor", ["AUDITOR"]) });
      const health = await second.inject({ method: "GET", url: "/v1/dev/admin-v2/provider-accounts/health", headers: headers("auditor", ["AUDITOR"]) });
      expect(listed.statusCode).toBe(200);
      expect(listed.body).not.toContain("offline-secret-never-in-admin-state");
      expect(listed.json()).toEqual([expect.objectContaining({ id: written.json().id, status: "TESTED" })]);
      expect(health.json()).toEqual([expect.objectContaining({ credentialId: written.json().id, providerId: "provider-test" })]);
      const persisted = await restartedRuntime.adminControlPlaneState();
      expect(JSON.stringify(persisted)).not.toContain("offline-secret-never-in-admin-state");
    } finally {
      await first?.close();
      await second?.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
