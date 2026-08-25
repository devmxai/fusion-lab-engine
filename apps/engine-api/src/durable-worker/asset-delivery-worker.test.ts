// @vitest-environment node

import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderGenerationRequest } from "../../../../packages/contracts/src/provider.ts";
import {
  PostgresAtomicGenerationRepository,
  type TransactionalSqlClient,
} from "../../../../packages/durable-execution/src/postgres-atomic.ts";
import { PostgresWorkerCoordinator } from "../../../../packages/durable-execution/src/postgres-worker.ts";
import { PrivateMediaPipeline } from "../../../../packages/media-pipeline/src/pipeline.ts";
import { InMemoryPrivateObjectStore } from "../../../../packages/media-pipeline/src/private-store.ts";
import { defaultLocalMediaPolicy } from "../../../../packages/media-pipeline/src/types.ts";
import { ProviderSourceUrlGuard } from "../../../../packages/media-pipeline/src/url-guard.ts";
import { LocalSignatureScanner } from "../../../../packages/media-pipeline/src/validator.ts";
import { ProviderRegistry } from "../../../../packages/providers/src/registry.ts";
import { FakeProviderAdapter } from "../test/fake-provider-adapter.ts";
import { DurableAssetDeliveryWorker } from "./asset-delivery-worker.ts";
import { DurableProviderAttemptWorker } from "./provider-attempt-worker.ts";

const schemaSql = await readFile(
  new URL("../../../../packages/durable-execution/sql/001_generation_v2_durability.sql", import.meta.url),
  "utf8",
);
const HASH = "f".repeat(64);
const NOW = new Date("2026-08-21T16:00:00.000Z");
const databases = new Set<PGlite>();

function client(database: PGlite): TransactionalSqlClient {
  return database as unknown as TransactionalSqlClient;
}

function generationRequest(operationId: string): ProviderGenerationRequest {
  return {
    operationId,
    model: "local/test-image-v1",
    mediaType: "image",
    scenario: "success",
    input: { prompt: "TEST", quantity: 1, resolution: "720p", audio: false },
  };
}

function registry(adapter: FakeProviderAdapter): ProviderRegistry {
  const providers = new ProviderRegistry();
  providers.register(adapter);
  return providers;
}

function mediaPipeline() {
  return new PrivateMediaPipeline(
    new InMemoryPrivateObjectStore(() => NOW),
    new ProviderSourceUrlGuard(),
    new LocalSignatureScanner(),
    defaultLocalMediaPolicy,
  );
}

class UnsafeAssetAdapter extends FakeProviderAdapter {
  override async fetchAsset(resultUrl: string) {
    return {
      sourceUrl: resultUrl,
      contentType: "image/svg+xml",
      bytes: new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"),
    };
  }
}

class UnprovenAssetAdapter extends FakeProviderAdapter {
  override async fetchAsset(_resultUrl: string): Promise<never> {
    throw new Error("transient asset fetch connection reset");
  }
}

async function prepare(database: PGlite, adapter: FakeProviderAdapter) {
  const repository = new PostgresAtomicGenerationRepository(client(database), () => NOW);
  await repository.grantCredits({
    ownerId: "asset-worker-user",
    credits: 1_000,
    journalId: randomUUID(),
    commandId: `grant:${randomUUID()}`,
    reasonCode: "ASSET_WORKER_TEST",
  });
  const quoteId = randomUUID();
  await repository.issueQuote({
    id: quoteId,
    ownerId: "asset-worker-user",
    requestHash: HASH,
    customerCredits: 4,
    expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
  });
  const operationId = randomUUID();
  await repository.commitGeneration({
    operationId,
    reservationId: randomUUID(),
    journalId: randomUUID(),
    journalCommandId: `reserve:${operationId}`,
    operationEventId: randomUUID(),
    outboxEventId: randomUUID(),
    ownerId: "asset-worker-user",
    quoteId,
    generationIntentId: `asset-worker-intent:${randomUUID()}`,
    idempotencyKey: `asset-worker-transport:${randomUUID()}`,
    route: "POST /v2/operations",
    requestHash: HASH,
    outboxPayload: { operationId, requestHash: HASH },
  });
  const coordinator = new PostgresWorkerCoordinator(client(database), () => NOW);
  const lease = await coordinator.claimNextOutbox("asset-worker-relay", 1_000);
  await coordinator.consumeQueuedDelivery({
    consumerName: "asset-worker-provider-relay",
    eventId: lease!.eventId,
    operationId,
    payload: lease!.payload,
    eventRecordId: randomUUID(),
  });
  await coordinator.acknowledgeOutbox(lease!.eventId, "asset-worker-relay");
  await coordinator.beginDispatch({
    operationId,
    expectedVersion: 1,
    attemptId: randomUUID(),
    attemptNumber: 1,
    providerId: adapter.id,
    providerIdempotencyKey: `provider-attempt:${operationId}:1`,
    requestHash: HASH,
    requestPayload: generationRequest(operationId),
    dispatchDeadlineAt: new Date(NOW.getTime() + 60_000).toISOString(),
    eventRecordId: randomUUID(),
  });
  const providers = registry(adapter);
  const providerWorker = new DurableProviderAttemptWorker(coordinator, providers);
  for (let step = 0; step < 5; step += 1) {
    await providerWorker.driveOnce(operationId, 1);
    if ((await coordinator.operation(operationId)).state === "PROVIDER_SUCCEEDED") break;
  }
  expect((await coordinator.operation(operationId)).state).toBe("PROVIDER_SUCCEEDED");
  return { coordinator, providers, operationId };
}

