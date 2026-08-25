import { releaseEvidenceHash } from "./canonical.ts";
import type {
  ReleaseApprovalRole,
  ReleaseReadinessEvidence,
  ReleaseRolloutEvent,
  ReleaseRolloutPolicyVersion,
  ReleaseRolloutSnapshot,
  ReleaseStage,
  ReleaseStageObservation,
} from "./types.ts";
import { ReleaseGovernanceError } from "./types.ts";

const STAGES: readonly ReleaseStage[] = [
  "INTERNAL_ALPHA",
  "INVITE_BETA",
  "ROLLOUT_1",
  "ROLLOUT_5",
  "ROLLOUT_25",
  "ROLLOUT_50",
  "ROLLOUT_100",
  "GA_READY",
];

function exactList<T>(actual: readonly T[], expected: readonly T[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function validatePolicy(policy: ReleaseRolloutPolicyVersion): void {
  const gates = [...policy.requiredFormalGateIds].sort((left, right) => left - right);
  if (!policy.id
    || !policy.releaseId
    || !/^[a-f0-9]{64}$/.test(policy.releaseDigest)
    || !Number.isInteger(policy.version)
    || policy.version <= 0
    || policy.lifecycle !== "PUBLISHED"
    || policy.requiredFormalGateIds.length === 0
    || new Set(policy.requiredFormalGateIds).size !== policy.requiredFormalGateIds.length
    || policy.requiredFormalGateIds.some((gate, index) => !Number.isInteger(gate) || gate < 0 || gate !== gates[index])
    || !exactList(policy.stages, STAGES)
    || !exactList(policy.requiredApprovalRoles, ["PRODUCT", "ENGINEERING", "SECURITY", "FINANCE"])
    || !Number.isInteger(policy.minimumSamplesPerStage)
    || policy.minimumSamplesPerStage <= 0
    || !Number.isInteger(policy.minimumObservationSecondsPerStage)
    || policy.minimumObservationSecondsPerStage <= 0
    || policy.pauseAtErrorBudgetConsumptionBps !== 5000
    || policy.stopAtErrorBudgetConsumptionBps !== 10000
    || policy.requireZeroCriticalHigh !== true
    || policy.requireZeroUnexplainedLedgerDrift !== true
    || policy.promotionAuthority !== "LOCAL_CONTRACT_SIMULATION_ONLY"
    || policy.productionActivationAllowed !== false
    || Number.isNaN(Date.parse(policy.publishedAt))) {
    throw new ReleaseGovernanceError("INVALID_RELEASE_POLICY", "Release Policy must pin the exact Alpha/Beta/1→5→25→50→100/GA ladder and fail-closed local authority.");
  }
}

function validDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function validateReadiness(policy: ReleaseRolloutPolicyVersion, evidence: ReleaseReadinessEvidence): void {
  if (!evidence.evidenceId
    || evidence.policyVersionId !== policy.id
    || evidence.releaseDigest !== policy.releaseDigest
    || !validDigest(evidence.artifactDigest)
    || !validDigest(evidence.sbomDigest)
    || !validDigest(evidence.provenanceDigest)
    || !exactList(evidence.verifiedFormalGateIds, policy.requiredFormalGateIds)
    || evidence.criticalSecurityFindingCount !== 0
    || evidence.highSecurityFindingCount !== 0
    || evidence.unexplainedLedgerDriftCount !== 0
    || evidence.actualCostReconciliationBps !== 10_000
    || evidence.rollbackDrillPassed !== true
    || evidence.sloPolicyPinned !== true
    || evidence.drPlanPinned !== true
    || evidence.runbooksIndexed !== true
    || evidence.localFixtureOnly !== true
    || evidence.externalTrafficObserved !== false
    || Number.isNaN(Date.parse(evidence.observedAt))) {
    throw new ReleaseGovernanceError("INVALID_RELEASE_EVIDENCE", "Local release readiness requires exact artifacts, formal-Gate fixtures, reconciliation, rollback, SLO/DR/runbooks and zero release blockers.");
  }
}

function validateObservation(policy: ReleaseRolloutPolicyVersion, observation: ReleaseStageObservation): number {
  const startedAt = Date.parse(observation.windowStartedAt);
  const endedAt = Date.parse(observation.windowEndedAt);
  const counts = [
    observation.sampleCount,
    observation.criticalSecurityFindingCount,
    observation.highSecurityFindingCount,
    observation.unexplainedLedgerDriftCount,
    observation.financialInvariantFailureCount,
    observation.reconciliationBps,
    observation.errorBudgetConsumptionBps,
    observation.unbudgetableIncidentCount,
  ];
  if (!observation.observationId
    || observation.policyVersionId !== policy.id
    || Number.isNaN(startedAt)
    || Number.isNaN(endedAt)
    || endedAt <= startedAt
    || counts.some((value) => !Number.isInteger(value) || value < 0)
    || observation.reconciliationBps > 10_000
    || observation.errorBudgetConsumptionBps > 10_000
    || observation.localFixtureOnly !== true
    || observation.externalTrafficObserved !== false) {
    throw new ReleaseGovernanceError("INVALID_RELEASE_EVIDENCE", "Stage observation must be bounded immutable local evidence for the active Policy Version.");
  }
  return Math.floor((endedAt - startedAt) / 1000);
}

function hasReleaseBlocker(observation: ReleaseStageObservation): boolean {
  return observation.criticalSecurityFindingCount > 0
    || observation.highSecurityFindingCount > 0
    || observation.unexplainedLedgerDriftCount > 0
    || observation.financialInvariantFailureCount > 0
    || observation.reconciliationBps !== 10_000
    || observation.sloBreached
    || !observation.rollbackAvailable
    || observation.errorBudgetConsumptionBps >= 10_000
    || observation.unbudgetableIncidentCount > 0;
}

export class InMemoryReleaseRolloutController {
  private state: ReleaseRolloutSnapshot["state"] = "DRAFT";
  private currentStage: ReleaseStage | null = null;
  private readonly completedStages: ReleaseStage[] = [];
  private readonly approvals = new Map<ReleaseApprovalRole, { approvalId: string; actorId: string; intentHash: string }>();
  private readonly commands = new Map<string, string>();
  private readonly observations = new Map<string, { intentHash: string; snapshot: ReleaseRolloutSnapshot }>();
  private readonly events: ReleaseRolloutEvent[] = [];
  private readinessEvidenceId: string | null = null;
  private stopReason: ReleaseRolloutSnapshot["stopReason"] = null;

  constructor(
    private readonly policy: ReleaseRolloutPolicyVersion,
    private readonly makerId: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    validatePolicy(policy);
    if (!makerId) throw new ReleaseGovernanceError("INVALID_RELEASE_APPROVAL", "Release Policy requires a named maker identity.");
  }

  approve(input: { approvalId: string; actorId: string; role: ReleaseApprovalRole }): ReleaseRolloutSnapshot {
    const intentHash = releaseEvidenceHash(input);
    const commandKey = `approval:${input.approvalId}`;
    const priorCommand = this.commands.get(commandKey);
    if (priorCommand) {
      if (priorCommand === intentHash) return this.snapshot();
      throw new ReleaseGovernanceError("RELEASE_COMMAND_CONFLICT", "Approval ID was reused with different intent.");
    }
    if (this.state !== "DRAFT"
      || !input.approvalId
      || !input.actorId
      || input.actorId === this.makerId
      || !this.policy.requiredApprovalRoles.includes(input.role)
      || this.approvals.has(input.role)
      || [...this.approvals.values()].some(({ actorId }) => actorId === input.actorId)) {
      throw new ReleaseGovernanceError("INVALID_RELEASE_APPROVAL", "Product, Engineering, Security and Finance approvals require distinct actors independent from the maker.");
    }
    this.approvals.set(input.role, { approvalId: input.approvalId, actorId: input.actorId, intentHash });
    this.commands.set(commandKey, intentHash);
    this.appendEvent(`release-event:${input.approvalId}`, "APPROVED", input.actorId, null, "ROLE_APPROVAL");
    return this.snapshot();
  }

  arm(evidence: ReleaseReadinessEvidence): ReleaseRolloutSnapshot {
    if (this.state !== "DRAFT" || this.policy.requiredApprovalRoles.some((role) => !this.approvals.has(role))) {
      throw new ReleaseGovernanceError("RELEASE_TRANSITION_DENIED", "All four separated approvals are required before arming a release simulation.");
    }
    validateReadiness(this.policy, evidence);
    this.state = "ARMED";
    this.readinessEvidenceId = evidence.evidenceId;
    this.appendEvent(`release-event:${evidence.evidenceId}`, "ARMED", "system:release-governance", null, "READINESS_ACCEPTED");
    return this.snapshot();
  }

  start(): ReleaseRolloutSnapshot {
    if (this.state !== "ARMED") {
      throw new ReleaseGovernanceError("RELEASE_TRANSITION_DENIED", "Only an armed release simulation may begin Internal Alpha.");
    }
    this.state = "RUNNING";
    this.currentStage = STAGES[0];
    this.appendEvent("release-event:stage:internal-alpha", "STAGE_STARTED", "system:release-governance", this.currentStage, "ORDERED_PROMOTION");
    return this.snapshot();
  }

  evaluateAndAdvance(observation: ReleaseStageObservation): ReleaseRolloutSnapshot {
    const intentHash = releaseEvidenceHash(observation);
    const prior = this.observations.get(observation.observationId);
    if (prior) {
      if (prior.intentHash === intentHash) return structuredClone(prior.snapshot);
      throw new ReleaseGovernanceError("RELEASE_COMMAND_CONFLICT", "Observation ID was reused with different evidence.");
    }
    if (this.state !== "RUNNING" || !this.currentStage || observation.stage !== this.currentStage) {
      throw new ReleaseGovernanceError("RELEASE_TRANSITION_DENIED", "Observation must evaluate the currently active rollout stage without skipping.");
    }
    const durationSeconds = validateObservation(this.policy, observation);
    if (hasReleaseBlocker(observation)) return this.remember(observation, this.stop("RELEASE_BLOCKER"));
    if (observation.errorBudgetConsumptionBps >= this.policy.pauseAtErrorBudgetConsumptionBps) {
      return this.remember(observation, this.pause());
    }
    if (observation.sampleCount < this.policy.minimumSamplesPerStage
      || durationSeconds < this.policy.minimumObservationSecondsPerStage) {
      throw new ReleaseGovernanceError("INVALID_RELEASE_EVIDENCE", "Rollout stage lacks the minimum sample count or observation duration.");
    }
    const passedStage = this.currentStage;
    this.completedStages.push(passedStage);
    this.appendEvent(`release-event:${observation.observationId}:passed`, "STAGE_PASSED", "system:release-governance", passedStage, "ORDERED_PROMOTION");
    const nextIndex = STAGES.indexOf(passedStage) + 1;
    if (nextIndex === STAGES.length) {
      this.state = "COMPLETED";
      this.currentStage = null;
      return this.remember(observation, this.snapshot());
    }
    this.currentStage = STAGES[nextIndex]!;
    this.appendEvent(`release-event:${observation.observationId}:next`, "STAGE_STARTED", "system:release-governance", this.currentStage, "ORDERED_PROMOTION");
    return this.remember(observation, this.snapshot());
  }

  activateStop(eventId: string, actorId: string): ReleaseRolloutSnapshot {
    if (!eventId || !actorId) throw new ReleaseGovernanceError("RELEASE_TRANSITION_DENIED", "Manual release stop requires Event ID and actor.");
    return this.stop("RELEASE_BLOCKER", eventId, actorId);
  }

  snapshot(): ReleaseRolloutSnapshot {
    return {
      policyVersionId: this.policy.id,
      releaseId: this.policy.releaseId,
      state: this.state,
      currentStage: this.currentStage,
      completedStages: [...this.completedStages],
      approvalRoles: [...this.approvals.keys()].sort(),
      readinessEvidenceId: this.readinessEvidenceId,
      stopReason: this.stopReason,
      eventCount: this.events.length,
      eventChainValid: this.verifyEventChain(),
      externalTrafficAllowed: false,
      productionActivationAllowed: false,
    };
  }

  entries(): readonly ReleaseRolloutEvent[] {
    return structuredClone(this.events);
  }

  private pause(): ReleaseRolloutSnapshot {
    this.state = "PAUSED";
    this.stopReason = "ERROR_BUDGET_HALF_CONSUMED";
    this.appendEvent(`release-event:pause:${this.events.length + 1}`, "ROLLOUT_PAUSED", "system:release-governance", this.currentStage, "ERROR_BUDGET_HALF_CONSUMED");
    return this.snapshot();
  }

  private stop(reason: "RELEASE_BLOCKER", eventId = `stop:${this.events.length + 1}`, actorId = "system:release-governance"): ReleaseRolloutSnapshot {
    if (this.state === "STOPPED") return this.snapshot();
    this.state = "STOPPED";
    this.stopReason = reason;
    this.appendEvent(`release-event:${eventId}`, "ROLLOUT_STOPPED", actorId, this.currentStage, reason);
    return this.snapshot();
  }

  private remember(observation: ReleaseStageObservation, snapshot: ReleaseRolloutSnapshot): ReleaseRolloutSnapshot {
    this.observations.set(observation.observationId, { intentHash: releaseEvidenceHash(observation), snapshot: structuredClone(snapshot) });
    return snapshot;
  }

  private appendEvent(
    eventId: string,
    type: ReleaseRolloutEvent["type"],
    actorId: string,
    stage: ReleaseStage | null,
    reason: ReleaseRolloutEvent["reason"],
  ): void {
    const previousEventHash = this.events.at(-1)?.eventHash ?? null;
    const intent = {
      sequence: this.events.length + 1,
      eventId,
      type,
      actorKeyHash: releaseEvidenceHash(actorId),
      stage,
      reason,
      occurredAt: this.now().toISOString(),
      previousEventHash,
    };
    this.events.push({ ...intent, eventHash: releaseEvidenceHash(intent) });
  }

  private verifyEventChain(): boolean {
    let prior: string | null = null;
    return this.events.every((event, index) => {
      const { eventHash, ...intent } = event;
      const valid = event.sequence === index + 1 && event.previousEventHash === prior && eventHash === releaseEvidenceHash(intent);
      prior = eventHash;
      return valid;
    });
  }
}
