// @vitest-environment node

import { describe, expect, it } from "vitest";
import { LocalExactCanaryController } from "./canary.ts";
import type {
  CanaryApproval,
  CanaryGateObservation,
  CanaryReadinessEvidence,
  CanaryStageBps,
  ExactCanaryPolicyVersion,
} from "./types.ts";

const baseTime = new Date("2026-08-13T12:00:00.000Z");
const policy: ExactCanaryPolicyVersion = {
  id: "exact-canary:local:v1",
  version: 1,
  lifecycle: "PUBLISHED",
  exactEquivalenceGroupId: "exact-group:image-test:v1",
  safeRouteVersionId: "route-provider-test-safe:v1",
  candidateRouteVersionId: "route-provider-test-candidate:v1",
  stagesBps: [100, 500, 1000, 2500, 5000, 10000],
  minimumShadowDecisions: 100,
  minimumSamplesPerStage: 50,
  minimumObservationSeconds: 600,
  maximumReliabilityRegressionPpm: 5_000,
  maximumQualityRegressionPpm: 5_000,
  maximumP95LatencyRegressionBps: 500,
  minimumActualCostReconciliationBps: 9_900,
  requiredApprovalRoles: ["FINANCE", "RELIABILITY"],
  cohortOrder: "ADMIN_INTERNAL_FIRST",
  assignmentHash: "SHA256_MOD_10000",
  publishedAt: "2026-08-13T00:00:00.000Z",
};
const readiness: CanaryReadinessEvidence = {
  evidenceId: "readiness-001",
  policyVersionId: policy.id,
  exactEquivalenceGroupId: policy.exactEquivalenceGroupId,
  shadowDecisionCount: 100,
  exactReplayMatchCount: 100,
  selectedHardGateViolationCount: 0,
  dispatchMutationCount: 0,
  rollbackDrillPassed: true,
  observedAt: baseTime.toISOString(),
};

function approval(role: CanaryApproval["role"], actorId: string): CanaryApproval {
  return {
    approvalId: `approval-${role.toLowerCase()}`,
    actorId,
    role,
    policyVersionId: policy.id,
    approvedAt: baseTime.toISOString(),
  };
}

function approvedController(): LocalExactCanaryController {
  const controller = new LocalExactCanaryController(policy);
  controller.approve(approval("FINANCE", "finance-human-1"));
  controller.approve(approval("RELIABILITY", "reliability-human-1"));
  return controller;
}

function runningController(): LocalExactCanaryController {
  const controller = approvedController();
  controller.arm(readiness);
  controller.start();
  return controller;
}

function observation(stageBps: CanaryStageBps, values: Partial<CanaryGateObservation> = {}): CanaryGateObservation {
  return {
    observationId: `observation-${stageBps}`,
    policyVersionId: policy.id,
    stageBps,
    windowStartedAt: baseTime.toISOString(),
    windowEndedAt: new Date(baseTime.getTime() + 600_000).toISOString(),
    sampleCount: 50,
    marginFloorBreachCount: 0,
    hardGateViolationCount: 0,
    financialAuthorityConflictCount: 0,
    actualCostReconciliationBps: 10_000,
    reliabilityRegressionPpm: 0,
    qualityRegressionPpm: 0,
    p95LatencyRegressionBps: 0,
    ...values,
  };
}

