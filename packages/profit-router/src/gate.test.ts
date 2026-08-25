// @vitest-environment node

import { describe, expect, it } from "vitest";
import { evaluateGate13 } from "./gate.ts";
import type { Gate13FormalDependencies, Gate13LocalEvidence } from "./types.ts";

const evaluationTime = new Date("2026-08-13T12:00:00.000Z");
const localEvidence: Gate13LocalEvidence = {
  evidenceId: "gate-13-local-evidence-001",
  routerFoundationTestsPassed: true,
  scorePolicyTestsPassed: true,
  shadowDecisionCount: 100,
  replayMatchCount: 100,
  selectedHardGateViolationCount: 0,
  marginFloorBreachCount: 0,
  qualityRegressionPpm: 0,
  maximumAllowedQualityRegressionPpm: 5_000,
  reliabilityRegressionPpm: 0,
  maximumAllowedReliabilityRegressionPpm: 5_000,
  p95LatencyRegressionBps: 0,
  maximumAllowedP95LatencyRegressionBps: 500,
  actualCostReconciliationBps: 10_000,
  minimumActualCostReconciliationBps: 9_900,
  canaryStagesCompletedBps: [100, 500, 1000, 2500, 5000, 10000],
  rollbackDrillPassed: true,
  decisionChainVerified: true,
  externalDispatchCount: 0,
  observedAt: evaluationTime.toISOString(),
};
const missingFormalDependencies: Gate13FormalDependencies = {
  formalGates6Through12Passed: false,
  representativeProductionDataAvailable: false,
  productionExactEquivalenceGroupCertified: false,
  realExactCanaryCompleted: false,
  productionRollbackDrillPassed: false,
  namedProductFinanceReliabilityApprovals: false,
};

describe("Gate 13 decision", () => {
  it("passes the complete local implementation but holds the formal Gate without production evidence", () => {
    expect(evaluateGate13({
      local: localEvidence,
      formal: missingFormalDependencies,
      now: evaluationTime,
    })).toEqual({
      gate: 13,
      evaluatedAt: evaluationTime.toISOString(),
      localImplementationDecision: "PASS",
      formalGateDecision: "HOLD",
      localReasons: [],
      formalBlockers: [
        "FORMAL_GATES_6_12_NOT_PASSED",
        "REPRESENTATIVE_PRODUCTION_DATA_MISSING",
        "PRODUCTION_EXACT_GROUP_NOT_CERTIFIED",
        "REAL_EXACT_CANARY_NOT_COMPLETED",
        "PRODUCTION_ROLLBACK_DRILL_NOT_PASSED",
        "NAMED_APPROVALS_MISSING",
      ],
      productionAuthorizationGranted: false,
    });
  });

  it("holds locally on any margin breach, incomplete replay or quality/SLO regression", () => {
    const decision = evaluateGate13({
      local: {
        ...localEvidence,
        replayMatchCount: 99,
        marginFloorBreachCount: 1,
        qualityRegressionPpm: 5_001,
        p95LatencyRegressionBps: 501,
      },
      formal: missingFormalDependencies,
      now: evaluationTime,
    });
    expect(decision).toMatchObject({
      localImplementationDecision: "HOLD",
      formalGateDecision: "HOLD",
      localReasons: [
        "SHADOW_REPLAY_INCOMPLETE",
        "MARGIN_FLOOR_BREACH",
        "QUALITY_REGRESSION",
        "P95_LATENCY_REGRESSION",
      ],
      productionAuthorizationGranted: false,
    });
  });

  it("requires the exact complete canary ladder, rollback drill and verified decision chain", () => {
    const decision = evaluateGate13({
      local: {
        ...localEvidence,
        canaryStagesCompletedBps: [100, 500, 1000],
        rollbackDrillPassed: false,
        decisionChainVerified: false,
      },
      formal: missingFormalDependencies,
      now: evaluationTime,
    });
    expect(decision.localReasons).toEqual([
      "CANARY_LADDER_INCOMPLETE",
      "ROLLBACK_DRILL_NOT_PASSED",
      "DECISION_CHAIN_NOT_VERIFIED",
    ]);
  });

  it("never mistakes local external dispatch for valid local evidence", () => {
    const decision = evaluateGate13({
      local: { ...localEvidence, externalDispatchCount: 1 },
      formal: missingFormalDependencies,
      now: evaluationTime,
    });
    expect(decision).toMatchObject({
      localImplementationDecision: "HOLD",
      localReasons: ["LOCAL_EXTERNAL_DISPATCH_DETECTED"],
      productionAuthorizationGranted: false,
    });
  });

  it("can return formal PASS only when local evidence and every external dependency pass", () => {
    const allFormalDependencies: Gate13FormalDependencies = {
      formalGates6Through12Passed: true,
      representativeProductionDataAvailable: true,
      productionExactEquivalenceGroupCertified: true,
      realExactCanaryCompleted: true,
      productionRollbackDrillPassed: true,
      namedProductFinanceReliabilityApprovals: true,
    };
    expect(evaluateGate13({ local: localEvidence, formal: allFormalDependencies, now: evaluationTime }))
      .toMatchObject({
        localImplementationDecision: "PASS",
        formalGateDecision: "PASS",
        formalBlockers: [],
        productionAuthorizationGranted: true,
      });
  });

  it("rejects malformed evidence instead of manufacturing a Gate result", () => {
    expect(() => evaluateGate13({
      local: { ...localEvidence, actualCostReconciliationBps: 10_001 },
      formal: missingFormalDependencies,
      now: evaluationTime,
    })).toThrowError(expect.objectContaining({ code: "INVALID_GATE_EVIDENCE" }));
  });
});
