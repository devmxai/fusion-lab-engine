import { DurableExecutionError } from "./errors.ts";

export type AttemptState =
  | "READY"
  | "LEASED"
  | "SUBMITTED"
  | "SUBMISSION_UNKNOWN"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "MANUAL_REVIEW";

export type ExecutionAttempt = {
  id: string;
  operationId: string;
  attemptNumber: number;
  state: AttemptState;
  workerId: string | null;
  providerTaskId: string | null;
  lastEvidenceCode: string;
  createdAt: string;
  updatedAt: string;
};

const terminalStates: readonly AttemptState[] = ["SUCCEEDED", "FAILED", "MANUAL_REVIEW"];

export class InMemoryAttemptStore {
  private readonly attempts = new Map<string, ExecutionAttempt>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  create(input: { id: string; operationId: string; evidenceCode: string }): ExecutionAttempt {
    if (!input.id || !input.operationId || !input.evidenceCode) throw new TypeError("Attempt identity and evidence are required.");
    if (this.attempts.has(input.id)) {
      throw new DurableExecutionError("ATTEMPT_CONFLICT", "An attempt ID can be created only once.");
    }
    const operationAttempts = [...this.attempts.values()].filter(({ operationId }) => operationId === input.operationId);
    if (operationAttempts.some(({ state }) => !terminalStates.includes(state))) {
      throw new DurableExecutionError("ATTEMPT_CONFLICT", "An operation cannot own multiple active attempts.");
    }
    const timestamp = this.now().toISOString();
    const attempt: ExecutionAttempt = {
      id: input.id,
      operationId: input.operationId,
      attemptNumber: operationAttempts.length + 1,
      state: "READY",
      workerId: null,
      providerTaskId: null,
      lastEvidenceCode: input.evidenceCode,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.attempts.set(attempt.id, attempt);
    return structuredClone(attempt);
  }

  claim(attemptId: string, workerId: string): ExecutionAttempt {
    if (!workerId) throw new TypeError("Worker ID is required.");
    const attempt = this.require(attemptId);
    if (attempt.state !== "READY") {
      throw new DurableExecutionError("ATTEMPT_ILLEGAL_TRANSITION", "Only a ready attempt may be leased.");
    }
    attempt.state = "LEASED";
    attempt.workerId = workerId;
    attempt.lastEvidenceCode = "worker_lease_acquired";
    attempt.updatedAt = this.now().toISOString();
    return structuredClone(attempt);
  }

  recoverWorker(workerId: string): number {
    let recovered = 0;
    for (const attempt of this.attempts.values()) {
      if (attempt.state === "LEASED" && attempt.workerId === workerId) {
        attempt.state = "READY";
        attempt.workerId = null;
        attempt.lastEvidenceCode = "worker_lease_recovered_after_crash";
        attempt.updatedAt = this.now().toISOString();
        recovered += 1;
      }
    }
    return recovered;
  }

  markSubmitted(attemptId: string, workerId: string, providerTaskId: string): ExecutionAttempt {
    return this.fromLease(attemptId, workerId, "SUBMITTED", "provider_submission_confirmed", providerTaskId);
  }

  markSubmissionUnknown(attemptId: string, workerId: string): ExecutionAttempt {
    return this.fromLease(attemptId, workerId, "SUBMISSION_UNKNOWN", "provider_submission_outcome_unknown");
  }

  markRunning(attemptId: string, evidenceCode = "provider_task_running"): ExecutionAttempt {
    return this.transition(attemptId, ["SUBMITTED", "RUNNING"], "RUNNING", evidenceCode);
  }

  markSucceeded(attemptId: string): ExecutionAttempt {
    return this.transition(attemptId, ["SUBMITTED", "RUNNING", "SUBMISSION_UNKNOWN"], "SUCCEEDED", "provider_task_succeeded");
  }

  markFailed(attemptId: string, evidenceCode: string): ExecutionAttempt {
    return this.transition(attemptId, ["LEASED", "SUBMITTED", "RUNNING", "SUBMISSION_UNKNOWN"], "FAILED", evidenceCode);
  }

  resolveUnknown(attemptId: string, providerTaskId: string): ExecutionAttempt {
    const attempt = this.transition(
      attemptId,
      ["SUBMISSION_UNKNOWN"],
      "SUBMITTED",
      "idempotency_lookup_resolved_submission",
    );
    const stored = this.require(attempt.id);
    stored.providerTaskId = providerTaskId;
    return structuredClone(stored);
  }

  markManualReview(attemptId: string, evidenceCode: string): ExecutionAttempt {
    return this.transition(
      attemptId,
      ["READY", "LEASED", "SUBMITTED", "SUBMISSION_UNKNOWN", "RUNNING"],
      "MANUAL_REVIEW",
      evidenceCode,
    );
  }

  forOperation(operationId: string): ReadonlyArray<Readonly<ExecutionAttempt>> {
    return structuredClone([...this.attempts.values()].filter((attempt) => attempt.operationId === operationId));
  }

  snapshot(): ReadonlyArray<Readonly<ExecutionAttempt>> {
    return structuredClone([...this.attempts.values()]);
  }

  private fromLease(
    attemptId: string,
    workerId: string,
    state: "SUBMITTED" | "SUBMISSION_UNKNOWN",
    evidenceCode: string,
    providerTaskId: string | null = null,
  ): ExecutionAttempt {
    const attempt = this.require(attemptId);
    if (attempt.state !== "LEASED" || attempt.workerId !== workerId) {
      throw new DurableExecutionError("ATTEMPT_LEASE_MISMATCH", "Only the current attempt worker may record submission.");
    }
    attempt.state = state;
    attempt.workerId = null;
    attempt.providerTaskId = providerTaskId;
    attempt.lastEvidenceCode = evidenceCode;
    attempt.updatedAt = this.now().toISOString();
    return structuredClone(attempt);
  }

  private transition(
    attemptId: string,
    allowed: readonly AttemptState[],
    state: AttemptState,
    evidenceCode: string,
  ): ExecutionAttempt {
    const attempt = this.require(attemptId);
    if (!allowed.includes(attempt.state)) {
      throw new DurableExecutionError("ATTEMPT_ILLEGAL_TRANSITION", `Attempt cannot transition from ${attempt.state} to ${state}.`);
    }
    attempt.state = state;
    attempt.workerId = null;
    attempt.lastEvidenceCode = evidenceCode;
    attempt.updatedAt = this.now().toISOString();
    return structuredClone(attempt);
  }

  private require(attemptId: string): ExecutionAttempt {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) throw new DurableExecutionError("ATTEMPT_CONFLICT", "Attempt does not exist.");
    return attempt;
  }
}
