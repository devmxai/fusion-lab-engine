import { createHash, randomUUID } from "node:crypto";
import {
  requireLegalTransition,
  type OperationState,
  type TransitionActor,
} from "../../contracts/src/operation.js";
import type { DurableOperationView, SqlExecutor, TransactionalSqlClient } from "./postgres-atomic.js";

type OperationRow = {
  id: string;
  owner_id: string;
  quote_id: string;
  generation_intent_id: string;
  request_hash: string;
  state: OperationState;
  state_version: string | number | bigint;
  customer_credits: string | number | bigint;
  created_at: string | Date;
  updated_at: string | Date;
};

type OutboxRow = {
  id: string;
  aggregate_id: string;
  aggregate_version: string | number | bigint;
  event_name: string;
  payload: Record<string, unknown> | string;
  status: "PENDING" | "LEASED" | "ACKED" | "DEAD_LETTER";
  attempts: number;
  lease_owner: string | null;
  lease_expires_at: string | Date | null;
};

export type DurableAttemptState =
  | "DISPATCHING"
  | "SUBMISSION_UNKNOWN"
  | "SUBMITTED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "RECONCILIATION_REQUIRED";

type AttemptRow = {
  id: string;
  operation_id: string;
  attempt_number: number;
  provider_id: string;
  provider_idempotency_key: string;
  state: DurableAttemptState;
  version: string | number | bigint;
  provider_task_id: string | null;
  request_hash: string;
  request_payload: Record<string, unknown> | string;
  response_hash: string | null;
  unknown_lookup_count: number;
  poll_count: number;
  actual_provider_credits: string | number | bigint | null;
  charge_status: "ACTUAL" | "CONFIRMED_NO_CHARGE" | "UNKNOWN" | null;
  provider_result_url: string | null;
  last_error_code: string | null;
  dispatch_deadline_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
};

type AssetRow = {
  id: string;
  operation_id: string;
  attempt_id: string;
  provider_id: string;
  provider_task_id: string;
  private_object_id: string;
  object_key: string;
  bucket: string;
  owner_id: string;
  project_id: string;
  media_type: "image" | "video" | "audio";
  content_type: string;
  byte_length: string | number | bigint;
  checksum_sha256: string;
  metadata: Record<string, unknown> | string;
  source_url: string;
  stored_at: string | Date;
};

type ReservationRow = {
  id: string;
  operation_id: string;
  owner_id: string;
  quoted_credits: string | number | bigint;
  held_credits: string | number | bigint;
  captured_credits: string | number | bigint;
  released_credits: string | number | bigint;
  state: "HELD" | "SETTLED" | "RELEASED" | "MANUAL_REVIEW";
};

export type DurableAttemptView = {
  id: string;
  operationId: string;
  attemptNumber: number;
  providerId: string;
  providerIdempotencyKey: string;
  state: DurableAttemptState;
  version: number;
  providerTaskId: string | null;
  requestHash: string;
  requestPayload: Record<string, unknown>;
  responseHash: string | null;
  unknownLookupCount: number;
  pollCount: number;
  actualProviderCredits: number | null;
  chargeStatus: "ACTUAL" | "CONFIRMED_NO_CHARGE" | "UNKNOWN" | null;
  providerResultUrl: string | null;
  lastErrorCode: string | null;
  dispatchDeadlineAt: string;
  createdAt: string;
  updatedAt: string;
  operationState: OperationState;
  operationStateVersion: number;
};

export type DurableAssetView = {
  id: string;
  operationId: string;
  attemptId: string;
  providerId: string;
  providerTaskId: string;
  privateObjectId: string;
  objectKey: string;
  bucket: string;
  ownerId: string;
  projectId: string;
  mediaType: "image" | "video" | "audio";
  contentType: string;
  byteLength: number;
  checksumSha256: string;
  metadata: Record<string, unknown>;
  sourceUrl: string;
  storedAt: string;
};

export type DurableOutboxLease = {
  eventId: string;
  operationId: string;
  aggregateVersion: number;
  eventName: string;
  payload: Record<string, unknown>;
  attempts: number;
  workerId: string;
  leaseExpiresAt: string;
};

export class PostgresWorkerError extends Error {
  constructor(
    readonly code:
      | "OUTBOX_LEASE_MISMATCH"
      | "INBOX_DELIVERY_CONFLICT"
      | "OPERATION_CAS_CONFLICT"
      | "OPERATION_STATE_CONFLICT"
      | "ATTEMPT_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "PostgresWorkerError";
  }
}

