import { createHash } from "node:crypto";

export type SqlResult<Row> = { rows: Row[]; affectedRows?: number };

export interface SqlExecutor {
  query<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<SqlResult<Row>>;
  exec(sql: string): Promise<unknown>;
}

export interface TransactionalSqlClient extends SqlExecutor {
  transaction<Result>(work: (transaction: SqlExecutor) => Promise<Result>): Promise<Result>;
}

export class PostgresAtomicError extends Error {
  constructor(
    readonly code:
      | "QUOTE_NOT_FOUND"
      | "QUOTE_EXPIRED"
      | "QUOTE_CONSUMED_CONFLICT"
      | "IDEMPOTENCY_CONFLICT"
      | "GENERATION_INTENT_CONFLICT"
      | "INSUFFICIENT_CREDITS",
    message: string,
  ) {
    super(message);
    this.name = "PostgresAtomicError";
  }
}

type StoredOperation = {
  id: string;
  owner_id: string;
  quote_id: string;
  generation_intent_id: string;
  request_hash: string;
  state: string;
  state_version: string | number | bigint;
  customer_credits: string | number | bigint;
  created_at: string | Date;
  updated_at: string | Date;
};

type StoredQuote = {
  id: string;
  owner_id: string;
  request_hash: string;
  customer_credits: string | number | bigint;
  state: string;
  consumed_operation_id: string | null;
  expires_at: string | Date;
};

export type DurableOperationView = {
  id: string;
  ownerId: string;
  quoteId: string;
  generationIntentId: string;
  requestHash: string;
  state: string;
  stateVersion: number;
  customerCredits: number;
  createdAt: string;
  updatedAt: string;
};

/** Immutable routing evidence pinned before any customer credit reservation. */
export type RouteExecutionEvidence = {
  routeId: string;
  providerId: string;
  providerAccountId: string;
  providerAccountScope: "LOCAL_TEST_ONLY" | "PRODUCTION";
  providerModelBindingId: string;
  providerModelId: string;
  catalogSnapshotId: string;
  catalogSnapshotHash: string;
  providerCostVersionId: string;
  providerCostVersion: string;
  adapterVersion: string;
  usageExtractorVersion: string;
  certificationLifecycle: string;
  /** Legacy local fixtures omit this. Customer traffic must use PUBLISHED_OFFER. */
  dispatchSource?: "LOCAL_TEST" | "PUBLISHED_OFFER";
  publishedOfferId?: string;
  releaseBundleId?: string;
  releaseBundleVersion?: number;
  evidenceSha256: string;
};

function assertExecutionEvidence(value: RouteExecutionEvidence): void {
  const textFields = [
    value.routeId, value.providerId, value.providerAccountId, value.providerModelBindingId,
    value.providerModelId, value.catalogSnapshotId, value.providerCostVersionId,
    value.providerCostVersion, value.adapterVersion, value.usageExtractorVersion,
    value.certificationLifecycle,
  ];
  if (textFields.some((field) => !field || field.length > 300)
    || !["LOCAL_TEST_ONLY", "PRODUCTION"].includes(value.providerAccountScope)
    || !/^[a-f0-9]{64}$/.test(value.catalogSnapshotHash)
    || !/^[a-f0-9]{64}$/.test(value.evidenceSha256)) {
    throw new TypeError("invalid_route_execution_evidence");
  }
  if (value.dispatchSource === "PUBLISHED_OFFER") {
    const releaseBundleVersion = value.releaseBundleVersion;
    if (!value.publishedOfferId || !value.releaseBundleId || !Number.isSafeInteger(releaseBundleVersion) || (releaseBundleVersion ?? 0) < 1) {
      throw new TypeError("published_offer_execution_evidence_incomplete");
    }
  } else if (value.dispatchSource !== undefined && value.dispatchSource !== "LOCAL_TEST") {
    throw new TypeError("invalid_route_execution_source");
  }
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function whole(value: string | number | bigint): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("unsafe_whole_credit_value");
  return parsed;
}

