// @vitest-environment node

import { describe, expect, it } from "vitest";
import { InMemoryReleaseRolloutController } from "./rollout.ts";
import type {
  ReleaseApprovalRole,
  ReleaseReadinessEvidence,
  ReleaseRolloutPolicyVersion,
  ReleaseStage,
  ReleaseStageObservation,
} from "./types.ts";

const now = new Date("2026-08-13T16:00:00.000Z");
const digest = "a".repeat(64);

const policy: ReleaseRolloutPolicyVersion = {
  id: "release-policy-v1",
  releaseId: "release-local-001",
  version: 1,
  lifecycle: "PUBLISHED",
  releaseDigest: digest,
  requiredFormalGateIds: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  stages: ["INTERNAL_ALPHA", "INVITE_BETA", "ROLLOUT_1", "ROLLOUT_5", "ROLLOUT_25", "ROLLOUT_50", "ROLLOUT_100", "GA_READY"],
  requiredApprovalRoles: ["PRODUCT", "ENGINEERING", "SECURITY", "FINANCE"],
  minimumSamplesPerStage: 100,
  minimumObservationSecondsPerStage: 3_600,
  pauseAtErrorBudgetConsumptionBps: 5000,
  stopAtErrorBudgetConsumptionBps: 10000,
  requireZeroCriticalHigh: true,
  requireZeroUnexplainedLedgerDrift: true,
  promotionAuthority: "LOCAL_CONTRACT_SIMULATION_ONLY",
  productionActivationAllowed: false,
  publishedAt: now.toISOString(),
};

const readiness: ReleaseReadinessEvidence = {
  evidenceId: "readiness-local-001",
  policyVersionId: policy.id,
  releaseDigest: digest,
  artifactDigest: "b".repeat(64),
  sbomDigest: "c".repeat(64),
  provenanceDigest: "d".repeat(64),
  verifiedFormalGateIds: policy.requiredFormalGateIds,
  criticalSecurityFindingCount: 0,
  highSecurityFindingCount: 0,
  unexplainedLedgerDriftCount: 0,
  actualCostReconciliationBps: 10_000,
  rollbackDrillPassed: true,
  sloPolicyPinned: true,
  drPlanPinned: true,
  runbooksIndexed: true,
  localFixtureOnly: true,
  externalTrafficObserved: false,
  observedAt: now.toISOString(),
};

function approveAll(controller: InMemoryReleaseRolloutController): void {
  const roles: ReleaseApprovalRole[] = ["PRODUCT", "ENGINEERING", "SECURITY", "FINANCE"];
  roles.forEach((role, index) => controller.approve({
    approvalId: `approval-${role.toLowerCase()}`,
    actorId: `actor-${index + 1}`,
    role,
  }));
}

function observation(stage: ReleaseStage, suffix: string = stage): ReleaseStageObservation {
  return {
    observationId: `observation-${suffix}`,
    policyVersionId: policy.id,
    stage,
    sampleCount: 100,
    windowStartedAt: "2026-08-13T10:00:00.000Z",
    windowEndedAt: "2026-08-13T11:00:00.000Z",
    criticalSecurityFindingCount: 0,
    highSecurityFindingCount: 0,
    unexplainedLedgerDriftCount: 0,
    financialInvariantFailureCount: 0,
    reconciliationBps: 10_000,
    sloBreached: false,
    rollbackAvailable: true,
    errorBudgetConsumptionBps: 0,
    unbudgetableIncidentCount: 0,
    localFixtureOnly: true,
    externalTrafficObserved: false,
  };
}

function armedController(): InMemoryReleaseRolloutController {
  const controller = new InMemoryReleaseRolloutController(policy, "maker-1", () => now);
  approveAll(controller);
  controller.arm(readiness);
  return controller;
}

