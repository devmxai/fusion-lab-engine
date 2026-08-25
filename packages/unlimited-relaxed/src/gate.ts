import { evidenceHash } from "./canonical.ts";
import type {
  Gate15Decision,
  Gate15FormalBlocker,
  Gate15FormalDependencies,
  Gate15LocalDecisionReason,
  Gate15LocalEvidence,
} from "./types.ts";
import { UnlimitedRelaxedError } from "./types.ts";

function unsigned(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new UnlimitedRelaxedError("INVALID_GATE_15_EVIDENCE", "Gate 15 financial evidence must use unsigned integer microusd strings.");
  }
  return BigInt(value);
}

function validateEvidence(evidence: Gate15LocalEvidence): void {
  const counts = [
    evidence.offerPolicyCount,
    evidence.truthfulOfferDisclosureCount,
    evidence.hiddenCapViolationCount,
    evidence.hiddenModelSubstitutionViolationCount,
    evidence.restrictedRouteViolationCount,
    evidence.riskReportCount,
    evidence.representativeRiskReportCount,
    evidence.percentileReportCount,
    evidence.priceShockScenarioCount,
    evidence.heavyUserScenarioCount,
    evidence.averageOnlyDecisionCount,
    evidence.budgetBreachScenarioCount,
    evidence.pilotControlPolicyCount,
    evidence.localLegalApprovalCount,
    evidence.localFinanceApprovalCount,
    evidence.killedPolicyReopenCount,
    evidence.externalDispatchCount,
    evidence.productionActivationCount,
  ];
  [
    evidence.allowedCohortCogsMicrousd,
    evidence.availableCohortCogsMicrousd,
    evidence.reservedCohortCogsMicrousd,
    evidence.settledCohortCogsMicrousd,
    evidence.customerCreditsChargedMicrousd,
    evidence.maximumProjectedCohortLossMicrousd,
    evidence.approvedCohortLossBudgetMicrousd,
  ].forEach(unsigned);
  if (!evidence.evidenceId
    || Number.isNaN(Date.parse(evidence.observedAt))
    || counts.some((value) => !Number.isInteger(value) || value < 0)
    || evidence.truthfulOfferDisclosureCount > evidence.offerPolicyCount
    || evidence.representativeRiskReportCount > evidence.riskReportCount
    || evidence.percentileReportCount > evidence.riskReportCount) {
    throw new UnlimitedRelaxedError("INVALID_GATE_15_EVIDENCE", "Gate 15 evidence must be a valid bounded immutable report.");
  }
}

