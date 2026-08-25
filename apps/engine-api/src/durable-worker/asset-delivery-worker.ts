import { createHash, randomUUID } from "node:crypto";
import { ProviderGenerationRequestSchema } from "../../../../packages/contracts/src/provider.ts";
import {
  PostgresWorkerCoordinator,
  type DurableAttemptView,
} from "../../../../packages/durable-execution/src/postgres-worker.ts";
import { PrivateMediaPipeline } from "../../../../packages/media-pipeline/src/pipeline.ts";
import { MediaPipelineError } from "../../../../packages/media-pipeline/src/types.ts";
import { ProviderRegistry } from "../../../../packages/providers/src/registry.ts";
import type { ProviderAdapter } from "../../../../packages/providers/src/types.ts";
import type { OperationProviderAdapterAccess } from "./provider-adapter-access.ts";

export type AssetDeliveryDriveResult = {
  action: "ASSET_STORED" | "DELIVERED" | "SETTLED" | "DELIVERY_FAILED_REFUNDED" | "RECONCILIATION_REQUIRED" | "TERMINAL";
  accessToken?: string;
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function errorCode(error: unknown): string {
  if (error instanceof MediaPipelineError) return error.code;
  if (error instanceof Error && error.name) return error.name.toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  return "UNKNOWN_ASSET_DELIVERY_ERROR";
}

export class DurableAssetDeliveryWorker {
  constructor(
    private readonly coordinator: PostgresWorkerCoordinator,
    private readonly providers: ProviderRegistry,
    private readonly media: PrivateMediaPipeline,
    private readonly id: () => string = randomUUID,
    private readonly adapters?: OperationProviderAdapterAccess,
  ) {}

  async driveOnce(input: { operationId: string; attemptNumber: number; projectId: string }): Promise<AssetDeliveryDriveResult> {
    const attempt = await this.coordinator.attempt(input.operationId, input.attemptNumber);
    if (attempt.operationState === "PROVIDER_SUCCEEDED") return this.ingest(input.projectId, attempt);
    if (attempt.operationState === "ASSET_STORED") return this.deliver(attempt);
    if (attempt.operationState === "DELIVERED") return this.settle(attempt);
    return { action: "TERMINAL" };
  }

  private async ingest(projectId: string, attempt: DurableAttemptView): Promise<AssetDeliveryDriveResult> {
    const request = ProviderGenerationRequestSchema.parse(attempt.requestPayload);
    if (request.mediaType === "text") {
      await this.reconcile(attempt, "TEXT_RESULT_REQUIRES_SEPARATE_DELIVERY_CONTRACT", { request });
      return { action: "RECONCILIATION_REQUIRED" };
    }
    if (!attempt.providerTaskId || !attempt.providerResultUrl) {
      await this.reconcile(attempt, "SUCCESS_EVIDENCE_MISSING_PROVIDER_TASK_OR_RESULT_URL", { attemptId: attempt.id });
      return { action: "RECONCILIATION_REQUIRED" };
    }
    const expectedMediaType = request.mediaType;
    const ownerId = await this.ownerForAttempt(attempt);
    try {
      const object = await this.withProvider(attempt, (provider) => this.media.ingestProviderResult({
        sourceUrl: attempt.providerResultUrl!,
        sourcePolicy: provider.assetSourcePolicy,
        expectedMediaType,
        ownerId,
        projectId,
        operationId: attempt.operationId,
        fetchAsset: (maxBytes) => provider.fetchAsset(attempt.providerResultUrl!, maxBytes),
      }));
      await this.coordinator.storeAsset({
        operationId: attempt.operationId,
        expectedOperationVersion: attempt.operationStateVersion,
        attemptId: attempt.id,
        assetId: this.id(),
        privateObjectId: object.id,
        objectKey: object.objectKey,
        bucket: object.bucket,
        ownerId: object.ownerId,
        projectId: object.projectId,
        mediaType: object.mediaType,
        contentType: object.contentType,
        byteLength: object.byteLength,
        checksumSha256: object.checksumSha256,
        metadata: object.metadata,
        sourceUrl: attempt.providerResultUrl,
        eventRecordId: this.id(),
        evidenceHash: hash({ objectId: object.id, checksumSha256: object.checksumSha256, sourceUrl: attempt.providerResultUrl }),
      });
      return { action: "ASSET_STORED" };
    } catch (error) {
      if (error instanceof MediaPipelineError) {
        await this.coordinator.releaseDeliveryFailure({
          operationId: attempt.operationId,
          expectedOperationState: "PROVIDER_SUCCEEDED",
          expectedOperationVersion: attempt.operationStateVersion,
          attemptId: attempt.id,
          commandId: `release-delivery-failure:${attempt.operationId}`,
          journalId: this.id(),
          eventRecordId: this.id(),
          evidenceHash: hash({ code: error.code, quarantineId: error.quarantineId, sourceUrl: attempt.providerResultUrl }),
        });
        return { action: "DELIVERY_FAILED_REFUNDED" };
      }
      await this.reconcile(attempt, `ASSET_INGEST_UNPROVEN:${errorCode(error)}`, { sourceUrl: attempt.providerResultUrl });
      return { action: "RECONCILIATION_REQUIRED" };
    }
  }

  private async deliver(attempt: DurableAttemptView): Promise<AssetDeliveryDriveResult> {
    try {
      const asset = await this.coordinator.asset(attempt.operationId);
      const accessToken = this.media.refreshAccessGrant(asset.privateObjectId, asset.ownerId, 15 * 60);
      await this.coordinator.recordDelivery({
        operationId: attempt.operationId,
        expectedOperationVersion: attempt.operationStateVersion,
        assetId: asset.id,
        deliveryId: this.id(),
        ownerId: asset.ownerId,
        evidenceHash: hash({ assetId: asset.id, checksumSha256: asset.checksumSha256, delivery: "private_owner_grant_ready" }),
        eventRecordId: this.id(),
      });
      return { action: "DELIVERED", accessToken };
    } catch (error) {
      if (error instanceof MediaPipelineError) {
        await this.coordinator.releaseDeliveryFailure({
          operationId: attempt.operationId,
          expectedOperationState: "ASSET_STORED",
          expectedOperationVersion: attempt.operationStateVersion,
          attemptId: attempt.id,
          commandId: `release-delivery-failure:${attempt.operationId}`,
          journalId: this.id(),
          eventRecordId: this.id(),
          evidenceHash: hash({ code: error.code, assetDelivery: "private_grant_failed" }),
        });
        return { action: "DELIVERY_FAILED_REFUNDED" };
      }
      await this.reconcile(attempt, `DELIVERY_UNPROVEN:${errorCode(error)}`, { operationId: attempt.operationId });
      return { action: "RECONCILIATION_REQUIRED" };
    }
  }

  private async settle(attempt: DurableAttemptView): Promise<AssetDeliveryDriveResult> {
    await this.coordinator.settleDelivered({
      operationId: attempt.operationId,
      expectedOperationVersion: attempt.operationStateVersion,
      commandId: `settle-delivery:${attempt.operationId}`,
      journalId: this.id(),
      eventRecordId: this.id(),
      evidenceHash: hash({ operationId: attempt.operationId, attemptId: attempt.id, settlement: "private_delivery_ready" }),
    });
    return { action: "SETTLED" };
  }

  private async reconcile(attempt: DurableAttemptView, code: string, evidence: unknown): Promise<void> {
    await this.coordinator.advanceAttempt({
      operationId: attempt.operationId,
      attemptNumber: attempt.attemptNumber,
      expectedOperationState: attempt.operationState,
      expectedOperationVersion: attempt.operationStateVersion,
      expectedAttemptState: "SUCCEEDED",
      expectedAttemptVersion: attempt.version,
      nextAttemptState: "RECONCILIATION_REQUIRED",
      event: "operation.reconciliation_required.v1",
      actor: "reconciler",
      eventRecordId: this.id(),
      evidenceHash: hash({ code, evidence }),
      lastErrorCode: code,
    });
  }

  private async ownerForAttempt(attempt: DurableAttemptView): Promise<string> {
    // The durable attempt intentionally does not duplicate owner data.  Asset storage
    // receives it from the locked operation view in a single coordinator read.
    return (await this.coordinator.operation(attempt.operationId)).ownerId;
  }

  private async withProvider<T>(attempt: DurableAttemptView, work: (adapter: ProviderAdapter) => Promise<T>): Promise<T> {
    if (this.adapters) return this.adapters.withAdapter({ operationId: attempt.operationId, providerId: attempt.providerId }, work);
    return work(this.providers.require(attempt.providerId));
  }
}
