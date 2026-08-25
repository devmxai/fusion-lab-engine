// @vitest-environment node

import { describe, expect, it } from "vitest";
import { evaluateGate14 } from "./gate.ts";
import type { Gate14FormalDependencies, Gate14LocalEvidence } from "./types.ts";

const evaluationTime = new Date("2026-08-13T12:00:00.000Z");

const localEvidence: Gate14LocalEvidence = {
  evidenceId: "gate-14-local-evidence-001",
  optInProfileTestsPassed: true,
  feedbackEvaluationTestsPassed: true,
  explorationBudgetTestsPassed: true,
  experimentContractTestsPassed: true,
  cfoAdvisorTestsPassed: true,
  smartAuthorizationCount: 4,
  resultDisclosureCount: 4,
  hiddenSubstitutionViolationCount: 0,
  feedbackEventCount: 4,
  automatedEvaluationCount: 4,
  readyEvaluationReportCount: 1,
  explorationAllocationBps: 500,
  explorationReservationCount: 3,
  explorationReservedMicrousd: "300000",
  explorationSettledMicrousd: "180000",
  explorationReleasedMicrousd: "120000",
  customerExplorationSurchargeMicrousd: "0",
  experimentPolicyCount: 3,
  experimentCompletedRunCount: 3,
  experimentOutputCount: 6,
  experimentDisclosedOutputCount: 6,
  marginFloorBreachCount: 0,
  observedSatisfactionPpm: 800000,
  minimumSatisfactionPpm: 750000,
  killSwitchDrillPassed: true,
  cfoAdvisorReportCount: 2,
  cfoAdvisorProposalCount: 6,
  cfoAdvisorProposalChainVerified: true,
  cfoAdvisorRuntimeMutationCount: 0,
  externalDispatchCount: 0,
  observedAt: evaluationTime.toISOString(),
};

const missingFormalDependencies: Gate14FormalDependencies = {
  formalGate13Passed: false,
  representativeSmartBetaDataAvailable: false,
  realConsentDisclosureEvidenceVerified: false,
  fundedExplorationBudgetApproved: false,
  privacyLegalExperimentApproval: false,
  realSmartBetaCanaryCompleted: false,
  productionKillSwitchDrillPassed: false,
  observedSatisfactionAndMarginLimitsPassed: false,
  namedProductFinanceReliabilityApprovals: false,
};