describe("local Exact Canary controller", () => {
  it("rejects a changed rollout ladder or unsafe Policy Version", () => {
    expect(() => new LocalExactCanaryController({
      ...policy,
      stagesBps: [100, 500, 2500, 2500, 5000, 10000],
    } as unknown as ExactCanaryPolicyVersion)).toThrowError(expect.objectContaining({ code: "INVALID_CANARY_POLICY" }));
  });

  it("requires distinct Finance/Reliability actors and complete replayable readiness evidence", () => {
    const controller = new LocalExactCanaryController(policy);
    controller.approve(approval("FINANCE", "same-human"));
    expect(() => controller.approve(approval("RELIABILITY", "same-human")))
      .toThrowError(expect.objectContaining({ code: "CANARY_APPROVAL_REQUIRED" }));
    expect(() => controller.arm(readiness)).toThrowError(expect.objectContaining({ code: "CANARY_APPROVAL_REQUIRED" }));

    const approved = approvedController();
    expect(() => approved.arm({ ...readiness, exactReplayMatchCount: 99 }))
      .toThrowError(expect.objectContaining({ code: "CANARY_GATE_FAILED" }));
    expect(approved.arm(readiness)).toMatchObject({ state: "ARMED", readinessEvidenceId: "readiness-001" });
  });

  it("starts at one percent with Admin/Internal first and deterministic single-authority assignment plans", () => {
    const controller = runningController();
    let eligibleKey = "";
    for (let index = 0; index < 10_000; index += 1) {
      const candidate = `cohort-${index}`;
      if (controller.planAssignment({ cohortKey: candidate, cohort: "ADMIN_INTERNAL" }).bucketBps < 100) {
        eligibleKey = candidate;
        break;
      }
    }
    const internal = controller.planAssignment({ cohortKey: eligibleKey, cohort: "ADMIN_INTERNAL" });
    const repeated = controller.planAssignment({ cohortKey: eligibleKey, cohort: "ADMIN_INTERNAL" });
    const publicPlan = controller.planAssignment({ cohortKey: eligibleKey, cohort: "PUBLIC" });
    expect(internal).toEqual(repeated);
    expect(internal).toMatchObject({
      selectedRouteVersionId: policy.candidateRouteVersionId,
      financialAuthority: "EXACT_CANARY_ENGINE",
      dispatchMutationPerformed: false,
    });
    expect(publicPlan).toMatchObject({
      selectedRouteVersionId: policy.safeRouteVersionId,
      financialAuthority: "SAFE_ENGINE",
      dispatchMutationPerformed: false,
    });
    expect(JSON.stringify(internal)).not.toContain(eligibleKey);
  });

  it("advances only through 1→5→10→25→50→100 after sufficient clean windows", () => {
    const controller = runningController();
    const stages = policy.stagesBps;
    for (const [index, stage] of stages.entries()) {
      const snapshot = controller.evaluateAndAdvance(observation(stage));
      if (index < stages.length - 1) {
        expect(snapshot).toMatchObject({ state: "RUNNING", currentStageBps: stages[index + 1] });
      } else {
        expect(snapshot).toMatchObject({ state: "COMPLETED", completedStagesBps: stages });
      }
    }
    expect(controller.snapshot()).toMatchObject({
      externalDispatchPerformed: false,
      financialAuthorityPolicy: "ONE_SOURCE_PER_COHORT",
    });
    expect(controller.planAssignment({ cohortKey: "completed-cohort", cohort: "PUBLIC" }))
      .toMatchObject({ selectedRouteVersionId: policy.candidateRouteVersionId, dispatchMutationPerformed: false });
    expect(controller.activateKillSwitch()).toMatchObject({
      state: "ROLLED_BACK",
      rollbackReason: "MANUAL_KILL_SWITCH",
      newAssignmentRouteVersionId: policy.safeRouteVersionId,
    });
  });

  it("holds the current stage when samples or observation duration are insufficient", () => {
    const controller = runningController();
    expect(() => controller.evaluateAndAdvance(observation(100, { sampleCount: 49 })))
      .toThrowError(expect.objectContaining({ code: "CANARY_GATE_FAILED" }));
    expect(controller.snapshot()).toMatchObject({ state: "RUNNING", currentStageBps: 100, completedStagesBps: [] });
  });

  it("rolls back immediately on a margin floor breach and never assigns new candidate traffic", () => {
    const controller = runningController();
    const breach = observation(100, { marginFloorBreachCount: 1 });
    const rolledBack = controller.evaluateAndAdvance(breach);
    expect(rolledBack).toMatchObject({
      state: "ROLLED_BACK",
      currentStageBps: 0,
      rollbackReason: "MARGIN_FLOOR_BREACH",
      newAssignmentRouteVersionId: policy.safeRouteVersionId,
      inFlightPolicy: "COMPLETE_PINNED_NO_REDISPATCH",
      acceptedQuotePolicy: "HONOR_UNTIL_EXPIRY",
      externalDispatchPerformed: false,
    });
    expect(controller.planAssignment({ cohortKey: "any-cohort", cohort: "ADMIN_INTERNAL" }))
      .toMatchObject({ selectedRouteVersionId: policy.safeRouteVersionId, financialAuthority: "SAFE_ENGINE" });
    expect(controller.evaluateAndAdvance(breach)).toEqual(rolledBack);
    expect(() => controller.evaluateAndAdvance({ ...breach, sampleCount: 51 }))
      .toThrowError(expect.objectContaining({ code: "CANARY_GATE_FAILED" }));
  });

  it("fails closed on quality/SLO/financial regressions and supports an idempotent manual kill switch", () => {
    const quality = runningController();
    expect(quality.evaluateAndAdvance(observation(100, { qualityRegressionPpm: 5_001 })))
      .toMatchObject({ state: "ROLLED_BACK", rollbackReason: "QUALITY_REGRESSION" });

    const financial = runningController();
    expect(financial.evaluateAndAdvance(observation(100, { financialAuthorityConflictCount: 1 })))
      .toMatchObject({ state: "ROLLED_BACK", rollbackReason: "FINANCIAL_AUTHORITY_CONFLICT" });

    const manual = runningController();
    const first = manual.activateKillSwitch();
    expect(first).toMatchObject({ state: "ROLLED_BACK", rollbackReason: "MANUAL_KILL_SWITCH" });
    expect(manual.activateKillSwitch()).toEqual(first);
  });
});
