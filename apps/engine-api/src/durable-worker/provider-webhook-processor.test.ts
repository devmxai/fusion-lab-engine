// @vitest-environment node

import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransactionalSqlClient } from "../../../../packages/durable-execution/src/postgres-atomic.ts";
import { PostgresProviderWebhookInbox } from "../../../../packages/durable-execution/src/postgres-provider-webhook-inbox.ts";
import { PostgresWorkerCoordinator } from "../../../../packages/durable-execution/src/postgres-worker.ts";
import { ProviderRegistry } from "../../../../packages/providers/src/registry.ts";
import { FakeProviderAdapter } from "../test/fake-provider-adapter.ts";
import { DurableProviderAttemptWorker } from "./provider-attempt-worker.ts";
import { DurableProviderWebhookProcessor } from "./provider-webhook-processor.ts";

const schemaSql = await readFile(new URL("../../../../packages/durable-execution/sql/001_generation_v2_durability.sql", import.meta.url), "utf8");
const databases: PGlite[] = [];

afterEach(async () => { await Promise.all(databases.splice(0).map((database) => database.close())); });

describe("durable provider webhook processor", () => {
  it("stores a verified unmatched callback as rejected without calling a provider or a financial path", async () => {
    const database = await PGlite.create();
    databases.push(database);
    await database.exec(schemaSql);
    const sql = database as unknown as TransactionalSqlClient;
    const providers = new ProviderRegistry();
    const adapter = new FakeProviderAdapter();
    const taskLookup = vi.spyOn(adapter, "getTask");
    providers.register(adapter);
    const coordinator = new PostgresWorkerCoordinator(sql);
    const processor = new DurableProviderWebhookProcessor(
      new PostgresProviderWebhookInbox(sql),
      coordinator,
      providers,
      new DurableProviderAttemptWorker(coordinator, providers),
      "webhook-test-worker",
    );
    await expect(processor.consumeVerified({
      providerId: "provider-test",
      deliveryId: "provider-test-task-unknown.completed",
      taskId: "provider-test-task-unknown",
      rawBody: new TextEncoder().encode('{"taskId":"provider-test-task-unknown"}'),
      payload: { taskId: "provider-test-task-unknown" },
    })).resolves.toEqual({ kind: "REJECTED" });
    expect(taskLookup).not.toHaveBeenCalled();
    const receipt = await database.query<{ status: string; rejection_code: string }>(
      "SELECT status, rejection_code FROM fusion_engine.provider_webhook_inbox",
    );
    expect(receipt.rows[0]).toEqual({ status: "REJECTED", rejection_code: "UNMATCHED_PROVIDER_TASK" });
  });
});
