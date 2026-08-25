// @vitest-environment node

import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  PostgresAtomicError,
  PostgresAtomicGenerationRepository,
  type TransactionalSqlClient,
} from "./postgres-atomic.ts";

const schemaSql = await readFile(
  new URL("../sql/001_generation_v2_durability.sql", import.meta.url),
  "utf8",
);
const HASH = "a".repeat(64);
const NOW = new Date("2026-08-21T12:00:00.000Z");
const databases: PGlite[] = [];

function client(database: PGlite): TransactionalSqlClient {
  return database as unknown as TransactionalSqlClient;
}

async function database(dataDir?: string) {
  const instance = await PGlite.create(dataDir);
  databases.push(instance);
  await instance.exec(schemaSql);
  return instance;
}

function commitInput(quoteId: string, overrides: Partial<Parameters<PostgresAtomicGenerationRepository["commitGeneration"]>[0]> = {}) {
  const operationId = randomUUID();
  return {
    operationId,
    reservationId: randomUUID(),
    journalId: randomUUID(),
    journalCommandId: `reserve:${operationId}`,
    operationEventId: randomUUID(),
    outboxEventId: randomUUID(),
    ownerId: "local-user",
    quoteId,
    generationIntentId: "generation-intent-postgres-0001",
    idempotencyKey: "transport-postgres-0001",
    route: "POST /v2/operations",
    requestHash: HASH,
    outboxPayload: { operationId },
    ...overrides,
  };
}

async function seed(repository: PostgresAtomicGenerationRepository, credits = 1_000) {
  await repository.grantCredits({
    ownerId: "local-user",
    credits,
    journalId: randomUUID(),
    commandId: `opening-grant:${randomUUID()}`,
    reasonCode: "LOCAL_POSTGRES_TEST",
  });
  const quoteId = randomUUID();
  await repository.issueQuote({
    id: quoteId,
    ownerId: "local-user",
    requestHash: HASH,
    customerCredits: 4,
    expiresAt: "2026-08-21T13:00:00.000Z",
  });
  return quoteId;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (instance) => {
    try { await instance.close(); } catch { /* already closed by restart proof */ }
  }));
});

