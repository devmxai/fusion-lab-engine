import { evidenceHash } from "./canonical.ts";
import type {
  UnlimitedCohortBudgetSnapshot,
  UnlimitedPilotAccessDecision,
  UnlimitedPilotControlEvent,
  UnlimitedPilotControlPolicyVersion,
  UnlimitedPilotControlSnapshot,
  UnlimitedRiskReport,
} from "./types.ts";
import { UnlimitedRelaxedError } from "./types.ts";

type OpenProposal = {
  changeId: string;
  makerId: string;
  intentHash: string;
  approvals: Map<"LEGAL" | "FINANCE", { approvalId: string; actorId: string; intentHash: string }>;
};

function validatePolicy(policy: UnlimitedPilotControlPolicyVersion): void {
  if (!policy.id
    || !policy.policyKey.trim()
    || !policy.offerPolicyVersionId
    || !policy.cohortBudgetPolicyVersionId
    || !policy.riskModelPolicyVersionId
    || !Number.isInteger(policy.version)
    || policy.version <= 0
    || policy.lifecycle !== "PUBLISHED"
    || !Number.isInteger(policy.maximumCohortMembers)
    || policy.maximumCohortMembers <= 0
    || !Number.isInteger(policy.minimumRemainingBudgetBpsForNewSales)
    || policy.minimumRemainingBudgetBpsForNewSales <= 0
    || policy.minimumRemainingBudgetBpsForNewSales >= 10_000
    || !Number.isInteger(policy.maximumQueueAgeSecondsForNewSales)
    || policy.maximumQueueAgeSecondsForNewSales <= 0
    || policy.requiredOpenApprovalRoles.join(",") !== "LEGAL,FINANCE"
    || policy.makerCheckerRequired !== true
    || policy.salesStopDefault !== true
    || policy.killSwitchMode !== "IMMEDIATE_NEW_OPERATION_STOP"
    || policy.inFlightPolicy !== "SETTLE_OR_RELEASE_NO_REDISPATCH"
    || policy.productionActivationAllowed !== false
    || Number.isNaN(Date.parse(policy.publishedAt))) {
    throw new UnlimitedRelaxedError("INVALID_PILOT_CONTROL_POLICY", "Pilot Control Policy must require maker-checker Legal/Finance approval, default Sales Stop and immediate Kill Switch without Production authority.");
  }
}

function budgetEvidenceValid(budget: UnlimitedCohortBudgetSnapshot): boolean {
  const money = [
    budget.allowedCohortCogsMicrousd,
    budget.availableCohortCogsMicrousd,
    budget.reservedCohortCogsMicrousd,
    budget.settledCohortCogsMicrousd,
  ];
  if (money.some((value) => !/^\d+$/.test(value))) return false;
  const [allowed, available, reserved, settled] = money.map(BigInt) as [bigint, bigint, bigint, bigint];
  return allowed > 0n
    && available + reserved + settled === allowed
    && budget.customerCreditsCharged === "0"
    && budget.ledgerChainValid
    && budget.projectionReconciled;
}

function riskEvidenceValid(risk: UnlimitedRiskReport): boolean {
  const { evidenceHash: riskEvidenceHash, ...riskEvidence } = risk;
  const anyBreach = risk.scenarios.some(({ budgetBreached }) => budgetBreached);
  const semanticOutcome = risk.dataReadiness === "INSUFFICIENT_DATA"
    ? risk.riskOutcome === "INSUFFICIENT_DATA"
    : anyBreach
      ? risk.riskOutcome === "BUDGET_BREACH_PROJECTED"
      : risk.riskOutcome === "WITHIN_APPROVED_BUDGET";
  return riskEvidenceHash === evidenceHash(riskEvidence) && semanticOutcome;
}

function validateEvidence(
  policy: UnlimitedPilotControlPolicyVersion,
  risk: UnlimitedRiskReport,
  budget: UnlimitedCohortBudgetSnapshot,
): void {
  if (!riskEvidenceValid(risk)
    || risk.policyVersionId !== policy.riskModelPolicyVersionId
    || risk.offerPolicyVersionId !== policy.offerPolicyVersionId
    || risk.cohortBudgetPolicyVersionId !== policy.cohortBudgetPolicyVersionId
    || budget.policyVersionId !== policy.cohortBudgetPolicyVersionId
    || budget.offerPolicyVersionId !== policy.offerPolicyVersionId
    || risk.cohortId !== budget.cohortId
    || risk.dataReadiness !== "REPRESENTATIVE"
    || risk.riskOutcome !== "WITHIN_APPROVED_BUDGET"
    || risk.simulationOnly !== true
    || risk.pilotActivationAllowed !== false
    || risk.externalDispatchPerformed !== false
    || !budgetEvidenceValid(budget)
    || budget.pilotActivationAllowed !== false
    || budget.externalDispatchPerformed !== false) {
    throw new UnlimitedRelaxedError("INVALID_PILOT_CONTROL_EVIDENCE", "Opening local Pilot simulation requires representative within-budget Risk evidence and a matching reconciled Cohort Budget.");
  }
}

