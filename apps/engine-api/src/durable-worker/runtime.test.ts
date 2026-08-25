// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderGenerationRequest } from "../../../../packages/contracts/src/provider.ts";
import { ProviderRegistry } from "../../../../packages/providers/src/registry.ts";
import { registerLocalTestRouteManifests } from "../../../../packages/providers/src/local-test-route-catalog.ts";
import { FakeProviderAdapter } from "../test/fake-provider-adapter.ts";
import { LocalDurableRuntime } from "./runtime.ts";

const runtimes: LocalDurableRuntime[] = [];
const HASH = createHash("sha256").update("durable-runtime-test").digest("hex");
const NOW = new Date("2026-08-21T17:00:00.000Z");

class CountingFakeProviderAdapter extends FakeProviderAdapter {
  submitCalls = 0;

  override async submit(input: ProviderGenerationRequest, idempotencyKey: string) {
    this.submitCalls += 1;
    return super.submit(input, idempotencyKey);
  }
}

function registry(adapter: FakeProviderAdapter): ProviderRegistry {
  const providers = new ProviderRegistry();
  providers.register(adapter);
  registerLocalTestRouteManifests(providers);
  return providers;
}

function request(scenario: ProviderGenerationRequest["scenario"]): Omit<ProviderGenerationRequest, "operationId"> {
  return {
    model: "local/test-image-v1",
    mediaType: "image",
    scenario,
    input: { prompt: "TEST", quantity: 1, resolution: "720p", audio: false },
  };
}

async function createRuntime(
  directory: string,
  providers: ProviderRegistry,
  routeDispatchGuard?: Parameters<typeof LocalDurableRuntime.create>[0]["routeDispatchGuard"],
  now: () => Date = () => NOW,
  attemptTimeoutMs?: number,
) {
  const runtime = await LocalDurableRuntime.create({ dataDir: directory, providers, now, tickMilliseconds: 10_000, routeDispatchGuard, attemptTimeoutMs });
  runtimes.push(runtime);
  return runtime;
}

async function enqueue(runtime: LocalDurableRuntime, scenario: ProviderGenerationRequest["scenario"]) {
  await runtime.grantLocalCredits({ ownerId: "runtime-user", credits: 1_000 });
  const quoteId = await runtime.issueLocalQuote({
    ownerId: "runtime-user",
    requestHash: HASH,
    customerCredits: 4,
    expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    metadata: {
      projectId: "runtime-project", recipeId: "image.create", providerId: "provider-test",
      providerRequestTemplate: request(scenario), pricingSnapshot: { customerCredits: 4 },
      executionEvidence: runtime.executionEvidenceFor("provider-test", request(scenario)),
    },
  });
  return runtime.enqueueLocalGeneration({
    ownerId: "runtime-user",
    quoteId,
    generationIntentId: `runtime-intent:${scenario}:0001`,
    idempotencyKey: `runtime-key:${scenario}:0001`,
    requestHash: HASH,
    providerId: "provider-test",
    request: request(scenario),
    projectId: "runtime-project",
    executionEvidence: runtime.executionEvidenceFor("provider-test", request(scenario)),
  });
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
});