afterEach(async () => {
  await Promise.all([...databases].map(async (database) => {
    databases.delete(database);
    await database.close();
  }));
});

describe("durable private asset delivery and customer settlement", () => {
  it("stores the verified private asset, delivers owner access, and settles exactly once under 100 retries", async () => {
    const database = await PGlite.create();
    databases.add(database);
    await database.exec(schemaSql);
    const adapter = new FakeProviderAdapter();
    const { coordinator, providers, operationId } = await prepare(database, adapter);
    const media = mediaPipeline();
    const worker = new DurableAssetDeliveryWorker(coordinator, providers, media);

    expect(await worker.driveOnce({ operationId, attemptNumber: 1, projectId: "project-asset-test" }))
      .toMatchObject({ action: "ASSET_STORED" });
    const delivered = await worker.driveOnce({ operationId, attemptNumber: 1, projectId: "project-asset-test" });
    expect(delivered).toMatchObject({ action: "DELIVERED", accessToken: expect.any(String) });
    const asset = await coordinator.asset(operationId);
    expect(media.readWithGrant(asset.privateObjectId, delivered.accessToken!)).toMatchObject({
      object: { ownerId: "asset-worker-user", checksumSha256: asset.checksumSha256 },
    });

    await Promise.all(Array.from({ length: 100 }, () => worker.driveOnce({ operationId, attemptNumber: 1, projectId: "project-asset-test" })));

    expect(await coordinator.operation(operationId)).toMatchObject({ state: "SETTLED" });
    const evidence = await database.query<{
      reservation_state: string;
      captured_credits: number;
      released_credits: number;
      available_credits: number;
      held_credits: number;
      spent_credits: number;
      assets: number;
      deliveries: number;
      settle_journals: number;
      settlement_balance: number;
      cost_disposition: string;
      provider_credits: number;
    }>(`SELECT
      (SELECT state FROM fusion_engine.credit_reservations WHERE operation_id = $1) AS reservation_state,
      (SELECT captured_credits::int FROM fusion_engine.credit_reservations WHERE operation_id = $1) AS captured_credits,
      (SELECT released_credits::int FROM fusion_engine.credit_reservations WHERE operation_id = $1) AS released_credits,
      (SELECT available_credits::int FROM fusion_engine.wallets WHERE owner_id = 'asset-worker-user') AS available_credits,
      (SELECT held_credits::int FROM fusion_engine.wallets WHERE owner_id = 'asset-worker-user') AS held_credits,
      (SELECT spent_credits::int FROM fusion_engine.wallets WHERE owner_id = 'asset-worker-user') AS spent_credits,
      (SELECT count(*)::int FROM fusion_engine.operation_assets WHERE operation_id = $1) AS assets,
      (SELECT count(*)::int FROM fusion_engine.operation_deliveries WHERE operation_id = $1) AS deliveries,
      (SELECT count(*)::int FROM fusion_engine.ledger_journals WHERE operation_id = $1 AND kind = 'SETTLE') AS settle_journals,
      (SELECT sum(amount)::int FROM fusion_engine.ledger_entries WHERE journal_id IN
        (SELECT id FROM fusion_engine.ledger_journals WHERE operation_id = $1 AND kind = 'SETTLE')) AS settlement_balance,
      (SELECT disposition FROM fusion_engine.provider_cost_outcomes WHERE operation_id = $1) AS cost_disposition,
      (SELECT provider_credits::int FROM fusion_engine.provider_cost_outcomes WHERE operation_id = $1) AS provider_credits`, [operationId]);
    expect(evidence.rows[0]).toEqual({
      reservation_state: "SETTLED",
      captured_credits: 4,
      released_credits: 0,
      available_credits: 996,
      held_credits: 0,
      spent_credits: 4,
      assets: 1,
      deliveries: 1,
      settle_journals: 1,
      settlement_balance: 0,
      cost_disposition: "DELIVERED",
      provider_credits: 2,
    });
  }, 45_000);

  it("refunds once and records provider loss when verified media validation rejects the charged result", async () => {
    const database = await PGlite.create();
    databases.add(database);
    await database.exec(schemaSql);
    const adapter = new UnsafeAssetAdapter();
    const { coordinator, providers, operationId } = await prepare(database, adapter);
    const worker = new DurableAssetDeliveryWorker(coordinator, providers, mediaPipeline());

    expect(await worker.driveOnce({ operationId, attemptNumber: 1, projectId: "project-asset-test" }))
      .toMatchObject({ action: "DELIVERY_FAILED_REFUNDED" });
    expect(await coordinator.operation(operationId)).toMatchObject({ state: "DELIVERY_FAILED" });
    const evidence = await database.query<{
      reservation_state: string; released_credits: number; available_credits: number; held_credits: number;
      spent_credits: number; release_journals: number; disposition: string; provider_credits: number;
    }>(`SELECT
      (SELECT state FROM fusion_engine.credit_reservations WHERE operation_id = $1) AS reservation_state,
      (SELECT released_credits::int FROM fusion_engine.credit_reservations WHERE operation_id = $1) AS released_credits,
      (SELECT available_credits::int FROM fusion_engine.wallets WHERE owner_id = 'asset-worker-user') AS available_credits,
      (SELECT held_credits::int FROM fusion_engine.wallets WHERE owner_id = 'asset-worker-user') AS held_credits,
      (SELECT spent_credits::int FROM fusion_engine.wallets WHERE owner_id = 'asset-worker-user') AS spent_credits,
      (SELECT count(*)::int FROM fusion_engine.ledger_journals WHERE operation_id = $1 AND kind = 'RELEASE') AS release_journals,
      (SELECT disposition FROM fusion_engine.provider_cost_outcomes WHERE operation_id = $1) AS disposition,
      (SELECT provider_credits::int FROM fusion_engine.provider_cost_outcomes WHERE operation_id = $1) AS provider_credits`, [operationId]);
    expect(evidence.rows[0]).toEqual({
      reservation_state: "RELEASED",
      released_credits: 4,
      available_credits: 1_000,
      held_credits: 0,
      spent_credits: 0,
      release_journals: 1,
      disposition: "LOSS",
      provider_credits: 2,
    });
  }, 30_000);

  it("keeps the hold protected when asset retrieval fails without a conclusive delivery failure", async () => {
    const database = await PGlite.create();
    databases.add(database);
    await database.exec(schemaSql);
    const adapter = new UnprovenAssetAdapter();
    const { coordinator, providers, operationId } = await prepare(database, adapter);
    const worker = new DurableAssetDeliveryWorker(coordinator, providers, mediaPipeline());

    expect(await worker.driveOnce({ operationId, attemptNumber: 1, projectId: "project-asset-test" }))
      .toMatchObject({ action: "RECONCILIATION_REQUIRED" });
    expect(await coordinator.operation(operationId)).toMatchObject({ state: "RECONCILIATION_REQUIRED" });
    const evidence = await database.query<{ state: string; held_credits: number; available_credits: number; financial_commands: number }>(`SELECT
      (SELECT state FROM fusion_engine.credit_reservations WHERE operation_id = $1) AS state,
      (SELECT held_credits::int FROM fusion_engine.credit_reservations WHERE operation_id = $1) AS held_credits,
      (SELECT available_credits::int FROM fusion_engine.wallets WHERE owner_id = 'asset-worker-user') AS available_credits,
      (SELECT count(*)::int FROM fusion_engine.financial_command_bindings WHERE operation_id = $1) AS financial_commands`, [operationId]);
    expect(evidence.rows[0]).toEqual({ state: "HELD", held_credits: 4, available_credits: 996, financial_commands: 0 });
  }, 30_000);

  it("settles one durable delivery after a real PostgreSQL restart without a second journal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-durable-settlement-"));
    try {
      const firstDatabase = await PGlite.create(directory);
      databases.add(firstDatabase);
      await firstDatabase.exec(schemaSql);
      const adapter = new FakeProviderAdapter();
      const { coordinator, providers, operationId } = await prepare(firstDatabase, adapter);
      const media = mediaPipeline();
      const firstWorker = new DurableAssetDeliveryWorker(coordinator, providers, media);
      await firstWorker.driveOnce({ operationId, attemptNumber: 1, projectId: "project-restart" });
      await firstWorker.driveOnce({ operationId, attemptNumber: 1, projectId: "project-restart" });
      expect(await coordinator.operation(operationId)).toMatchObject({ state: "DELIVERED" });
      databases.delete(firstDatabase);
      await firstDatabase.close();

      const restartedDatabase = await PGlite.create(directory);
      databases.add(restartedDatabase);
      const restartedCoordinator = new PostgresWorkerCoordinator(client(restartedDatabase), () => NOW);
      const restartedWorker = new DurableAssetDeliveryWorker(restartedCoordinator, providers, media);
      await Promise.all(Array.from({ length: 20 }, () => restartedWorker.driveOnce({ operationId, attemptNumber: 1, projectId: "project-restart" })));
      expect(await restartedCoordinator.operation(operationId)).toMatchObject({ state: "SETTLED" });
      const journals = await restartedDatabase.query<{ settle_journals: number; financial_commands: number }>(`SELECT
        (SELECT count(*)::int FROM fusion_engine.ledger_journals WHERE operation_id = $1 AND kind = 'SETTLE') AS settle_journals,
        (SELECT count(*)::int FROM fusion_engine.financial_command_bindings WHERE operation_id = $1 AND action = 'SETTLE_DELIVERY') AS financial_commands`, [operationId]);
      expect(journals.rows[0]).toEqual({ settle_journals: 1, financial_commands: 1 });
      databases.delete(restartedDatabase);
      await restartedDatabase.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