describe("PostgreSQL atomic Generation V2 repository", () => {
  it("commits 100 retries as one quote consumption, reservation, operation and outbox event", async () => {
    const pg = await database();
    const repository = new PostgresAtomicGenerationRepository(client(pg), () => NOW);
    const quoteId = await seed(repository);
    const firstInput = commitInput(quoteId);

    const results = await Promise.all(Array.from({ length: 100 }, (_, index) => repository.commitGeneration({
      ...firstInput,
      operationId: index === 0 ? firstInput.operationId : randomUUID(),
      reservationId: index === 0 ? firstInput.reservationId : randomUUID(),
      journalId: index === 0 ? firstInput.journalId : randomUUID(),
      journalCommandId: `reserve-retry:${index}`,
      operationEventId: index === 0 ? firstInput.operationEventId : randomUUID(),
      outboxEventId: index === 0 ? firstInput.outboxEventId : randomUUID(),
      idempotencyKey: `transport-postgres-${index.toString().padStart(4, "0")}`,
    })));

    expect(new Set(results.map(({ operation }) => operation.id)).size).toBe(1);
    expect(results.filter(({ kind }) => kind === "CREATED")).toHaveLength(1);
    const counts = await pg.query<{
      operations: number;
      reservations: number;
      outbox: number;
      reserve_journals: number;
    }>(`SELECT
      (SELECT count(*)::int FROM fusion_engine.operations) AS operations,
      (SELECT count(*)::int FROM fusion_engine.credit_reservations) AS reservations,
      (SELECT count(*)::int FROM fusion_engine.outbox_events) AS outbox,
      (SELECT count(*)::int FROM fusion_engine.ledger_journals WHERE kind = 'RESERVE') AS reserve_journals`);
    expect(counts.rows[0]).toEqual({ operations: 1, reservations: 1, outbox: 1, reserve_journals: 1 });
    const wallet = await pg.query<{ available_credits: number; held_credits: number; spent_credits: number }>(
      "SELECT available_credits, held_credits, spent_credits FROM fusion_engine.wallets WHERE owner_id = 'local-user'",
    );
    expect(wallet.rows[0]).toMatchObject({ available_credits: 996, held_credits: 4, spent_credits: 0 });
  }, 30_000);

  it("rolls back every durable write when the wallet cannot fund the reservation", async () => {
    const pg = await database();
    const repository = new PostgresAtomicGenerationRepository(client(pg), () => NOW);
    const quoteId = await seed(repository, 1);

    await expect(repository.commitGeneration(commitInput(quoteId)))
      .rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" } satisfies Partial<PostgresAtomicError>);
    const state = await pg.query<{ operations: number; reservations: number; outbox: number; quote_state: string }>(`SELECT
      (SELECT count(*)::int FROM fusion_engine.operations) AS operations,
      (SELECT count(*)::int FROM fusion_engine.credit_reservations) AS reservations,
      (SELECT count(*)::int FROM fusion_engine.outbox_events) AS outbox,
      (SELECT state FROM fusion_engine.quotes WHERE id = $1) AS quote_state`, [quoteId]);
    expect(state.rows[0]).toEqual({ operations: 0, reservations: 0, outbox: 0, quote_state: "ISSUED" });
    const wallet = await pg.query<{ available_credits: number; held_credits: number }>(
      "SELECT available_credits, held_credits FROM fusion_engine.wallets WHERE owner_id = 'local-user'",
    );
    expect(wallet.rows[0]).toEqual({ available_credits: 1, held_credits: 0 });
  });

  it("rejects unbalanced or mutable ledger evidence at the database boundary", async () => {
    const pg = await database();
    const journalId = randomUUID();
    await expect(pg.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO fusion_engine.ledger_journals (id, command_id, kind, reason_code)
         VALUES ($1, $2, 'ADJUSTMENT', 'UNBALANCED_TEST')`,
        [journalId, `unbalanced:${journalId}`],
      );
      await transaction.query(
        `INSERT INTO fusion_engine.ledger_entries (journal_id, account_id, amount)
         VALUES ($1, 'owner:test:available', 7)`,
        [journalId],
      );
    })).rejects.toThrow(/unbalanced_ledger_journal/);

    const repository = new PostgresAtomicGenerationRepository(client(pg), () => NOW);
    await repository.grantCredits({
      ownerId: "immutable-user",
      credits: 10,
      journalId,
      commandId: `grant:${journalId}`,
      reasonCode: "IMMUTABILITY_TEST",
    });
    await expect(pg.query(
      "UPDATE fusion_engine.ledger_journals SET reason_code = 'MUTATED' WHERE id = $1",
      [journalId],
    )).rejects.toThrow(/immutable_financial_record/);
  });

  it("survives a real local PostgreSQL filesystem close and restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-pglite-"));
    try {
      const first = await database(directory);
      const firstRepository = new PostgresAtomicGenerationRepository(client(first), () => NOW);
      const quoteId = await seed(firstRepository);
      const committed = await firstRepository.commitGeneration(commitInput(quoteId));
      await first.close();

      const second = await PGlite.create(directory);
      databases.push(second);
      const secondRepository = new PostgresAtomicGenerationRepository(client(second), () => NOW);
      const recovered = await secondRepository.operation(committed.operation.id);
      expect(recovered).toMatchObject({
        id: committed.operation.id,
        quoteId,
        generationIntentId: "generation-intent-postgres-0001",
        state: "RESERVED",
        customerCredits: 4,
      });
      const durable = await second.query<{ reservations: number; outbox: number }>(`SELECT
        (SELECT count(*)::int FROM fusion_engine.credit_reservations) AS reservations,
        (SELECT count(*)::int FROM fusion_engine.outbox_events) AS outbox`);
      expect(durable.rows[0]).toEqual({ reservations: 1, outbox: 1 });
      await second.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
