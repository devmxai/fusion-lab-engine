// @vitest-environment node

import { describe, expect, it } from "vitest";
import { evidenceHash } from "./canonical.ts";
import { InMemoryUnlimitedPilotController } from "./pilot-control.ts";
import type {
  UnlimitedCohortBudgetSnapshot,
  UnlimitedPilotControlPolicyVersion,
  UnlimitedRiskReport,
} from "./types.ts";

const now = new Date("2026-08-13T12:00:00.000Z");
const policy: UnlimitedPilotControlPolicyVersion = {
  id: "unlimited-pilot-control:v1",
  policyKey: "relaxed-pilot-control",
  version: 1,
  lifecycle: "PUBLISHED",
  offerPolicyVersionId: "unlimited-relaxed-offer:v1",
  cohortBudgetPolicyVersionId: "unlimited-cohort-budget:v1",
  riskModelPolicyVersionId: "unlimited-risk-model:v1",
  maximumCohortMembers: 100,
  minimumRemainingBudgetBpsForNewSales: 2000,
  maximumQueueAgeSecondsForNewSales: 1800,
  requiredOpenApprovalRoles: ["LEGAL", "FINANCE"],
  makerCheckerRequired: true,
  salesStopDefault: true,
  killSwitchMode: "IMMEDIATE_NEW_OPERATION_STOP",
  inFlightPolicy: "SETTLE_OR_RELEASE_NO_REDISPATCH",
  productionActivationAllowed: false,
  publishedAt: "2026-08-13T00:00:00.000Z",
};

function budget(overrides: Partial<UnlimitedCohortBudgetSnapshot> = {}): UnlimitedCohortBudgetSnapshot {
  return {
    policyVersionId: policy.cohortBudgetPolicyVersionId,
    offerPolicyVersionId: policy.offerPolicyVersionId,
    cohortId: "cohort:relaxed-pilot:1",
    netCohortSubscriptionEconomicValueMicrousd: "20000000",
    approvedCogsRatioBps: 5000,
    allowedCohortCogsMicrousd: "10000000",
    availableCohortCogsMicrousd: "8000000",
    reservedCohortCogsMicrousd: "1000000",
    settledCohortCogsMicrousd: "1000000",
    releasedCohortCogsMicrousd: "500000",
    reservationCount: 10,
    ledgerEntryCount: 25,
    ledgerChainValid: true,
    projectionReconciled: true,
    customerCreditsCharged: "0",
    externalDispatchPerformed: false,
    pilotActivationAllowed: false,
    ...overrides,
  };
}

function risk(overrides: Partial<UnlimitedRiskReport> = {}): UnlimitedRiskReport {
  const reportWithoutHash = {
    reportId: "risk-report:healthy",
    policyVersionId: policy.riskModelPolicyVersionId,
    offerPolicyVersionId: policy.offerPolicyVersionId,
    cohortBudgetPolicyVersionId: policy.cohortBudgetPolicyVersionId,
    cohortId: "cohort:relaxed-pilot:1",
    windowStartsAt: "2026-06-01T00:00:00.000Z",
    windowEndsAt: "2026-08-01T00:00:00.000Z",
    representativeDayCount: 61,
    completedFinancialCycles: 0,
    userSampleCount: 100,
    operationSampleCount: 500,
    totalActualCogsMicrousd: "5000000",
    meanUserCogsMicrousd: "50000",
    percentilesMicrousd: { p50: "40000", p90: "80000", p95: "90000", p99: "100000" },
    p99ToP50RatioBps: "25000",
    heavyUserThresholdMicrousd: "100000",
    heavyUserCount: 2,
    heavyUserCogsShareBps: "400",
    scenarios: [{
      scenario: "CURRENT" as const,
      shockBps: 0,
      projectedCohortCogsMicrousd: "5000000",
      approvedCohortCogsMicrousd: "10000000",
      projectedBudgetLossMicrousd: "0",
      budgetBreached: false,
    }],
    dataReadiness: "REPRESENTATIVE" as const,
    representativeBasis: "SIXTY_DAYS" as const,
    riskOutcome: "WITHIN_APPROVED_BUDGET" as const,
    decisionUsesAverageOnly: false as const,
    sanitizedInputOnly: true as const,
    simulationOnly: true as const,
    pilotActivationAllowed: false as const,
    externalDispatchPerformed: false as const,
    ...overrides,
  };
  return { ...reportWithoutHash, evidenceHash: evidenceHash(reportWithoutHash) };
}

