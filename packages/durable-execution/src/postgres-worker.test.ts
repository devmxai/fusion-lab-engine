// @vitest-environment node

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { PostgresAtomicGenerationRepository, type TransactionalSqlClient } from "./postgres-atomic.ts";
import { PostgresWorkerCoordinator } from "./postgres-worker.ts";

const schemaSql = await readFile(new URL("../sql/001_generation_v2_durability.sql", import.meta.url), "utf8");
const HASH = "b".repeat(64);
const databases: PGlite[] = [];

function providerRequest(operationId: string) {
  return {
    operationId,
    model: "local-test-image",
    mediaType: "image",
    scenario: "success",
    input: { prompt: "TEST", quantity: 1, resolution: "720p", audio: false },
  };
}

function sqlClient(pg: PGlite): TransactionalSqlClient {
  return pg as unknown as TransactionalSqlClient;
}

async function setup(clock: { now: Date }) {
  const pg = await PGlite.create();
  databases.push(pg);
  await pg.exec(schemaSql);
  const repository = new PostgresAtomicGenerationRepository(sqlClient(pg), () => clock.now);
  await repository.grantCredits({
    ownerId: "worker-user",
    credits: 1_000,
    journalId: randomUUID(),
    commandId: `grant:${randomUUID()}`,
    reasonCode: "WORKER_TEST",
  });
  const quoteId = randomUUID();
  await repository.issueQuote({
    id: quoteId,
    ownerId: "worker-user",
    requestHash: HASH,
    customerCredits: 4,
    expiresAt: new Date(clock.now.getTime() + 60_000).toISOString(),
  });
  const operationId = randomUUID();
  await repository.commitGeneration({
    operationId,
    reservationId: randomUUID(),
    journalId: randomUUID(),
    journalCommandId: `reserve:${operationId}`,
    operationEventId: randomUUID(),
    outboxEventId: randomUUID(),
    ownerId: "worker-user",
    quoteId,
    generationIntentId: `worker-intent:${randomUUID()}`,
    idempotencyKey: `worker-transport:${randomUUID()}`,
    route: "POST /v2/operations",
    requestHash: HASH,
    outboxPayload: { operationId, requestHash: HASH },
  });
  return { pg, repository, operationId };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((pg) => pg.close()));
});

