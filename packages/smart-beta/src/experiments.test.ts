// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  InMemorySmartExperimentController,
  InMemorySmartExperimentPolicyRegistry,
} from "./experiments.ts";
import type {
  ExplorationPlan,
  SmartExperimentKind,
  SmartExperimentPolicyVersion,
  SmartSelectionAuthorization,
} from "./types.ts";

const now = new Date("2026-08-13T12:00:00.000Z");
const profileVersionId = "smart-profile:best-value:v1";
const explorationPolicyVersionId = "smart-exploration:v1";

const authorization: SmartSelectionAuthorization = {
  authorizationId: "smart-auth:1",
  userId: "private-user-id",
  profileVersionId,
  profileKey: "BEST_VALUE",
  consentId: "consent:1",
  disclosureVersionId: "smart-disclosure:v1",
  automaticSelection: true,
  preSelectionDisclosure: "Smart automatically chooses one of the disclosed eligible models.",
  candidateVersions: [
    {
      familyVersionId: "family:a:v1",
      modelVersionId: "model:a:v3",
      routeVersionId: "route:a:v2",
      exactCertified: false,
      smartProfileCertified: true,
    },
    {
      familyVersionId: "family:b:v1",
      modelVersionId: "model:b:v5",
      routeVersionId: "route:b:v4",
      exactCertified: true,
      smartProfileCertified: true,
    },
  ],
  selectionAuthorityGranted: true,
  hiddenSubstitutionAllowed: false,
  externalDispatchPerformed: false,
  authorizedAt: now.toISOString(),
};

const explorationPlan: ExplorationPlan = {
  requestId: "explore:1",
  policyVersionId: explorationPolicyVersionId,
  assignmentKeyHash: "assignment-hash",
  bucketBps: 10,
  selection: "EXPLORATION",
  reservationId: "exploration-reservation:1",
  reservedIncrementalCostMicrousd: "25000",
  customerQuotedCreditsUnchanged: true,
  customerSurchargeMicrousd: "0",
  platformFunded: true,
  dispatchMutationPerformed: false,
  reason: "EXPLORATION_RESERVED",
};

function policy(kind: SmartExperimentKind): SmartExperimentPolicyVersion {
  const contract = kind === "DRAFT_TO_FINAL"
    ? {
      kind,
      draftOutputLabel: "DRAFT" as const,
      finalRequiresSeparateQuote: true as const,
      finalRequiresExplicitConfirmation: true as const,
    }
    : kind === "SMART_VARIATIONS"
      ? {
        kind,
        maxVariations: 3,
        requirePerOutputModelDisclosure: true as const,
      }
      : {
        kind,
        maxQueueWaitSeconds: 900,
        maxConcurrency: 8,
        progressMode: "STAGE_ONLY_NO_PERCENTAGE" as const,
      };
  return {
    id: `smart-experiment:${kind.toLowerCase()}:v1`,
    experimentKey: kind.toLowerCase(),
    version: 1,
    lifecycle: "PUBLISHED",
    kind,
    eligibleProfileVersionIds: [profileVersionId],
    explorationPolicyVersionId,
    disclosureVersionId: `experiment-disclosure:${kind.toLowerCase()}:v1`,
    disclosureText: `This is the disclosed ${kind} beta contract.`,
    minimumSatisfactionPpm: 750_000,
    hardFloorMarginBps: 3000,
    windowStartsAt: "2026-08-13T00:00:00.000Z",
    windowEndsAt: "2026-08-14T00:00:00.000Z",
    platformSubsidized: true,
    customerContractMutationAllowed: false,
    contract,
    publishedAt: "2026-08-13T00:00:00.000Z",
  };
}

function plan(controller: InMemorySmartExperimentController, runId: string, requestedVariations?: number) {
  return controller.plan({
    runId,
    userKey: "private-experiment-user",
    authorization,
    explorationPlan,
    ...(requestedVariations === undefined ? {} : { requestedVariations }),
  });
}

function output(outputId: string, index: number, stage: "DRAFT" | "FINAL" | "VARIATION" | "RELAXED_RESULT", second = false) {
  const candidate = authorization.candidateVersions[second ? 1 : 0]!;
  return {
    outputId,
    index,
    stage,
    actualFamilyVersionId: candidate.familyVersionId,
    actualModelVersionId: candidate.modelVersionId,
    actualRouteVersionId: candidate.routeVersionId,
  };
}