function propose(controller: InMemoryUnlimitedPilotController) {
  return controller.proposeSimulationOpen({
    changeId: "pilot-change:open-1",
    makerId: "maker:product",
    risk: risk(),
    budget: budget(),
  });
}

function open(controller: InMemoryUnlimitedPilotController) {
  propose(controller);
  controller.approveSimulationOpen({
    approvalId: "approval:legal",
    changeId: "pilot-change:open-1",
    actorId: "approver:legal",
    role: "LEGAL",
  });
  return controller.approveSimulationOpen({
    approvalId: "approval:finance",
    changeId: "pilot-change:open-1",
    actorId: "approver:finance",
    role: "FINANCE",
  });
}

describe("Unlimited Relaxed Pilot Sales Stop and Kill Switch controls", () => {
  it("requires default Sales Stop, exact Legal/Finance maker-checker and no Production authority", () => {
    expect(() => new InMemoryUnlimitedPilotController({
      ...policy,
      requiredOpenApprovalRoles: ["FINANCE", "LEGAL"],
    } as unknown as UnlimitedPilotControlPolicyVersion, () => now))
      .toThrowError(expect.objectContaining({ code: "INVALID_PILOT_CONTROL_POLICY" }));
    expect(() => new InMemoryUnlimitedPilotController({
      ...policy,
      productionActivationAllowed: true,
    } as unknown as UnlimitedPilotControlPolicyVersion, () => now))
      .toThrowError(expect.objectContaining({ code: "INVALID_PILOT_CONTROL_POLICY" }));
    expect(new InMemoryUnlimitedPilotController(policy, () => now).snapshot()).toMatchObject({
      state: "CLOSED",
      newMemberAdmissionAllowed: false,
      existingMemberNewOperationAllowed: false,
      productionActivationAllowed: false,
    });
  });

  it("refuses an open proposal without representative within-budget Risk and reconciled Budget evidence", () => {
    const controller = new InMemoryUnlimitedPilotController(policy, () => now);
    expect(() => controller.proposeSimulationOpen({
      changeId: "change:insufficient",
      makerId: "maker",
      risk: risk({ dataReadiness: "INSUFFICIENT_DATA", representativeBasis: "INSUFFICIENT", riskOutcome: "INSUFFICIENT_DATA" }),
      budget: budget(),
    })).toThrowError(expect.objectContaining({ code: "INVALID_PILOT_CONTROL_EVIDENCE" }));
    expect(() => controller.proposeSimulationOpen({
      changeId: "change:drift",
      makerId: "maker",
      risk: risk(),
      budget: budget({ projectionReconciled: false }),
    })).toThrowError(expect.objectContaining({ code: "INVALID_PILOT_CONTROL_EVIDENCE" }));
  });

  it("opens local simulation only after distinct Legal and Finance approvals independent from maker", () => {
    const controller = new InMemoryUnlimitedPilotController(policy, () => now);
    expect(propose(controller)).toMatchObject({ state: "CLOSED", pendingChangeId: "pilot-change:open-1", approvalRoles: [] });
    expect(controller.approveSimulationOpen({
      approvalId: "approval:legal",
      changeId: "pilot-change:open-1",
      actorId: "approver:legal",
      role: "LEGAL",
    })).toMatchObject({ state: "CLOSED", approvalRoles: ["LEGAL"] });
    const opened = controller.approveSimulationOpen({
      approvalId: "approval:finance",
      changeId: "pilot-change:open-1",
      actorId: "approver:finance",
      role: "FINANCE",
    });
    expect(opened).toMatchObject({
      state: "SIMULATION_OPEN",
      approvalRoles: ["FINANCE", "LEGAL"],
      newMemberAdmissionAllowed: true,
      productionActivationAllowed: false,
      externalDispatchPerformed: false,
    });
  });

  it("rejects maker self-approval, repeated roles and approval-ID conflicts", () => {
    const controller = new InMemoryUnlimitedPilotController(policy, () => now);
    propose(controller);
    expect(() => controller.approveSimulationOpen({
      approvalId: "approval:self",
      changeId: "pilot-change:open-1",
      actorId: "maker:product",
      role: "LEGAL",
    })).toThrowError(expect.objectContaining({ code: "PILOT_CONTROL_APPROVAL_DENIED" }));
    const approval = {
      approvalId: "approval:legal",
      changeId: "pilot-change:open-1",
      actorId: "approver:legal",
      role: "LEGAL" as const,
    };
    controller.approveSimulationOpen(approval);
    expect(controller.approveSimulationOpen(approval)).toEqual(controller.snapshot());
    expect(() => controller.approveSimulationOpen({ ...approval, actorId: "approver:other" }))
      .toThrowError(expect.objectContaining({ code: "PILOT_CONTROL_REQUEST_CONFLICT" }));
  });

  it("Sales Stop blocks new members but preserves existing-member operation and in-flight settlement", () => {
    const controller = new InMemoryUnlimitedPilotController(policy, () => now);
    open(controller);
    expect(controller.activateSalesStop("sales-stop:manual", "operator:finance")).toMatchObject({
      state: "SALES_STOPPED",
      stopReason: "MANUAL_SALES_STOP",
      newMemberAdmissionAllowed: false,
      existingMemberNewOperationAllowed: true,
      inFlightPolicy: "SETTLE_OR_RELEASE_NO_REDISPATCH",
    });
    expect(controller.decideAccess(false)).toMatchObject({ newMemberAdmissionAllowed: false, newOperationAllowed: false, reason: "SALES_STOPPED" });
    expect(controller.decideAccess(true)).toMatchObject({ newMemberAdmissionAllowed: false, newOperationAllowed: true, reason: "SALES_STOPPED" });
  });

  it("enforces the published Pilot cohort-member limit without creating a hidden usage cap", () => {
    const controller = new InMemoryUnlimitedPilotController(policy, () => now);
    open(controller);
    expect(controller.decideAccess(false, 99)).toMatchObject({ newMemberAdmissionAllowed: true, reason: "SIMULATION_OPEN" });
    expect(controller.decideAccess(false, 100)).toMatchObject({
      currentCohortMemberCount: 100,
      maximumCohortMembers: 100,
      newMemberAdmissionAllowed: false,
      reason: "COHORT_MEMBER_LIMIT_REACHED",
      productionAdmissionAllowed: false,
    });
    expect(controller.decideAccess(true, 100)).toMatchObject({ newOperationAllowed: true });
  });

  it("automatically Sales-Stops on low remaining budget or queue-age breach", () => {
    const lowBudget = new InMemoryUnlimitedPilotController(policy, () => now);
    open(lowBudget);
    expect(lowBudget.evaluateHealth({
      evaluationId: "health:low-budget",
      risk: risk(),
      budget: budget({
        availableCohortCogsMicrousd: "1999999",
        settledCohortCogsMicrousd: "7000001",
      }),
      oldestQueueAgeSeconds: 100,
    })).toMatchObject({ state: "SALES_STOPPED", stopReason: "LOW_REMAINING_BUDGET" });

    const queue = new InMemoryUnlimitedPilotController(policy, () => now);
    open(queue);
    expect(queue.evaluateHealth({
      evaluationId: "health:queue",
      risk: risk(),
      budget: budget(),
      oldestQueueAgeSeconds: 1801,
    })).toMatchObject({ state: "SALES_STOPPED", stopReason: "QUEUE_AGE_BREACH" });
  });

  it("Kill Switch immediately stops all new work, preserves in-flight settlement and cannot reopen", () => {
    const controller = new InMemoryUnlimitedPilotController(policy, () => now);
    open(controller);
    const breached = risk({
      riskOutcome: "BUDGET_BREACH_PROJECTED",
      scenarios: [{
        scenario: "PRICE_SHOCK",
        shockBps: 5000,
        projectedCohortCogsMicrousd: "11000000",
        approvedCohortCogsMicrousd: "10000000",
        projectedBudgetLossMicrousd: "1000000",
        budgetBreached: true,
      }],
    });
    expect(controller.evaluateHealth({
      evaluationId: "health:risk-breach",
      risk: breached,
      budget: budget(),
      oldestQueueAgeSeconds: 100,
    })).toMatchObject({
      state: "KILLED",
      stopReason: "RISK_BUDGET_BREACH",
      newMemberAdmissionAllowed: false,
      existingMemberNewOperationAllowed: false,
      inFlightPolicy: "SETTLE_OR_RELEASE_NO_REDISPATCH",
      eventChainValid: true,
    });
    expect(controller.decideAccess(true)).toMatchObject({ newOperationAllowed: false, reason: "KILL_SWITCH_ACTIVE", dispatchMutationPerformed: false });
    expect(() => controller.proposeSimulationOpen({
      changeId: "change:reopen",
      makerId: "maker:new",
      risk: risk(),
      budget: budget(),
    })).toThrowError(expect.objectContaining({ code: "PILOT_CONTROL_TRANSITION_DENIED" }));
    expect(controller.entries().every(({ actorKeyHash }) => actorKeyHash.length === 64)).toBe(true);
  });
});
