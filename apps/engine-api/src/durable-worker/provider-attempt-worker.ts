import { createHash, randomUUID } from "node:crypto";
import {
  ProviderGenerationRequestSchema,
  ProviderSubmitResponseSchema,
  ProviderTaskResponseSchema,
  type ProviderTaskResponse,
} from "../../../../packages/contracts/src/provider.js";
import {
  PostgresWorkerCoordinator,
  PostgresWorkerError,
  type DurableAttemptView,
} from "../../../../packages/durable-execution/src/postgres-worker.js";
import { ProviderRegistry } from "../../../../packages/providers/src/registry.js";
import {
  ProviderDefinitiveError,
  ProviderSubmissionUnknownError,
  type ProviderAdapter,
} from "../../../../packages/providers/src/types.js";
import type { OperationProviderAdapterAccess } from "./provider-adapter-access.js";

export type ProviderAttemptDriveResult = {
  action:
    | "SUBMITTED"
    | "SUBMISSION_UNKNOWN"
    | "LOOKUP_WAITING"
    | "LOOKUP_RECOVERED"
    | "POLL_WAITING"
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "RECONCILIATION_REQUIRED"
    | "TERMINAL"
    | "CONCURRENT_PROGRESS";
  attempt: DurableAttemptView;
};

function evidenceHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function errorCode(error: unknown): string {
  if (error instanceof ProviderDefinitiveError) return error.code;
  if (error instanceof Error && error.name) return error.name.toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  return "UNKNOWN_PROVIDER_ERROR";
}

function isAttemptCas(error: unknown): boolean {
  return error instanceof PostgresWorkerError
    && (error.code === "ATTEMPT_CONFLICT" || error.code === "OPERATION_CAS_CONFLICT");
}

export class DurableProviderAttemptWorker {
  constructor(
    private readonly coordinator: PostgresWorkerCoordinator,
    private readonly providers: ProviderRegistry,
    private readonly maxUnknownLookups = 3,
    private readonly id: () => string = randomUUID,
    private readonly adapters?: OperationProviderAdapterAccess,
  ) {
    if (!Number.isSafeInteger(maxUnknownLookups) || maxUnknownLookups < 1) {
      throw new TypeError("invalid_max_unknown_lookups");
    }
  }

  async driveOnce(operationId: string, attemptNumber: number): Promise<ProviderAttemptDriveResult> {
    try {
      const attempt = await this.coordinator.attempt(operationId, attemptNumber);
      if (attempt.state === "DISPATCHING") return await this.submit(attempt);
      if (attempt.state === "SUBMISSION_UNKNOWN") return await this.lookup(attempt);
      if (attempt.state === "SUBMITTED" || attempt.state === "RUNNING") return await this.poll(attempt);
      if (attempt.state === "FAILED" && attempt.operationState === "PROVIDER_FAILED") return await this.finalizeProviderFailure(attempt);
      return { action: "TERMINAL", attempt };
    } catch (error) {
      if (!isAttemptCas(error)) throw error;
      return {
        action: "CONCURRENT_PROGRESS",
        attempt: await this.coordinator.attempt(operationId, attemptNumber),
      };
    }
  }

  async timeoutIfExpired(operationId: string, attemptNumber: number, now = Date.now()): Promise<ProviderAttemptDriveResult> {
    try {
      const attempt = await this.coordinator.attempt(operationId, attemptNumber);
      if (!["DISPATCHING", "SUBMISSION_UNKNOWN", "SUBMITTED", "RUNNING"].includes(attempt.state)) {
        return { action: "TERMINAL", attempt };
      }
      if (Date.parse(attempt.dispatchDeadlineAt) > now) return { action: "POLL_WAITING", attempt };
      return await this.reconcile(attempt, "PROVIDER_TIMEOUT_AFTER_DEADLINE");
    } catch (error) {
      if (!isAttemptCas(error)) throw error;
      return { action: "CONCURRENT_PROGRESS", attempt: await this.coordinator.attempt(operationId, attemptNumber) };
    }
  }

