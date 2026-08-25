import { z } from "zod";

export const OperationStateSchema = z.enum([
  "DRAFT",
  "QUOTED",
  "RESERVED",
  "QUEUED",
  "DISPATCHING",
  "SUBMISSION_UNKNOWN",
  "SUBMITTED",
  "RUNNING",
  "PROVIDER_SUCCEEDED",
  "PROVIDER_FAILED",
  "ASSET_STORED",
  "DELIVERY_FAILED",
  "DELIVERED",
  "SETTLED",
  "CANCELLED",
  "RECONCILIATION_REQUIRED",
]);

export const ReservationStateSchema = z.enum([
  "HELD",
  "SETTLED",
  "RELEASED",
  "MANUAL_REVIEW",
]);

export const TransitionActorSchema = z.enum([
  "engine-api",
  "engine-transaction",
  "outbox-relay",
  "worker",
  "provider-adapter",
  "provider-poller",
  "media-worker",
  "delivery-worker",
  "finance-worker",
  "reconciler",
]);

export type OperationState = z.infer<typeof OperationStateSchema>;
export type TransitionActor = z.infer<typeof TransitionActorSchema>;

export type LegalOperationTransition = {
  from: OperationState;
  event: string;
  actor: TransitionActor;
  to: OperationState;
  financialEffect:
    | "NONE"
    | "AVAILABLE_TO_HELD"
    | "EXPOSURE_RECORDED"
    | "HELD_TO_RELEASED"
    | "HELD_TO_CAPTURED_AND_REMAINDER_RELEASED"
    | "HELD_TO_RELEASED_AND_PROVIDER_LOSS"
    | "PROTECTED_HOLD";
  evidenceRequired: boolean;
};

const reconciliationTransitions: readonly LegalOperationTransition[] = OperationStateSchema.options
  .filter((state) => state !== "RECONCILIATION_REQUIRED")
  .map((from) => ({
    from,
    event: "operation.reconciliation_required.v1",
    actor: "reconciler",
    to: "RECONCILIATION_REQUIRED",
    financialEffect: "PROTECTED_HOLD",
    evidenceRequired: true,
  }));

