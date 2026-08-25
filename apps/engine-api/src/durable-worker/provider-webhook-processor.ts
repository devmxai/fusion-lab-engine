import { randomUUID } from "node:crypto";
import { ProviderTaskResponseSchema } from "../../../../packages/contracts/src/provider.ts";
import { PostgresProviderWebhookInbox } from "../../../../packages/durable-execution/src/postgres-provider-webhook-inbox.ts";
import { PostgresWorkerCoordinator } from "../../../../packages/durable-execution/src/postgres-worker.ts";
import { ProviderRegistry } from "../../../../packages/providers/src/registry.ts";
import { DurableProviderAttemptWorker } from "./provider-attempt-worker.ts";

/**
 * Post-verification webhook consumer. The HTTP boundary verifies provider
 * signing data first; this class then makes the callback durable and fetches
 * authoritative task state. Webhook JSON never settles a wallet directly.
 */
export class DurableProviderWebhookProcessor {
  constructor(
    private readonly inbox: PostgresProviderWebhookInbox,
    private readonly coordinator: PostgresWorkerCoordinator,
    private readonly providers: ProviderRegistry,
    private readonly worker: DurableProviderAttemptWorker,
    private readonly consumerId = `provider-webhook:${randomUUID()}`,
  ) {}

  async consumeVerified(input: {
    providerId: string;
    deliveryId: string;
    taskId: string;
    rawBody: Uint8Array;
    payload: Record<string, unknown>;
  }): Promise<{ kind: "PROCESSED" | "DUPLICATE" | "DEFERRED" | "REJECTED" }> {
    const accepted = await this.inbox.receiveVerified(input);
    const claimed = await this.inbox.claim({
      providerId: input.providerId,
      deliveryId: input.deliveryId,
      consumerId: this.consumerId,
    });
    if (claimed.kind === "TERMINAL") return { kind: "DUPLICATE" };
    if (claimed.kind === "IN_PROGRESS") return { kind: "DUPLICATE" };
    const attempt = await this.coordinator.attemptByProviderTask(input.providerId, input.taskId);
    if (!attempt) {
      await this.inbox.reject({
        providerId: input.providerId,
        deliveryId: input.deliveryId,
        consumerId: this.consumerId,
        rejectionCode: "UNMATCHED_PROVIDER_TASK",
      });
      return { kind: "REJECTED" };
    }
    try {
      const authoritative = ProviderTaskResponseSchema.parse(
        await this.providers.require(input.providerId).getTask(input.taskId),
      );
      if (authoritative.taskId !== input.taskId) {
        await this.inbox.reject({
          providerId: input.providerId,
          deliveryId: input.deliveryId,
          consumerId: this.consumerId,
          rejectionCode: "AUTHORITATIVE_TASK_MISMATCH",
        });
        return { kind: "REJECTED" };
      }
      // The durable worker owns all operation and ledger transitions. Calling
      // it here only wakes normal polling; it does not trust callback body.
      await this.worker.driveOnce(attempt.operationId, attempt.attemptNumber);
      await this.inbox.complete({ providerId: input.providerId, deliveryId: input.deliveryId, consumerId: this.consumerId });
      return { kind: accepted.kind === "DUPLICATE" ? "DUPLICATE" : "PROCESSED" };
    } catch {
      await this.inbox.defer({ providerId: input.providerId, deliveryId: input.deliveryId, consumerId: this.consumerId });
      return { kind: "DEFERRED" };
    }
  }
}