  private async submit(attempt: DurableAttemptView): Promise<ProviderAttemptDriveResult> {
    const request = ProviderGenerationRequestSchema.parse(attempt.requestPayload);
    const claimed = await this.coordinator.claimSubmission({
      operationId: attempt.operationId,
      attemptNumber: attempt.attemptNumber,
      expectedOperationVersion: attempt.operationStateVersion,
      expectedAttemptVersion: attempt.version,
      eventRecordId: this.id(),
      evidenceHash: evidenceHash({
        protocol: "write-ahead-provider-submit-v1",
        providerId: attempt.providerId,
        providerIdempotencyKey: attempt.providerIdempotencyKey,
        requestHash: attempt.requestHash,
      }),
    });

    try {
      const response = ProviderSubmitResponseSchema.parse(
        await this.withProvider(attempt, (provider) => provider.submit(request, attempt.providerIdempotencyKey)),
      );
      const persisted = await this.coordinator.advanceAttempt({
        operationId: attempt.operationId,
        attemptNumber: attempt.attemptNumber,
        expectedOperationState: "SUBMISSION_UNKNOWN",
        expectedOperationVersion: claimed.operation.stateVersion,
        expectedAttemptState: "SUBMISSION_UNKNOWN",
        expectedAttemptVersion: claimed.attempt.version,
        nextAttemptState: "SUBMITTED",
        event: "provider.submitted.v1",
        actor: "reconciler",
        eventRecordId: this.id(),
        evidenceHash: evidenceHash(response),
        providerTaskId: response.taskId,
        responseHash: evidenceHash(response),
        clearLastError: true,
      });
      return { action: "SUBMITTED", attempt: persisted.attempt };
    } catch (error) {
      if (error instanceof ProviderDefinitiveError) {
        const persisted = await this.coordinator.advanceAttempt({
          operationId: attempt.operationId,
          attemptNumber: attempt.attemptNumber,
          expectedOperationState: "SUBMISSION_UNKNOWN",
          expectedOperationVersion: claimed.operation.stateVersion,
          expectedAttemptState: "SUBMISSION_UNKNOWN",
          expectedAttemptVersion: claimed.attempt.version,
          nextAttemptState: "FAILED",
          event: "attempt.dispatch_rejected.v1",
          actor: "reconciler",
          eventRecordId: this.id(),
          evidenceHash: evidenceHash({ code: error.code, definitive: true }),
          actualProviderCredits: 0,
          chargeStatus: "CONFIRMED_NO_CHARGE",
          lastErrorCode: error.code,
        });
        return this.finalizeProviderFailure(persisted.attempt);
      }
      const observed = await this.coordinator.observeAttempt({
        operationId: attempt.operationId,
        attemptNumber: attempt.attemptNumber,
        expectedAttemptState: "SUBMISSION_UNKNOWN",
        expectedAttemptVersion: claimed.attempt.version,
        lastErrorCode: error instanceof ProviderSubmissionUnknownError
          ? "PROVIDER_SUBMISSION_OUTCOME_UNKNOWN"
          : `UNCLASSIFIED_SUBMISSION_OUTCOME:${errorCode(error)}`,
      });
      return { action: "SUBMISSION_UNKNOWN", attempt: observed };
    }
  }

  private async lookup(attempt: DurableAttemptView): Promise<ProviderAttemptDriveResult> {
    let task: ProviderTaskResponse | null;
    try {
      const response = await this.withProvider(attempt, (provider) => provider.lookupByIdempotency(attempt.providerIdempotencyKey));
      task = response === null ? null : ProviderTaskResponseSchema.parse(response);
    } catch (error) {
      const observed = await this.coordinator.observeAttempt({
        operationId: attempt.operationId,
        attemptNumber: attempt.attemptNumber,
        expectedAttemptState: "SUBMISSION_UNKNOWN",
        expectedAttemptVersion: attempt.version,
        lastErrorCode: `PROVIDER_LOOKUP_ERROR:${errorCode(error)}`,
      });
      return { action: "LOOKUP_WAITING", attempt: observed };
    }

    if (!task) {
      const missing = await this.coordinator.recordUnknownLookupMiss({
        operationId: attempt.operationId,
        attemptNumber: attempt.attemptNumber,
        expectedOperationVersion: attempt.operationStateVersion,
        expectedAttemptVersion: attempt.version,
        maxUnknownLookups: this.maxUnknownLookups,
        eventRecordId: this.id(),
        evidenceHash: evidenceHash({
          providerId: attempt.providerId,
          providerIdempotencyKey: attempt.providerIdempotencyKey,
          lookup: "NOT_FOUND",
          nextLookupCount: attempt.unknownLookupCount + 1,
        }),
      });
      return {
        action: missing.outcome === "WAITING" ? "LOOKUP_WAITING" : "RECONCILIATION_REQUIRED",
        attempt: missing.attempt,
      };
    }

    const responseHash = evidenceHash(task);
    const recovered = await this.coordinator.advanceAttempt({
      operationId: attempt.operationId,
      attemptNumber: attempt.attemptNumber,
      expectedOperationState: "SUBMISSION_UNKNOWN",
      expectedOperationVersion: attempt.operationStateVersion,
      expectedAttemptState: "SUBMISSION_UNKNOWN",
      expectedAttemptVersion: attempt.version,
      nextAttemptState: "SUBMITTED",
      event: "provider.submitted.v1",
      actor: "reconciler",
      eventRecordId: this.id(),
      evidenceHash: responseHash,
      providerTaskId: task.taskId,
      responseHash,
      actualProviderCredits: task.actualProviderCredits ?? undefined,
      chargeStatus: task.chargeStatus,
      providerResultUrl: task.resultUrl ?? undefined,
      incrementUnknownLookup: true,
      clearLastError: true,
    });
    return { action: "LOOKUP_RECOVERED", attempt: recovered.attempt };
  }

