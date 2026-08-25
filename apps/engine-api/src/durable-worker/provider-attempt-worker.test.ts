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
import { ProviderRegistry } from "../../../../packages/providers/src/registry.ts";
import {
  ProviderDefinitiveError,
  ProviderSubmissionUnknownError,
} from "../../../../packages/providers/src/types.ts";
import { FakeProviderAdapter } from "../test/fake-provider-adapter.ts";
import { DurableProviderAttemptWorker } from "./provider-attempt-worker.ts";

const schemaSql = await readFile(
  new URL("../../../../packages/durable-execution/sql/001_generation_v2_durability.sql", import.meta.url),
  "utf8",
);
const HASH = "e".repeat(64);
const NOW = new Date("2026-08-21T15:00:00.000Z");
const databases = new Set<PGlite>();

function client(database: PGlite): TransactionalSqlClient {
  return database as unknown as TransactionalSqlClient;
}

async function openDatabase(dataDir?: string, initialize = true): Promise<PGlite> {
  const database = await PGlite.create(dataDir);
  databases.add(database);
  if (initialize) await database.exec(schemaSql);
  return database;
}

async function closeDatabase(database: PGlite): Promise<void> {
  databases.delete(database);
  await database.close();
}

function request(operationId: string, scenario: ProviderGenerationRequest["scenario"]): ProviderGenerationRequest {
  return {
    operationId,
    model: "local/test-image-v1",
    mediaType: "image",
    scenario,
    input: { prompt: "TEST", quantity: 1, resolution: "720p", audio: false },
  };
}

class CountingFakeProviderAdapter extends FakeProviderAdapter {
  submitCalls = 0;
  lookupCalls = 0;
  pollCalls = 0;

  override async submit(input: ProviderGenerationRequest, idempotencyKey: string) {
    this.submitCalls += 1;
    return super.submit(input, idempotencyKey);
  }

  override async lookupByIdempotency(idempotencyKey: string) {
    this.lookupCalls += 1;
    return super.lookupByIdempotency(idempotencyKey);
  }

  override async getTask(taskId: string) {
    this.pollCalls += 1;
    return super.getTask(taskId);
  }
}

class MissingSubmissionAdapter extends CountingFakeProviderAdapter {
  override async submit(_input: ProviderGenerationRequest, _idempotencyKey: string): Promise<never> {
    this.submitCalls += 1;
    throw new ProviderSubmissionUnknownError("Connection ended before acceptance could be proven.");
  }
}

class DefinitiveRejectionAdapter extends CountingFakeProviderAdapter {
  override async submit(_input: ProviderGenerationRequest, _idempotencyKey: string): Promise<never> {
    this.submitCalls += 1;
    throw new ProviderDefinitiveError("MODEL_DISABLED", "The selected model is disabled.");
  }
}

class ChargedFailureAdapter extends CountingFakeProviderAdapter {
  override async getTask(taskId: string) {
    this.pollCalls += 1;
    return {
      taskId,
      status: "failed" as const,
      actualProviderCredits: 1,
      resultUrl: null,
      errorCode: "PROVIDER_FAILED_AFTER_CHARGE",
      chargeStatus: "ACTUAL" as const,
    };
  }
}

function registry(adapter: FakeProviderAdapter): ProviderRegistry {
  const providers = new ProviderRegistry();
  providers.register(adapter);
  return providers;
}

async function prepareAttempt(
  database: PGlite,
  scenario: ProviderGenerationRequest["scenario"],
): Promise<{ operationId: string; coordinator: PostgresWorkerCoordinator }> {
  const repository = new PostgresAtomicGenerationRepository(client(database), () => NOW);
  await repository.grantCredits({
    ownerId: "provider-worker-user",
    credits: 1_000,
    journalId: randomUUID(),
    commandId: `grant:${randomUUID()}`,
    reasonCode: "PROVIDER_WORKER_TEST",
  });
  const quoteId = randomUUID();
  await repository.issueQuote({
    id: quoteId,
    ownerId: "provider-worker-user",
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
    ownerId: "provider-worker-user",
    quoteId,
    generationIntentId: `provider-worker-intent:${randomUUID()}`,
    idempotencyKey: `provider-worker-transport:${randomUUID()}`,
    route: "POST /v2/operations",
    requestHash: HASH,
    outboxPayload: { operationId, requestHash: HASH },
  });
  const coordinator = new PostgresWorkerCoordinator(client(database), () => NOW);
  const lease = await coordinator.claimNextOutbox("provider-worker-relay", 1_000);
  await coordinator.consumeQueuedDelivery({
    consumerName: "durable-provider-worker",
    eventId: lease!.eventId,
    operationId,
    payload: lease!.payload,
    eventRecordId: randomUUID(),
  });
  await coordinator.acknowledgeOutbox(lease!.eventId, "provider-worker-relay");
  await coordinator.beginDispatch({
    operationId,
    expectedVersion: 1,
    attemptId: randomUUID(),
    attemptNumber: 1,
    providerId: "provider-test",
    providerIdempotencyKey: `provider-attempt:${operationId}:1`,
    requestHash: HASH,
    requestPayload: request(operationId, scenario),
    dispatchDeadlineAt: new Date(NOW.getTime() + 60_000).toISOString(),
    eventRecordId: randomUUID(),
  });
  return { operationId, coordinator };
}

