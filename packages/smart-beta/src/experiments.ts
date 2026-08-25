import { evidenceHash } from "./canonical.ts";
import type {
  ExplorationPlan,
  SmartExperimentOutput,
  SmartExperimentPolicyVersion,
  SmartExperimentRun,
  SmartExperimentSnapshot,
  SmartSelectionAuthorization,
} from "./types.ts";
import { SmartBetaError } from "./types.ts";

type MutableRun = {
  runId: string;
  policyVersionId: string;
  kind: SmartExperimentRun["kind"];
  userKeyHash: string;
  authorizationId: string;
  profileVersionId: string;
  explorationReservationId: string;
  disclosureVersionId: string;
  disclosureText: string;
  contract: SmartExperimentRun["contract"];
  requestedVariations: number | null;
  finalConfirmation: SmartExperimentRun["finalConfirmation"];
  outputs: SmartExperimentOutput[];
  state: SmartExperimentRun["state"];
  platformSubsidized: true;
  customerSurchargeMicrousd: "0";
  customerContractMutationAllowed: false;
  inFlightPolicy: "COMPLETE_PINNED_NO_REDISPATCH";
  dispatchMutationPerformed: false;
  createdAt: string;
  completedAt: string | null;
};

function assertIntegerRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function validatePolicy(policy: SmartExperimentPolicyVersion): void {
  const startsAt = Date.parse(policy.windowStartsAt);
  const endsAt = Date.parse(policy.windowEndsAt);
  const profiles = new Set(policy.eligibleProfileVersionIds);
  let contractValid = policy.contract.kind === policy.kind;
  if (policy.contract.kind === "DRAFT_TO_FINAL") {
    contractValid &&= policy.contract.draftOutputLabel === "DRAFT"
      && policy.contract.finalRequiresSeparateQuote === true
      && policy.contract.finalRequiresExplicitConfirmation === true;
  } else if (policy.contract.kind === "SMART_VARIATIONS") {
    contractValid &&= assertIntegerRange(policy.contract.maxVariations, 2, 4)
      && policy.contract.requirePerOutputModelDisclosure === true;
  } else {
    contractValid &&= assertIntegerRange(policy.contract.maxQueueWaitSeconds, 1, 86_400)
      && assertIntegerRange(policy.contract.maxConcurrency, 1, 100)
      && policy.contract.progressMode === "STAGE_ONLY_NO_PERCENTAGE";
  }
  if (!policy.id
    || !policy.experimentKey.trim()
    || !Number.isInteger(policy.version)
    || policy.version <= 0
    || policy.lifecycle !== "PUBLISHED"
    || policy.eligibleProfileVersionIds.length === 0
    || profiles.size !== policy.eligibleProfileVersionIds.length
    || policy.eligibleProfileVersionIds.some((id) => !id.trim())
    || !policy.explorationPolicyVersionId
    || !policy.disclosureVersionId
    || !policy.disclosureText.trim()
    || !assertIntegerRange(policy.minimumSatisfactionPpm, 0, 1_000_000)
    || !assertIntegerRange(policy.hardFloorMarginBps, 0, 9_999)
    || Number.isNaN(startsAt)
    || Number.isNaN(endsAt)
    || endsAt <= startsAt
    || policy.platformSubsidized !== true
    || policy.customerContractMutationAllowed !== false
    || !contractValid
    || Number.isNaN(Date.parse(policy.publishedAt))) {
    throw new SmartBetaError("INVALID_EXPERIMENT_POLICY", "Experiment Policy must publish an explicit, bounded and platform-subsidized customer contract.");
  }
}

function publicRun(run: MutableRun): SmartExperimentRun {
  return structuredClone(run);
}

export class InMemorySmartExperimentPolicyRegistry {
  private readonly byId = new Map<string, SmartExperimentPolicyVersion>();
  private readonly bySequence = new Map<string, string>();

  publish(policy: SmartExperimentPolicyVersion): SmartExperimentPolicyVersion {
    validatePolicy(policy);
    const existing = this.byId.get(policy.id);
    if (existing) {
      if (evidenceHash(existing) === evidenceHash(policy)) return structuredClone(existing);
      throw new SmartBetaError("IMMUTABLE_EXPERIMENT_POLICY", "A published Experiment Policy version cannot be changed.");
    }
    const sequence = `${policy.experimentKey}:${policy.version}`;
    if (this.bySequence.has(sequence)) {
      throw new SmartBetaError("DUPLICATE_EXPERIMENT_POLICY_SEQUENCE", "Experiment Policy key and version must be unique.");
    }
    const frozen = structuredClone(policy);
    this.byId.set(policy.id, frozen);
    this.bySequence.set(sequence, policy.id);
    return structuredClone(frozen);
  }

  require(policyVersionId: string): SmartExperimentPolicyVersion {
    const policy = this.byId.get(policyVersionId);
    if (!policy) throw new SmartBetaError("EXPERIMENT_POLICY_NOT_FOUND", "Experiment Policy version was not found.");
    return structuredClone(policy);
  }
}