  private async poll(attempt: DurableAttemptView): Promise<ProviderAttemptDriveResult> {
    if (!attempt.providerTaskId) return this.reconcile(attempt, "MISSING_PROVIDER_TASK_ID");
    let task: ProviderTaskResponse;
    try {
      task = ProviderTaskResponseSchema.parse(await this.withProvider(attempt, (provider) => provider.getTask(attempt.providerTaskId!)));
    } catch (error) {
      const observed = await this.coordinator.observeAttempt({
        operationId: attempt.operationId,
        attemptNumber: attempt.attemptNumber,
        expectedAttemptState: attempt.state,
        expectedAttemptVersion: attempt.version,
        lastErrorCode: `PROVIDER_POLL_ERROR:${errorCode(error)}`,
        incrementPoll: true,
      });
      return { action: "POLL_WAITING", attempt: observed };
    }
    if (task.taskId !== attempt.providerTaskId) {
      return this.reconcile(attempt, "PROVIDER_TASK_ID_MISMATCH", task);
    }

    const responseHash = evidenceHash(task);
    if (task.status === "submitted") {
      const observed = await this.coordinator.observeAttempt({
        operationId: attempt.operationId,
        attemptNumber: attempt.attemptNumber,
        expectedAttemptState: attempt.state,
        expectedAttemptVersion: attempt.version,
        responseHash,
        incrementPoll: true,
      });
      return { action: "POLL_WAITING", attempt: observed };
    }
    if (task.status === "running") {
      if (attempt.state === "RUNNING") {
        const observed = await this.coordinator.observeAttempt({
          operationId: attempt.operationId,
          attemptNumber: attempt.attemptNumber,
          expectedAttemptState: "RUNNING",
          expectedAttemptVersion: attempt.version,
          responseHash,
          incrementPoll: true,
        });
        return { action: "RUNNING", attempt: observed };
      }
      const running = await this.coordinator.advanceAttempt({
        operationId: attempt.operationId,
        attemptNumber: attempt.attemptNumber,
        expectedOperationState: "SUBMITTED",
        expectedOperationVersion: attempt.operationStateVersion,
        expectedAttemptState: "SUBMITTED",
        expectedAttemptVersion: attempt.version,
        nextAttemptState: "RUNNING",
        event: "provider.running.v1",
        actor: "provider-poller",
        eventRecordId: this.id(),
        evidenceHash: responseHash,
        responseHash,
        incrementPoll: true,
        clearLastError: true,
      });
      return { action: "RUNNING", attempt: running.attempt };
    }
    if (task.status === "failed") {
      if (task.chargeStatus === "UNKNOWN") {
        return this.reconcile(attempt, "FAILED_PROVIDER_CHARGE_NOT_PROVEN_ZERO", task);
      }
      if ((task.chargeStatus === "CONFIRMED_NO_CHARGE" && task.actualProviderCredits !== null)
        || (task.chargeStatus === "ACTUAL" && (task.actualProviderCredits === null || task.actualProviderCredits <= 0))) {
        return this.reconcile(attempt, "FAILED_PROVIDER_CHARGE_CONTRACT_INVALID", task);
      }
      const failed = await this.coordinator.advanceAttempt({
        operationId: attempt.operationId,
        attemptNumber: attempt.attemptNumber,
        expectedOperationState: attempt.operationState,
        expectedOperationVersion: attempt.operationStateVersion,
        expectedAttemptState: attempt.state,
        expectedAttemptVersion: attempt.version,
        nextAttemptState: "FAILED",
        event: "provider.failed.v1",
        actor: "provider-poller",
        eventRecordId: this.id(),
        evidenceHash: responseHash,
        responseHash,
        actualProviderCredits: task.chargeStatus === "CONFIRMED_NO_CHARGE" ? 0 : task.actualProviderCredits ?? 0,
        chargeStatus: task.chargeStatus,
        lastErrorCode: task.errorCode ?? "PROVIDER_FAILED",
        incrementPoll: true,
      });
      return this.finalizeProviderFailure(failed.attempt);
    }
    if (task.actualProviderCredits === null || task.resultUrl === null || task.chargeStatus !== "ACTUAL") {
      return this.reconcile(attempt, "SUCCESS_EVIDENCE_INCOMPLETE", task);
    }
    const succeeded = await this.coordinator.advanceAttempt({
      operationId: attempt.operationId,
      attemptNumber: attempt.attemptNumber,
      expectedOperationState: attempt.operationState,
      expectedOperationVersion: attempt.operationStateVersion,
      expectedAttemptState: attempt.state,
      expectedAttemptVersion: attempt.version,
      nextAttemptState: "SUCCEEDED",
      event: "provider.succeeded.v1",
      actor: "provider-poller",
      eventRecordId: this.id(),
      evidenceHash: responseHash,
      responseHash,
      actualProviderCredits: task.actualProviderCredits,
      chargeStatus: "ACTUAL",
      providerResultUrl: task.resultUrl,
      incrementPoll: true,
      clearLastError: true,
    });
    return { action: "SUCCEEDED", attempt: succeeded.attempt };
  }

