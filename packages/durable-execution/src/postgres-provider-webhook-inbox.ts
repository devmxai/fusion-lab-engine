import { createHash } from "node:crypto";
import type { TransactionalSqlClient } from "./postgres-atomic.js";

export type ProviderWebhookInboxStatus = "RECEIVED" | "PROCESSING" | "PROCESSED" | "REJECTED";

type ProviderWebhookInboxRow = {
  provider_id: string;
  delivery_id: string;
  task_id: string;
  payload_hash: string;
  payload: Record<string, unknown> | string;
  status: ProviderWebhookInboxStatus;
  consumer_id: string | null;
  received_at: string | Date;
  processing_started_at: string | Date | null;
  processed_at: string | Date | null;
  rejection_code: string | null;
};

export type ProviderWebhookInboxView = {
  providerId: string;
  deliveryId: string;
  taskId: string;
  payloadHash: string;
  payload: Record<string, unknown>;
  status: ProviderWebhookInboxStatus;
  consumerId: string | null;
  receivedAt: string;
  processingStartedAt: string | null;
  processedAt: string | null;
  rejectionCode: string | null;
};

export class ProviderWebhookInboxError extends Error {
  constructor(
    readonly code: "WEBHOOK_DELIVERY_CONFLICT" | "WEBHOOK_INBOX_STATE_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "ProviderWebhookInboxError";
  }
}