describe("Gate 14 decision", () => {
  it("passes the local implementation while holding the formal Gate without real approvals and evidence", () => {
    const decision = evaluateGate14({
      local: localEvidence,
      formal: missingFormalDependencies,
      now: evaluationTime,
    });
    expect(decision).toMatchObject({
      gate: 14,
      evaluatedAt: evaluationTime.toISOString(),
      localImplementationDecision: "PASS",
      formalGateDecision: "HOLD",
      localReasons: [],
      formalBlockers: [
        "FORMAL_GATE_13_NOT_PASSED",
        "REPRESENTATIVE_SMART_BETA_DATA_MISSING",
        "REAL_CONSENT_DISCLOSURE_EVIDENCE_MISSING",
        "FUNDED_EXPLORATION_BUDGET_NOT_APPROVED",
        "PRIVACY_LEGAL_EXPERIMENT_APPROVAL_MISSING",
        "REAL_SMART_BETA_CANARY_NOT_COMPLETED",
        "PRODUCTION_KILL_SWITCH_DRILL_NOT_PASSED",
        "OBSERVED_SATISFACTION_MARGIN_LIMITS_NOT_PASSED",
        "NAMED_APPROVALS_MISSING",
      ],
      productionAuthorizationGranted: false,
      smartBetaActivationAuthorized: false,
    });
    expect(decision.evidenceHash).toHaveLength(64);
    expect(decision.decisionHash).toHaveLength(64);
  });

  it("holds locally on hidden substitution, missing disclosure or local external Dispatch", () => {
    const decision = evaluateGate14({
      local: {
        ...localEvidence,
        resultDisclosureCount: 3,
        hiddenSubstitutionViolationCount: 1,
        externalDispatchCount: 1,
      },
      formal: missingFormalDependencies,
      now: evaluationTime,
    });
    expect(decision.localReasons).toEqual([
      "OPT_IN_DISCLOSURE_INCOMPLETE",
      "HIDDEN_SUBSTITUTION_DETECTED",
      "LOCAL_EXTERNAL_DISPATCH_DETECTED",
    ]);
    expect(decision.productionAuthorizationGranted).toBe(false);
  });

  it("requires budget bounds, exact Exploration reconciliation and zero customer surcharge", () => {
    const decision = evaluateGate14({
      local: {
        ...localEvidence,
        explorationAllocationBps: 501,
        explorationReleasedMicrousd: "119999",
        customerExplorationSurchargeMicrousd: "1",
      },
      formal: missingFormalDependencies,
      now: evaluationTime,
    });
    expect(decision.localReasons).toEqual([
      "EXPLORATION_ALLOCATION_OUT_OF_BOUNDS",
      "EXPLORATION_RECONCILIATION_FAILED",
      "CUSTOMER_SURCHARGE_DETECTED",
    ]);
  });

  it("requires all experiment contracts, every output disclosure, limits and instant rollback", () => {
    const decision = evaluateGate14({
      local: {
        ...localEvidence,
        experimentPolicyCount: 2,
        experimentCompletedRunCount: 2,
        experimentDisclosedOutputCount: 5,
        marginFloorBreachCount: 1,
        observedSatisfactionPpm: 749999,
        killSwitchDrillPassed: false,
      },
      formal: missingFormalDependencies,
      now: evaluationTime,
    });
    expect(decision.localReasons).toEqual([
      "EXPERIMENT_CONTRACTS_INCOMPLETE",
      "OUTPUT_DISCLOSURE_INCOMPLETE",
      "MARGIN_FLOOR_BREACH",
      "SATISFACTION_BELOW_LIMIT",
      "KILL_SWITCH_DRILL_NOT_PASSED",
    ]);
  });

  it("holds if the Advisor lacks evidence, breaks its chain or performs a runtime mutation", () => {
    const decision = evaluateGate14({
      local: {
        ...localEvidence,
        cfoAdvisorReportCount: 0,
        cfoAdvisorProposalChainVerified: false,
        cfoAdvisorRuntimeMutationCount: 1,
      },
      formal: missingFormalDependencies,
      now: evaluationTime,
    });
    expect(decision.localReasons).toEqual([
      "CFO_ADVISOR_EVIDENCE_INCOMPLETE",
      "CFO_ADVISOR_CHAIN_NOT_VERIFIED",
      "CFO_ADVISOR_EXECUTION_AUTHORITY_DETECTED",
    ]);
  });

  it("can formally pass only when every real external dependency and local invariant passes", () => {
    const formal: Gate14FormalDependencies = {
      formalGate13Passed: true,
      representativeSmartBetaDataAvailable: true,
      realConsentDisclosureEvidenceVerified: true,
      fundedExplorationBudgetApproved: true,
      privacyLegalExperimentApproval: true,
      realSmartBetaCanaryCompleted: true,
      productionKillSwitchDrillPassed: true,
      observedSatisfactionAndMarginLimitsPassed: true,
      namedProductFinanceReliabilityApprovals: true,
    };
    expect(evaluateGate14({ local: localEvidence, formal, now: evaluationTime })).toMatchObject({
      localImplementationDecision: "PASS",
      formalGateDecision: "PASS",
      formalBlockers: [],
      productionAuthorizationGranted: true,
      smartBetaActivationAuthorized: true,
    });
  });

  it("rejects malformed evidence instead of manufacturing a Gate decision", () => {
    expect(() => evaluateGate14({
      local: { ...localEvidence, observedSatisfactionPpm: 1_000_001 },
      formal: missingFormalDependencies,
      now: evaluationTime,
    })).toThrowError(expect.objectContaining({ code: "INVALID_GATE_14_EVIDENCE" }));
    expect(() => evaluateGate14({
      local: { ...localEvidence, explorationReservedMicrousd: "1.5" },
      formal: missingFormalDependencies,
      now: evaluationTime,
    })).toThrowError(expect.objectContaining({ code: "INVALID_GATE_14_EVIDENCE" }));
  });
});