describe("local durable runtime", () => {
  it("creates a missing nested local data directory before opening PGlite", async () => {
    const root = await mkdtemp(join(tmpdir(), "fusionlab-runtime-parent-"));
    const dataDir = join(root, ".local", "engine");
    const runtime = await LocalDurableRuntime.create({
      dataDir,
      providers: registry(new CountingFakeProviderAdapter()),
      now: () => NOW,
    });
    try {
      expect((await runtime.status()).database).toBe("ready");
    } finally {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("relays one durable operation through provider, private delivery and exact settlement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-runtime-"));
    try {
      const adapter = new CountingFakeProviderAdapter();
      const runtime = await createRuntime(directory, registry(adapter));
      const operationId = await enqueue(runtime, "success");

      await runtime.drainUntilIdle();

      expect(await runtime.operation(operationId)).toMatchObject({ state: "SETTLED" });
      expect(await runtime.status()).toMatchObject({
        database: "ready",
        worker: "idle",
        lastErrorCode: null,
        operations: { SETTLED: 1 },
        outbox: { ACKED: 1 },
      });
      expect(adapter.submitCalls).toBe(1);
      expect(await runtime.adminOverview()).toMatchObject({
        operationCounts: { SETTLED: 1 },
        holds: [],
        providerCostOutcomes: [{ operationId, disposition: "DELIVERED", providerCredits: 2 }],
      });
      expect(await runtime.adminOperations()).toEqual(expect.arrayContaining([
        expect.objectContaining({ operationId, state: "SETTLED", customerCredits: 4, providerId: "provider-test", providerCost: { credits: 2, disposition: "DELIVERED" } }),
      ]));
      expect(await runtime.adminOwnerDirectory()).toEqual(expect.arrayContaining([
        expect.objectContaining({ ownerId: "runtime-user", wallet: { availableCredits: 996, heldCredits: 0, spentCredits: 4 }, operationCount: 1, activeOperationCount: 0 }),
      ]));
      expect(await runtime.adminOwnerFinanceView("runtime-user")).toMatchObject({
        ownerId: "runtime-user", wallet: { availableCredits: 996, heldCredits: 0, spentCredits: 4 },
        operationCounts: { SETTLED: 1 }, journalCounts: { GRANT: 1, RESERVE: 1, SETTLE: 1 },
      });
      expect(await runtime.adminOperationHistory(operationId)).toMatchObject({
        operation: { id: operationId, state: "SETTLED" },
        reservation: { state: "SETTLED", captured_credits: 4 },
        providerCostOutcome: { disposition: "DELIVERED", provider_credits: 2 },
      });
    } finally {
      await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("recovers a submission-unknown operation from disk after runtime restart without a second submit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-runtime-restart-"));
    try {
      const adapter = new CountingFakeProviderAdapter();
      const providers = registry(adapter);
      const first = await createRuntime(directory, providers);
      const operationId = await enqueue(first, "submission_unknown_then_success");
      await first.tick();
      expect(await first.operation(operationId)).toMatchObject({ state: "SUBMISSION_UNKNOWN" });
      expect(await first.adminExceptionQueue()).toEqual(expect.arrayContaining([
        expect.objectContaining({ operationId, category: "SUBMISSION_UNKNOWN", severity: "HIGH", reason: "provider_acceptance_not_proven" }),
      ]));
      expect(adapter.submitCalls).toBe(1);
      runtimes.splice(runtimes.indexOf(first), 1);
      await first.close();

      const restarted = await createRuntime(directory, providers);
      await restarted.drainUntilIdle();
      expect(await restarted.operation(operationId)).toMatchObject({ state: "SETTLED" });
      expect(adapter.submitCalls).toBe(1);
      expect((await restarted.status()).operations).toEqual({ SETTLED: 1 });
    } finally {
      await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails closed at the durable dispatch boundary when a route kill switch changes after reservation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-runtime-kill-switch-"));
    try {
      const adapter = new CountingFakeProviderAdapter();
      let allowed = true;
      const runtime = await createRuntime(directory, registry(adapter), () => ({
        allowed,
        reasonCode: allowed ? null : "SECURITY_HOLD",
        versionId: allowed ? null : "approved-route-control-v1",
      }));
      const operationId = await enqueue(runtime, "success");
      allowed = false;
      await runtime.drainUntilIdle();
      expect(await runtime.operation(operationId)).toMatchObject({ state: "CANCELLED" });
      expect(adapter.submitCalls).toBe(0);
      expect(await runtime.adminOwnerFinanceView("runtime-user")).toMatchObject({
        wallet: { availableCredits: 1_000, heldCredits: 0, spentCredits: 0 },
      });
    } finally {
      await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("moves an overdue provider attempt to reconciliation and never performs a blind timed refund", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-runtime-attempt-timeout-"));
    try {
      const adapter = new CountingFakeProviderAdapter();
      let now = new Date(NOW);
      const runtime = await createRuntime(directory, registry(adapter), undefined, () => now, 100);
      const operationId = await enqueue(runtime, "success");
      await runtime.tick();
      expect(await runtime.operation(operationId)).toMatchObject({ state: "SUBMITTED" });
      now = new Date(now.getTime() + 101);
      await runtime.tick();
      expect(await runtime.operation(operationId)).toMatchObject({ state: "RECONCILIATION_REQUIRED" });
      expect(adapter.submitCalls).toBe(1);
      expect(await runtime.adminOwnerFinanceView("runtime-user")).toMatchObject({
        wallet: { availableCredits: 996, heldCredits: 4, spentCredits: 0 },
      });
    } finally {
      await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("persists frozen quote metadata across restart and enqueues from that metadata only", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-runtime-quote-"));
    try {
      const adapter = new CountingFakeProviderAdapter();
      const providers = registry(adapter);
      const first = await createRuntime(directory, providers);
      await first.grantLocalCredits({ ownerId: "quote-user", credits: 100 });
      const quoteId = await first.issueLocalQuote({
        ownerId: "quote-user", requestHash: HASH, customerCredits: 4,
        expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
        metadata: {
          projectId: "quote-project", recipeId: "image.create", providerId: "provider-test",
          providerRequestTemplate: request("success"),
          pricingSnapshot: { customerCredits: 4, providerEstimate: 2, version: "local-test-v1" },
          executionEvidence: first.executionEvidenceFor("provider-test", request("success")),
        },
      });
      runtimes.splice(runtimes.indexOf(first), 1);
      await first.close();

      const restarted = await createRuntime(directory, providers);
      expect(await restarted.quoteMetadata(quoteId)).toMatchObject({
        id: quoteId, state: "ISSUED", projectId: "quote-project", recipeId: "image.create",
        providerId: "provider-test", pricingSnapshot: { customerCredits: 4, providerEstimate: 2 },
      });
      const operationId = await restarted.enqueueFromQuoteMetadata({
        ownerId: "quote-user", quoteId, generationIntentId: "quote-metadata-intent-0001",
        idempotencyKey: "quote-metadata-key-0001", requestHash: HASH,
      });
      await restarted.drainUntilIdle();
      expect(await restarted.operation(operationId)).toMatchObject({ state: "SETTLED" });
    } finally {
      await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("keeps delivered private media on disk across restart while requiring a fresh grant", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-runtime-media-"));
    try {
      const adapter = new CountingFakeProviderAdapter();
      const providers = registry(adapter);
      const first = await createRuntime(directory, providers);
      const operationId = await enqueue(first, "success");
      await first.drainUntilIdle();
      const assetId = (await first.generationOperationView(operationId)).delivery!.assetId;
      const firstGrant = await first.issueAssetAccessGrant({ ownerId: "runtime-user", assetId, ttlSeconds: 60 });
      expect((await first.readAssetWithGrant({ ownerId: "runtime-user", assetId, token: firstGrant.token })).bytes.byteLength).toBeGreaterThan(0);
      runtimes.splice(runtimes.indexOf(first), 1);
      await first.close();

      const restarted = await createRuntime(directory, providers);
      await expect(restarted.readAssetWithGrant({ ownerId: "runtime-user", assetId, token: firstGrant.token })).rejects.toThrow();
      const freshGrant = await restarted.issueAssetAccessGrant({ ownerId: "runtime-user", assetId, ttlSeconds: 60 });
      expect((await restarted.readAssetWithGrant({ ownerId: "runtime-user", assetId, token: freshGrant.token })).bytes.byteLength).toBeGreaterThan(0);
    } finally {
      await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