export class InMemorySmartExperimentController {
  private readonly policy: SmartExperimentPolicyVersion;
  private readonly runs = new Map<string, { intentHash: string; run: MutableRun; authorization: SmartSelectionAuthorization }>();
  private killSwitchReason: SmartExperimentSnapshot["killSwitchReason"] = null;

  constructor(
    policy: SmartExperimentPolicyVersion,
    private readonly now: () => Date = () => new Date(),
  ) {
    validatePolicy(policy);
    this.policy = structuredClone(policy);
  }

  plan(input: {
    runId: string;
    userKey: string;
    authorization: SmartSelectionAuthorization;
    explorationPlan: ExplorationPlan;
    requestedVariations?: number;
  }): SmartExperimentRun {
    const plannedAt = this.now();
    const intentHash = evidenceHash(input);
    const previous = this.runs.get(input.runId);
    if (previous) {
      if (previous.intentHash === intentHash) return publicRun(previous.run);
      throw new SmartBetaError("EXPERIMENT_REQUEST_CONFLICT", "Experiment Run ID was reused with different intent.");
    }
    if (this.killSwitchReason) {
      throw new SmartBetaError("EXPERIMENT_KILL_SWITCH_ACTIVE", "New Experiment enrollment is disabled by the kill switch.");
    }
    const authorization = input.authorization;
    const exploration = input.explorationPlan;
    const requestedVariations = this.policy.kind === "SMART_VARIATIONS"
      ? input.requestedVariations ?? 2
      : null;
    const variationContract = this.policy.contract.kind === "SMART_VARIATIONS" ? this.policy.contract : null;
    const validVariations = variationContract
      ? assertIntegerRange(requestedVariations!, 2, variationContract.maxVariations)
      : input.requestedVariations === undefined;
    if (!input.runId
      || !input.userKey
      || Number.isNaN(plannedAt.getTime())
      || plannedAt.getTime() < Date.parse(this.policy.windowStartsAt)
      || plannedAt.getTime() >= Date.parse(this.policy.windowEndsAt)
      || !this.policy.eligibleProfileVersionIds.includes(authorization.profileVersionId)
      || authorization.selectionAuthorityGranted !== true
      || authorization.hiddenSubstitutionAllowed !== false
      || authorization.externalDispatchPerformed !== false
      || authorization.candidateVersions.length === 0
      || exploration.policyVersionId !== this.policy.explorationPolicyVersionId
      || exploration.selection !== "EXPLORATION"
      || !exploration.reservationId
      || exploration.platformFunded !== true
      || exploration.customerQuotedCreditsUnchanged !== true
      || exploration.customerSurchargeMicrousd !== "0"
      || exploration.dispatchMutationPerformed !== false
      || !validVariations) {
      throw new SmartBetaError("INVALID_EXPERIMENT_ENROLLMENT", "Experiment enrollment requires pinned Smart authorization, eligible exploration reserve and unchanged customer economics.");
    }
    const run: MutableRun = {
      runId: input.runId,
      policyVersionId: this.policy.id,
      kind: this.policy.kind,
      userKeyHash: evidenceHash(input.userKey),
      authorizationId: authorization.authorizationId,
      profileVersionId: authorization.profileVersionId,
      explorationReservationId: exploration.reservationId,
      disclosureVersionId: this.policy.disclosureVersionId,
      disclosureText: this.policy.disclosureText,
      contract: structuredClone(this.policy.contract),
      requestedVariations,
      finalConfirmation: null,
      outputs: [],
      state: "PLANNED",
      platformSubsidized: true,
      customerSurchargeMicrousd: "0",
      customerContractMutationAllowed: false,
      inFlightPolicy: "COMPLETE_PINNED_NO_REDISPATCH",
      dispatchMutationPerformed: false,
      createdAt: plannedAt.toISOString(),
      completedAt: null,
    };
    this.runs.set(input.runId, { intentHash, run, authorization: structuredClone(authorization) });
    return publicRun(run);
  }

  confirmFinal(runId: string, confirmationId: string, finalQuoteVersionId: string): SmartExperimentRun {
    const entry = this.requireRun(runId);
    const run = entry.run;
    if (run.kind !== "DRAFT_TO_FINAL" || run.state !== "PLANNED" || !confirmationId || !finalQuoteVersionId) {
      throw new SmartBetaError("INVALID_EXPERIMENT_TRANSITION", "Final confirmation is valid only for a planned Draft-to-Final run with a separate quote.");
    }
    if (run.finalConfirmation) {
      if (run.finalConfirmation.confirmationId === confirmationId
        && run.finalConfirmation.finalQuoteVersionId === finalQuoteVersionId) return publicRun(run);
      throw new SmartBetaError("INVALID_EXPERIMENT_TRANSITION", "Final confirmation is immutable once recorded.");
    }
    run.finalConfirmation = {
      confirmationId,
      finalQuoteVersionId,
      confirmedAt: this.now().toISOString(),
    };
    return publicRun(run);
  }