export const legalOperationTransitions: readonly LegalOperationTransition[] = [
  { from: "DRAFT", event: "quote.issued.v1", actor: "engine-api", to: "QUOTED", financialEffect: "NONE", evidenceRequired: true },
  { from: "QUOTED", event: "operation.reserved.v1", actor: "engine-transaction", to: "RESERVED", financialEffect: "AVAILABLE_TO_HELD", evidenceRequired: true },
  { from: "RESERVED", event: "operation.queued.v1", actor: "outbox-relay", to: "QUEUED", financialEffect: "NONE", evidenceRequired: true },
  { from: "QUEUED", event: "attempt.dispatching.v1", actor: "worker", to: "DISPATCHING", financialEffect: "EXPOSURE_RECORDED", evidenceRequired: true },
  { from: "DISPATCHING", event: "provider.submitted.v1", actor: "provider-adapter", to: "SUBMITTED", financialEffect: "NONE", evidenceRequired: true },
  { from: "DISPATCHING", event: "provider.submission_unknown.v1", actor: "provider-adapter", to: "SUBMISSION_UNKNOWN", financialEffect: "PROTECTED_HOLD", evidenceRequired: true },
  { from: "DISPATCHING", event: "attempt.dispatch_rejected.v1", actor: "worker", to: "PROVIDER_FAILED", financialEffect: "HELD_TO_RELEASED", evidenceRequired: true },
  { from: "SUBMISSION_UNKNOWN", event: "provider.submitted.v1", actor: "reconciler", to: "SUBMITTED", financialEffect: "NONE", evidenceRequired: true },
  { from: "SUBMISSION_UNKNOWN", event: "attempt.dispatch_rejected.v1", actor: "reconciler", to: "PROVIDER_FAILED", financialEffect: "HELD_TO_RELEASED", evidenceRequired: true },
  { from: "SUBMITTED", event: "provider.running.v1", actor: "provider-poller", to: "RUNNING", financialEffect: "NONE", evidenceRequired: true },
  { from: "SUBMITTED", event: "provider.succeeded.v1", actor: "provider-poller", to: "PROVIDER_SUCCEEDED", financialEffect: "NONE", evidenceRequired: true },
  { from: "RUNNING", event: "provider.succeeded.v1", actor: "provider-poller", to: "PROVIDER_SUCCEEDED", financialEffect: "NONE", evidenceRequired: true },
  { from: "SUBMITTED", event: "provider.failed.v1", actor: "provider-poller", to: "PROVIDER_FAILED", financialEffect: "HELD_TO_RELEASED", evidenceRequired: true },
  { from: "RUNNING", event: "provider.failed.v1", actor: "provider-poller", to: "PROVIDER_FAILED", financialEffect: "HELD_TO_RELEASED", evidenceRequired: true },
  { from: "PROVIDER_SUCCEEDED", event: "asset.stored.v1", actor: "media-worker", to: "ASSET_STORED", financialEffect: "NONE", evidenceRequired: true },
  { from: "PROVIDER_SUCCEEDED", event: "asset.delivery_failed.v1", actor: "media-worker", to: "DELIVERY_FAILED", financialEffect: "HELD_TO_RELEASED_AND_PROVIDER_LOSS", evidenceRequired: true },
  { from: "ASSET_STORED", event: "operation.delivered.v1", actor: "delivery-worker", to: "DELIVERED", financialEffect: "NONE", evidenceRequired: true },
  { from: "ASSET_STORED", event: "asset.delivery_failed.v1", actor: "delivery-worker", to: "DELIVERY_FAILED", financialEffect: "HELD_TO_RELEASED_AND_PROVIDER_LOSS", evidenceRequired: true },
  { from: "DELIVERED", event: "ledger.settled.v1", actor: "finance-worker", to: "SETTLED", financialEffect: "HELD_TO_CAPTURED_AND_REMAINDER_RELEASED", evidenceRequired: true },
  { from: "DRAFT", event: "operation.cancelled.v1", actor: "engine-api", to: "CANCELLED", financialEffect: "NONE", evidenceRequired: true },
  { from: "QUOTED", event: "operation.cancelled.v1", actor: "engine-api", to: "CANCELLED", financialEffect: "NONE", evidenceRequired: true },
  { from: "RESERVED", event: "operation.cancelled.v1", actor: "engine-transaction", to: "CANCELLED", financialEffect: "HELD_TO_RELEASED", evidenceRequired: true },
  { from: "QUEUED", event: "operation.cancelled.v1", actor: "worker", to: "CANCELLED", financialEffect: "HELD_TO_RELEASED", evidenceRequired: true },
  { from: "DISPATCHING", event: "operation.cancelled.v1", actor: "provider-adapter", to: "CANCELLED", financialEffect: "HELD_TO_RELEASED", evidenceRequired: true },
  ...reconciliationTransitions,
] as const;

export function requireLegalTransition(input: {
  currentState: OperationState;
  currentVersion: number;
  expectedState: OperationState;
  expectedVersion: number;
  event: string;
  actor: TransitionActor;
  hasEvidence: boolean;
}): { state: OperationState; version: number; transition: LegalOperationTransition } {
  if (input.currentState !== input.expectedState || input.currentVersion !== input.expectedVersion) {
    throw new Error("operation_compare_and_set_conflict");
  }
  const transition = legalOperationTransitions.find((candidate) =>
    candidate.from === input.currentState
    && candidate.event === input.event
    && candidate.actor === input.actor
  );
  if (!transition) throw new Error("illegal_operation_transition");
  if (transition.evidenceRequired && !input.hasEvidence) {
    throw new Error("operation_transition_evidence_required");
  }
  return { state: transition.to, version: input.currentVersion + 1, transition };
}
