import type {
  Gate13Decision,
  Gate13DecisionReason,
  Gate13FormalDependencies,
  Gate13LocalEvidence,
} from "./types.ts";
import { ProfitRouterError } from "./types.ts";

const COMPLETE_CANARY_LADDER = [100, 500, 1000, 2500, 5000, 10000] as const;

function validateEvidence(evidence: Gate13LocalEvidence): void {
  const integerFields = [
    evidence.shadowDecisionCount,
    evidence.replayMatchCount,
    evidence.selectedHardGateViolationCount,
    evidence.marginFloorBreachCount,
    evidence.qualityRegressionPpm,
    evidence.maximumAllowedQualityRegressionPpm,
    evidence.reliabilityRegressionPpm,
    evidence.maximumAllowedReliabilityRegressionPpm,
    evidence.p95LatencyRegressionBps,
    evidence.maximumAllowedP95LatencyRegressionBps,
    evidence.actualCostReconciliationBps,
    evidence.minimumActualCostReconciliationBps,
    evidence.externalDispatchCount,
  ];
  if (!evidence.evidenceId
    || Number.isNaN(Date.parse(evidence.observedAt))
    || integerFields.some((value) => !Number.isInteger(value) || value < 0)
    || evidence.replayMatchCount > evidence.shadowDecisionCount
    || evidence.actualCostReconciliationBps > 10_000
    || evidence.minimumActualCostReconciliationBps > 10_000) {
    throw new ProfitRouterError("INVALID_GATE_EVIDENCE", "Gate 13 evidence must be a valid bounded immutable report.");
  }
}

function ladderComplete(stages: readonly number[]): boolean {
  return stages.length === COMPLETE_CANARY_LADDER.length
    && stages.every((stage, index) => stage === COMPLETE_CANARY_LADDER[index]);
}

export function evaluateGate13(input: {
  local: Gate13LocalEvidence;
  formal: Gate13FormalDependencies;
  now?: Date;
}): Gate13Decision {
  validateEvidence(input.local);
  const evaluatedAt = input.now ?? new Date();
  if (Number.isNaN(evaluatedAt.getTime())) {
    throw new ProfitRouterError("INVALID_GATE_EVIDENCE", "Gate 13 evaluation time must be valid.");
  }
  const localReasons: Gate13DecisionReason[] = [];
  if (!input.local.routerFoundationTestsPassed) localReasons.push("LOCAL_FOUNDATION_TESTS_FAILED");
  if (!input.local.scorePolicyTestsPassed) localReasons.push("LOCAL_SCORE_TESTS_FAILED");
  if (input.local.shadowDecisionCount === 0 || input.local.replayMatchCount !== input.local.shadowDecisionCount) {
    localReasons.push("SHADOW_REPLAY_INCOMPLETE");
  }
  if (input.local.selectedHardGateViolationCount > 0) localReasons.push("HARD_GATE_VIOLATION");
  if (input.local.marginFloorBreachCount > 0) localReasons.push("MARGIN_FLOOR_BREACH");
  if (input.local.qualityRegressionPpm > input.local.maximumAllowedQualityRegressionPpm) localReasons.push("QUALITY_REGRESSION");
  if (input.local.reliabilityRegressionPpm > input.local.maximumAllowedReliabilityRegressionPpm) {
    localReasons.push("RELIABILITY_REGRESSION");
  }
  if (input.local.p95LatencyRegressionBps > input.local.maximumAllowedP95LatencyRegressionBps) {
    localReasons.push("P95_LATENCY_REGRESSION");
  }
  if (input.local.actualCostReconciliationBps < input.local.minimumActualCostReconciliationBps) {
    localReasons.push("ACTUAL_COST_RECONCILIATION_BELOW_TARGET");
  }
  if (!ladderComplete(input.local.canaryStagesCompletedBps)) localReasons.push("CANARY_LADDER_INCOMPLETE");
  if (!input.local.rollbackDrillPassed) localReasons.push("ROLLBACK_DRILL_NOT_PASSED");
  if (!input.local.decisionChainVerified) localReasons.push("DECISION_CHAIN_NOT_VERIFIED");
  if (input.local.externalDispatchCount > 0) localReasons.push("LOCAL_EXTERNAL_DISPATCH_DETECTED");

  const formalBlockers: Gate13DecisionReason[] = [];
  if (!input.formal.formalGates6Through12Passed) formalBlockers.push("FORMAL_GATES_6_12_NOT_PASSED");
  if (!input.formal.representativeProductionDataAvailable) formalBlockers.push("REPRESENTATIVE_PRODUCTION_DATA_MISSING");
  if (!input.formal.productionExactEquivalenceGroupCertified) formalBlockers.push("PRODUCTION_EXACT_GROUP_NOT_CERTIFIED");
  if (!input.formal.realExactCanaryCompleted) formalBlockers.push("REAL_EXACT_CANARY_NOT_COMPLETED");
  if (!input.formal.productionRollbackDrillPassed) formalBlockers.push("PRODUCTION_ROLLBACK_DRILL_NOT_PASSED");
  if (!input.formal.namedProductFinanceReliabilityApprovals) formalBlockers.push("NAMED_APPROVALS_MISSING");

  const localImplementationDecision = localReasons.length === 0 ? "PASS" : "HOLD";
  const formalGateDecision = localImplementationDecision === "PASS" && formalBlockers.length === 0 ? "PASS" : "HOLD";
  return {
    gate: 13,
    evaluatedAt: evaluatedAt.toISOString(),
    localImplementationDecision,
    formalGateDecision,
    localReasons,
    formalBlockers,
    productionAuthorizationGranted: formalGateDecision === "PASS",
  };
}
