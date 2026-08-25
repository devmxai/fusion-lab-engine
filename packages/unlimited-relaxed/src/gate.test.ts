// @vitest-environment node

import { describe, expect, it } from "vitest";
import { evaluateGate15 } from "./gate.ts";
import type { Gate15FormalDependencies, Gate15LocalEvidence } from "./types.ts";

const evaluationTime = new Date("2026-08-13T15:00:00.000Z");

const localEvidence: Gate15LocalEvidence = {
  evidenceId: "gate-15-local-evidence-001",
  offerContractTestsPassed: true,
  cohortBudgetTestsPassed: true,
  riskModelTestsPassed: true,
  pilotControlTestsPassed: true,
  offerPolicyCount: 1,
  truthfulOfferDisclosureCount: 1,
  hiddenCapViolationCount: 0,
  hiddenModelSubstitutionViolationCount: 0,
  restrictedRouteViolationCount: 0,
  allowedCohortCogsMicrousd: "10000000",
  availableCohortCogsMicrousd: "7000000",
  reservedCohortCogsMicrousd: "1000000",
  settledCohortCogsMicrousd: "2000000",
  cohortBudgetLedgerChainVerified: true,
  cohortBudgetProjectionReconciled: true,
  customerCreditsChargedMicrousd: "0",
  riskReportCount: 2,
  representativeRiskReportCount: 2,
  percentileReportCount: 2,
  priceShockScenarioCount: 4,
  heavyUserScenarioCount: 2,
  averageOnlyDecisionCount: 0,
  budgetBreachScenarioCount: 0,
  maximumProjectedCohortLossMicrousd: "0",
  approvedCohortLossBudgetMicrousd: "0",
  pilotControlPolicyCount: 1,
  localLegalApprovalCount: 1,
  localFinanceApprovalCount: 1,
  salesStopDrillPassed: true,
  killSwitchDrillPassed: true,
  killedPolicyReopenCount: 0,
  externalDispatchCount: 0,
  productionActivationCount: 0,
  observedAt: evaluationTime.toISOString(),
};

const missingFormalDependencies: Gate15FormalDependencies = {
  formalGate14Passed: false,
  representativeSixtyDayOrTwoCycleDataAvailable: false,
  publishedFairUseLegallyApproved: false,
  cohortBudgetFinanceApproved: false,
  realCohortLossWithinApprovedBudget: false,
  realSalesStopKillSwitchDrillPassed: false,
  namedLegalFinanceApprovals: false,
};