function iso(value: string | Date | null): string | null {
  return value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function object(value: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  return value;
}

function view(row: ProviderWebhookInboxRow): ProviderWebhookInboxView {
  return {
    providerId: row.provider_id,
    deliveryId: row.delivery_id,
    taskId: row.task_id,
    payloadHash: row.payload_hash,
    payload: structuredClone(object(row.payload)),
    status: row.status,
    consumerId: row.consumer_id,
    receivedAt: iso(row.received_at)!,
    processingStartedAt: iso(row.processing_started_at),
    processedAt: iso(row.processed_at),
    rejectionCode: row.rejection_code,
  };
}

function assertText(name: string, value: string, max: number): void {
  if (!value || value.length > max) throw new TypeError(`invalid_${name}`);
}

function payloadHash(rawBody: Uint8Array): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

/**
 * Durable boundary for externally signed provider deliveries.  Signature
 * verification happens before `receiveVerified`; duplicate/replay decisions
 * happen here and survive restart.  A received webhook only wakes an
 * authoritative provider fetch; it is never direct financial evidence.
 */
export class PostgresProviderWebhookInbox {
  constructor(
    private readonly database: TransactionalSqlClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async receiveVerified(input: {
    providerId: string;
    deliveryId: string;
    taskId: string;
    rawBody: Uint8Array;
    payload: Record<string, unknown>;
  }): Promise<{ kind: "ACCEPTED" | "DUPLICATE"; receipt: ProviderWebhookInboxView }> {
    assertText("provider_id", input.providerId, 100);
    assertText("delivery_id", input.deliveryId, 300);
    assertText("task_id", input.taskId, 300);
    const hash = payloadHash(input.rawBody);
    const receivedAt = this.now().toISOString();
    return this.database.transaction(async (transaction) => {
      const existing = await transaction.query<ProviderWebhookInboxRow>(
        `SELECT * FROM fusion_engine.provider_webhook_inbox
         WHERE provider_id = $1 AND delivery_id = $2 FOR UPDATE`,
        [input.providerId, input.deliveryId],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.task_id !== input.taskId || row.payload_hash !== hash) {
          throw new ProviderWebhookInboxError(
            "WEBHOOK_DELIVERY_CONFLICT",
            "Provider delivery identity was replayed with different task or raw payload bytes.",
          );
        }
        return { kind: "DUPLICATE" as const, receipt: view(row) };
      }
      await transaction.query(
        `INSERT INTO fusion_engine.provider_webhook_inbox
         (provider_id, delivery_id, task_id, payload_hash, payload, status, received_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'RECEIVED', $6)`,
        [input.providerId, input.deliveryId, input.taskId, hash, JSON.stringify(input.payload), receivedAt],
      );
      const created = await transaction.query<ProviderWebhookInboxRow>(
        `SELECT * FROM fusion_engine.provider_webhook_inbox
         WHERE provider_id = $1 AND delivery_id = $2`,
        [input.providerId, input.deliveryId],
      );
      return { kind: "ACCEPTED" as const, receipt: view(created.rows[0]!)};
    });
  }

  async claim(input: { providerId: string; deliveryId: string; consumerId: string }): Promise<{
    kind: "CLAIMED" | "IN_PROGRESS" | "TERMINAL";
    receipt: ProviderWebhookInboxView;
  }> {
    assertText("provider_id", input.providerId, 100);
    assertText("delivery_id", input.deliveryId, 300);
    assertText("consumer_id", input.consumerId, 200);
    return this.database.transaction(async (transaction) => {
      const result = await transaction.query<ProviderWebhookInboxRow>(
        `SELECT * FROM fusion_engine.provider_webhook_inbox
         WHERE provider_id = $1 AND delivery_id = $2 FOR UPDATE`,
        [input.providerId, input.deliveryId],
      );
      const row = result.rows[0];
      if (!row) throw new ProviderWebhookInboxError("WEBHOOK_INBOX_STATE_CONFLICT", "Webhook delivery was not accepted.");
      if (row.status === "PROCESSING") return { kind: "IN_PROGRESS" as const, receipt: view(row) };
      if (row.status === "PROCESSED" || row.status === "REJECTED") return { kind: "TERMINAL" as const, receipt: view(row) };
      const startedAt = this.now().toISOString();
      await transaction.query(
        `UPDATE fusion_engine.provider_webhook_inbox
         SET status = 'PROCESSING', consumer_id = $3, processing_started_at = $4
         WHERE provider_id = $1 AND delivery_id = $2 AND status = 'RECEIVED'`,
        [input.providerId, input.deliveryId, input.consumerId, startedAt],
      );
      const claimed = await transaction.query<ProviderWebhookInboxRow>(
        `SELECT * FROM fusion_engine.provider_webhook_inbox
         WHERE provider_id = $1 AND delivery_id = $2`,
        [input.providerId, input.deliveryId],
      );
      return { kind: "CLAIMED" as const, receipt: view(claimed.rows[0]!)};
    });
  }

  async complete(input: { providerId: string; deliveryId: string; consumerId: string }): Promise<ProviderWebhookInboxView> {
    return this.transitionTerminal(input, "PROCESSED");
  }

  async defer(input: { providerId: string; deliveryId: string; consumerId: string }): Promise<ProviderWebhookInboxView> {
    assertText("provider_id", input.providerId, 100);
    assertText("delivery_id", input.deliveryId, 300);
    assertText("consumer_id", input.consumerId, 200);
    return this.database.transaction(async (transaction) => {
      const result = await transaction.query<ProviderWebhookInboxRow>(
        `SELECT * FROM fusion_engine.provider_webhook_inbox
         WHERE provider_id = $1 AND delivery_id = $2 FOR UPDATE`,
        [input.providerId, input.deliveryId],
      );
      const row = result.rows[0];
      if (!row || row.status !== "PROCESSING" || row.consumer_id !== input.consumerId) {
        throw new ProviderWebhookInboxError("WEBHOOK_INBOX_STATE_CONFLICT", "Only the active webhook consumer may defer a delivery.");
      }
      await transaction.query(
        `UPDATE fusion_engine.provider_webhook_inbox
         SET status = 'RECEIVED', consumer_id = NULL, processing_started_at = NULL
         WHERE provider_id = $1 AND delivery_id = $2 AND consumer_id = $3 AND status = 'PROCESSING'`,
        [input.providerId, input.deliveryId, input.consumerId],
      );
      const deferred = await transaction.query<ProviderWebhookInboxRow>(
        `SELECT * FROM fusion_engine.provider_webhook_inbox
         WHERE provider_id = $1 AND delivery_id = $2`,
        [input.providerId, input.deliveryId],
      );
      return view(deferred.rows[0]!);
    });
  }

  async reject(input: { providerId: string; deliveryId: string; consumerId: string; rejectionCode: string }): Promise<ProviderWebhookInboxView> {
    assertText("rejection_code", input.rejectionCode, 200);
    return this.transitionTerminal(input, "REJECTED", input.rejectionCode);
  }

  private async transitionTerminal(
    input: { providerId: string; deliveryId: string; consumerId: string },
    status: "PROCESSED" | "REJECTED",
    rejectionCode?: string,
  ): Promise<ProviderWebhookInboxView> {
    assertText("provider_id", input.providerId, 100);
    assertText("delivery_id", input.deliveryId, 300);
    assertText("consumer_id", input.consumerId, 200);
    return this.database.transaction(async (transaction) => {
      const result = await transaction.query<ProviderWebhookInboxRow>(
        `SELECT * FROM fusion_engine.provider_webhook_inbox
         WHERE provider_id = $1 AND delivery_id = $2 FOR UPDATE`,
        [input.providerId, input.deliveryId],
      );
      const row = result.rows[0];
      if (!row || row.status !== "PROCESSING" || row.consumer_id !== input.consumerId) {
        throw new ProviderWebhookInboxError("WEBHOOK_INBOX_STATE_CONFLICT", "Only the active webhook consumer may finalize a delivery.");
      }
      const processedAt = this.now().toISOString();
      await transaction.query(
        `UPDATE fusion_engine.provider_webhook_inbox
         SET status = $4,
             consumer_id = CASE WHEN $4 = 'REJECTED' THEN NULL ELSE consumer_id END,
             processing_started_at = CASE WHEN $4 = 'REJECTED' THEN NULL ELSE processing_started_at END,
             processed_at = $5, rejection_code = $6
         WHERE provider_id = $1 AND delivery_id = $2 AND consumer_id = $3 AND status = 'PROCESSING'`,
        [input.providerId, input.deliveryId, input.consumerId, status, processedAt, rejectionCode ?? null],
      );
      const finalized = await transaction.query<ProviderWebhookInboxRow>(
        `SELECT * FROM fusion_engine.provider_webhook_inbox
         WHERE provider_id = $1 AND delivery_id = $2`,
        [input.providerId, input.deliveryId],
      );
      return view(finalized.rows[0]!);
    });
  }
}
