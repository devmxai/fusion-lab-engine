import { createHash } from "node:crypto";
import type {
  CanaryApproval,
  CanaryAssignmentPlan,
  CanaryControllerSnapshot,
  CanaryGateObservation,
  CanaryReadinessEvidence,
  CanaryRollbackReason,
  CanaryStageBps,
  ExactCanaryPolicyVersion,
} from "./types.ts";
import { ProfitRouterError } from "./types.ts";

const REQUIRED_STAGES = [100, 500, 1000, 2500, 5000, 10000] as const;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameStages(stages: readonly number[]): boolean {
  return stages.length === REQUIRED_STAGES.length
    && stages.every((stage, index) => stage === REQUIRED_STAGES[index]);
}

function validatePolicy(policy: ExactCanaryPolicyVersion): void {
  const boundedNonNegative = [
    policy.maximumReliabilityRegressionPpm,
    policy.maximumQualityRegressionPpm,
    policy.maximumP95LatencyRegressionBps,
  ].every((value) => Number.isInteger(value) && value >= 0);
  if (!policy.id
    || policy.lifecycle !== "PUBLISHED"
    || !Number.isInteger(policy.version)
    || policy.version <= 0
    || !policy.exactEquivalenceGroupId
    || !policy.safeRouteVersionId
    || !policy.candidateRouteVersionId
    || policy.safeRouteVersionId === policy.candidateRouteVersionId
    || !sameStages(policy.stagesBps)
    || !Number.isInteger(policy.minimumShadowDecisions)
    || policy.minimumShadowDecisions <= 0
    || !Number.isInteger(policy.minimumSamplesPerStage)
    || policy.minimumSamplesPerStage <= 0
    || !Number.isInteger(policy.minimumObservationSeconds)
    || policy.minimumObservationSeconds <= 0
    || !boundedNonNegative
    || !Number.isInteger(policy.minimumActualCostReconciliationBps)
    || policy.minimumActualCostReconciliationBps < 0
    || policy.minimumActualCostReconciliationBps > 10_000
    || policy.requiredApprovalRoles[0] !== "FINANCE"
    || policy.requiredApprovalRoles[1] !== "RELIABILITY"
    || policy.cohortOrder !== "ADMIN_INTERNAL_FIRST"
    || policy.assignmentHash !== "SHA256_MOD_10000"
    || Number.isNaN(Date.parse(policy.publishedAt))) {
    throw new ProfitRouterError("INVALID_CANARY_POLICY", "Exact Canary requires one valid immutable fail-closed Policy Version.");
  }
}

function validateObservation(observation: CanaryGateObservation, policy: ExactCanaryPolicyVersion): number {
  const start = Date.parse(observation.windowStartedAt);
  const end = Date.parse(observation.windowEndedAt);
  const integerFields = [
    observation.sampleCount,
    observation.marginFloorBreachCount,
    observation.hardGateViolationCount,
    observation.financialAuthorityConflictCount,
    observation.actualCostReconciliationBps,
    observation.reliabilityRegressionPpm,
    observation.qualityRegressionPpm,
    observation.p95LatencyRegressionBps,
  ];
  if (!observation.observationId
    || observation.policyVersionId !== policy.id
    || Number.isNaN(start)
    || Number.isNaN(end)
    || end <= start
    || integerFields.some((value) => !Number.isInteger(value) || value < 0)
    || observation.actualCostReconciliationBps > 10_000) {
    throw new ProfitRouterError("CANARY_GATE_FAILED", "Canary observation must be a valid immutable server window for the active Policy Version.");
  }
  return end - start;
}

function automaticRollbackReason(
  observation: CanaryGateObservation,
  policy: ExactCanaryPolicyVersion,
): CanaryRollbackReason | null {
  if (observation.marginFloorBreachCount > 0) return "MARGIN_FLOOR_BREACH";
  if (observation.hardGateViolationCount > 0) return "HARD_GATE_VIOLATION";
  if (observation.financialAuthorityConflictCount > 0) return "FINANCIAL_AUTHORITY_CONFLICT";
  if (observation.actualCostReconciliationBps < policy.minimumActualCostReconciliationBps) {
    return "ACTUAL_COST_RECONCILIATION_REGRESSION";
  }
  if (observation.reliabilityRegressionPpm > policy.maximumReliabilityRegressionPpm) return "RELIABILITY_REGRESSION";
  if (observation.qualityRegressionPpm > policy.maximumQualityRegressionPpm) return "QUALITY_REGRESSION";
  if (observation.p95LatencyRegressionBps > policy.maximumP95LatencyRegressionBps) return "P95_LATENCY_REGRESSION";
  return null;
}

