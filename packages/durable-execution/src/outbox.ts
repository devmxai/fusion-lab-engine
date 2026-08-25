import { DurableExecutionError } from "./errors.ts";

export type OutboxMessage<Payload> = {
  eventId: string;
  aggregateId: string;
  aggregateVersion: number;
  eventName: string;
  payload: Payload;
  occurredAt: string;
};

type StoredOutboxMessage<Payload> = OutboxMessage<Payload> & {
  status: "PENDING" | "LEASED" | "ACKED" | "DEAD_LETTER";
  attempts: number;
  workerId: string | null;
  lastErrorCode: string | null;
};

export type OutboxLease<Payload> = OutboxMessage<Payload> & {
  attempts: number;
  workerId: string;
};

export interface OutboxStore<Payload> {
  append(message: OutboxMessage<Payload>): void;
  claim(workerId: string, limit: number): OutboxLease<Payload>[];
  claimAggregate(workerId: string, aggregateId: string): OutboxLease<Payload> | null;
  acknowledge(eventId: string, workerId: string): void;
  reject(eventId: string, workerId: string, errorCode: string, maxAttempts: number): void;
  recoverWorker(workerId: string): number;
  rollbackAppend(eventId: string): void;
}

export class InMemoryOutboxStore<Payload> implements OutboxStore<Payload> {
  private readonly messages = new Map<string, StoredOutboxMessage<Payload>>();

  append(message: OutboxMessage<Payload>): void {
    if (this.messages.has(message.eventId)) {
      throw new DurableExecutionError("OUTBOX_DUPLICATE_EVENT", "An outbox event ID can be appended only once.");
    }
    this.messages.set(message.eventId, {
      ...structuredClone(message),
      status: "PENDING",
      attempts: 0,
      workerId: null,
      lastErrorCode: null,
    });
  }

  claim(workerId: string, limit: number): OutboxLease<Payload>[] {
    if (workerId.length === 0) throw new TypeError("Worker ID is required.");
    if (!Number.isInteger(limit) || limit < 1) throw new TypeError("Claim limit must be a positive integer.");

    const leases: OutboxLease<Payload>[] = [];
    for (const message of this.messages.values()) {
      if (message.status !== "PENDING") continue;
      message.status = "LEASED";
      message.workerId = workerId;
      message.attempts += 1;
      leases.push(structuredClone({
        eventId: message.eventId,
        aggregateId: message.aggregateId,
        aggregateVersion: message.aggregateVersion,
        eventName: message.eventName,
        payload: message.payload,
        occurredAt: message.occurredAt,
        attempts: message.attempts,
        workerId,
      }));
      if (leases.length === limit) break;
    }
    return leases;
  }

  claimAggregate(workerId: string, aggregateId: string): OutboxLease<Payload> | null {
    if (workerId.length === 0 || aggregateId.length === 0) {
      throw new TypeError("Worker ID and aggregate ID are required.");
    }
    for (const message of this.messages.values()) {
      if (message.aggregateId !== aggregateId || message.status !== "PENDING") continue;
      message.status = "LEASED";
      message.workerId = workerId;
      message.attempts += 1;
      return structuredClone({
        eventId: message.eventId,
        aggregateId: message.aggregateId,
        aggregateVersion: message.aggregateVersion,
        eventName: message.eventName,
        payload: message.payload,
        occurredAt: message.occurredAt,
        attempts: message.attempts,
        workerId,
      });
    }
    return null;
  }

  has(eventId: string): boolean {
    return this.messages.has(eventId);
  }

  acknowledge(eventId: string, workerId: string): void {
    const message = this.requireLease(eventId, workerId);
    message.status = "ACKED";
    message.workerId = null;
  }

  reject(eventId: string, workerId: string, errorCode: string, maxAttempts: number): void {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new TypeError("Maximum attempts must be a positive integer.");
    }
    const message = this.requireLease(eventId, workerId);
    message.lastErrorCode = errorCode;
    message.workerId = null;
    message.status = message.attempts >= maxAttempts ? "DEAD_LETTER" : "PENDING";
  }

  recoverWorker(workerId: string): number {
    let recovered = 0;
    for (const message of this.messages.values()) {
      if (message.status === "LEASED" && message.workerId === workerId) {
        message.status = "PENDING";
        message.workerId = null;
        recovered += 1;
      }
    }
    return recovered;
  }

  rollbackAppend(eventId: string): void {
    const message = this.messages.get(eventId);
    if (!message) return;
    if (message.status !== "PENDING" || message.attempts !== 0) {
      throw new DurableExecutionError(
        "OUTBOX_LEASE_MISMATCH",
        "Only an undelivered append may be rolled back by its transaction.",
      );
    }
    this.messages.delete(eventId);
  }

  snapshot(): ReadonlyArray<Readonly<StoredOutboxMessage<Payload>>> {
    return structuredClone([...this.messages.values()]);
  }

  private requireLease(eventId: string, workerId: string): StoredOutboxMessage<Payload> {
    const message = this.messages.get(eventId);
    if (!message || message.status !== "LEASED" || message.workerId !== workerId) {
      throw new DurableExecutionError(
        "OUTBOX_LEASE_MISMATCH",
        "Only the worker holding the current outbox lease may mutate delivery state.",
      );
    }
    return message;
  }
}