  private async withProvider<T>(attempt: DurableAttemptView, work: (adapter: ProviderAdapter) => Promise<T>): Promise<T> {
    if (this.adapters) return this.adapters.withAdapter({ operationId: attempt.operationId, providerId: attempt.providerId }, work);
    try {
      return await work(this.providers.require(attempt.providerId));
    } catch (error) {
      if (error instanceof ProviderDefinitiveError || error instanceof ProviderSubmissionUnknownError) throw error;
      if (error instanceof Error && error.message.startsWith("provider_adapter_not_registered:")) {
        throw new ProviderDefinitiveError("PROVIDER_RUNTIME_NOT_CONFIGURED", "No certified provider runtime is configured for this released offer.");
      }
      throw error;
    }
  }

  private async finalizeProviderFailure(attempt: DurableAttemptView): Promise<ProviderAttemptDriveResult> {
    if (attempt.actualProviderCredits === null || !attempt.chargeStatus
      || !["ACTUAL", "CONFIRMED_NO_CHARGE"].includes(attempt.chargeStatus)) {
      return this.reconcile(attempt, "FAILED_PROVIDER_CHARGE_NOT_PROVEN_ZERO");
    }
    const released = await this.coordinator.releaseProviderFailure({
      operationId: attempt.operationId,
      expectedOperationVersion: attempt.operationStateVersion,
      attemptId: attempt.id,
      commandId: `release-provider-failure:${attempt.operationId}`,
      journalId: this.id(),
      evidenceHash: evidenceHash({
        attemptId: attempt.id,
        providerTaskId: attempt.providerTaskId,
        providerCredits: attempt.actualProviderCredits,
        chargeStatus: attempt.chargeStatus,
        reason: attempt.lastErrorCode,
      }),
    });
    return {
      action: "FAILED",
      attempt: await this.coordinator.attempt(released.operation.id, attempt.attemptNumber),
    };
  }

  private async reconcile(
    attempt: DurableAttemptView,
    code: string,
    evidence?: unknown,
  ): Promise<ProviderAttemptDriveResult> {
    const reconciled = await this.coordinator.advanceAttempt({
      operationId: attempt.operationId,
      attemptNumber: attempt.attemptNumber,
      expectedOperationState: attempt.operationState,
      expectedOperationVersion: attempt.operationStateVersion,
      expectedAttemptState: attempt.state,
      expectedAttemptVersion: attempt.version,
      nextAttemptState: "RECONCILIATION_REQUIRED",
      event: "operation.reconciliation_required.v1",
      actor: "reconciler",
      eventRecordId: this.id(),
      evidenceHash: evidenceHash({ code, evidence }),
      responseHash: evidence === undefined ? undefined : evidenceHash(evidence),
      lastErrorCode: code,
      incrementPoll: evidence !== undefined,
    });
    return { action: "RECONCILIATION_REQUIRED", attempt: reconciled.attempt };
  }
}
