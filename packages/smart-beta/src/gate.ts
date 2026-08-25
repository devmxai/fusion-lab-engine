import { evidenceHash } from "./canonical.ts";
import type {
  Gate14Decision,
  Gate14FormalBlocker,
  Gate14FormalDependencies,
  Gate14LocalDecisionReason,
  Gate14LocalEvidence,
} from "./types.ts";
import { SmartBetaError } from "./types.ts";

function unsigned(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new SmartBetaError("INVALID_GATE_14_EVIDENCE", "Gate 14 financial evidence must use unsigned integer microusd strings.");
  }
  return BigInt(value);
}

function validateEvidence(evidence: Gate14LocalEvidence): void {
  const counts = [
    evidence.smartAuthorizationCount,
    evidence.resultDisclosureCount,
    evidence.hiddenSubstitutionViolationCount,
    evidence.feedbackEventCount,
    evidence.automatedEvaluationCount,
    evidence.readyEvaluationReportCount,
    evidence.explorationReservationCount,
    evidence.experimentPolicyCount,
    evidence.experimentCompletedRunCount,
    evidence.experimentOutputCount,
    evidence.experimentDisclosedOutputCount,
    evidence.marginFloorBreachCount,
    evidence.cfoAdvisorReportCount,
    evidence.cfoAdvisorProposalCount,
    evidence.cfoAdvisorRuntimeMutationCount,
    evidence.externalDispatchCount,
  ];
  unsigned(evidence.explorationReservedMicrousd);
  unsigned(evidence.explorationSettledMicrousd);
  unsigned(evidence.explorationReleasedMicrousd);
  unsigned(evidence.customerExplorationSurchargeMicrousd);
  if (!evidence.evidenceId
    || Number.isNaN(Date.parse(evidence.observedAt))
    || counts.some((value) => !Number.isInteger(value) || value < 0)
    || !Number.isInteger(evidence.explorationAllocationBps)
    || evidence.explorationAllocationBps < 0
    || evidence.explorationAllocationBps > 10_000
    || !Number.isInteger(evidence.observedSatisfactionPpm)
    || evidence.observedSatisfactionPpm < 0
    || evidence.observedSatisfactionPpm > 1_000_000
    || !Number.isInteger(evidence.minimumSatisfactionPpm)
    || evidence.minimumSatisfactionPpm < 0
    || evidence.minimumSatisfactionPpm > 1_000_000
    || evidence.resultDisclosureCount > evidence.smartAuthorizationCount
    || evidence.experimentDisclosedOutputCount > evidence.experimentOutputCount) {
    throw new SmartBetaError("INVALID_GATE_14_EVIDENCE", "Gate 14 evidence must be a valid bounded immutable report.");
  }
}