describe("PostgreSQL durable outbox and worker coordination", () => {
  it("deduplicates delivery after a worker crashes after consume but before outbox ack", async () => {
    const clock = { now: new Date("2026-08-21T14:00:00.000Z") };
    const { pg, operationId } = await setup(clock);
    const coordinator = new PostgresWorkerCoordinator(sqlClient(pg), () => clock.now);

    const firstLease = await coordinator.claimNextOutbox("worker-a", 1_000);
    expect(firstLease).toMatchObject({ operationId, attempts: 1, workerId: "worker-a" });
    clock.now = new Date(clock.now.getTime() + 500);
    expect(await coordinator.claimNextOutbox("worker-b", 1_000)).toBeNull();

    const firstDelivery = await coordinator.consumeQueuedDelivery({
      consumerName: "generation-worker",
      eventId: firstLease!.eventId,
      operationId,
      payload: firstLease!.payload,
      eventRecordId: randomUUID(),
    });
    expect(firstDelivery).toMatchObject({ kind: "PROCESSED", operation: { state: "QUEUED", stateVersion: 1 } });

    clock.now = new Date(clock.now.getTime() + 1_000);
    const recoveredLease = await coordinator.claimNextOutbox("worker-b", 1_000);
    expect(recoveredLease).toMatchObject({ eventId: firstLease!.eventId, attempts: 2, workerId: "worker-b" });
    const duplicate = await coordinator.consumeQueuedDelivery({
      consumerName: "generation-worker",
      eventId: recoveredLease!.eventId,
      operationId,
      payload: recoveredLease!.payload,
      eventRecordId: randomUUID(),
    });
    expect(duplicate).toMatchObject({ kind: "DUPLICATE", operation: { state: "QUEUED", stateVersion: 1 } });
    await coordinator.acknowledgeOutbox(recoveredLease!.eventId, "worker-b");

    const evidence = await pg.query<{
      outbox_status: string;
      attempts: number;
      inbox_count: number;
      queued_events: number;
    }>(`SELECT
      (SELECT status FROM fusion_engine.outbox_events WHERE id = $1) AS outbox_status,
      (SELECT attempts FROM fusion_engine.outbox_events WHERE id = $1) AS attempts,
      (SELECT count(*)::int FROM fusion_engine.inbox_receipts WHERE event_id = $1) AS inbox_count,
      (SELECT count(*)::int FROM fusion_engine.operation_events WHERE operation_id = $2 AND state = 'QUEUED') AS queued_events`,
      [firstLease!.eventId, operationId]);
    expect(evidence.rows[0]).toEqual({ outbox_status: "ACKED", attempts: 2, inbox_count: 1, queued_events: 1 });
  }, 30_000);

  it("creates one provider dispatch attempt across 100 worker retries", async () => {
    const clock = { now: new Date("2026-08-21T14:10:00.000Z") };
    const { pg, operationId } = await setup(clock);
    const coordinator = new PostgresWorkerCoordinator(sqlClient(pg), () => clock.now);
    const lease = await coordinator.claimNextOutbox("relay", 1_000);
    await coordinator.consumeQueuedDelivery({
      consumerName: "generation-worker",
      eventId: lease!.eventId,
      operationId,
      payload: lease!.payload,
      eventRecordId: randomUUID(),
    });
    await coordinator.acknowledgeOutbox(lease!.eventId, "relay");

    const dispatches = await Promise.all(Array.from({ length: 100 }, () => coordinator.beginDispatch({
      operationId,
      expectedVersion: 1,
      attemptId: randomUUID(),
      attemptNumber: 1,
      providerId: "provider-test",
      providerIdempotencyKey: `provider-attempt:${operationId}:1`,
      requestHash: HASH,
      requestPayload: providerRequest(operationId),
      dispatchDeadlineAt: new Date(clock.now.getTime() + 60_000).toISOString(),
      eventRecordId: randomUUID(),
    })));
    expect(dispatches.filter(({ kind }) => kind === "CREATED")).toHaveLength(1);
    expect(new Set(dispatches.map(({ operation }) => operation.id)).size).toBe(1);
    expect(dispatches[0].operation).toMatchObject({ state: "DISPATCHING", stateVersion: 2 });
    const counts = await pg.query<{ attempts: number; dispatch_events: number }>(`SELECT
      (SELECT count(*)::int FROM fusion_engine.operation_attempts WHERE operation_id = $1) AS attempts,
      (SELECT count(*)::int FROM fusion_engine.operation_events WHERE operation_id = $1 AND state = 'DISPATCHING') AS dispatch_events`,
      [operationId]);
    expect(counts.rows[0]).toEqual({ attempts: 1, dispatch_events: 1 });

    await expect(coordinator.beginDispatch({
      operationId,
      expectedVersion: 1,
      attemptId: randomUUID(),
      attemptNumber: 1,
      providerId: "provider-test",
      providerIdempotencyKey: `different-provider-key:${operationId}`,
      requestHash: HASH,
      requestPayload: providerRequest(operationId),
      dispatchDeadlineAt: new Date(clock.now.getTime() + 60_000).toISOString(),
      eventRecordId: randomUUID(),
    })).rejects.toMatchObject({ code: "ATTEMPT_CONFLICT" });
  }, 30_000);

  it("retries leased outbox work then dead-letters it at the configured boundary", async () => {
    const clock = { now: new Date("2026-08-21T14:20:00.000Z") };
    const { pg } = await setup(clock);
    const coordinator = new PostgresWorkerCoordinator(sqlClient(pg), () => clock.now);
    const first = await coordinator.claimNextOutbox("worker-a", 1_000);
    const retryAt = new Date(clock.now.getTime() + 5_000);
    expect(await coordinator.rejectOutbox({
      eventId: first!.eventId,
      workerId: "worker-a",
      errorCode: "TEMPORARY_PROVIDER_UNAVAILABLE",
      retryAt: retryAt.toISOString(),
      maxAttempts: 2,
    })).toBe("PENDING");
    expect(await coordinator.claimNextOutbox("worker-b", 1_000)).toBeNull();

    clock.now = retryAt;
    const second = await coordinator.claimNextOutbox("worker-b", 1_000);
    expect(second?.attempts).toBe(2);
    expect(await coordinator.rejectOutbox({
      eventId: second!.eventId,
      workerId: "worker-b",
      errorCode: "PERMANENT_DISPATCH_FAILURE",
      retryAt: new Date(clock.now.getTime() + 5_000).toISOString(),
      maxAttempts: 2,
    })).toBe("DEAD_LETTER");
    clock.now = new Date(clock.now.getTime() + 10_000);
    expect(await coordinator.claimNextOutbox("worker-c", 1_000)).toBeNull();
    const state = await pg.query<{ status: string; attempts: number; last_error_code: string }>(
      "SELECT status, attempts, last_error_code FROM fusion_engine.outbox_events WHERE id = $1",
      [first!.eventId],
    );
    expect(state.rows[0]).toEqual({ status: "DEAD_LETTER", attempts: 2, last_error_code: "PERMANENT_DISPATCH_FAILURE" });
  });

  it("persists only legal CAS transitions and rejects stale worker versions", async () => {
    const clock = { now: new Date("2026-08-21T14:30:00.000Z") };
    const { pg, operationId } = await setup(clock);
    const coordinator = new PostgresWorkerCoordinator(sqlClient(pg), () => clock.now);
    const lease = await coordinator.claimNextOutbox("relay", 1_000);
    const queued = await coordinator.consumeQueuedDelivery({
      consumerName: "generation-worker",
      eventId: lease!.eventId,
      operationId,
      payload: lease!.payload,
      eventRecordId: randomUUID(),
    });
    await expect(coordinator.beginDispatch({
      operationId,
      expectedVersion: 0,
      attemptId: randomUUID(),
      attemptNumber: 1,
      providerId: "provider-test",
      providerIdempotencyKey: `provider-attempt:${operationId}:1`,
      requestHash: HASH,
      requestPayload: providerRequest(operationId),
      dispatchDeadlineAt: new Date(clock.now.getTime() + 60_000).toISOString(),
      eventRecordId: randomUUID(),
    })).rejects.toMatchObject({ code: "OPERATION_CAS_CONFLICT" });

    const dispatching = await coordinator.beginDispatch({
      operationId,
      expectedVersion: queued.operation.stateVersion,
      attemptId: randomUUID(),
      attemptNumber: 1,
      providerId: "provider-test",
      providerIdempotencyKey: `provider-attempt:${operationId}:1`,
      requestHash: HASH,
      requestPayload: providerRequest(operationId),
      dispatchDeadlineAt: new Date(clock.now.getTime() + 60_000).toISOString(),
      eventRecordId: randomUUID(),
    });
    const submitted = await coordinator.transition({
      operationId,
      expectedState: "DISPATCHING",
      expectedVersion: dispatching.operation.stateVersion,
      event: "provider.submitted.v1",
      actor: "provider-adapter",
      evidenceHash: "c".repeat(64),
      eventRecordId: randomUUID(),
    });
    expect(submitted).toMatchObject({ state: "SUBMITTED", stateVersion: 3 });
    await expect(coordinator.transition({
      operationId,
      expectedState: "DISPATCHING",
      expectedVersion: 2,
      event: "provider.submitted.v1",
      actor: "provider-adapter",
      evidenceHash: "d".repeat(64),
      eventRecordId: randomUUID(),
    })).rejects.toMatchObject({ code: "OPERATION_CAS_CONFLICT" });
    const persisted = await pg.query<{ state: string; state_version: number; events: number }>(`SELECT
      state, state_version,
      (SELECT count(*)::int FROM fusion_engine.operation_events WHERE operation_id = $1) AS events
      FROM fusion_engine.operations WHERE id = $1`, [operationId]);
    expect(persisted.rows[0]).toEqual({ state: "SUBMITTED", state_version: 3, events: 4 });
  });
});