async function driveToTerminal(
  worker: DurableProviderAttemptWorker,
  operationId: string,
  maximumDrives = 10,
) {
  let result = await worker.driveOnce(operationId, 1);
  for (let index = 1; index < maximumDrives && !["SUCCEEDED", "FAILED", "RECONCILIATION_REQUIRED", "TERMINAL"].includes(result.action); index += 1) {
    result = await worker.driveOnce(operationId, 1);
  }
  return result;
}

afterEach(async () => {
  await Promise.all([...databases].map(async (database) => {
    databases.delete(database);
    await database.close();
  }));
});

describe("durable provider attempt lifecycle", () => {
  it("submits once under concurrent worker retries and persists the provider cost evidence", async () => {
    const database = await openDatabase();
    const { operationId, coordinator } = await prepareAttempt(database, "success");
    const adapter = new CountingFakeProviderAdapter();
    const worker = new DurableProviderAttemptWorker(coordinator, registry(adapter));

    await Promise.all(Array.from({ length: 20 }, () => worker.driveOnce(operationId, 1)));
    const terminal = await driveToTerminal(worker, operationId);

    expect(terminal).toMatchObject({
      action: "SUCCEEDED",
      attempt: {
        state: "SUCCEEDED",
        operationState: "PROVIDER_SUCCEEDED",
        actualProviderCredits: 2,
        chargeStatus: "ACTUAL",
        providerResultUrl: expect.stringContaining("/v1/assets/"),
      },
    });
    expect(adapter.submitCalls).toBe(1);
    const evidence = await database.query<{ attempts: number; tasks: number; success_events: number }>(`SELECT
      (SELECT count(*)::int FROM fusion_engine.operation_attempts WHERE operation_id = $1) AS attempts,
      (SELECT count(DISTINCT provider_task_id)::int FROM fusion_engine.operation_attempts WHERE operation_id = $1) AS tasks,
      (SELECT count(*)::int FROM fusion_engine.operation_events WHERE operation_id = $1 AND state = 'PROVIDER_SUCCEEDED') AS success_events`,
      [operationId]);
    expect(evidence.rows[0]).toEqual({ attempts: 1, tasks: 1, success_events: 1 });
  }, 30_000);

  it("recovers an accepted unknown submission after a real database restart without resubmitting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-provider-worker-"));
    try {
      const firstDatabase = await openDatabase(directory);
      const { operationId, coordinator } = await prepareAttempt(firstDatabase, "submission_unknown_then_success");
      const adapter = new CountingFakeProviderAdapter();
      const providers = registry(adapter);
      const firstWorker = new DurableProviderAttemptWorker(coordinator, providers);
      const unknown = await firstWorker.driveOnce(operationId, 1);
      expect(unknown).toMatchObject({ action: "SUBMISSION_UNKNOWN", attempt: { state: "SUBMISSION_UNKNOWN" } });
      expect(adapter.submitCalls).toBe(1);
      await closeDatabase(firstDatabase);

      const restartedDatabase = await openDatabase(directory, false);
      const restartedCoordinator = new PostgresWorkerCoordinator(client(restartedDatabase), () => NOW);
      const restartedWorker = new DurableProviderAttemptWorker(restartedCoordinator, providers);
      const recovered = await restartedWorker.driveOnce(operationId, 1);
      expect(recovered).toMatchObject({ action: "LOOKUP_RECOVERED", attempt: { state: "SUBMITTED" } });
      const terminal = await driveToTerminal(restartedWorker, operationId);
      expect(terminal).toMatchObject({ action: "SUCCEEDED", attempt: { actualProviderCredits: 2 } });
      expect(adapter.submitCalls).toBe(1);
      expect(adapter.lookupCalls).toBe(1);
      await closeDatabase(restartedDatabase);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("never blindly resubmits when provider lookup cannot prove acceptance", async () => {
    const database = await openDatabase();
    const { operationId, coordinator } = await prepareAttempt(database, "success");
    const adapter = new MissingSubmissionAdapter();
    const worker = new DurableProviderAttemptWorker(coordinator, registry(adapter), 3);

    const terminal = await driveToTerminal(worker, operationId);

    expect(terminal).toMatchObject({
      action: "RECONCILIATION_REQUIRED",
      attempt: {
        state: "RECONCILIATION_REQUIRED",
        operationState: "RECONCILIATION_REQUIRED",
        unknownLookupCount: 3,
        providerTaskId: null,
      },
    });
    expect(adapter.submitCalls).toBe(1);
    expect(adapter.lookupCalls).toBe(3);
  });

  it("records definitive rejection as proven zero provider charge", async () => {
    const database = await openDatabase();
    const { operationId, coordinator } = await prepareAttempt(database, "success");
    const adapter = new DefinitiveRejectionAdapter();
    const worker = new DurableProviderAttemptWorker(coordinator, registry(adapter));

    const terminal = await worker.driveOnce(operationId, 1);

    expect(terminal).toMatchObject({
      action: "FAILED",
      attempt: {
        state: "FAILED",
        operationState: "PROVIDER_FAILED",
        actualProviderCredits: 0,
        chargeStatus: "CONFIRMED_NO_CHARGE",
        lastErrorCode: "MODEL_DISABLED",
      },
    });
    expect(adapter.submitCalls).toBe(1);
    const reservation = await database.query<{ state: string; held_credits: number; released_credits: number }>(
      "SELECT state, held_credits, released_credits FROM fusion_engine.credit_reservations WHERE operation_id = $1",
      [operationId],
    );
    expect(reservation.rows[0]).toEqual({ state: "RELEASED", held_credits: 0, released_credits: 4 });
  });

  it("releases the customer hold exactly once after a provider proves no charge", async () => {
    const database = await openDatabase();
    const { operationId, coordinator } = await prepareAttempt(database, "provider_failure");
    const adapter = new CountingFakeProviderAdapter();
    const worker = new DurableProviderAttemptWorker(coordinator, registry(adapter));

    const terminal = await driveToTerminal(worker, operationId);

    expect(terminal).toMatchObject({
      action: "FAILED",
      attempt: {
        state: "FAILED",
        operationState: "PROVIDER_FAILED",
        actualProviderCredits: 0,
        chargeStatus: "CONFIRMED_NO_CHARGE",
        lastErrorCode: "SIMULATED_PROVIDER_FAILURE",
      },
    });
    expect(adapter.submitCalls).toBe(1);
    expect(await adapter.getBalance()).toMatchObject({ available: 1_000, held: 0, spent: 0 });
    const reservation = await database.query<{ state: string; held_credits: number; released_credits: number }>(
      "SELECT state, held_credits, released_credits FROM fusion_engine.credit_reservations WHERE operation_id = $1",
      [operationId],
    );
    expect(reservation.rows[0]).toEqual({ state: "RELEASED", held_credits: 0, released_credits: 4 });
  });

  it("records platform loss and refunds the customer when a failed provider task proves a charge", async () => {
    const database = await openDatabase();
    const { operationId, coordinator } = await prepareAttempt(database, "success");
    const adapter = new ChargedFailureAdapter();
    const worker = new DurableProviderAttemptWorker(coordinator, registry(adapter));

    const terminal = await driveToTerminal(worker, operationId);

    expect(terminal).toMatchObject({
      action: "FAILED",
      attempt: {
        state: "FAILED",
        operationState: "PROVIDER_FAILED",
        actualProviderCredits: 1,
        chargeStatus: "ACTUAL",
      },
    });
    const reservation = await database.query<{ state: string; held_credits: number; released_credits: number }>(
      "SELECT state, held_credits, released_credits FROM fusion_engine.credit_reservations WHERE operation_id = $1",
      [operationId],
    );
    expect(reservation.rows[0]).toEqual({ state: "RELEASED", held_credits: 0, released_credits: 4 });
    const outcome = await database.query<{ disposition: string; provider_credits: number }>(
      "SELECT disposition, provider_credits FROM fusion_engine.provider_cost_outcomes WHERE operation_id = $1",
      [operationId],
    );
    expect(outcome.rows[0]).toEqual({ disposition: "LOSS", provider_credits: 1 });
  });
});
