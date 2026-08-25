// @vitest-environment node

import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import type { TransactionalSqlClient } from "./postgres-atomic.ts";
import { PostgresProviderWebhookInbox } from "./postgres-provider-webhook-inbox.ts";

const schemaSql = await readFile(new URL("../sql/001_generation_v2_durability.sql", import.meta.url), "utf8");
const databases: PGlite[] = [];

function client(database: PGlite): TransactionalSqlClient {
  return database as unknown as TransactionalSqlClient;
}

async function setup() {
  const database = await PGlite.create();
  databases.push(database);
  await database.exec(schemaSql);
  return new PostgresProviderWebhookInbox(client(database), () => new Date("2026-08-22T10:00:00.000Z"));
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("durable provider webhook inbox", () => {
  it("accepts one verified delivery and treats identical raw bytes as a durable duplicate", async () => {
    const inbox = await setup();
    const body = new TextEncoder().encode('{"taskId":"kie-task-1","status":"success"}');
    const input = {
      providerId: "kie",
      deliveryId: "kie-task-1.1786536000",
      taskId: "kie-task-1",
      rawBody: body,
      payload: { taskId: "kie-task-1", status: "success" },
    };
    await expect(inbox.receiveVerified(input)).resolves.toMatchObject({
      kind: "ACCEPTED",
      receipt: { status: "RECEIVED", taskId: "kie-task-1" },
    });
    await expect(inbox.receiveVerified(input)).resolves.toMatchObject({
      kind: "DUPLICATE",
      receipt: { status: "RECEIVED" },
    });
  });

  it("fails closed when a delivery identity is reused with different task evidence or raw bytes", async () => {
    const inbox = await setup();
    await inbox.receiveVerified({
      providerId: "openrouter",
      deliveryId: "video-1-completed",
      taskId: "video-1",
      rawBody: new TextEncoder().encode('{"id":"video-1","status":"completed"}'),
      payload: { id: "video-1", status: "completed" },
    });
    await expect(inbox.receiveVerified({
      providerId: "openrouter",
      deliveryId: "video-1-completed",
      taskId: "video-2",
      rawBody: new TextEncoder().encode('{"id":"video-2","status":"completed"}'),
      payload: { id: "video-2", status: "completed" },
    })).rejects.toMatchObject({ code: "WEBHOOK_DELIVERY_CONFLICT" });
  });

  it("permits exactly one consumer and retains a terminal audited receipt", async () => {
    const inbox = await setup();
    const input = {
      providerId: "kie",
      deliveryId: "kie-task-2.1786536000",
      taskId: "kie-task-2",
      rawBody: new TextEncoder().encode('{"taskId":"kie-task-2"}'),
      payload: { taskId: "kie-task-2" },
    };
    await inbox.receiveVerified(input);
    await expect(inbox.claim({ providerId: input.providerId, deliveryId: input.deliveryId, consumerId: "webhook-worker-a" }))
      .resolves.toMatchObject({ kind: "CLAIMED", receipt: { status: "PROCESSING", consumerId: "webhook-worker-a" } });
    await expect(inbox.claim({ providerId: input.providerId, deliveryId: input.deliveryId, consumerId: "webhook-worker-b" }))
      .resolves.toMatchObject({ kind: "IN_PROGRESS" });
    await expect(inbox.complete({ providerId: input.providerId, deliveryId: input.deliveryId, consumerId: "webhook-worker-b" }))
      .rejects.toMatchObject({ code: "WEBHOOK_INBOX_STATE_CONFLICT" });
    await expect(inbox.complete({ providerId: input.providerId, deliveryId: input.deliveryId, consumerId: "webhook-worker-a" }))
      .resolves.toMatchObject({ status: "PROCESSED", consumerId: "webhook-worker-a" });
    await expect(inbox.claim({ providerId: input.providerId, deliveryId: input.deliveryId, consumerId: "webhook-worker-c" }))
      .resolves.toMatchObject({ kind: "TERMINAL", receipt: { status: "PROCESSED" } });
  });
});