describe("Gate 15 decision", () => {
  it("passes local engineering while holding the formal Gate without real evidence and approvals", () => {
    const decision = evaluateGate15({
      local: localEvidence,
      formal: missingFormalDependencies,
      now: evaluationTime,
    });
    expect(decision).toMatchObject({
      gate: 15,
      evaluatedAt: evaluationTime.toISOString(),
      localImplementationDecision: "PASS",
      formalGateDecision: "HOLD",
      localReasons: [],
      formalBlockers: [
        "FORMAL_GATE_14_NOT_PASSED",
        "REPRESENTATIVE_60_DAY_OR_TWO_CYCLE_DATA_MISSING",
        "PUBLISHED_FAIR_USE_LEGAL_APPROVAL_MISSING",
        "COHORT_BUDGET_FINANCE_APPROVAL_MISSING",
        "REAL_COHORT_LOSS_EVIDENCE_NOT_WITHIN_BUDGET",
        "REAL_SALES_STOP_KILL_SWITCH_DRILL_NOT_PASSED",
        "NAMED_LEGAL_FINANCE_APPROVALS_MISSING",
      ],
      productionAuthorizationGranted: false,
      unlimitedRelaxedPilotActivationAuthorized: false,
    });
    expect(decision.evidenceHash).toHaveLength(64);
    expect(decision.decisionHash).toHaveLength(64);
  });

  it("holds on an untruthful offer, hidden substitution or a route outside the contract", () => {
    const decision = evaluateGate15({
      local: {
        ...localEvidence,
        truthfulOfferDisclosureCount: 0,
        hiddenCapViolationCount: 1,
        hiddenModelSubstitutionViolationCount: 1,
        restrictedRouteViolationCount: 1,
      },
      formal: missingFormalDependencies,
      now: evaluationTime,
    });
    expect(decision.localReasons).toEqual([
      "TRUTHFUL_OFFER_EVIDENCE_INCOMPLETE",
      "HIDDEN_CAP_DETECTED",
      "HIDDEN_MODEL_SUBSTITUTION_DETECTED",
      "RESTRICTED_ROUTE_BREACH",
    ]);
  });

  it("requires exact Cohort Budget reconstruction and zero customer Credit charge", () => {
    const decision = evaluateGate15({
      local: {
        ...localEvidence,
        availableCohortCogsMicrousd: "6999999",
        cohortBudgetLedgerChainVerified: false,
        customerCreditsChargedMicrousd: "1",
      },
      formal: missingFormalDependencies,
      now: evaluationTime,
    });
    expect(decision.localReasons).toEqual([
      "COHORT_BUDGET_RECONCILIATION_FAILED",
      "CUSTOMER_CREDIT_CHARGE_DETECTED",
    ]);
  });

  it("requires representative percentile, price-shock and heavy-user evidence within the loss budget", () => {
    const decision = evaluateGate15({
      local: {
        ...localEvidence,
        representativeRiskReportCount: 1,
        percentileReportCount: 1,
        priceShockScenarioCount: 0,
        heavyUserScenarioCount: 0,
        averageOnlyDecisionCount: 1,
        budgetBreachScenarioCount: 1,
        maximumProjectedCohortLossMicrousd: "1001",
        approvedCohortLossBudgetMicrousd: "1000",
      },
      formal: missingFormalDependencies,
      now: evaluationTime,
    });
    expect(decision.localReasons).toEqual([
      "RISK_EVIDENCE_INCOMPLETE",
      "SHOCK_HEAVY_USER_EVIDENCE_INCOMPLETE",
      "AVERAGE_ONLY_DECISION_DETECTED",
      "COHORT_LOSS_BUDGET_BREACH",
    ]);
  });

  it("requires Legal and Finance control evidence plus clean Sales Stop and terminal Kill drills", () => {
    const decision = evaluateGate15({
      local: {
        ...localEvidence,
        localLegalApprovalCount: 0,
        localFinanceApprovalCount: 0,
        salesStopDrillPassed: false,
        killSwitchDrillPassed: false,
        killedPolicyReopenCount: 1,
      },
      formal: missingFormalDependencies,
      now: evaluationTime,
    });
    expect(decision.localReasons).toEqual([
      "LEGAL_FINANCE_CONTROL_EVIDENCE_INCOMPLETE",
      "SALES_STOP_DRILL_NOT_PASSED",
      "KILL_SWITCH_DRILL_NOT_PASSED",
      "KILLED_POLICY_REOPENED",
    ]);
  });

  it("holds local execution if Dispatch or Production activation occurred", () => {
    const decision = evaluateGate15({
      local: { ...localEvidence, externalDispatchCount: 1, productionActivationCount: 1 },
      formal: missingFormalDependencies,
      now: evaluationTime,
    });
    expect(decision.localReasons).toEqual([
      "LOCAL_EXTERNAL_DISPATCH_DETECTED",
      "LOCAL_PRODUCTION_ACTIVATION_DETECTED",
    ]);
    expect(decision.productionAuthorizationGranted).toBe(false);
  });

  it("can formally pass only when all real dependencies and the local contract pass", () => {
    const formal: Gate15FormalDependencies = {
      formalGate14Passed: true,
      representativeSixtyDayOrTwoCycleDataAvailable: true,
      publishedFairUseLegallyApproved: true,
      cohortBudgetFinanceApproved: true,
      realCohortLossWithinApprovedBudget: true,
      realSalesStopKillSwitchDrillPassed: true,
      namedLegalFinanceApprovals: true,
    };
    expect(evaluateGate15({ local: localEvidence, formal, now: evaluationTime })).toMatchObject({
      localImplementationDecision: "PASS",
      formalGateDecision: "PASS",
      formalBlockers: [],
      productionAuthorizationGranted: true,
      unlimitedRelaxedPilotActivationAuthorized: true,
    });
  });

  it("rejects malformed evidence instead of manufacturing a Gate decision", () => {
    expect(() => evaluateGate15({
      local: { ...localEvidence, representativeRiskReportCount: 3 },
      formal: missingFormalDependencies,
      now: evaluationTime,
    })).toThrowError(expect.objectContaining({ code: "INVALID_GATE_15_EVIDENCE" }));
    expect(() => evaluateGate15({
      local: { ...localEvidence, maximumProjectedCohortLossMicrousd: "1.5" },
      formal: missingFormalDependencies,
      now: evaluationTime,
    })).toThrowError(expect.objectContaining({ code: "INVALID_GATE_15_EVIDENCE" }));
  });
});