export function evaluateGate15(input: {
  local: Gate15LocalEvidence;
  formal: Gate15FormalDependencies;
  now?: Date;
}): Gate15Decision {
  validateEvidence(input.local);
  const evaluatedAt = input.now ?? new Date();
  if (Number.isNaN(evaluatedAt.getTime())) {
    throw new UnlimitedRelaxedError("INVALID_GATE_15_EVIDENCE", "Gate 15 evaluation time must be valid.");
  }

  const localReasons: Gate15LocalDecisionReason[] = [];
  if (!input.local.offerContractTestsPassed) localReasons.push("OFFER_CONTRACT_TESTS_FAILED");
  if (!input.local.cohortBudgetTestsPassed) localReasons.push("COHORT_BUDGET_TESTS_FAILED");
  if (!input.local.riskModelTestsPassed) localReasons.push("RISK_MODEL_TESTS_FAILED");
  if (!input.local.pilotControlTestsPassed) localReasons.push("PILOT_CONTROL_TESTS_FAILED");
  if (input.local.offerPolicyCount === 0
    || input.local.truthfulOfferDisclosureCount !== input.local.offerPolicyCount) {
    localReasons.push("TRUTHFUL_OFFER_EVIDENCE_INCOMPLETE");
  }
  if (input.local.hiddenCapViolationCount > 0) localReasons.push("HIDDEN_CAP_DETECTED");
  if (input.local.hiddenModelSubstitutionViolationCount > 0) {
    localReasons.push("HIDDEN_MODEL_SUBSTITUTION_DETECTED");
  }
  if (input.local.restrictedRouteViolationCount > 0) localReasons.push("RESTRICTED_ROUTE_BREACH");

  const allowed = unsigned(input.local.allowedCohortCogsMicrousd);
  const available = unsigned(input.local.availableCohortCogsMicrousd);
  const reserved = unsigned(input.local.reservedCohortCogsMicrousd);
  const settled = unsigned(input.local.settledCohortCogsMicrousd);
  if (allowed === 0n
    || available + reserved + settled !== allowed
    || !input.local.cohortBudgetLedgerChainVerified
    || !input.local.cohortBudgetProjectionReconciled) {
    localReasons.push("COHORT_BUDGET_RECONCILIATION_FAILED");
  }
  if (unsigned(input.local.customerCreditsChargedMicrousd) !== 0n) {
    localReasons.push("CUSTOMER_CREDIT_CHARGE_DETECTED");
  }

  if (input.local.riskReportCount === 0
    || input.local.representativeRiskReportCount !== input.local.riskReportCount
    || input.local.percentileReportCount !== input.local.riskReportCount) {
    localReasons.push("RISK_EVIDENCE_INCOMPLETE");
  }
  if (input.local.priceShockScenarioCount === 0 || input.local.heavyUserScenarioCount === 0) {
    localReasons.push("SHOCK_HEAVY_USER_EVIDENCE_INCOMPLETE");
  }
  if (input.local.averageOnlyDecisionCount > 0) localReasons.push("AVERAGE_ONLY_DECISION_DETECTED");
  if (input.local.budgetBreachScenarioCount > 0
    || unsigned(input.local.maximumProjectedCohortLossMicrousd) > unsigned(input.local.approvedCohortLossBudgetMicrousd)) {
    localReasons.push("COHORT_LOSS_BUDGET_BREACH");
  }

  if (input.local.pilotControlPolicyCount === 0
    || input.local.localLegalApprovalCount === 0
    || input.local.localFinanceApprovalCount === 0) {
    localReasons.push("LEGAL_FINANCE_CONTROL_EVIDENCE_INCOMPLETE");
  }
  if (!input.local.salesStopDrillPassed) localReasons.push("SALES_STOP_DRILL_NOT_PASSED");
  if (!input.local.killSwitchDrillPassed) localReasons.push("KILL_SWITCH_DRILL_NOT_PASSED");
  if (input.local.killedPolicyReopenCount > 0) localReasons.push("KILLED_POLICY_REOPENED");
  if (input.local.externalDispatchCount > 0) localReasons.push("LOCAL_EXTERNAL_DISPATCH_DETECTED");
  if (input.local.productionActivationCount > 0) localReasons.push("LOCAL_PRODUCTION_ACTIVATION_DETECTED");

  const formalBlockers: Gate15FormalBlocker[] = [];
  if (!input.formal.formalGate14Passed) formalBlockers.push("FORMAL_GATE_14_NOT_PASSED");
  if (!input.formal.representativeSixtyDayOrTwoCycleDataAvailable) {
    formalBlockers.push("REPRESENTATIVE_60_DAY_OR_TWO_CYCLE_DATA_MISSING");
  }
  if (!input.formal.publishedFairUseLegallyApproved) {
    formalBlockers.push("PUBLISHED_FAIR_USE_LEGAL_APPROVAL_MISSING");
  }
  if (!input.formal.cohortBudgetFinanceApproved) {
    formalBlockers.push("COHORT_BUDGET_FINANCE_APPROVAL_MISSING");
  }
  if (!input.formal.realCohortLossWithinApprovedBudget) {
    formalBlockers.push("REAL_COHORT_LOSS_EVIDENCE_NOT_WITHIN_BUDGET");
  }
  if (!input.formal.realSalesStopKillSwitchDrillPassed) {
    formalBlockers.push("REAL_SALES_STOP_KILL_SWITCH_DRILL_NOT_PASSED");
  }
  if (!input.formal.namedLegalFinanceApprovals) formalBlockers.push("NAMED_LEGAL_FINANCE_APPROVALS_MISSING");

  const localImplementationDecision: Gate15Decision["localImplementationDecision"] = localReasons.length === 0 ? "PASS" : "HOLD";
  const formalGateDecision: Gate15Decision["formalGateDecision"] = localImplementationDecision === "PASS" && formalBlockers.length === 0 ? "PASS" : "HOLD";
  const evidenceDigest = evidenceHash(input.local);
  const decisionWithoutHash = {
    gate: 15 as const,
    evaluatedAt: evaluatedAt.toISOString(),
    evidenceHash: evidenceDigest,
    localImplementationDecision,
    formalGateDecision,
    localReasons,
    formalBlockers,
    productionAuthorizationGranted: formalGateDecision === "PASS",
    unlimitedRelaxedPilotActivationAuthorized: formalGateDecision === "PASS",
  };
  return { ...decisionWithoutHash, decisionHash: evidenceHash(decisionWithoutHash) };
}