  recordOutput(runId: string, input: Omit<SmartExperimentOutput, "modelDisclosed" | "evidenceHash">): SmartExperimentRun {
    const entry = this.requireRun(runId);
    const run = entry.run;
    if (run.state !== "PLANNED" || !input.outputId || !Number.isInteger(input.index) || input.index < 0) {
      throw new SmartBetaError("INVALID_EXPERIMENT_TRANSITION", "Outputs can only be recorded on a planned Experiment run.");
    }
    const candidate = entry.authorization.candidateVersions.some((item) =>
      item.familyVersionId === input.actualFamilyVersionId
      && item.modelVersionId === input.actualModelVersionId
      && item.routeVersionId === input.actualRouteVersionId);
    if (!candidate || !this.validOutputSlot(run, input.stage, input.index)) {
      throw new SmartBetaError("INVALID_EXPERIMENT_TRANSITION", "Experiment output must use an authorized model tuple and a valid disclosed stage slot.");
    }
    const intent = { ...input, modelDisclosed: true as const };
    const output: SmartExperimentOutput = { ...intent, evidenceHash: evidenceHash(intent) };
    const sameId = run.outputs.find((item) => item.outputId === input.outputId);
    if (sameId) {
      if (sameId.evidenceHash === output.evidenceHash) return publicRun(run);
      throw new SmartBetaError("EXPERIMENT_OUTPUT_CONFLICT", "Experiment Output ID was reused with different evidence.");
    }
    if (run.outputs.some((item) => item.index === input.index || (run.kind === "DRAFT_TO_FINAL" && item.stage === input.stage))) {
      throw new SmartBetaError("EXPERIMENT_OUTPUT_CONFLICT", "Experiment output slot is already occupied.");
    }
    run.outputs.push(output);
    run.outputs.sort((left, right) => left.index - right.index);
    return publicRun(run);
  }

  complete(runId: string): SmartExperimentRun {
    const run = this.requireRun(runId).run;
    if (run.state === "COMPLETED") return publicRun(run);
    const ready = run.kind === "DRAFT_TO_FINAL"
      ? Boolean(run.finalConfirmation) && run.outputs.some((item) => item.stage === "DRAFT") && run.outputs.some((item) => item.stage === "FINAL")
      : run.kind === "SMART_VARIATIONS"
        ? run.outputs.length === run.requestedVariations && run.outputs.every((item) => item.stage === "VARIATION")
        : run.outputs.length === 1 && run.outputs[0]?.stage === "RELAXED_RESULT";
    if (!ready) throw new SmartBetaError("INVALID_EXPERIMENT_TRANSITION", "Experiment cannot complete until every promised, disclosed output is recorded.");
    run.state = "COMPLETED";
    run.completedAt = this.now().toISOString();
    return publicRun(run);
  }

  evaluateCohort(input: { satisfactionPpm: number; marginBps: number; sampleCount: number }): SmartExperimentSnapshot {
    if (!assertIntegerRange(input.satisfactionPpm, 0, 1_000_000)
      || !assertIntegerRange(input.marginBps, -10_000, 10_000)
      || !Number.isInteger(input.sampleCount)
      || input.sampleCount <= 0) {
      throw new SmartBetaError("INVALID_EXPERIMENT_TRANSITION", "Cohort evidence must contain bounded integer metrics and a positive sample count.");
    }
    if (input.marginBps < this.policy.hardFloorMarginBps) this.killSwitchReason = "MARGIN_FLOOR_BREACH";
    else if (input.satisfactionPpm < this.policy.minimumSatisfactionPpm) this.killSwitchReason = "SATISFACTION_REGRESSION";
    return this.snapshot();
  }

  activateKillSwitch(): SmartExperimentSnapshot {
    this.killSwitchReason = "MANUAL";
    return this.snapshot();
  }

  get(runId: string): SmartExperimentRun {
    return publicRun(this.requireRun(runId).run);
  }

  snapshot(): SmartExperimentSnapshot {
    const runs = [...this.runs.values()].map(({ run }) => run);
    return {
      policyVersionId: this.policy.id,
      kind: this.policy.kind,
      killSwitchActive: this.killSwitchReason !== null,
      killSwitchReason: this.killSwitchReason,
      newEnrollmentAllowed: this.killSwitchReason === null,
      plannedRunCount: runs.filter((run) => run.state === "PLANNED").length,
      completedRunCount: runs.filter((run) => run.state === "COMPLETED").length,
      customerSurchargeMicrousd: "0",
      externalDispatchPerformed: false,
    };
  }

  private validOutputSlot(run: MutableRun, stage: SmartExperimentOutput["stage"], index: number): boolean {
    if (run.kind === "DRAFT_TO_FINAL") {
      if (stage === "DRAFT") return index === 0;
      return stage === "FINAL" && index === 1 && run.finalConfirmation !== null;
    }
    if (run.kind === "SMART_VARIATIONS") {
      return stage === "VARIATION" && index < (run.requestedVariations ?? 0);
    }
    return stage === "RELAXED_RESULT" && index === 0;
  }

  private requireRun(runId: string): { intentHash: string; run: MutableRun; authorization: SmartSelectionAuthorization } {
    const run = this.runs.get(runId);
    if (!run) throw new SmartBetaError("INVALID_EXPERIMENT_TRANSITION", "Experiment run was not found.");
    return run;
  }
}
