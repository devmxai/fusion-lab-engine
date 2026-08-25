import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DurableExecutionError } from "./errors.ts";
import { InMemoryAttemptStore } from "./attempts.ts";
import { InMemoryAtomicOperationStore } from "./atomic-operation.ts";
import { InMemoryIdempotencyStore } from "./idempotency.ts";
import { InMemoryInboxStore } from "./inbox.ts";
import { InMemoryOutboxStore } from "./outbox.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe("idempotency primitive", () => {
  const identity = {
    actorId: "user-1",
    route: "POST /v2/operations",
    key: "operation-0001",
    requestHash: hash("request-a"),
  };

  it("allows one lease holder and replays the immutable completed response", () => {
    const store = new InMemoryIdempotencyStore<{ operationId: string }>();
    const acquired = store.acquire(identity);
    expect(acquired.kind).toBe("ACQUIRED");
    if (acquired.kind !== "ACQUIRED") throw new Error("Expected acquired lease");
    expect(store.acquire(identity)).toEqual({ kind: "IN_PROGRESS" });
    store.complete(identity, acquired.leaseToken, { operationId: "op-1" });
    expect(store.acquire(identity)).toEqual({ kind: "REPLAY", response: { operationId: "op-1" } });
  });

  it("fails closed when the same scoped key has a different request hash", () => {
    const store = new InMemoryIdempotencyStore();
    store.acquire(identity);
    expect(() => store.acquire({ ...identity, requestHash: hash("request-b") }))
      .toThrowError(expect.objectContaining<Partial<DurableExecutionError>>({ code: "IDEMPOTENCY_CONFLICT" }));
  });

  it("scopes the same key independently by actor and route", () => {
    const store = new InMemoryIdempotencyStore();
    expect(store.acquire(identity).kind).toBe("ACQUIRED");
    expect(store.acquire({ ...identity, actorId: "user-2" }).kind).toBe("ACQUIRED");
    expect(store.acquire({ ...identity, route: "POST /v2/quotes" }).kind).toBe("ACQUIRED");
  });
});

describe("outbox primitive", () => {
  const message = {
    eventId: "event-1",
    aggregateId: "operation-1",
    aggregateVersion: 1,
    eventName: "operation.queued.v1",
    payload: { operationId: "operation-1" },
    occurredAt: "2026-08-12T12:00:00.000Z",
  };

  it("delivers at least once and acknowledges only through the lease holder", () => {
    const outbox = new InMemoryOutboxStore<typeof message.payload>();
    outbox.append(message);
    expect(outbox.claim("worker-a", 1)).toHaveLength(1);
    expect(() => outbox.acknowledge(message.eventId, "worker-b"))
      .toThrowError(expect.objectContaining<Partial<DurableExecutionError>>({ code: "OUTBOX_LEASE_MISMATCH" }));
    outbox.acknowledge(message.eventId, "worker-a");
    expect(outbox.claim("worker-a", 1)).toEqual([]);
  });

  it("recovers an unacknowledged crash for redelivery without cloning the event", () => {
    const outbox = new InMemoryOutboxStore<typeof message.payload>();
    outbox.append(message);
    expect(outbox.claim("crashed-worker", 1)[0]?.attempts).toBe(1);
    expect(outbox.recoverWorker("crashed-worker")).toBe(1);
    expect(outbox.claim("replacement-worker", 1)[0]).toMatchObject({ eventId: "event-1", attempts: 2 });
    expect(outbox.snapshot()).toHaveLength(1);
  });

  it("dead-letters after the bounded attempt budget", () => {
    const outbox = new InMemoryOutboxStore<typeof message.payload>();
    outbox.append(message);
    outbox.claim("worker", 1);
    outbox.reject("event-1", "worker", "TEMPORARY", 2);
    outbox.claim("worker", 1);
    outbox.reject("event-1", "worker", "PERMANENT", 2);
    expect(outbox.snapshot()[0]).toMatchObject({ status: "DEAD_LETTER", attempts: 2, lastErrorCode: "PERMANENT" });
  });
});