export class LocalExactCanaryController {
  private readonly approvals = new Map<CanaryApproval["role"], CanaryApproval>();
  private readonly evaluatedObservations = new Map<string, {
    intent: string;
    snapshot: CanaryControllerSnapshot;
  }>();
  private readonly completedStages: CanaryStageBps[] = [];
  private state: CanaryControllerSnapshot["state"] = "DRAFT";
  private currentStageBps: 0 | CanaryStageBps = 0;
  private rollbackReason: CanaryRollbackReason | null = null;
  private readinessEvidenceId: string | null = null;

  constructor(private readonly policy: ExactCanaryPolicyVersion) {
    validatePolicy(policy);
  }

  approve(approval: CanaryApproval): CanaryControllerSnapshot {
    if (this.state !== "DRAFT") {
      throw new ProfitRouterError("INVALID_CANARY_TRANSITION", "Approvals are immutable once the Canary is armed.");
    }
    if (!approval.approvalId
      || !approval.actorId
      || approval.policyVersionId !== this.policy.id
      || !this.policy.requiredApprovalRoles.includes(approval.role)
      || Number.isNaN(Date.parse(approval.approvedAt))) {
      throw new ProfitRouterError("CANARY_APPROVAL_REQUIRED", "Canary approval must match a required role and the active Policy Version.");
    }
    const prior = this.approvals.get(approval.role);
    if (prior) {
      if (JSON.stringify(prior) === JSON.stringify(approval)) return this.snapshot();
      throw new ProfitRouterError("CANARY_APPROVAL_REQUIRED", "A required approval role cannot be overwritten.");
    }
    if ([...this.approvals.values()].some(({ actorId }) => actorId === approval.actorId)) {
      throw new ProfitRouterError("CANARY_APPROVAL_REQUIRED", "Finance and Reliability approvals require distinct human actors.");
    }
    this.approvals.set(approval.role, structuredClone(approval));
    return this.snapshot();
  }

  arm(evidence: CanaryReadinessEvidence): CanaryControllerSnapshot {
    if (this.state !== "DRAFT") {
      throw new ProfitRouterError("INVALID_CANARY_TRANSITION", "Only a Draft Canary may be armed.");
    }
    if (this.policy.requiredApprovalRoles.some((role) => !this.approvals.has(role))) {
      throw new ProfitRouterError("CANARY_APPROVAL_REQUIRED", "Every required role must approve before arming.");
    }
    if (!evidence.evidenceId
      || evidence.policyVersionId !== this.policy.id
      || evidence.exactEquivalenceGroupId !== this.policy.exactEquivalenceGroupId
      || !Number.isInteger(evidence.shadowDecisionCount)
      || evidence.shadowDecisionCount < this.policy.minimumShadowDecisions
      || evidence.exactReplayMatchCount !== evidence.shadowDecisionCount
      || evidence.selectedHardGateViolationCount !== 0
      || evidence.dispatchMutationCount !== 0
      || evidence.rollbackDrillPassed !== true
      || Number.isNaN(Date.parse(evidence.observedAt))) {
      throw new ProfitRouterError("CANARY_GATE_FAILED", "Canary readiness requires sufficient exactly replayed Shadow evidence and a passed rollback drill.");
    }
    this.readinessEvidenceId = evidence.evidenceId;
    this.state = "ARMED";
    return this.snapshot();
  }

  start(): CanaryControllerSnapshot {
    if (this.state !== "ARMED") {
      throw new ProfitRouterError("INVALID_CANARY_TRANSITION", "Only an armed Canary may begin at one percent.");
    }
    this.state = "RUNNING";
    this.currentStageBps = REQUIRED_STAGES[0];
    return this.snapshot();
  }