export class InMemoryUnlimitedPilotController {
  private state: UnlimitedPilotControlSnapshot["state"] = "CLOSED";
  private stopReason: UnlimitedPilotControlSnapshot["stopReason"] = null;
  private proposal: OpenProposal | null = null;
  private readonly events: UnlimitedPilotControlEvent[] = [];
  private readonly commandIntents = new Map<string, string>();

  constructor(
    private readonly policy: UnlimitedPilotControlPolicyVersion,
    private readonly now: () => Date = () => new Date(),
  ) {
    validatePolicy(policy);
  }

  proposeSimulationOpen(input: {
    changeId: string;
    makerId: string;
    risk: UnlimitedRiskReport;
    budget: UnlimitedCohortBudgetSnapshot;
  }): UnlimitedPilotControlSnapshot {
    if (this.state === "KILLED") {
      throw new UnlimitedRelaxedError("PILOT_CONTROL_TRANSITION_DENIED", "A killed Pilot controller cannot reopen under the same Policy Version.");
    }
    validateEvidence(this.policy, input.risk, input.budget);
    const intentHash = evidenceHash(input);
    if (this.proposal) {
      if (this.proposal.changeId === input.changeId && this.proposal.intentHash === intentHash) return this.snapshot();
      throw new UnlimitedRelaxedError("PILOT_CONTROL_REQUEST_CONFLICT", "Only one immutable open proposal may exist under this local Policy instance.");
    }
    if (!input.changeId || !input.makerId) {
      throw new UnlimitedRelaxedError("PILOT_CONTROL_APPROVAL_DENIED", "Open proposal requires a server-owned Change ID and maker.");
    }
    this.proposal = { changeId: input.changeId, makerId: input.makerId, intentHash, approvals: new Map() };
    this.appendEvent(`pilot-event:${input.changeId}:proposed`, "OPEN_PROPOSED", input.changeId, input.makerId, "LOCAL_OPEN_PROPOSAL");
    return this.snapshot();
  }

  approveSimulationOpen(input: {
    approvalId: string;
    changeId: string;
    actorId: string;
    role: "LEGAL" | "FINANCE";
  }): UnlimitedPilotControlSnapshot {
    const proposal = this.proposal;
    if (!proposal || proposal.changeId !== input.changeId || this.state === "KILLED") {
      throw new UnlimitedRelaxedError("PILOT_CONTROL_TRANSITION_DENIED", "Approval requires the active open proposal and a non-killed controller.");
    }
    const intentHash = evidenceHash(input);
    const commandKey = `approval:${input.approvalId}`;
    const previousIntent = this.commandIntents.get(commandKey);
    if (previousIntent) {
      if (previousIntent === intentHash) return this.snapshot();
      throw new UnlimitedRelaxedError("PILOT_CONTROL_REQUEST_CONFLICT", "Approval ID was reused with different intent.");
    }
    const actorAlreadyApproved = [...proposal.approvals.values()].some(({ actorId }) => actorId === input.actorId);
    if (!input.approvalId
      || !input.actorId
      || input.actorId === proposal.makerId
      || actorAlreadyApproved
      || proposal.approvals.has(input.role)) {
      throw new UnlimitedRelaxedError("PILOT_CONTROL_APPROVAL_DENIED", "Legal and Finance approvals require distinct actors independent from the maker.");
    }
    proposal.approvals.set(input.role, { approvalId: input.approvalId, actorId: input.actorId, intentHash });
    this.commandIntents.set(commandKey, intentHash);
    this.appendEvent(
      `pilot-event:${input.approvalId}`,
      "OPEN_APPROVED",
      input.changeId,
      input.actorId,
      input.role === "LEGAL" ? "LEGAL_APPROVAL" : "FINANCE_APPROVAL",
    );
    if (proposal.approvals.has("LEGAL") && proposal.approvals.has("FINANCE")) {
      this.state = "SIMULATION_OPEN";
      this.stopReason = null;
      this.appendEvent(
        `pilot-event:${input.changeId}:opened`,
        "SIMULATION_OPENED",
        input.changeId,
        "system:pilot-controller",
        "DUAL_APPROVAL_COMPLETE",
      );
    }
    return this.snapshot();
  }