function safeWhole(value: string | number | bigint): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("unsafe_postgres_integer");
  return parsed;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function view(row: OperationRow): DurableOperationView {
  return {
    id: row.id,
    ownerId: row.owner_id,
    quoteId: row.quote_id,
    generationIntentId: row.generation_intent_id,
    requestHash: row.request_hash,
    state: row.state,
    stateVersion: safeWhole(row.state_version),
    customerCredits: safeWhole(row.customer_credits),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function payloadOf(value: OutboxRow["payload"]): Record<string, unknown> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  return value;
}

function attemptView(row: AttemptRow, operation: OperationRow): DurableAttemptView {
  return {
    id: row.id,
    operationId: row.operation_id,
    attemptNumber: row.attempt_number,
    providerId: row.provider_id,
    providerIdempotencyKey: row.provider_idempotency_key,
    state: row.state,
    version: safeWhole(row.version),
    providerTaskId: row.provider_task_id,
    requestHash: row.request_hash,
    requestPayload: payloadOf(row.request_payload),
    responseHash: row.response_hash,
    unknownLookupCount: row.unknown_lookup_count,
    pollCount: row.poll_count,
    actualProviderCredits: row.actual_provider_credits === null ? null : safeWhole(row.actual_provider_credits),
    chargeStatus: row.charge_status,
    providerResultUrl: row.provider_result_url,
    lastErrorCode: row.last_error_code,
    dispatchDeadlineAt: toIso(row.dispatch_deadline_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    operationState: operation.state,
    operationStateVersion: safeWhole(operation.state_version),
  };
}

function assetView(row: AssetRow): DurableAssetView {
  return {
    id: row.id,
    operationId: row.operation_id,
    attemptId: row.attempt_id,
    providerId: row.provider_id,
    providerTaskId: row.provider_task_id,
    privateObjectId: row.private_object_id,
    objectKey: row.object_key,
    bucket: row.bucket,
    ownerId: row.owner_id,
    projectId: row.project_id,
    mediaType: row.media_type,
    contentType: row.content_type,
    byteLength: safeWhole(row.byte_length),
    checksumSha256: row.checksum_sha256,
    metadata: payloadOf(row.metadata),
    sourceUrl: row.source_url,
    storedAt: toIso(row.stored_at),
  };
}

export class PostgresWorkerCoordinator {
  constructor(
    private readonly database: TransactionalSqlClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async claimNextOutbox(workerId: string, leaseMilliseconds: number): Promise<DurableOutboxLease | null> {
    if (!workerId.trim() || !Number.isSafeInteger(leaseMilliseconds) || leaseMilliseconds < 100) {
      throw new TypeError("invalid_outbox_lease_request");
    }
    return this.database.transaction(async (transaction) => {
      const claimedAt = this.now();
      const expiresAt = new Date(claimedAt.getTime() + leaseMilliseconds);
      const candidate = await transaction.query<OutboxRow>(
        `SELECT * FROM fusion_engine.outbox_events
         WHERE (
           (status = 'PENDING' AND available_at <= $1)
           OR (status = 'LEASED' AND lease_expires_at <= $1)
         )
         ORDER BY available_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [claimedAt.toISOString()],
      );
      if (!candidate.rows[0]) return null;
      const updated = await transaction.query<OutboxRow>(
        `UPDATE fusion_engine.outbox_events
         SET status = 'LEASED', attempts = attempts + 1, lease_owner = $2,
             lease_expires_at = $3, updated_at = $1
         WHERE id = $4
         RETURNING *`,
        [claimedAt.toISOString(), workerId, expiresAt.toISOString(), candidate.rows[0].id],
      );
      const row = updated.rows[0];
      return {
        eventId: row.id,
        operationId: row.aggregate_id,
        aggregateVersion: safeWhole(row.aggregate_version),
        eventName: row.event_name,
        payload: payloadOf(row.payload),
        attempts: row.attempts,
        workerId,
        leaseExpiresAt: expiresAt.toISOString(),
      };
    });
  }

  async acknowledgeOutbox(eventId: string, workerId: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const row = await this.lockOutbox(transaction, eventId);
      if (row.status !== "LEASED" || row.lease_owner !== workerId) {
        throw new PostgresWorkerError("OUTBOX_LEASE_MISMATCH", "Only the current lease owner may acknowledge outbox delivery.");
      }
      await transaction.query(
        `UPDATE fusion_engine.outbox_events
         SET status = 'ACKED', lease_owner = NULL, lease_expires_at = NULL, updated_at = $2
         WHERE id = $1`,
        [eventId, this.now().toISOString()],
      );
    });
  }

  async rejectOutbox(input: {
    eventId: string;
    workerId: string;
    errorCode: string;
    retryAt: string;
    maxAttempts: number;
  }): Promise<"PENDING" | "DEAD_LETTER"> {
    return this.database.transaction(async (transaction) => {
      const row = await this.lockOutbox(transaction, input.eventId);
      if (row.status !== "LEASED" || row.lease_owner !== input.workerId) {
        throw new PostgresWorkerError("OUTBOX_LEASE_MISMATCH", "Only the current lease owner may reject outbox delivery.");
      }
      const status = row.attempts >= input.maxAttempts ? "DEAD_LETTER" : "PENDING";
      await transaction.query(
        `UPDATE fusion_engine.outbox_events
         SET status = $2, available_at = $3, lease_owner = NULL, lease_expires_at = NULL,
             last_error_code = $4, updated_at = $5
         WHERE id = $1`,
        [input.eventId, status, input.retryAt, input.errorCode, this.now().toISOString()],
      );
      return status;
    });
  }

  async consumeQueuedDelivery(input: {
    consumerName: string;
    eventId: string;
    operationId: string;
    payload: Record<string, unknown>;
    eventRecordId: string;
  }): Promise<{ kind: "PROCESSED" | "DUPLICATE"; operation: DurableOperationView }> {
    return this.database.transaction(async (transaction) => {
      const payloadHash = hash(input.payload);
      const receipt = await transaction.query<{
        aggregate_id: string;
        payload_hash: string;
        status: "PROCESSING" | "PROCESSED";
      }>(
        `SELECT aggregate_id, payload_hash, status FROM fusion_engine.inbox_receipts
         WHERE consumer_name = $1 AND event_id = $2 FOR UPDATE`,
        [input.consumerName, input.eventId],
      );
      if (receipt.rows[0]) {
        if (receipt.rows[0].aggregate_id !== input.operationId || receipt.rows[0].payload_hash !== payloadHash) {
          throw new PostgresWorkerError("INBOX_DELIVERY_CONFLICT", "Inbox event was replayed with different content.");
        }
        return { kind: "DUPLICATE", operation: await this.requireOperation(transaction, input.operationId) };
      }

      const occurredAt = this.now().toISOString();
      await transaction.query(
        `INSERT INTO fusion_engine.inbox_receipts
         (consumer_name, event_id, aggregate_id, payload_hash, status, received_at)
         VALUES ($1, $2, $3, $4, 'PROCESSING', $5)`,
        [input.consumerName, input.eventId, input.operationId, payloadHash, occurredAt],
      );
      const operation = await this.lockOperation(transaction, input.operationId);
      if (operation.state !== "RESERVED") {
        throw new PostgresWorkerError("OPERATION_STATE_CONFLICT", "Queued delivery requires a RESERVED operation.");
      }
      const next = requireLegalTransition({
        currentState: operation.state,
        currentVersion: safeWhole(operation.state_version),
        expectedState: "RESERVED",
        expectedVersion: safeWhole(operation.state_version),
        event: "operation.queued.v1",
        actor: "outbox-relay",
        hasEvidence: true,
      });
      await this.persistTransition(transaction, operation, next.state, next.version, {
        eventRecordId: input.eventRecordId,
        event: next.transition.event,
        actor: next.transition.actor,
        evidenceHash: payloadHash,
        occurredAt,
      });
      await transaction.query(
        `UPDATE fusion_engine.inbox_receipts
         SET status = 'PROCESSED', processed_at = $3
         WHERE consumer_name = $1 AND event_id = $2`,
        [input.consumerName, input.eventId, occurredAt],
      );
      return { kind: "PROCESSED", operation: await this.requireOperation(transaction, input.operationId) };
    });
  }

  async beginDispatch(input: {
    operationId: string;
    expectedVersion: number;
    attemptId: string;
    attemptNumber: number;
    providerId: string;
    providerIdempotencyKey: string;
    requestHash: string;
    requestPayload: Record<string, unknown>;
    dispatchDeadlineAt: string;
    eventRecordId: string;
  }): Promise<{ kind: "CREATED" | "REPLAY"; operation: DurableOperationView }> {
    const deadline = new Date(input.dispatchDeadlineAt);
    if (Number.isNaN(deadline.getTime()) || deadline.getTime() <= this.now().getTime()) {
      throw new TypeError("invalid_dispatch_deadline");
    }
    return this.database.transaction(async (transaction) => {
      const attempt = await transaction.query<{
        provider_id: string;
        provider_idempotency_key: string;
        request_hash: string;
        payload_matches: boolean;
      }>(
        `SELECT provider_id, provider_idempotency_key, request_hash,
                request_payload = $3::jsonb AS payload_matches
         FROM fusion_engine.operation_attempts
         WHERE operation_id = $1 AND attempt_number = $2 FOR UPDATE`,
        [input.operationId, input.attemptNumber, JSON.stringify(input.requestPayload)],
      );
      if (attempt.rows[0]) {
        const exact = attempt.rows[0].provider_id === input.providerId
          && attempt.rows[0].provider_idempotency_key === input.providerIdempotencyKey
          && attempt.rows[0].request_hash === input.requestHash
          && attempt.rows[0].payload_matches;
        if (!exact) throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Attempt identity is already bound to different input.");
        return { kind: "REPLAY", operation: await this.requireOperation(transaction, input.operationId) };
      }

      const operation = await this.lockOperation(transaction, input.operationId);
      if (operation.state !== "QUEUED" || safeWhole(operation.state_version) !== input.expectedVersion) {
        throw new PostgresWorkerError("OPERATION_CAS_CONFLICT", "Operation state/version changed before dispatch.");
      }
      const next = requireLegalTransition({
        currentState: operation.state,
        currentVersion: safeWhole(operation.state_version),
        expectedState: "QUEUED",
        expectedVersion: input.expectedVersion,
        event: "attempt.dispatching.v1",
        actor: "worker",
        hasEvidence: true,
      });
      const occurredAt = this.now().toISOString();
      await transaction.query(
        `INSERT INTO fusion_engine.operation_attempts
         (id, operation_id, attempt_number, provider_id, provider_idempotency_key, state,
          request_hash, request_payload, dispatch_deadline_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'DISPATCHING', $6, $7::jsonb, $8, $9, $9)`,
        [
          input.attemptId,
          input.operationId,
          input.attemptNumber,
          input.providerId,
          input.providerIdempotencyKey,
          input.requestHash,
          JSON.stringify(input.requestPayload),
          input.dispatchDeadlineAt,
          occurredAt,
        ],
      );
      await this.persistTransition(transaction, operation, next.state, next.version, {
        eventRecordId: input.eventRecordId,
        event: next.transition.event,
        actor: next.transition.actor,
        evidenceHash: hash({ attemptId: input.attemptId, requestHash: input.requestHash }),
        occurredAt,
      });
      return { kind: "CREATED", operation: await this.requireOperation(transaction, input.operationId) };
    });
  }

  async attempt(operationId: string, attemptNumber: number): Promise<DurableAttemptView> {
    return this.database.transaction(async (transaction) => {
      const operation = await this.lockOperation(transaction, operationId);
      const attempt = await this.lockAttempt(transaction, operationId, attemptNumber);
      return attemptView(attempt, operation);
    });
  }

  async attemptByProviderTask(providerId: string, providerTaskId: string): Promise<DurableAttemptView | null> {
    return this.database.transaction(async (transaction) => {
      const row = await transaction.query<AttemptRow>(
        `SELECT * FROM fusion_engine.operation_attempts
         WHERE provider_id = $1 AND provider_task_id = $2 FOR UPDATE`,
        [providerId, providerTaskId],
      );
      if (!row.rows[0]) return null;
      const operation = await this.lockOperation(transaction, row.rows[0].operation_id);
      return attemptView(row.rows[0], operation);
    });
  }

  async operation(operationId: string): Promise<DurableOperationView> {
    return this.requireOperation(this.database, operationId);
  }

  async runnableAttempts(limit = 50): Promise<Array<{ operationId: string; attemptNumber: number }>> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new TypeError("invalid_runnable_attempt_limit");
    const result = await this.database.query<{ operation_id: string; attempt_number: number }>(
      `SELECT a.operation_id, a.attempt_number
       FROM fusion_engine.operation_attempts a
       JOIN fusion_engine.operations o ON o.id = a.operation_id
       WHERE o.state IN ('DISPATCHING', 'SUBMISSION_UNKNOWN', 'SUBMITTED', 'RUNNING',
                         'PROVIDER_SUCCEEDED', 'PROVIDER_FAILED', 'ASSET_STORED', 'DELIVERED')
       ORDER BY a.updated_at, a.operation_id
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({ operationId: row.operation_id, attemptNumber: row.attempt_number }));
  }

  async expiredAttempts(now: string, limit = 50): Promise<Array<{ operationId: string; attemptNumber: number }>> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new TypeError("invalid_expired_attempt_limit");
    const result = await this.database.query<{ operation_id: string; attempt_number: number }>(
      `SELECT operation_id, attempt_number
       FROM fusion_engine.operation_attempts
       WHERE state IN ('SUBMISSION_UNKNOWN', 'SUBMITTED', 'RUNNING')
         AND dispatch_deadline_at <= $1
       ORDER BY dispatch_deadline_at, operation_id
       LIMIT $2`,
      [now, limit],
    );
    return result.rows.map((row) => ({ operationId: row.operation_id, attemptNumber: row.attempt_number }));
  }

  async asset(operationId: string): Promise<DurableAssetView> {
    return this.database.transaction(async (transaction) => assetView(
      await this.lockAssetByOperation(transaction, operationId, true),
    ));
  }

  async claimSubmission(input: {
    operationId: string;
    attemptNumber: number;
    expectedOperationVersion: number;
    expectedAttemptVersion: number;
    eventRecordId: string;
    evidenceHash: string;
  }): Promise<{ attempt: DurableAttemptView; operation: DurableOperationView }> {
    return this.advanceAttempt({
      operationId: input.operationId,
      attemptNumber: input.attemptNumber,
      expectedOperationState: "DISPATCHING",
      expectedOperationVersion: input.expectedOperationVersion,
      expectedAttemptState: "DISPATCHING",
      expectedAttemptVersion: input.expectedAttemptVersion,
      nextAttemptState: "SUBMISSION_UNKNOWN",
      event: "provider.submission_unknown.v1",
      actor: "provider-adapter",
      eventRecordId: input.eventRecordId,
      evidenceHash: input.evidenceHash,
      lastErrorCode: "SUBMISSION_IN_FLIGHT",
    });
  }

  async advanceAttempt(input: {
    operationId: string;
    attemptNumber: number;
    expectedOperationState: OperationState;
    expectedOperationVersion: number;
    expectedAttemptState: DurableAttemptState;
    expectedAttemptVersion: number;
    nextAttemptState: DurableAttemptState;
    event: string;
    actor: TransitionActor;
    eventRecordId: string;
    evidenceHash: string;
    providerTaskId?: string;
    responseHash?: string;
    actualProviderCredits?: number;
    chargeStatus?: "ACTUAL" | "CONFIRMED_NO_CHARGE" | "UNKNOWN";
    providerResultUrl?: string;
    lastErrorCode?: string;
    clearLastError?: boolean;
    incrementUnknownLookup?: boolean;
    incrementPoll?: boolean;
  }): Promise<{ attempt: DurableAttemptView; operation: DurableOperationView }> {
    if (input.actualProviderCredits !== undefined
      && (!Number.isSafeInteger(input.actualProviderCredits) || input.actualProviderCredits < 0)) {
      throw new TypeError("invalid_actual_provider_credits");
    }
    return this.database.transaction(async (transaction) => {
      const operation = await this.lockOperation(transaction, input.operationId);
      const attempt = await this.lockAttempt(transaction, input.operationId, input.attemptNumber);
      if (operation.state !== input.expectedOperationState
        || safeWhole(operation.state_version) !== input.expectedOperationVersion) {
        throw new PostgresWorkerError("OPERATION_CAS_CONFLICT", "Operation state/version changed before attempt transition.");
      }
      if (attempt.state !== input.expectedAttemptState || safeWhole(attempt.version) !== input.expectedAttemptVersion) {
        throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Attempt state/version changed before transition.");
      }
      const next = requireLegalTransition({
        currentState: operation.state,
        currentVersion: safeWhole(operation.state_version),
        expectedState: input.expectedOperationState,
        expectedVersion: input.expectedOperationVersion,
        event: input.event,
        actor: input.actor,
        hasEvidence: /^[a-f0-9]{64}$/.test(input.evidenceHash),
      });
      const occurredAt = this.now().toISOString();
      const updated = await transaction.query<AttemptRow>(
        `UPDATE fusion_engine.operation_attempts
         SET state = $5, version = version + 1,
             provider_task_id = COALESCE($6, provider_task_id),
             response_hash = COALESCE($7, response_hash),
             actual_provider_credits = COALESCE($8, actual_provider_credits),
             charge_status = COALESCE($9, charge_status),
             provider_result_url = COALESCE($10, provider_result_url),
             last_error_code = CASE WHEN $12 THEN NULL ELSE COALESCE($11, last_error_code) END,
             unknown_lookup_count = unknown_lookup_count + $13,
             poll_count = poll_count + $14,
             updated_at = $15
         WHERE operation_id = $1 AND attempt_number = $2 AND state = $3 AND version = $4
         RETURNING *`,
        [
          input.operationId,
          input.attemptNumber,
          input.expectedAttemptState,
          input.expectedAttemptVersion,
          input.nextAttemptState,
          input.providerTaskId ?? null,
          input.responseHash ?? null,
          input.actualProviderCredits ?? null,
          input.chargeStatus ?? null,
          input.providerResultUrl ?? null,
          input.lastErrorCode ?? null,
          input.clearLastError ?? false,
          input.incrementUnknownLookup ? 1 : 0,
          input.incrementPoll ? 1 : 0,
          occurredAt,
        ],
      );
      if (!updated.rows[0]) {
        throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Attempt compare-and-set update failed.");
      }
      await this.persistTransition(transaction, operation, next.state, next.version, {
        eventRecordId: input.eventRecordId,
        event: next.transition.event,
        actor: next.transition.actor,
        evidenceHash: input.evidenceHash,
        occurredAt,
      });
      const persistedOperation = await this.lockOperation(transaction, input.operationId);
      return {
        attempt: attemptView(updated.rows[0], persistedOperation),
        operation: view(persistedOperation),
      };
    });
  }

  async observeAttempt(input: {
    operationId: string;
    attemptNumber: number;
    expectedAttemptState: DurableAttemptState;
    expectedAttemptVersion: number;
    responseHash?: string;
    lastErrorCode?: string;
    incrementUnknownLookup?: boolean;
    incrementPoll?: boolean;
  }): Promise<DurableAttemptView> {
    return this.database.transaction(async (transaction) => {
      const operation = await this.lockOperation(transaction, input.operationId);
      const attempt = await this.lockAttempt(transaction, input.operationId, input.attemptNumber);
      if (attempt.state !== input.expectedAttemptState || safeWhole(attempt.version) !== input.expectedAttemptVersion) {
        throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Attempt state/version changed before observation.");
      }
      const updated = await transaction.query<AttemptRow>(
        `UPDATE fusion_engine.operation_attempts
         SET version = version + 1,
             response_hash = COALESCE($5, response_hash),
             last_error_code = COALESCE($6, last_error_code),
             unknown_lookup_count = unknown_lookup_count + $7,
             poll_count = poll_count + $8,
             updated_at = $9
         WHERE operation_id = $1 AND attempt_number = $2 AND state = $3 AND version = $4
         RETURNING *`,
        [
          input.operationId,
          input.attemptNumber,
          input.expectedAttemptState,
          input.expectedAttemptVersion,
          input.responseHash ?? null,
          input.lastErrorCode ?? null,
          input.incrementUnknownLookup ? 1 : 0,
          input.incrementPoll ? 1 : 0,
          this.now().toISOString(),
        ],
      );
      if (!updated.rows[0]) {
        throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Attempt observation compare-and-set failed.");
      }
      return attemptView(updated.rows[0], operation);
    });
  }

  async recordUnknownLookupMiss(input: {
    operationId: string;
    attemptNumber: number;
    expectedOperationVersion: number;
    expectedAttemptVersion: number;
    maxUnknownLookups: number;
    eventRecordId: string;
    evidenceHash: string;
  }): Promise<{ attempt: DurableAttemptView; operation: DurableOperationView; outcome: "WAITING" | "RECONCILIATION_REQUIRED" }> {
    if (!Number.isSafeInteger(input.maxUnknownLookups) || input.maxUnknownLookups < 1) {
      throw new TypeError("invalid_max_unknown_lookups");
    }
    return this.database.transaction(async (transaction) => {
      const operation = await this.lockOperation(transaction, input.operationId);
      const attempt = await this.lockAttempt(transaction, input.operationId, input.attemptNumber);
      if (operation.state !== "SUBMISSION_UNKNOWN"
        || safeWhole(operation.state_version) !== input.expectedOperationVersion) {
        throw new PostgresWorkerError("OPERATION_CAS_CONFLICT", "Unknown lookup requires the expected operation version.");
      }
      if (attempt.state !== "SUBMISSION_UNKNOWN" || safeWhole(attempt.version) !== input.expectedAttemptVersion) {
        throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Unknown lookup requires the expected attempt version.");
      }
      const unknownLookupCount = attempt.unknown_lookup_count + 1;
      const reconcile = unknownLookupCount >= input.maxUnknownLookups;
      const occurredAt = this.now().toISOString();
      const updated = await transaction.query<AttemptRow>(
        `UPDATE fusion_engine.operation_attempts
         SET state = $4, version = version + 1, unknown_lookup_count = $5,
             last_error_code = 'PROVIDER_IDEMPOTENCY_LOOKUP_NOT_FOUND', updated_at = $6
         WHERE operation_id = $1 AND attempt_number = $2 AND state = 'SUBMISSION_UNKNOWN' AND version = $3
         RETURNING *`,
        [
          input.operationId,
          input.attemptNumber,
          input.expectedAttemptVersion,
          reconcile ? "RECONCILIATION_REQUIRED" : "SUBMISSION_UNKNOWN",
          unknownLookupCount,
          occurredAt,
        ],
      );
      if (!updated.rows[0]) {
        throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Unknown lookup compare-and-set failed.");
      }
      let persistedOperation = operation;
      if (reconcile) {
        const next = requireLegalTransition({
          currentState: operation.state,
          currentVersion: safeWhole(operation.state_version),
          expectedState: "SUBMISSION_UNKNOWN",
          expectedVersion: input.expectedOperationVersion,
          event: "operation.reconciliation_required.v1",
          actor: "reconciler",
          hasEvidence: /^[a-f0-9]{64}$/.test(input.evidenceHash),
        });
        await this.persistTransition(transaction, operation, next.state, next.version, {
          eventRecordId: input.eventRecordId,
          event: next.transition.event,
          actor: next.transition.actor,
          evidenceHash: input.evidenceHash,
          occurredAt,
        });
        persistedOperation = await this.lockOperation(transaction, input.operationId);
      }
      return {
        attempt: attemptView(updated.rows[0], persistedOperation),
        operation: view(persistedOperation),
        outcome: reconcile ? "RECONCILIATION_REQUIRED" : "WAITING",
      };
    });
  }

  async storeAsset(input: {
    operationId: string;
    expectedOperationVersion: number;
    attemptId: string;
    assetId: string;
    privateObjectId: string;
    objectKey: string;
    bucket: string;
    ownerId: string;
    projectId: string;
    mediaType: "image" | "video" | "audio";
    contentType: string;
    byteLength: number;
    checksumSha256: string;
    metadata: Record<string, unknown>;
    sourceUrl: string;
    eventRecordId: string;
    evidenceHash: string;
  }): Promise<{ kind: "STORED" | "REPLAY"; asset: DurableAssetView; operation: DurableOperationView }> {
    if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 1 || !/^[a-f0-9]{64}$/.test(input.checksumSha256)) {
      throw new TypeError("invalid_private_asset_evidence");
    }
    return this.database.transaction(async (transaction) => {
      const operation = await this.lockOperation(transaction, input.operationId);
      const existing = await this.lockAssetByOperation(transaction, input.operationId, false);
      if (existing) {
        const exact = existing.attempt_id === input.attemptId
          && existing.private_object_id === input.privateObjectId
          && existing.object_key === input.objectKey
          && existing.checksum_sha256 === input.checksumSha256;
        if (!exact) throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Operation asset is already bound to different evidence.");
        if (!["ASSET_STORED", "DELIVERED", "SETTLED"].includes(operation.state)) {
          throw new PostgresWorkerError("OPERATION_STATE_CONFLICT", "Asset exists but operation did not complete durable storage.");
        }
        return { kind: "REPLAY", asset: assetView(existing), operation: view(operation) };
      }
      if (operation.state !== "PROVIDER_SUCCEEDED" || safeWhole(operation.state_version) !== input.expectedOperationVersion) {
        throw new PostgresWorkerError("OPERATION_CAS_CONFLICT", "Asset storage requires the expected provider success version.");
      }
      const attempt = await this.lockAttemptById(transaction, input.attemptId);
      if (attempt.operation_id !== input.operationId || attempt.state !== "SUCCEEDED"
        || !attempt.provider_task_id || attempt.provider_result_url !== input.sourceUrl) {
        throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Asset evidence does not match the successful provider attempt.");
      }
      const next = requireLegalTransition({
        currentState: operation.state,
        currentVersion: safeWhole(operation.state_version),
        expectedState: "PROVIDER_SUCCEEDED",
        expectedVersion: input.expectedOperationVersion,
        event: "asset.stored.v1",
        actor: "media-worker",
        hasEvidence: /^[a-f0-9]{64}$/.test(input.evidenceHash),
      });
      const occurredAt = this.now().toISOString();
      const inserted = await transaction.query<AssetRow>(
        `INSERT INTO fusion_engine.operation_assets
         (id, operation_id, attempt_id, provider_id, provider_task_id, private_object_id, object_key,
          bucket, owner_id, project_id, media_type, content_type, byte_length, checksum_sha256,
          metadata, source_url, stored_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::bigint, $14, $15::jsonb, $16, $17)
         RETURNING *`,
        [
          input.assetId, input.operationId, input.attemptId, attempt.provider_id, attempt.provider_task_id,
          input.privateObjectId, input.objectKey, input.bucket, input.ownerId, input.projectId,
          input.mediaType, input.contentType, input.byteLength, input.checksumSha256,
          JSON.stringify(input.metadata), input.sourceUrl, occurredAt,
        ],
      );
      await this.persistTransition(transaction, operation, next.state, next.version, {
        eventRecordId: input.eventRecordId,
        event: next.transition.event,
        actor: next.transition.actor,
        evidenceHash: input.evidenceHash,
        occurredAt,
      });
      const persistedOperation = await this.lockOperation(transaction, input.operationId);
      return { kind: "STORED", asset: assetView(inserted.rows[0]), operation: view(persistedOperation) };
    });
  }

  async recordDelivery(input: {
    operationId: string;
    expectedOperationVersion: number;
    assetId: string;
    deliveryId: string;
    ownerId: string;
    evidenceHash: string;
    eventRecordId: string;
  }): Promise<{ kind: "DELIVERED" | "REPLAY"; operation: DurableOperationView }> {
    return this.database.transaction(async (transaction) => {
      const operation = await this.lockOperation(transaction, input.operationId);
      const existing = await transaction.query<{ id: string; asset_id: string; owner_id: string; delivery_evidence_hash: string }>(
        "SELECT id, asset_id, owner_id, delivery_evidence_hash FROM fusion_engine.operation_deliveries WHERE operation_id = $1 FOR UPDATE",
        [input.operationId],
      );
      if (existing.rows[0]) {
        const exact = existing.rows[0].id === input.deliveryId
          && existing.rows[0].asset_id === input.assetId
          && existing.rows[0].owner_id === input.ownerId
          && existing.rows[0].delivery_evidence_hash === input.evidenceHash;
        if (!exact) throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Delivery is already bound to different evidence.");
        if (!["DELIVERED", "SETTLED"].includes(operation.state)) {
          throw new PostgresWorkerError("OPERATION_STATE_CONFLICT", "Delivery exists but operation state is inconsistent.");
        }
        return { kind: "REPLAY", operation: view(operation) };
      }
      if (operation.state !== "ASSET_STORED" || safeWhole(operation.state_version) !== input.expectedOperationVersion) {
        throw new PostgresWorkerError("OPERATION_CAS_CONFLICT", "Delivery requires the expected asset storage version.");
      }
      const asset = await this.lockAssetByOperation(transaction, input.operationId, true);
      if (asset.id !== input.assetId || asset.owner_id !== input.ownerId) {
        throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Delivery asset ownership does not match the operation.");
      }
      const next = requireLegalTransition({
        currentState: operation.state,
        currentVersion: safeWhole(operation.state_version),
        expectedState: "ASSET_STORED",
        expectedVersion: input.expectedOperationVersion,
        event: "operation.delivered.v1",
        actor: "delivery-worker",
        hasEvidence: /^[a-f0-9]{64}$/.test(input.evidenceHash),
      });
      const occurredAt = this.now().toISOString();
      await transaction.query(
        `INSERT INTO fusion_engine.operation_deliveries
         (id, operation_id, asset_id, owner_id, delivery_evidence_hash, delivered_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [input.deliveryId, input.operationId, input.assetId, input.ownerId, input.evidenceHash, occurredAt],
      );
      await this.persistTransition(transaction, operation, next.state, next.version, {
        eventRecordId: input.eventRecordId,
        event: next.transition.event,
        actor: next.transition.actor,
        evidenceHash: input.evidenceHash,
        occurredAt,
      });
      return { kind: "DELIVERED", operation: view(await this.lockOperation(transaction, input.operationId)) };
    });
  }

  async settleDelivered(input: {
    operationId: string;
    expectedOperationVersion: number;
    commandId: string;
    journalId: string;
    eventRecordId: string;
    evidenceHash: string;
  }): Promise<{ kind: "SETTLED" | "REPLAY"; operation: DurableOperationView }> {
    return this.database.transaction(async (transaction) => {
      const operation = await this.lockOperation(transaction, input.operationId);
      const commandHash = hash({ action: "SETTLE_DELIVERY", operationId: input.operationId, evidenceHash: input.evidenceHash });
      const replay = await this.financialReplay(transaction, input, "SETTLE_DELIVERY", commandHash);
      if (replay) return { kind: "REPLAY", operation: view(operation) };
      if (operation.state !== "DELIVERED" || safeWhole(operation.state_version) !== input.expectedOperationVersion) {
        throw new PostgresWorkerError("OPERATION_CAS_CONFLICT", "Settlement requires the expected delivered version.");
      }
      const reservation = await this.lockReservation(transaction, input.operationId);
      if (reservation.state !== "HELD") throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Settlement reservation is not held.");
      const credits = safeWhole(reservation.held_credits);
      const wallet = await transaction.query<{ owner_id: string; held_credits: string | number | bigint }>(
        "SELECT owner_id, held_credits FROM fusion_engine.wallets WHERE owner_id = $1 FOR UPDATE",
        [reservation.owner_id],
      );
      if (!wallet.rows[0] || safeWhole(wallet.rows[0].held_credits) < credits) {
        throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Customer wallet hold is inconsistent with the reservation.");
      }
      const asset = await this.lockAssetByOperation(transaction, input.operationId, true);
      const attempt = await this.lockAttemptById(transaction, asset.attempt_id);
      if (attempt.state !== "SUCCEEDED" || attempt.actual_provider_credits === null) {
        throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Settlement requires provider cost evidence.");
      }
      const next = requireLegalTransition({
        currentState: operation.state,
        currentVersion: safeWhole(operation.state_version),
        expectedState: "DELIVERED",
        expectedVersion: input.expectedOperationVersion,
        event: "ledger.settled.v1",
        actor: "finance-worker",
        hasEvidence: /^[a-f0-9]{64}$/.test(input.evidenceHash),
      });
      const occurredAt = this.now().toISOString();
      await transaction.query(
        `UPDATE fusion_engine.credit_reservations
         SET held_credits = 0, captured_credits = $2::bigint, released_credits = 0, state = 'SETTLED', updated_at = $3
         WHERE id = $1`,
        [reservation.id, credits, occurredAt],
      );
      await transaction.query(
        `UPDATE fusion_engine.wallets
         SET held_credits = held_credits - $2::bigint, spent_credits = spent_credits + $2::bigint,
             version = version + 1, updated_at = $3 WHERE owner_id = $1`,
        [reservation.owner_id, credits, occurredAt],
      );
      await this.recordFinancialJournal(transaction, {
        journalId: input.journalId,
        commandId: input.commandId,
        operationId: input.operationId,
        kind: "SETTLE",
        reasonCode: "DELIVERED_ASSET_CAPTURE",
        entries: [
          { accountId: `owner:${reservation.owner_id}:held`, amount: -credits },
          { accountId: "platform:earned", amount: credits },
        ],
        occurredAt,
      });
      await this.bindFinancialCommand(transaction, input, "SETTLE_DELIVERY", commandHash, occurredAt);
      await this.recordProviderCostOutcome(transaction, {
        operationId: input.operationId,
        attempt,
        disposition: "DELIVERED",
        evidenceHash: hash({ assetId: asset.id, providerCredits: safeWhole(attempt.actual_provider_credits) }),
        occurredAt,
      });
      await this.persistTransition(transaction, operation, next.state, next.version, {
        eventRecordId: input.eventRecordId,
        event: next.transition.event,
        actor: next.transition.actor,
        evidenceHash: input.evidenceHash,
        occurredAt,
      });
      return { kind: "SETTLED", operation: view(await this.lockOperation(transaction, input.operationId)) };
    });
  }

  async releaseDeliveryFailure(input: {
    operationId: string;
    expectedOperationState: "PROVIDER_SUCCEEDED" | "ASSET_STORED";
    expectedOperationVersion: number;
    attemptId: string;
    commandId: string;
    journalId: string;
    eventRecordId: string;
    evidenceHash: string;
  }): Promise<{ kind: "RELEASED" | "REPLAY"; operation: DurableOperationView }> {
    return this.database.transaction(async (transaction) => {
      const operation = await this.lockOperation(transaction, input.operationId);
      const commandHash = hash({ action: "RELEASE_DELIVERY_FAILURE", operationId: input.operationId, evidenceHash: input.evidenceHash });
      const replay = await this.financialReplay(transaction, input, "RELEASE_DELIVERY_FAILURE", commandHash);
      if (replay) return { kind: "REPLAY", operation: view(operation) };
      if (operation.state !== input.expectedOperationState || safeWhole(operation.state_version) !== input.expectedOperationVersion) {
        throw new PostgresWorkerError("OPERATION_CAS_CONFLICT", "Failure release requires the expected operation version.");
      }
      const attempt = await this.lockAttemptById(transaction, input.attemptId);
      if (attempt.operation_id !== input.operationId || attempt.state !== "SUCCEEDED" || attempt.actual_provider_credits === null) {
        throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Failure release requires charged provider evidence.");
      }
      const reservation = await this.lockReservation(transaction, input.operationId);
      if (reservation.state !== "HELD") throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Failure release reservation is not held.");
      const credits = safeWhole(reservation.held_credits);
      const wallet = await transaction.query<{ held_credits: string | number | bigint }>(
        "SELECT held_credits FROM fusion_engine.wallets WHERE owner_id = $1 FOR UPDATE",
        [reservation.owner_id],
      );
      if (!wallet.rows[0] || safeWhole(wallet.rows[0].held_credits) < credits) {
        throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Customer wallet hold is inconsistent with failure release.");
      }
      const event = input.expectedOperationState === "PROVIDER_SUCCEEDED" ? "asset.delivery_failed.v1" : "asset.delivery_failed.v1";
      const actor: TransitionActor = input.expectedOperationState === "PROVIDER_SUCCEEDED" ? "media-worker" : "delivery-worker";
      const next = requireLegalTransition({
        currentState: operation.state,
        currentVersion: safeWhole(operation.state_version),
        expectedState: input.expectedOperationState,
        expectedVersion: input.expectedOperationVersion,
        event,
        actor,
        hasEvidence: /^[a-f0-9]{64}$/.test(input.evidenceHash),
      });
      const occurredAt = this.now().toISOString();
      await transaction.query(
        `UPDATE fusion_engine.credit_reservations
         SET held_credits = 0, captured_credits = 0, released_credits = $2::bigint, state = 'RELEASED', updated_at = $3
         WHERE id = $1`,
        [reservation.id, credits, occurredAt],
      );
      await transaction.query(
        `UPDATE fusion_engine.wallets
         SET held_credits = held_credits - $2::bigint, available_credits = available_credits + $2::bigint,
             version = version + 1, updated_at = $3 WHERE owner_id = $1`,
        [reservation.owner_id, credits, occurredAt],
      );
      await this.recordFinancialJournal(transaction, {
        journalId: input.journalId,
        commandId: input.commandId,
        operationId: input.operationId,
        kind: "RELEASE",
        reasonCode: "DELIVERY_FAILURE_PROVIDER_LOSS",
        entries: [
          { accountId: `owner:${reservation.owner_id}:held`, amount: -credits },
          { accountId: `owner:${reservation.owner_id}:available`, amount: credits },
        ],
        occurredAt,
      });
      await this.bindFinancialCommand(transaction, input, "RELEASE_DELIVERY_FAILURE", commandHash, occurredAt);
      await this.recordProviderCostOutcome(transaction, {
        operationId: input.operationId,
        attempt,
        disposition: "LOSS",
        evidenceHash: hash({ failureEvidence: input.evidenceHash, providerCredits: safeWhole(attempt.actual_provider_credits) }),
        occurredAt,
      });
      await this.persistTransition(transaction, operation, next.state, next.version, {
        eventRecordId: input.eventRecordId,
        event: next.transition.event,
        actor: next.transition.actor,
        evidenceHash: input.evidenceHash,
        occurredAt,
      });
      return { kind: "RELEASED", operation: view(await this.lockOperation(transaction, input.operationId)) };
    });
  }

  /** Releases the customer hold after a definitive provider failure or pre-submit rejection. */
  async releaseProviderFailure(input: {
    operationId: string;
    expectedOperationVersion: number;
    attemptId: string;
    commandId: string;
    journalId: string;
    evidenceHash: string;
  }): Promise<{ kind: "RELEASED" | "REPLAY"; operation: DurableOperationView }> {
    return this.database.transaction(async (transaction) => {
      const operation = await this.lockOperation(transaction, input.operationId);
      const commandHash = hash({ action: "RELEASE_PROVIDER_FAILURE", operationId: input.operationId, evidenceHash: input.evidenceHash });
      const replay = await this.financialReplay(transaction, input, "RELEASE_PROVIDER_FAILURE", commandHash);
      if (replay) return { kind: "REPLAY", operation: view(operation) };
      if (operation.state !== "PROVIDER_FAILED" || safeWhole(operation.state_version) !== input.expectedOperationVersion) {
        throw new PostgresWorkerError("OPERATION_CAS_CONFLICT", "Provider failure release requires the expected terminal provider failure version.");
      }
      const attempt = await this.lockAttemptById(transaction, input.attemptId);
      if (attempt.operation_id !== input.operationId || attempt.state !== "FAILED" || attempt.actual_provider_credits === null
        || !["ACTUAL", "CONFIRMED_NO_CHARGE"].includes(attempt.charge_status ?? "")) {
        throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Provider failure release requires a definitive task-bound charge outcome.");
      }
      const credits = safeWhole(attempt.actual_provider_credits);
      if ((attempt.charge_status === "CONFIRMED_NO_CHARGE") !== (credits === 0)) {
        throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Provider failure charge status conflicts with the recorded actual usage.");
      }
      const reservation = await this.lockReservation(transaction, input.operationId);
      if (reservation.state !== "HELD") throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Provider failure release requires a held reservation.");
      const held = safeWhole(reservation.held_credits);
      const wallet = await transaction.query<{ held_credits: string | number | bigint }>(
        "SELECT held_credits FROM fusion_engine.wallets WHERE owner_id = $1 FOR UPDATE",
        [reservation.owner_id],
      );
      if (!wallet.rows[0] || safeWhole(wallet.rows[0].held_credits) < held) {
        throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Customer wallet hold is inconsistent with provider failure release.");
      }
      const occurredAt = this.now().toISOString();
      await transaction.query(
        `UPDATE fusion_engine.credit_reservations
         SET held_credits = 0, captured_credits = 0, released_credits = $2::bigint, state = 'RELEASED', updated_at = $3
         WHERE id = $1`,
        [reservation.id, held, occurredAt],
      );
      await transaction.query(
        `UPDATE fusion_engine.wallets
         SET held_credits = held_credits - $2::bigint, available_credits = available_credits + $2::bigint,
             version = version + 1, updated_at = $3 WHERE owner_id = $1`,
        [reservation.owner_id, held, occurredAt],
      );
      await this.recordFinancialJournal(transaction, {
        journalId: input.journalId,
        commandId: input.commandId,
        operationId: input.operationId,
        kind: "RELEASE",
        reasonCode: credits === 0 ? "PROVIDER_FAILURE_CONFIRMED_NO_CHARGE" : "PROVIDER_FAILURE_CHARGED_PLATFORM_LOSS",
        entries: [
          { accountId: `owner:${reservation.owner_id}:held`, amount: -held },
          { accountId: `owner:${reservation.owner_id}:available`, amount: held },
        ],
        occurredAt,
      });
      await this.bindFinancialCommand(transaction, input, "RELEASE_PROVIDER_FAILURE", commandHash, occurredAt);
      if (attempt.provider_task_id) {
        await this.recordProviderCostOutcome(transaction, {
          operationId: input.operationId,
          attempt,
          disposition: "LOSS",
          evidenceHash: hash({ providerFailure: true, providerCredits: credits, chargeStatus: attempt.charge_status }),
          occurredAt,
        });
      } else if (attempt.charge_status !== "CONFIRMED_NO_CHARGE" || credits !== 0) {
        throw new PostgresWorkerError("ATTEMPT_CONFLICT", "A taskless provider rejection must prove zero charge before release.");
      }
      return { kind: "RELEASED", operation: view(await this.lockOperation(transaction, input.operationId)) };
    });
  }

  /**
   * Stops a queued operation before any provider submission.  This is the
   * only kill-switch path that may release a held customer credit without a
   * provider-cost record, because the durable state proves dispatch never
   * began.
   */
  async cancelQueuedBeforeDispatch(input: {
    operationId: string;
    expectedVersion: number;
    commandId: string;
    journalId: string;
    eventRecordId: string;
    evidenceHash: string;
    reasonCode: string;
  }): Promise<{ kind: "CANCELLED" | "REPLAY"; operation: DurableOperationView }> {
    return this.database.transaction(async (transaction) => {
      const operation = await this.lockOperation(transaction, input.operationId);
      const commandHash = hash({ action: "RELEASE_PRE_DISPATCH", operationId: input.operationId, evidenceHash: input.evidenceHash });
      const replay = await this.financialReplay(transaction, input, "RELEASE_PRE_DISPATCH", commandHash);
      if (replay) return { kind: "REPLAY", operation: view(operation) };
      if (operation.state !== "QUEUED" || safeWhole(operation.state_version) !== input.expectedVersion) {
        throw new PostgresWorkerError("OPERATION_CAS_CONFLICT", "Pre-dispatch cancellation requires the expected queued operation version.");
      }
      const reservation = await this.lockReservation(transaction, input.operationId);
      if (reservation.state !== "HELD") throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Pre-dispatch cancellation requires a held reservation.");
      const credits = safeWhole(reservation.held_credits);
      const wallet = await transaction.query<{ held_credits: string | number | bigint }>(
        "SELECT held_credits FROM fusion_engine.wallets WHERE owner_id = $1 FOR UPDATE",
        [reservation.owner_id],
      );
      if (!wallet.rows[0] || safeWhole(wallet.rows[0].held_credits) < credits) {
        throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Customer wallet hold is inconsistent with pre-dispatch cancellation.");
      }
      const next = requireLegalTransition({
        currentState: operation.state,
        currentVersion: safeWhole(operation.state_version),
        expectedState: "QUEUED",
        expectedVersion: input.expectedVersion,
        event: "operation.cancelled.v1",
        actor: "worker",
        hasEvidence: /^[a-f0-9]{64}$/.test(input.evidenceHash),
      });
      const occurredAt = this.now().toISOString();
      await transaction.query(
        `UPDATE fusion_engine.credit_reservations
         SET held_credits = 0, captured_credits = 0, released_credits = $2::bigint, state = 'RELEASED', updated_at = $3
         WHERE id = $1`,
        [reservation.id, credits, occurredAt],
      );
      await transaction.query(
        `UPDATE fusion_engine.wallets
         SET held_credits = held_credits - $2::bigint, available_credits = available_credits + $2::bigint,
             version = version + 1, updated_at = $3 WHERE owner_id = $1`,
        [reservation.owner_id, credits, occurredAt],
      );
      await this.recordFinancialJournal(transaction, {
        journalId: input.journalId,
        commandId: input.commandId,
        operationId: input.operationId,
        kind: "RELEASE",
        reasonCode: input.reasonCode,
        entries: [
          { accountId: `owner:${reservation.owner_id}:held`, amount: -credits },
          { accountId: `owner:${reservation.owner_id}:available`, amount: credits },
        ],
        occurredAt,
      });
      await this.bindFinancialCommand(transaction, input, "RELEASE_PRE_DISPATCH", commandHash, occurredAt);
      await this.persistTransition(transaction, operation, next.state, next.version, {
        eventRecordId: input.eventRecordId,
        event: next.transition.event,
        actor: next.transition.actor,
        evidenceHash: input.evidenceHash,
        occurredAt,
      });
      return { kind: "CANCELLED", operation: view(await this.lockOperation(transaction, input.operationId)) };
    });
  }

  async transition(input: {
    operationId: string;
    expectedState: OperationState;
    expectedVersion: number;
    event: string;
    actor: TransitionActor;
    evidenceHash: string;
    eventRecordId: string;
  }): Promise<DurableOperationView> {
    return this.database.transaction(async (transaction) => {
      const operation = await this.lockOperation(transaction, input.operationId);
      if (operation.state !== input.expectedState || safeWhole(operation.state_version) !== input.expectedVersion) {
        throw new PostgresWorkerError("OPERATION_CAS_CONFLICT", "Operation state/version changed before transition.");
      }
      const next = requireLegalTransition({
        currentState: operation.state,
        currentVersion: safeWhole(operation.state_version),
        expectedState: input.expectedState,
        expectedVersion: input.expectedVersion,
        event: input.event,
        actor: input.actor,
        hasEvidence: /^[a-f0-9]{64}$/.test(input.evidenceHash),
      });
      await this.persistTransition(transaction, operation, next.state, next.version, {
        eventRecordId: input.eventRecordId,
        event: next.transition.event,
        actor: next.transition.actor,
        evidenceHash: input.evidenceHash,
        occurredAt: this.now().toISOString(),
      });
      return this.requireOperation(transaction, input.operationId);
    });
  }

  private async persistTransition(
    transaction: SqlExecutor,
    operation: OperationRow,
    nextState: OperationState,
    nextVersion: number,
    evidence: {
      eventRecordId: string;
      event: string;
      actor: TransitionActor;
      evidenceHash: string;
      occurredAt: string;
    },
  ): Promise<void> {
    const updated = await transaction.query(
      `UPDATE fusion_engine.operations
       SET state = $4, state_version = $5, updated_at = $6
       WHERE id = $1 AND state = $2 AND state_version = $3`,
      [operation.id, operation.state, safeWhole(operation.state_version), nextState, nextVersion, evidence.occurredAt],
    );
    if (updated.affectedRows !== 1) {
      throw new PostgresWorkerError("OPERATION_CAS_CONFLICT", "Operation compare-and-set update failed.");
    }
    await transaction.query(
      `INSERT INTO fusion_engine.operation_events
       (id, operation_id, sequence, state, state_version, event_name, actor, evidence_hash, occurred_at)
       VALUES ($1, $2, $3, $4, $3, $5, $6, $7, $8)`,
      [
        evidence.eventRecordId,
        operation.id,
        nextVersion,
        nextState,
        evidence.event,
        evidence.actor,
        evidence.evidenceHash,
        evidence.occurredAt,
      ],
    );
  }

  private async financialReplay(
    transaction: SqlExecutor,
    input: { operationId: string; commandId: string; journalId: string; evidenceHash: string },
    action: "SETTLE_DELIVERY" | "RELEASE_DELIVERY_FAILURE" | "RELEASE_PRE_DISPATCH" | "RELEASE_PROVIDER_FAILURE",
    requestHash: string,
  ): Promise<boolean> {
    const command = await transaction.query<{
      operation_id: string;
      action: "SETTLE_DELIVERY" | "RELEASE_DELIVERY_FAILURE" | "RELEASE_PRE_DISPATCH" | "RELEASE_PROVIDER_FAILURE";
      request_hash: string;
      journal_id: string;
    }>(
      `SELECT operation_id, action, request_hash, journal_id
       FROM fusion_engine.financial_command_bindings WHERE command_id = $1 FOR UPDATE`,
      [input.commandId],
    );
    if (command.rows[0]) {
      const exact = command.rows[0].operation_id === input.operationId
        && command.rows[0].action === action
        && command.rows[0].request_hash === requestHash;
      if (!exact) throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Financial command ID is already bound to different intent.");
      return true;
    }
    const operationAction = await transaction.query<{ command_id: string }>(
      `SELECT command_id FROM fusion_engine.financial_command_bindings
       WHERE operation_id = $1 AND action = $2 FOR UPDATE`,
      [input.operationId, action],
    );
    if (operationAction.rows[0]) {
      throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Operation financial action is already bound to a different command.");
    }
    return false;
  }

  private async bindFinancialCommand(
    transaction: SqlExecutor,
    input: { operationId: string; commandId: string; journalId: string },
    action: "SETTLE_DELIVERY" | "RELEASE_DELIVERY_FAILURE" | "RELEASE_PRE_DISPATCH" | "RELEASE_PROVIDER_FAILURE",
    requestHash: string,
    occurredAt: string,
  ): Promise<void> {
    await transaction.query(
      `INSERT INTO fusion_engine.financial_command_bindings
       (command_id, operation_id, action, request_hash, journal_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.commandId, input.operationId, action, requestHash, input.journalId, occurredAt],
    );
  }

  private async recordFinancialJournal(
    transaction: SqlExecutor,
    input: {
      journalId: string;
      commandId: string;
      operationId: string;
      kind: "SETTLE" | "RELEASE";
      reasonCode: string;
      entries: [{ accountId: string; amount: number }, { accountId: string; amount: number }];
      occurredAt: string;
    },
  ): Promise<void> {
    if (input.entries[0].amount + input.entries[1].amount !== 0
      || input.entries.some((entry) => !Number.isSafeInteger(entry.amount) || entry.amount === 0)) {
      throw new TypeError("unbalanced_financial_journal");
    }
    await transaction.query(
      `INSERT INTO fusion_engine.ledger_journals
       (id, command_id, kind, operation_id, reason_code, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.journalId, input.commandId, input.kind, input.operationId, input.reasonCode, input.occurredAt],
    );
    await transaction.query(
      `INSERT INTO fusion_engine.ledger_entries (journal_id, account_id, amount, created_at)
       VALUES ($1, $2, $3::bigint, $6), ($1, $4, $5::bigint, $6)`,
      [
        input.journalId,
        input.entries[0].accountId,
        input.entries[0].amount,
        input.entries[1].accountId,
        input.entries[1].amount,
        input.occurredAt,
      ],
    );
  }

  private async recordProviderCostOutcome(
    transaction: SqlExecutor,
    input: {
      operationId: string;
      attempt: AttemptRow;
      disposition: "DELIVERED" | "LOSS";
      evidenceHash: string;
      occurredAt: string;
    },
  ): Promise<void> {
    if (input.attempt.actual_provider_credits === null || !input.attempt.provider_task_id) {
      throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Provider cost outcome requires a charged task identity.");
    }
    const existing = await transaction.query<{
      attempt_id: string;
      provider_id: string;
      provider_credits: string | number | bigint;
      disposition: "DELIVERED" | "LOSS";
      evidence_hash: string;
    }>(
      "SELECT attempt_id, provider_id, provider_credits, disposition, evidence_hash FROM fusion_engine.provider_cost_outcomes WHERE operation_id = $1 FOR UPDATE",
      [input.operationId],
    );
    const providerCredits = safeWhole(input.attempt.actual_provider_credits);
    if (existing.rows[0]) {
      const exact = existing.rows[0].attempt_id === input.attempt.id
        && existing.rows[0].provider_id === input.attempt.provider_id
        && safeWhole(existing.rows[0].provider_credits) === providerCredits
        && existing.rows[0].disposition === input.disposition
        && existing.rows[0].evidence_hash === input.evidenceHash;
      if (!exact) throw new PostgresWorkerError("ATTEMPT_CONFLICT", "Provider cost outcome is already bound to different evidence.");
      return;
    }
    await transaction.query(
      `INSERT INTO fusion_engine.provider_cost_outcomes
       (id, operation_id, attempt_id, provider_id, provider_credits, disposition, evidence_hash, recorded_at)
       VALUES ($1, $2, $3, $4, $5::bigint, $6, $7, $8)`,
      [
        randomUUID(), input.operationId, input.attempt.id, input.attempt.provider_id,
        providerCredits, input.disposition, input.evidenceHash, input.occurredAt,
      ],
    );
  }

  private async lockOutbox(transaction: SqlExecutor, eventId: string): Promise<OutboxRow> {
    const result = await transaction.query<OutboxRow>(
      "SELECT * FROM fusion_engine.outbox_events WHERE id = $1 FOR UPDATE",
      [eventId],
    );
    if (!result.rows[0]) throw new Error("outbox_event_not_found");
    return result.rows[0];
  }

  private async lockOperation(transaction: SqlExecutor, operationId: string): Promise<OperationRow> {
    const result = await transaction.query<OperationRow>(
      "SELECT * FROM fusion_engine.operations WHERE id = $1 FOR UPDATE",
      [operationId],
    );
    if (!result.rows[0]) throw new Error("operation_not_found");
    return result.rows[0];
  }

  private async lockAttemptById(transaction: SqlExecutor, attemptId: string): Promise<AttemptRow> {
    const result = await transaction.query<AttemptRow>(
      "SELECT * FROM fusion_engine.operation_attempts WHERE id = $1 FOR UPDATE",
      [attemptId],
    );
    if (!result.rows[0]) throw new Error("operation_attempt_not_found");
    return result.rows[0];
  }

  private async lockAttempt(
    transaction: SqlExecutor,
    operationId: string,
    attemptNumber: number,
  ): Promise<AttemptRow> {
    const result = await transaction.query<AttemptRow>(
      `SELECT * FROM fusion_engine.operation_attempts
       WHERE operation_id = $1 AND attempt_number = $2 FOR UPDATE`,
      [operationId, attemptNumber],
    );
    if (!result.rows[0]) throw new Error("operation_attempt_not_found");
    return result.rows[0];
  }

  private async lockAssetByOperation(
    transaction: SqlExecutor,
    operationId: string,
    required: true,
  ): Promise<AssetRow>;
  private async lockAssetByOperation(
    transaction: SqlExecutor,
    operationId: string,
    required: false,
  ): Promise<AssetRow | null>;
  private async lockAssetByOperation(
    transaction: SqlExecutor,
    operationId: string,
    required: boolean,
  ): Promise<AssetRow | null> {
    const result = await transaction.query<AssetRow>(
      "SELECT * FROM fusion_engine.operation_assets WHERE operation_id = $1 FOR UPDATE",
      [operationId],
    );
    if (!result.rows[0] && required) throw new Error("operation_asset_not_found");
    return result.rows[0] ?? null;
  }

  private async lockReservation(transaction: SqlExecutor, operationId: string): Promise<ReservationRow> {
    const result = await transaction.query<ReservationRow>(
      "SELECT * FROM fusion_engine.credit_reservations WHERE operation_id = $1 FOR UPDATE",
      [operationId],
    );
    if (!result.rows[0]) throw new Error("credit_reservation_not_found");
    return result.rows[0];
  }

  private async requireOperation(executor: SqlExecutor, operationId: string): Promise<DurableOperationView> {
    const result = await executor.query<OperationRow>(
      "SELECT * FROM fusion_engine.operations WHERE id = $1",
      [operationId],
    );
    if (!result.rows[0]) throw new Error("operation_not_found");
    return view(result.rows[0]);
  }
}