function operationView(row: StoredOperation): DurableOperationView {
  return {
    id: row.id,
    ownerId: row.owner_id,
    quoteId: row.quote_id,
    generationIntentId: row.generation_intent_id,
    requestHash: row.request_hash,
    state: row.state,
    stateVersion: whole(row.state_version),
    customerCredits: whole(row.customer_credits),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function evidenceHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class PostgresAtomicGenerationRepository {
  constructor(
    private readonly database: TransactionalSqlClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issueQuote(input: {
    id: string;
    ownerId: string;
    requestHash: string;
    customerCredits: number;
    expiresAt: string;
    metadata?: {
      projectId: string;
      recipeId: string;
      providerId: string;
      providerRequestTemplate: Record<string, unknown>;
      pricingSnapshot: Record<string, unknown>;
      executionEvidence: RouteExecutionEvidence;
    };
  }): Promise<void> {
    if (input.metadata) {
      if (!input.metadata.projectId.trim() || !input.metadata.recipeId.trim() || !input.metadata.providerId.trim()) {
        throw new TypeError("invalid_generation_quote_metadata");
      }
      assertExecutionEvidence(input.metadata.executionEvidence);
      if (input.metadata.executionEvidence.providerId !== input.metadata.providerId) {
        throw new TypeError("provider_execution_evidence_mismatch");
      }
    }
    await this.database.transaction(async (transaction) => {
      const createdAt = this.now().toISOString();
      await transaction.query(
        `INSERT INTO fusion_engine.quotes
         (id, owner_id, request_hash, customer_credits, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [input.id, input.ownerId, input.requestHash, input.customerCredits, input.expiresAt, createdAt],
      );
      if (input.metadata) {
        await transaction.query(
          `INSERT INTO fusion_engine.generation_quote_metadata
           (quote_id, owner_id, project_id, recipe_id, provider_id, provider_request_template, pricing_snapshot, execution_evidence, created_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)`,
          [
            input.id, input.ownerId, input.metadata.projectId, input.metadata.recipeId, input.metadata.providerId,
            JSON.stringify(input.metadata.providerRequestTemplate), JSON.stringify(input.metadata.pricingSnapshot),
            JSON.stringify(input.metadata.executionEvidence), createdAt,
          ],
        );
      }
    });
  }

  async grantCredits(input: {
    ownerId: string;
    credits: number;
    journalId: string;
    commandId: string;
    reasonCode: string;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO fusion_engine.wallets (owner_id, available_credits, updated_at)
         VALUES ($1, 0, $2)
         ON CONFLICT (owner_id) DO NOTHING`,
        [input.ownerId, this.now().toISOString()],
      );
      await transaction.query(
        `UPDATE fusion_engine.wallets
         SET available_credits = available_credits + $2::bigint, version = version + 1, updated_at = $3
         WHERE owner_id = $1`,
        [input.ownerId, input.credits, this.now().toISOString()],
      );
      await transaction.query(
        `INSERT INTO fusion_engine.ledger_journals
         (id, command_id, kind, operation_id, reason_code, created_at)
         VALUES ($1, $2, 'GRANT', NULL, $3, $4)`,
        [input.journalId, input.commandId, input.reasonCode, this.now().toISOString()],
      );
      await transaction.query(
        `INSERT INTO fusion_engine.ledger_entries (journal_id, account_id, amount, created_at)
         VALUES ($1, 'platform:issued', -($2::bigint), $4), ($1, $3, $2::bigint, $4)`,
        [input.journalId, input.credits, `owner:${input.ownerId}:available`, this.now().toISOString()],
      );
    });
  }

  /**
   * Creates a development grant once.  The journal command is the idempotency
   * boundary: a restart or concurrent request must never mint the balance a
   * second time.
   */
  async grantCreditsOnce(input: {
    ownerId: string;
    credits: number;
    journalId: string;
    commandId: string;
    reasonCode: string;
  }): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const occurredAt = this.now().toISOString();
      const journal = await transaction.query<{ id: string }>(
        `INSERT INTO fusion_engine.ledger_journals
         (id, command_id, kind, operation_id, reason_code, created_at)
         VALUES ($1, $2, 'GRANT', NULL, $3, $4)
         ON CONFLICT (command_id) DO NOTHING
         RETURNING id`,
        [input.journalId, input.commandId, input.reasonCode, occurredAt],
      );
      if (!journal.rows[0]) return false;
      await transaction.query(
        `INSERT INTO fusion_engine.wallets (owner_id, available_credits, updated_at)
         VALUES ($1, 0, $2)
         ON CONFLICT (owner_id) DO NOTHING`,
        [input.ownerId, occurredAt],
      );
      await transaction.query(
        `UPDATE fusion_engine.wallets
         SET available_credits = available_credits + $2::bigint, version = version + 1, updated_at = $3
         WHERE owner_id = $1`,
        [input.ownerId, input.credits, occurredAt],
      );
      await transaction.query(
        `INSERT INTO fusion_engine.ledger_entries (journal_id, account_id, amount, created_at)
         VALUES ($1, 'platform:issued', -($2::bigint), $4), ($1, $3, $2::bigint, $4)`,
        [input.journalId, input.credits, `owner:${input.ownerId}:available`, occurredAt],
      );
      return true;
    });
  }

  async commitGeneration(input: {
    operationId: string;
    reservationId: string;
    journalId: string;
    journalCommandId: string;
    operationEventId: string;
    outboxEventId: string;
    ownerId: string;
    quoteId: string;
    generationIntentId: string;
    idempotencyKey: string;
    route: string;
    requestHash: string;
    outboxPayload: Record<string, unknown>;
  }): Promise<{ kind: "CREATED" | "REPLAY"; operation: DurableOperationView }> {
    return this.database.transaction(async (transaction) => {
      const quoteResult = await transaction.query<StoredQuote>(
        `SELECT id, owner_id, request_hash, customer_credits, state, consumed_operation_id, expires_at
         FROM fusion_engine.quotes WHERE id = $1 FOR UPDATE`,
        [input.quoteId],
      );
      const quote = quoteResult.rows[0];
      if (!quote || quote.owner_id !== input.ownerId) {
        throw new PostgresAtomicError("QUOTE_NOT_FOUND", "Quote not found.");
      }

      if (quote.consumed_operation_id) {
        const replay = await this.requireOperation(transaction, quote.consumed_operation_id);
        if (replay.requestHash !== input.requestHash || replay.ownerId !== input.ownerId) {
          throw new PostgresAtomicError("QUOTE_CONSUMED_CONFLICT", "Quote was consumed by different input.");
        }
        return { kind: "REPLAY", operation: replay };
      }
      if (quote.request_hash !== input.requestHash) {
        throw new PostgresAtomicError("QUOTE_CONSUMED_CONFLICT", "Quote hash does not match the generation request.");
      }
      if (new Date(quote.expires_at).getTime() <= this.now().getTime()) {
        throw new PostgresAtomicError("QUOTE_EXPIRED", "Quote expired.");
      }

      const intent = await transaction.query<StoredOperation>(
        `SELECT * FROM fusion_engine.operations WHERE generation_intent_id = $1`,
        [input.generationIntentId],
      );
      if (intent.rows[0]) {
        const existing = operationView(intent.rows[0]);
        if (existing.quoteId !== input.quoteId || existing.requestHash !== input.requestHash) {
          throw new PostgresAtomicError("GENERATION_INTENT_CONFLICT", "GenerationIntent is bound to different input.");
        }
        return { kind: "REPLAY", operation: existing };
      }

      const binding = await transaction.query<{ request_hash: string; operation_id: string }>(
        `SELECT request_hash, operation_id FROM fusion_engine.idempotency_bindings
         WHERE owner_id = $1 AND route = $2 AND idempotency_key = $3`,
        [input.ownerId, input.route, input.idempotencyKey],
      );
      if (binding.rows[0]) {
        if (binding.rows[0].request_hash !== input.requestHash) {
          throw new PostgresAtomicError("IDEMPOTENCY_CONFLICT", "Idempotency key is bound to different input.");
        }
        return { kind: "REPLAY", operation: await this.requireOperation(transaction, binding.rows[0].operation_id) };
      }

      const walletResult = await transaction.query<{
        available_credits: string | number | bigint;
      }>(
        `SELECT available_credits FROM fusion_engine.wallets WHERE owner_id = $1 FOR UPDATE`,
        [input.ownerId],
      );
      const credits = whole(quote.customer_credits);
      if (!walletResult.rows[0] || whole(walletResult.rows[0].available_credits) < credits) {
        throw new PostgresAtomicError("INSUFFICIENT_CREDITS", "Wallet has insufficient credits.");
      }

      const occurredAt = this.now().toISOString();
      await transaction.query(
        `INSERT INTO fusion_engine.operations
         (id, owner_id, quote_id, generation_intent_id, request_hash, state, state_version, customer_credits, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'RESERVED', 0, $6::bigint, $7, $7)`,
        [input.operationId, input.ownerId, input.quoteId, input.generationIntentId, input.requestHash, credits, occurredAt],
      );
      await transaction.query(
        `INSERT INTO fusion_engine.credit_reservations
         (id, operation_id, quote_id, owner_id, quoted_credits, held_credits, state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::bigint, $5::bigint, 'HELD', $6, $6)`,
        [input.reservationId, input.operationId, input.quoteId, input.ownerId, credits, occurredAt],
      );
      await transaction.query(
        `UPDATE fusion_engine.wallets
         SET available_credits = available_credits - $2::bigint,
             held_credits = held_credits + $2::bigint,
             version = version + 1,
             updated_at = $3
         WHERE owner_id = $1`,
        [input.ownerId, credits, occurredAt],
      );
      await transaction.query(
        `INSERT INTO fusion_engine.ledger_journals
         (id, command_id, kind, operation_id, reason_code, created_at)
         VALUES ($1, $2, 'RESERVE', $3, 'OPERATION_QUOTE_RESERVED', $4)`,
        [input.journalId, input.journalCommandId, input.operationId, occurredAt],
      );
      await transaction.query(
        `INSERT INTO fusion_engine.ledger_entries (journal_id, account_id, amount, created_at)
         VALUES ($1, $2, -($4::bigint), $5), ($1, $3, $4::bigint, $5)`,
        [
          input.journalId,
          `owner:${input.ownerId}:available`,
          `owner:${input.ownerId}:held`,
          credits,
          occurredAt,
        ],
      );
      await transaction.query(
        `INSERT INTO fusion_engine.operation_events
         (id, operation_id, sequence, state, state_version, event_name, actor, evidence_hash, occurred_at)
         VALUES ($1, $2, 0, 'RESERVED', 0, 'operation.reserved.v1', 'engine-transaction', $3, $4)`,
        [
          input.operationEventId,
          input.operationId,
          evidenceHash({ quoteId: input.quoteId, requestHash: input.requestHash, credits }),
          occurredAt,
        ],
      );
      await transaction.query(
        `INSERT INTO fusion_engine.outbox_events
         (id, aggregate_id, aggregate_version, event_name, payload, status, available_at, created_at, updated_at)
         VALUES ($1, $2, 1, 'operation.queued.v1', $3, 'PENDING', $4, $4, $4)`,
        [input.outboxEventId, input.operationId, JSON.stringify(input.outboxPayload), occurredAt],
      );
      await transaction.query(
        `INSERT INTO fusion_engine.idempotency_bindings
         (owner_id, route, idempotency_key, request_hash, operation_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [input.ownerId, input.route, input.idempotencyKey, input.requestHash, input.operationId, occurredAt],
      );
      await transaction.query(
        `UPDATE fusion_engine.quotes
         SET state = 'CONSUMED', consumed_operation_id = $2
         WHERE id = $1`,
        [input.quoteId, input.operationId],
      );

      return { kind: "CREATED", operation: await this.requireOperation(transaction, input.operationId) };
    });
  }

  async operation(operationId: string): Promise<DurableOperationView> {
    return this.requireOperation(this.database, operationId);
  }

  private async requireOperation(executor: SqlExecutor, operationId: string): Promise<DurableOperationView> {
    const result = await executor.query<StoredOperation>(
      `SELECT * FROM fusion_engine.operations WHERE id = $1`,
      [operationId],
    );
    if (!result.rows[0]) throw new Error("operation_not_found");
    return operationView(result.rows[0]);
  }
}