  evaluateAndAdvance(observation: CanaryGateObservation): CanaryControllerSnapshot {
    const prior = this.evaluatedObservations.get(observation.observationId);
    if (prior) {
      if (prior.intent === canonicalJson(observation)) return structuredClone(prior.snapshot);
      throw new ProfitRouterError("CANARY_GATE_FAILED", "Canary Observation ID was reused with different gate evidence.");
    }
    if (this.state !== "RUNNING" || observation.stageBps !== this.currentStageBps) {
      throw new ProfitRouterError("INVALID_CANARY_TRANSITION", "Observation must target the currently running Canary stage.");
    }
    const windowMs = validateObservation(observation, this.policy);
    const rollback = automaticRollbackReason(observation, this.policy);
    if (rollback) {
      const snapshot = this.rollback(rollback);
      this.rememberObservation(observation, snapshot);
      return snapshot;
    }
    if (observation.sampleCount < this.policy.minimumSamplesPerStage
      || windowMs < this.policy.minimumObservationSeconds * 1000) {
      throw new ProfitRouterError("CANARY_GATE_FAILED", "Canary stage lacks the minimum samples or observation duration.");
    }
    this.completedStages.push(this.currentStageBps);
    const nextIndex = REQUIRED_STAGES.indexOf(this.currentStageBps) + 1;
    if (nextIndex === REQUIRED_STAGES.length) {
      this.state = "COMPLETED";
      const snapshot = this.snapshot();
      this.rememberObservation(observation, snapshot);
      return snapshot;
    }
    this.currentStageBps = REQUIRED_STAGES[nextIndex]!;
    const snapshot = this.snapshot();
    this.rememberObservation(observation, snapshot);
    return snapshot;
  }

  activateKillSwitch(): CanaryControllerSnapshot {
    if (this.state === "ROLLED_BACK") return this.snapshot();
    return this.rollback("MANUAL_KILL_SWITCH");
  }

  planAssignment(input: { cohortKey: string; cohort: "ADMIN_INTERNAL" | "PUBLIC" }): CanaryAssignmentPlan {
    if (!input.cohortKey) throw new ProfitRouterError("INVALID_CANARY_TRANSITION", "A stable cohort key is required.");
    const cohortKeyHash = createHash("sha256").update(input.cohortKey).digest("hex");
    const bucketBps = Number(BigInt(`0x${cohortKeyHash.slice(0, 16)}`) % 10_000n);
    const stageAllowsPublic = this.currentStageBps > 100;
    const eligibleCohort = input.cohort === "ADMIN_INTERNAL" || stageAllowsPublic;
    const canarySelected = (this.state === "RUNNING" || this.state === "COMPLETED")
      && eligibleCohort
      && bucketBps < this.currentStageBps;
    return {
      cohortKeyHash,
      bucketBps,
      cohort: input.cohort,
      selectedRouteVersionId: canarySelected ? this.policy.candidateRouteVersionId : this.policy.safeRouteVersionId,
      financialAuthority: canarySelected ? "EXACT_CANARY_ENGINE" : "SAFE_ENGINE",
      dispatchMutationPerformed: false,
    };
  }

  snapshot(): CanaryControllerSnapshot {
    return {
      policyVersionId: this.policy.id,
      state: this.state,
      currentStageBps: this.currentStageBps,
      completedStagesBps: [...this.completedStages],
      approvals: [...this.approvals.values()].map((approval) => structuredClone(approval)),
      readinessEvidenceId: this.readinessEvidenceId,
      rollbackReason: this.rollbackReason,
      newAssignmentRouteVersionId: this.state === "ROLLED_BACK"
        ? this.policy.safeRouteVersionId
        : this.policy.candidateRouteVersionId,
      inFlightPolicy: "COMPLETE_PINNED_NO_REDISPATCH",
      acceptedQuotePolicy: "HONOR_UNTIL_EXPIRY",
      financialAuthorityPolicy: "ONE_SOURCE_PER_COHORT",
      externalDispatchPerformed: false,
    };
  }

  private rollback(reason: CanaryRollbackReason): CanaryControllerSnapshot {
    this.state = "ROLLED_BACK";
    this.rollbackReason = reason;
    this.currentStageBps = 0;
    return this.snapshot();
  }

  private rememberObservation(
    observation: CanaryGateObservation,
    snapshot: CanaryControllerSnapshot,
  ): void {
    this.evaluatedObservations.set(observation.observationId, {
      intent: canonicalJson(observation),
      snapshot: structuredClone(snapshot),
    });
  }
}