describe("transparent Smart beta Experiment contracts", () => {
  it("publishes immutable, versioned contracts for all three experiment kinds", () => {
    const registry = new InMemorySmartExperimentPolicyRegistry();
    for (const kind of ["DRAFT_TO_FINAL", "SMART_VARIATIONS", "RELAXED_QUEUE"] as const) {
      const published = registry.publish(policy(kind));
      expect(registry.publish(policy(kind))).toEqual(published);
      expect(published).toMatchObject({
        kind,
        platformSubsidized: true,
        customerContractMutationAllowed: false,
      });
    }
    expect(() => registry.publish({
      ...policy("RELAXED_QUEUE"),
      id: "invalid-fake-progress",
      contract: {
        ...policy("RELAXED_QUEUE").contract,
        progressMode: "PERCENTAGE",
      },
    } as unknown as SmartExperimentPolicyVersion)).toThrowError(expect.objectContaining({ code: "INVALID_EXPERIMENT_POLICY" }));
    expect(() => registry.publish({ ...policy("DRAFT_TO_FINAL"), disclosureText: "changed" }))
      .toThrowError(expect.objectContaining({ code: "IMMUTABLE_EXPERIMENT_POLICY" }));
  });

  it("requires pinned Smart authorization and a real platform exploration reservation", () => {
    const controller = new InMemorySmartExperimentController(policy("RELAXED_QUEUE"), () => now);
    const run = plan(controller, "run:enrolled");
    expect(run).toMatchObject({
      explorationReservationId: explorationPlan.reservationId,
      disclosureVersionId: "experiment-disclosure:relaxed_queue:v1",
      platformSubsidized: true,
      customerSurchargeMicrousd: "0",
      customerContractMutationAllowed: false,
      dispatchMutationPerformed: false,
    });
    expect(JSON.stringify(run)).not.toContain("private-experiment-user");
    expect(() => controller.plan({
      runId: "run:no-reserve",
      userKey: "user",
      authorization,
      explorationPlan: { ...explorationPlan, selection: "CONTROL", reservationId: null },
    })).toThrowError(expect.objectContaining({ code: "INVALID_EXPERIMENT_ENROLLMENT" }));
  });

  it("makes enrollment idempotent and rejects conflicting reuse of a run ID", () => {
    const controller = new InMemorySmartExperimentController(policy("SMART_VARIATIONS"), () => now);
    const first = plan(controller, "run:idempotent", 2);
    expect(plan(controller, "run:idempotent", 2)).toEqual(first);
    expect(() => plan(controller, "run:idempotent", 3))
      .toThrowError(expect.objectContaining({ code: "EXPERIMENT_REQUEST_CONFLICT" }));
  });

  it("enforces Draft-to-Final labeling, a separate final quote and explicit confirmation", () => {
    const controller = new InMemorySmartExperimentController(policy("DRAFT_TO_FINAL"), () => now);
    plan(controller, "run:draft-final");
    controller.recordOutput("run:draft-final", output("draft:1", 0, "DRAFT"));
    expect(() => controller.recordOutput("run:draft-final", output("final:1", 1, "FINAL", true)))
      .toThrowError(expect.objectContaining({ code: "INVALID_EXPERIMENT_TRANSITION" }));
    controller.confirmFinal("run:draft-final", "confirmation:1", "final-quote:v2");
    const withFinal = controller.recordOutput("run:draft-final", output("final:1", 1, "FINAL", true));
    expect(withFinal.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "DRAFT", modelDisclosed: true }),
      expect.objectContaining({ stage: "FINAL", modelDisclosed: true, actualModelVersionId: "model:b:v5" }),
    ]));
    expect(controller.complete("run:draft-final")).toMatchObject({ state: "COMPLETED" });
  });

  it("bounds Smart Variations and discloses the actual model tuple for every output", () => {
    const controller = new InMemorySmartExperimentController(policy("SMART_VARIATIONS"), () => now);
    expect(() => plan(controller, "run:too-many", 4))
      .toThrowError(expect.objectContaining({ code: "INVALID_EXPERIMENT_ENROLLMENT" }));
    plan(controller, "run:variations", 3);
    controller.recordOutput("run:variations", output("variation:1", 0, "VARIATION"));
    controller.recordOutput("run:variations", output("variation:2", 1, "VARIATION", true));
    const run = controller.recordOutput("run:variations", output("variation:3", 2, "VARIATION"));
    expect(run.outputs).toHaveLength(3);
    expect(run.outputs.every((item) => item.modelDisclosed && Boolean(item.evidenceHash))).toBe(true);
    expect(controller.complete("run:variations")).toMatchObject({ state: "COMPLETED" });
  });

  it("publishes a bounded Relaxed Queue SLA and never fabricates percentage progress", () => {
    const controller = new InMemorySmartExperimentController(policy("RELAXED_QUEUE"), () => now);
    const run = plan(controller, "run:relaxed");
    expect(run.contract).toEqual({
      kind: "RELAXED_QUEUE",
      maxQueueWaitSeconds: 900,
      maxConcurrency: 8,
      progressMode: "STAGE_ONLY_NO_PERCENTAGE",
    });
    controller.recordOutput("run:relaxed", output("relaxed:1", 0, "RELAXED_RESULT"));
    expect(controller.complete("run:relaxed")).toMatchObject({ state: "COMPLETED" });
  });

  it("stops new enrollment instantly while allowing pinned in-flight runs to finish without redispatch", () => {
    const controller = new InMemorySmartExperimentController(policy("RELAXED_QUEUE"), () => now);
    const active = plan(controller, "run:before-kill");
    expect(controller.activateKillSwitch()).toMatchObject({ killSwitchActive: true, killSwitchReason: "MANUAL" });
    expect(() => plan(controller, "run:after-kill"))
      .toThrowError(expect.objectContaining({ code: "EXPERIMENT_KILL_SWITCH_ACTIVE" }));
    expect(active.inFlightPolicy).toBe("COMPLETE_PINNED_NO_REDISPATCH");
    controller.recordOutput("run:before-kill", output("relaxed:existing", 0, "RELAXED_RESULT"));
    expect(controller.complete("run:before-kill")).toMatchObject({ state: "COMPLETED", dispatchMutationPerformed: false });
  });

  it("trips the kill switch on satisfaction regression or Margin Floor breach", () => {
    const satisfaction = new InMemorySmartExperimentController(policy("SMART_VARIATIONS"), () => now);
    expect(satisfaction.evaluateCohort({ satisfactionPpm: 749_999, marginBps: 4000, sampleCount: 50 }))
      .toMatchObject({ killSwitchReason: "SATISFACTION_REGRESSION", newEnrollmentAllowed: false });

    const margin = new InMemorySmartExperimentController(policy("DRAFT_TO_FINAL"), () => now);
    expect(margin.evaluateCohort({ satisfactionPpm: 900_000, marginBps: 2999, sampleCount: 50 }))
      .toMatchObject({ killSwitchReason: "MARGIN_FLOOR_BREACH", newEnrollmentAllowed: false });
  });
});