  evaluateHealth(input: {
    evaluationId: string;
    risk: UnlimitedRiskReport;
    budget: UnlimitedCohortBudgetSnapshot;
    oldestQueueAgeSeconds: number;
  }): UnlimitedPilotControlSnapshot {
    const intentHash = evidenceHash(input);
    const commandKey = `health:${input.evaluationId}`;
    const previous = this.commandIntents.get(commandKey);
    if (previous) {
      if (previous === intentHash) return this.snapshot();
      throw new UnlimitedRelaxedError("PILOT_CONTROL_REQUEST_CONFLICT", "Health Evaluation ID was reused with different evidence.");
    }
    if (!input.evaluationId
      || !Number.isInteger(input.oldestQueueAgeSeconds)
      || input.oldestQueueAgeSeconds < 0
      || !riskEvidenceValid(input.risk)
      || input.risk.policyVersionId !== this.policy.riskModelPolicyVersionId
      || input.budget.policyVersionId !== this.policy.cohortBudgetPolicyVersionId
      || input.budget.offerPolicyVersionId !== this.policy.offerPolicyVersionId
      || input.risk.cohortBudgetPolicyVersionId !== input.budget.policyVersionId
      || input.risk.cohortId !== input.budget.cohortId) {
      throw new UnlimitedRelaxedError("INVALID_PILOT_CONTROL_EVIDENCE", "Health evaluation requires valid pinned Risk, Budget and queue evidence.");
    }
    this.commandIntents.set(commandKey, intentHash);
    if (this.state === "KILLED") return this.snapshot();
    if (!budgetEvidenceValid(input.budget)) {
      return this.kill(input.evaluationId, "system:health", "BUDGET_RECONCILIATION_FAILURE");
    }
    if (input.risk.riskOutcome === "BUDGET_BREACH_PROJECTED") {
      return this.kill(input.evaluationId, "system:health", "RISK_BUDGET_BREACH");
    }
    const allowed = BigInt(input.budget.allowedCohortCogsMicrousd);
    const available = BigInt(input.budget.availableCohortCogsMicrousd);
    const remainingBps = allowed === 0n ? 0n : available * 10_000n / allowed;
    if (remainingBps < BigInt(this.policy.minimumRemainingBudgetBpsForNewSales)) {
      return this.salesStop(input.evaluationId, "system:health", "LOW_REMAINING_BUDGET");
    }
    if (input.oldestQueueAgeSeconds > this.policy.maximumQueueAgeSecondsForNewSales) {
      return this.salesStop(input.evaluationId, "system:health", "QUEUE_AGE_BREACH");
    }
    this.appendEvent(`pilot-event:${input.evaluationId}`, "HEALTH_EVALUATED", null, "system:health", "HEALTHY_NO_CHANGE");
    return this.snapshot();
  }

  activateSalesStop(eventId: string, actorId: string): UnlimitedPilotControlSnapshot {
    return this.salesStop(eventId, actorId, "MANUAL_SALES_STOP");
  }

  activateKillSwitch(eventId: string, actorId: string): UnlimitedPilotControlSnapshot {
    return this.kill(eventId, actorId, "MANUAL_KILL");
  }

  decideAccess(memberAlreadyAuthorized: boolean, currentCohortMemberCount = 0): UnlimitedPilotAccessDecision {
    if (!Number.isInteger(currentCohortMemberCount) || currentCohortMemberCount < 0) {
      throw new UnlimitedRelaxedError("INVALID_PILOT_CONTROL_EVIDENCE", "Cohort member count must be a non-negative integer.");
    }
    const memberLimitReached = currentCohortMemberCount >= this.policy.maximumCohortMembers;
    const admission = this.state === "SIMULATION_OPEN" && !memberLimitReached;
    const operation = memberAlreadyAuthorized && (this.state === "SIMULATION_OPEN" || this.state === "SALES_STOPPED");
    const reason = this.state === "SIMULATION_OPEN"
      ? memberLimitReached ? "COHORT_MEMBER_LIMIT_REACHED" : "SIMULATION_OPEN"
      : this.state === "SALES_STOPPED"
        ? "SALES_STOPPED"
        : this.state === "KILLED" ? "KILL_SWITCH_ACTIVE" : "CONTROL_CLOSED";
    return {
      policyVersionId: this.policy.id,
      memberAlreadyAuthorized,
      currentCohortMemberCount,
      maximumCohortMembers: this.policy.maximumCohortMembers,
      newMemberAdmissionAllowed: admission,
      newOperationAllowed: operation,
      reason,
      productionAdmissionAllowed: false,
      dispatchMutationPerformed: false,
    };
  }