describe("inbox primitive", () => {
  const identity = { provider: "for-test", deliveryId: "delivery-1", payloadHash: hash("payload-a") };

  it("executes a replayed provider delivery side effect exactly once", async () => {
    const inbox = new InMemoryInboxStore<{ applied: boolean }>();
    const handler = vi.fn(async () => ({ applied: true }));
    const [first, duplicate] = await Promise.all([
      inbox.consume(identity, handler),
      inbox.consume(identity, handler),
    ]);
    expect([first.kind, duplicate.kind].sort()).toEqual(["DUPLICATE", "PROCESSED"]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(inbox.snapshot()).toHaveLength(1);
  });

  it("rejects a delivery ID replayed with different content", async () => {
    const inbox = new InMemoryInboxStore();
    await inbox.consume(identity, () => ({ ok: true }));
    await expect(inbox.consume({ ...identity, payloadHash: hash("payload-b") }, () => ({ ok: false })))
      .rejects.toMatchObject({ code: "INBOX_DELIVERY_CONFLICT" });
  });

  it("does not persist a receipt when the handler fails, allowing reviewed retry", async () => {
    const inbox = new InMemoryInboxStore();
    await expect(inbox.consume(identity, () => { throw new Error("crash"); })).rejects.toThrow("crash");
    expect(inbox.snapshot()).toEqual([]);
    await expect(inbox.consume(identity, () => ({ recovered: true }))).resolves.toMatchObject({ kind: "PROCESSED" });
  });
});

describe("atomic operation and outbox boundary", () => {
  const input = {
    operation: { id: "operation-atomic-1", state: "RESERVED" },
    binding: {
      actorId: "user-1",
      route: "POST /v2/operations",
      key: "operation-atomic-key-1",
      requestHash: hash("atomic-request"),
    },
    outboxMessage: {
      eventId: "event-atomic-1",
      aggregateId: "operation-atomic-1",
      aggregateVersion: 1,
      eventName: "operation.queued.v1",
      payload: { operationId: "operation-atomic-1" },
      occurredAt: "2026-08-12T12:00:00.000Z",
    },
  };

  it("commits reserve, operation and outbox once and replays 100 duplicate requests", () => {
    const store = new InMemoryAtomicOperationStore<typeof input.operation, typeof input.outboxMessage.payload>();
    let reservations = 0;
    const commit = () => store.commitCreate({
      ...input,
      financialTransaction: (work) => work(),
      reserve: () => { reservations += 1; },
    });
    const first = commit();
    const repeated = Array.from({ length: 100 }, commit);
    expect(first.kind).toBe("CREATED");
    expect(repeated.every(({ kind, operation }) => kind === "REPLAY" && operation.id === input.operation.id)).toBe(true);
    expect(reservations).toBe(1);
    expect(store.operationsSnapshot()).toHaveLength(1);
    expect(store.outboxSnapshot()).toHaveLength(1);
  });

  it("does not expose an operation or outbox event when reservation fails", () => {
    const store = new InMemoryAtomicOperationStore<typeof input.operation, typeof input.outboxMessage.payload>();
    expect(() => store.commitCreate({
      ...input,
      financialTransaction: (work) => work(),
      reserve: () => { throw new Error("reserve_failed"); },
    })).toThrow("reserve_failed");
    expect(store.operationsSnapshot()).toEqual([]);
    expect(store.outboxSnapshot()).toEqual([]);
  });

  it("rolls back operation and outbox when the financial commit aborts after all writes", () => {
    const store = new InMemoryAtomicOperationStore<typeof input.operation, typeof input.outboxMessage.payload>();
    expect(() => store.commitCreate({
      ...input,
      financialTransaction: (work) => {
        work();
        throw new Error("financial_commit_aborted");
      },
      reserve: () => undefined,
    })).toThrow("financial_commit_aborted");
    expect(store.operationsSnapshot()).toEqual([]);
    expect(store.outboxSnapshot()).toEqual([]);
  });

  it("rejects an idempotency key rebound to different input", () => {
    const store = new InMemoryAtomicOperationStore<typeof input.operation, typeof input.outboxMessage.payload>();
    store.commitCreate({ ...input, financialTransaction: (work) => work(), reserve: () => undefined });
    expect(() => store.commitCreate({
      ...input,
      binding: { ...input.binding, requestHash: hash("different-request") },
      financialTransaction: (work) => work(),
      reserve: () => undefined,
    })).toThrowError(expect.objectContaining<Partial<DurableExecutionError>>({
      code: "OPERATION_IDEMPOTENCY_CONFLICT",
    }));
  });
});

describe("attempt state machine", () => {
  it("recovers a crashed worker lease without creating a second attempt", () => {
    const attempts = new InMemoryAttemptStore();
    attempts.create({ id: "attempt-1", operationId: "operation-1", evidenceCode: "queued" });
    attempts.claim("attempt-1", "crashed-worker");
    expect(attempts.recoverWorker("crashed-worker")).toBe(1);
    attempts.claim("attempt-1", "replacement-worker");
    attempts.markSubmitted("attempt-1", "replacement-worker", "provider-task-1");
    attempts.markRunning("attempt-1");
    attempts.markSucceeded("attempt-1");
    expect(attempts.forOperation("operation-1")).toEqual([
      expect.objectContaining({ attemptNumber: 1, state: "SUCCEEDED", providerTaskId: "provider-task-1" }),
    ]);
  });

  it("fails closed when a non-owner tries to complete a lease", () => {
    const attempts = new InMemoryAttemptStore();
    attempts.create({ id: "attempt-2", operationId: "operation-2", evidenceCode: "queued" });
    attempts.claim("attempt-2", "worker-a");
    expect(() => attempts.markSubmitted("attempt-2", "worker-b", "provider-task-2"))
      .toThrowError(expect.objectContaining<Partial<DurableExecutionError>>({ code: "ATTEMPT_LEASE_MISMATCH" }));
  });
});