describe("Stage 16 release rollout governance", () => {
  it("starts closed to traffic and requires four distinct approvers independent from the maker", () => {
    const controller = new InMemoryReleaseRolloutController(policy, "maker-1", () => now);
    expect(controller.snapshot()).toMatchObject({
      state: "DRAFT",
      currentStage: null,
      externalTrafficAllowed: false,
      productionActivationAllowed: false,
    });
    controller.approve({ approvalId: "approval-product", actorId: "actor-product", role: "PRODUCT" });
    expect(() => controller.approve({ approvalId: "approval-finance", actorId: "actor-product", role: "FINANCE" }))
      .toThrowError(expect.objectContaining({ code: "INVALID_RELEASE_APPROVAL" }));
    expect(() => controller.approve({ approvalId: "approval-security", actorId: "maker-1", role: "SECURITY" }))
      .toThrowError(expect.objectContaining({ code: "INVALID_RELEASE_APPROVAL" }));
    expect(() => controller.arm(readiness)).toThrowError(expect.objectContaining({ code: "RELEASE_TRANSITION_DENIED" }));
  });

  it("arms only with exact artifact, Gate, finance, rollback, SLO, DR and runbook evidence", () => {
    const controller = new InMemoryReleaseRolloutController(policy, "maker-1", () => now);
    approveAll(controller);
    expect(() => controller.arm({ ...readiness, verifiedFormalGateIds: [0, 2, 3] }))
      .toThrowError(expect.objectContaining({ code: "INVALID_RELEASE_EVIDENCE" }));
    expect(() => controller.arm({ ...readiness, unexplainedLedgerDriftCount: 1 }))
      .toThrowError(expect.objectContaining({ code: "INVALID_RELEASE_EVIDENCE" }));
    expect(controller.arm(readiness)).toMatchObject({ state: "ARMED", readinessEvidenceId: readiness.evidenceId });
  });

  it("enforces Internal Alpha then Invite Beta then 1→5→25→50→100 and GA without skipping", () => {
    const controller = armedController();
    expect(controller.start()).toMatchObject({ state: "RUNNING", currentStage: "INTERNAL_ALPHA" });
    expect(() => controller.evaluateAndAdvance(observation("ROLLOUT_1")))
      .toThrowError(expect.objectContaining({ code: "RELEASE_TRANSITION_DENIED" }));
    for (const stage of policy.stages) controller.evaluateAndAdvance(observation(stage));
    expect(controller.snapshot()).toMatchObject({
      state: "COMPLETED",
      currentStage: null,
      completedStages: policy.stages,
      externalTrafficAllowed: false,
      productionActivationAllowed: false,
    });
  });

  it("stops immediately on Critical/High, ledger, financial, SLO, reconciliation or unbudgetable blockers", () => {
    const blockers: Partial<ReleaseStageObservation>[] = [
      { criticalSecurityFindingCount: 1 },
      { highSecurityFindingCount: 1 },
      { unexplainedLedgerDriftCount: 1 },
      { financialInvariantFailureCount: 1 },
      { reconciliationBps: 9_999 },
      { sloBreached: true },
      { rollbackAvailable: false },
      { unbudgetableIncidentCount: 1 },
    ];
    blockers.forEach((blocker, index) => {
      const controller = armedController();
      controller.start();
      expect(controller.evaluateAndAdvance({ ...observation("INTERNAL_ALPHA", `${index}`), ...blocker }))
        .toMatchObject({ state: "STOPPED", stopReason: "RELEASE_BLOCKER", externalTrafficAllowed: false });
    });
  });

  it("pauses rollout when half of the error budget is consumed", () => {
    const controller = armedController();
    controller.start();
    expect(controller.evaluateAndAdvance({ ...observation("INTERNAL_ALPHA"), errorBudgetConsumptionBps: 5000 }))
      .toMatchObject({ state: "PAUSED", currentStage: "INTERNAL_ALPHA", stopReason: "ERROR_BUDGET_HALF_CONSUMED" });
  });

  it("refuses promotion without minimum samples and observation duration", () => {
    const controller = armedController();
    controller.start();
    expect(() => controller.evaluateAndAdvance({ ...observation("INTERNAL_ALPHA"), sampleCount: 99 }))
      .toThrowError(expect.objectContaining({ code: "INVALID_RELEASE_EVIDENCE" }));
    expect(() => controller.evaluateAndAdvance({
      ...observation("INTERNAL_ALPHA", "short"),
      windowEndedAt: "2026-08-13T10:59:59.000Z",
    })).toThrowError(expect.objectContaining({ code: "INVALID_RELEASE_EVIDENCE" }));
  });

  it("makes approvals and observations idempotent while rejecting changed intent", () => {
    const controller = new InMemoryReleaseRolloutController(policy, "maker-1", () => now);
    const approval = { approvalId: "approval-product", actorId: "actor-product", role: "PRODUCT" as const };
    expect(controller.approve(approval).eventCount).toBe(1);
    expect(controller.approve(approval).eventCount).toBe(1);
    expect(() => controller.approve({ ...approval, actorId: "actor-other" }))
      .toThrowError(expect.objectContaining({ code: "RELEASE_COMMAND_CONFLICT" }));

    const running = armedController();
    running.start();
    const first = running.evaluateAndAdvance(observation("INTERNAL_ALPHA"));
    expect(running.evaluateAndAdvance(observation("INTERNAL_ALPHA"))).toEqual(first);
    expect(() => running.evaluateAndAdvance({ ...observation("INTERNAL_ALPHA"), sampleCount: 101 }))
      .toThrowError(expect.objectContaining({ code: "RELEASE_COMMAND_CONFLICT" }));
    expect(running.snapshot().eventChainValid).toBe(true);
    expect(running.entries().every(({ actorKeyHash }) => /^[a-f0-9]{64}$/.test(actorKeyHash))).toBe(true);
  });

  it("supports a manual fail-closed stop with no Production or traffic authority", () => {
    const controller = armedController();
    controller.start();
    expect(controller.activateStop("manual-stop-1", "security-operator")).toMatchObject({
      state: "STOPPED",
      stopReason: "RELEASE_BLOCKER",
      externalTrafficAllowed: false,
      productionActivationAllowed: false,
    });
    expect(() => controller.evaluateAndAdvance(observation("INTERNAL_ALPHA")))
      .toThrowError(expect.objectContaining({ code: "RELEASE_TRANSITION_DENIED" }));
  });
});