export function evaluateGate14(input: {
  local: Gate14LocalEvidence;
  formal: Gate14FormalDependencies;
  now?: Date;
}): Gate14Decision {
  validateEvidence(input.local);
  const evaluatedAt = input.now ?? new Date();
  if (Number.isNaN(evaluatedAt.getTime())) {
    throw new SmartBetaError("INVALID_GATE_14_EVIDENCE", "Gate 14 evaluation time must be valid.");
  }
  const localReasons: Gate14LocalDecisionReason[] = [];
  if (!input.local.optInProfileTestsPassed) localReasons.push("OPT_IN_PROFILE_TESTS_FAILED");
  if (!input.local.feedbackEvaluationTestsPassed) localReasons.push("FEEDBACK_EVALUATION_TESTS_FAILED");
  if (!input.local.explorationBudgetTestsPassed) localReasons.push("EXPLORATION_BUDGET_TESTS_FAILED");
  if (!input.local.experimentContractTestsPassed) localReasons.push("EXPERIMENT_CONTRACT_TESTS_FAILED");
  if (!input.local.cfoAdvisorTestsPassed) localReasons.push("CFO_ADVISOR_TESTS_FAILED");
  if (input.local.smartAuthorizationCount === 0
    || input.local.resultDisclosureCount !== input.local.smartAuthorizationCount) {
    localReasons.push("OPT_IN_DISCLOSURE_INCOMPLETE");
  }
  if (input.local.hiddenSubstitutionViolationCount > 0) localReasons.push("HIDDEN_SUBSTITUTION_DETECTED");
  if (input.local.feedbackEventCount === 0
    || input.local.automatedEvaluationCount === 0
    || input.local.readyEvaluationReportCount === 0) {
    localReasons.push("EVALUATION_EVIDENCE_INCOMPLETE");
  }
  if (input.local.explorationAllocationBps < 100 || input.local.explorationAllocationBps > 500) {
    localReasons.push("EXPLORATION_ALLOCATION_OUT_OF_BOUNDS");
  }
  const reserved = unsigned(input.local.explorationReservedMicrousd);
  const settled = unsigned(input.local.explorationSettledMicrousd);
  const released = unsigned(input.local.explorationReleasedMicrousd);
  if (input.local.explorationReservationCount === 0 || reserved === 0n || reserved !== settled + released) {
    localReasons.push("EXPLORATION_RECONCILIATION_FAILED");
  }
  if (unsigned(input.local.customerExplorationSurchargeMicrousd) !== 0n) {
    localReasons.push("CUSTOMER_SURCHARGE_DETECTED");
  }
  if (input.local.experimentPolicyCount < 3 || input.local.experimentCompletedRunCount < 3) {
    localReasons.push("EXPERIMENT_CONTRACTS_INCOMPLETE");
  }
  if (input.local.experimentOutputCount === 0
    || input.local.experimentDisclosedOutputCount !== input.local.experimentOutputCount) {
    localReasons.push("OUTPUT_DISCLOSURE_INCOMPLETE");
  }
  if (input.local.marginFloorBreachCount > 0) localReasons.push("MARGIN_FLOOR_BREACH");
  if (input.local.observedSatisfactionPpm < input.local.minimumSatisfactionPpm) {
    localReasons.push("SATISFACTION_BELOW_LIMIT");
  }
  if (!input.local.killSwitchDrillPassed) localReasons.push("KILL_SWITCH_DRILL_NOT_PASSED");
  if (input.local.cfoAdvisorReportCount === 0) localReasons.push("CFO_ADVISOR_EVIDENCE_INCOMPLETE");
  if (!input.local.cfoAdvisorProposalChainVerified) localReasons.push("CFO_ADVISOR_CHAIN_NOT_VERIFIED");
  if (input.local.cfoAdvisorRuntimeMutationCount > 0) {
    localReasons.push("CFO_ADVISOR_EXECUTION_AUTHORITY_DETECTED");
  }
  if (input.local.externalDispatchCount > 0) localReasons.push("LOCAL_EXTERNAL_DISPATCH_DETECTED");

  const formalBlockers: Gate14FormalBlocker[] = [];
  if (!input.formal.formalGate13Passed) formalBlockers.push("FORMAL_GATE_13_NOT_PASSED");
  if (!input.formal.representativeSmartBetaDataAvailable) formalBlockers.push("REPRESENTATIVE_SMART_BETA_DATA_MISSING");
  if (!input.formal.realConsentDisclosureEvidenceVerified) formalBlockers.push("REAL_CONSENT_DISCLOSURE_EVIDENCE_MISSING");
  if (!input.formal.fundedExplorationBudgetApproved) formalBlockers.push("FUNDED_EXPLORATION_BUDGET_NOT_APPROVED");
  if (!input.formal.privacyLegalExperimentApproval) formalBlockers.push("PRIVACY_LEGAL_EXPERIMENT_APPROVAL_MISSING");
  if (!input.formal.realSmartBetaCanaryCompleted) formalBlockers.push("REAL_SMART_BETA_CANARY_NOT_COMPLETED");
  if (!input.formal.productionKillSwitchDrillPassed) formalBlockers.push("PRODUCTION_KILL_SWITCH_DRILL_NOT_PASSED");
  if (!input.formal.observedSatisfactionAndMarginLimitsPassed) {
    formalBlockers.push("OBSERVED_SATISFACTION_MARGIN_LIMITS_NOT_PASSED");
  }
  if (!input.formal.namedProductFinanceReliabilityApprovals) formalBlockers.push("NAMED_APPROVALS_MISSING");

  const localImplementationDecision: Gate14Decision["localImplementationDecision"] = localReasons.length === 0 ? "PASS" : "HOLD";
  const formalGateDecision: Gate14Decision["formalGateDecision"] = localImplementationDecision === "PASS" && formalBlockers.length === 0 ? "PASS" : "HOLD";
  const evidenceDigest = evidenceHash(input.local);
  const decisionWithoutHash = {
    gate: 14 as const,
    evaluatedAt: evaluatedAt.toISOString(),
    evidenceHash: evidenceDigest,
    localImplementationDecision,
    formalGateDecision,
    localReasons,
    formalBlockers,
    productionAuthorizationGranted: formalGateDecision === "PASS",
    smartBetaActivationAuthorized: formalGateDecision === "PASS",
  };
  return { ...decisionWithoutHash, decisionHash: evidenceHash(decisionWithoutHash) };
}