  entries(): readonly UnlimitedPilotControlEvent[] {
    return structuredClone(this.events);
  }

  snapshot(): UnlimitedPilotControlSnapshot {
    const roles = this.proposal ? [...this.proposal.approvals.keys()].sort() : [];
    return {
      policyVersionId: this.policy.id,
      state: this.state,
      stopReason: this.stopReason,
      newMemberAdmissionAllowed: this.state === "SIMULATION_OPEN",
      existingMemberNewOperationAllowed: this.state === "SIMULATION_OPEN" || this.state === "SALES_STOPPED",
      inFlightPolicy: "SETTLE_OR_RELEASE_NO_REDISPATCH",
      pendingChangeId: this.proposal?.changeId ?? null,
      approvalRoles: roles,
      eventCount: this.events.length,
      eventChainValid: this.verifyEventChain(),
      productionActivationAllowed: false,
      externalDispatchPerformed: false,
    };
  }

  private salesStop(
    eventId: string,
    actorId: string,
    reason: "MANUAL_SALES_STOP" | "LOW_REMAINING_BUDGET" | "QUEUE_AGE_BREACH",
  ): UnlimitedPilotControlSnapshot {
    if (this.state === "KILLED") return this.snapshot();
    const commandKey = `stop:${eventId}`;
    const intentHash = evidenceHash({ eventId, actorId, reason });
    const prior = this.commandIntents.get(commandKey);
    if (prior) {
      if (prior === intentHash) return this.snapshot();
      throw new UnlimitedRelaxedError("PILOT_CONTROL_REQUEST_CONFLICT", "Sales Stop Event ID was reused with different intent.");
    }
    if (!eventId || !actorId) throw new UnlimitedRelaxedError("PILOT_CONTROL_TRANSITION_DENIED", "Sales Stop requires an Event ID and actor.");
    this.commandIntents.set(commandKey, intentHash);
    this.state = "SALES_STOPPED";
    this.stopReason = reason;
    this.appendEvent(`pilot-event:${eventId}`, "SALES_STOPPED", null, actorId, reason);
    return this.snapshot();
  }

  private kill(
    eventId: string,
    actorId: string,
    reason: "MANUAL_KILL" | "RISK_BUDGET_BREACH" | "BUDGET_RECONCILIATION_FAILURE",
  ): UnlimitedPilotControlSnapshot {
    const commandKey = `kill:${eventId}`;
    const intentHash = evidenceHash({ eventId, actorId, reason });
    const prior = this.commandIntents.get(commandKey);
    if (prior) {
      if (prior === intentHash) return this.snapshot();
      throw new UnlimitedRelaxedError("PILOT_CONTROL_REQUEST_CONFLICT", "Kill Switch Event ID was reused with different intent.");
    }
    if (this.state === "KILLED") return this.snapshot();
    if (!eventId || !actorId) throw new UnlimitedRelaxedError("PILOT_CONTROL_TRANSITION_DENIED", "Kill Switch requires an Event ID and actor.");
    this.commandIntents.set(commandKey, intentHash);
    this.state = "KILLED";
    this.stopReason = reason;
    this.appendEvent(`pilot-event:${eventId}`, "KILL_SWITCHED", null, actorId, reason);
    return this.snapshot();
  }

  private appendEvent(
    eventId: string,
    type: UnlimitedPilotControlEvent["type"],
    changeId: string | null,
    actorId: string,
    reason: UnlimitedPilotControlEvent["reason"],
  ): void {
    const sequence = this.events.length + 1;
    const previousEventHash = this.events.at(-1)?.eventHash ?? null;
    const intent = {
      sequence,
      eventId,
      type,
      changeId,
      actorKeyHash: evidenceHash(actorId),
      reason,
      occurredAt: this.now().toISOString(),
      previousEventHash,
    };
    this.events.push({ ...intent, eventHash: evidenceHash(intent) });
  }

  private verifyEventChain(): boolean {
    let previousEventHash: string | null = null;
    return this.events.every((entry, index) => {
      const { eventHash, ...intent } = entry;
      const valid = entry.sequence === index + 1
        && entry.previousEventHash === previousEventHash
        && entry.eventHash === evidenceHash(intent);
      previousEventHash = entry.eventHash;
      return valid;
    });
  }
}
