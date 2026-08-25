// @vitest-environment node

import { describe, expect, it } from "vitest";
import { VersionedShadowScorer } from "./scoring.ts";
import type {
  CandidateFoundationEvaluation,
  RouteHardGateCode,
  ScoreCandidateInput,
  ScorePolicyVersion,
} from "./types.ts";

const baseTime = new Date("2026-08-13T12:00:00.000Z");
const policy: ScorePolicyVersion = {
  id: "profit-score:shadow:v1",
  version: 1,
  lifecycle: "PUBLISHED",
  weightsBps: {
    expectedCostPerUsableSuccess: 4500,
    reliability: 2500,
    quality: 2000,
    latency: 1000,
  },
  hysteresisThresholdBps: 100,
  stickyOverrideThresholdBps: 300,
  stickyTtlSeconds: 900,
  tieBreak: "ROUTE_VERSION_ID_ASC",
  autoLearningEnabled: false,
  publishedAt: "2026-08-13T00:00:00.000Z",
};

function foundation(
  routeVersionId: string,
  costMicrousd: string,
  rejectionReasons: readonly RouteHardGateCode[] = [],
): CandidateFoundationEvaluation {
  const eligible = rejectionReasons.length === 0;
  return {
    decisionId: `foundation:${routeVersionId}`,
    policyVersionId: "profit-router-policy:shadow:v1",
    mode: "SHADOW",
    routeVersionId,
    evaluatedAt: baseTime.toISOString(),
    eligible,
    rejectionReasons,
    metricSignature: {
      routeVersionId,
      modelVersionId: "local/test-video-v1",
      inputMode: "text",
      resolution: "720p",
      durationBucket: "10s",
      audioMode: "without_audio",
      referenceMode: "none",
      adapterVersion: "provider-test-http.v1",
      retryPolicyVersionId: "retry:none:v1",
    },
    economics: eligible ? {
      expectedPolicyCost: { numeratorMicrousdPpm: `${costMicrousd}000000`, denominatorPpm: "1000000" },
      usableSuccessProbability: { numerator: "1", denominator: "1" },
      expectedCostPerUsableSuccess: { numeratorMicrousd: costMicrousd, denominator: "1", ceilingMicrousd: costMicrousd },
    } : null,
  };
}

function scored(
  routeVersionId: string,
  options: { cost?: string; reliability?: number; quality?: number; latency?: number; rejected?: RouteHardGateCode[] } = {},
): ScoreCandidateInput {
  return {
    foundation: foundation(routeVersionId, options.cost ?? "250000", options.rejected ?? []),
    reliabilityPpm: options.reliability ?? 900_000,
    qualityPpm: options.quality ?? 900_000,
    p95LatencyMs: options.latency ?? 1000,
  };
}

describe("versioned Shadow scoring", () => {
  it("pins the manual 45/25/20/10 policy and rejects invalid or auto-learned weights", () => {
    expect(() => new VersionedShadowScorer({
      ...policy,
      weightsBps: { ...policy.weightsBps, latency: 999 },
    }, () => baseTime)).toThrowError(expect.objectContaining({ code: "INVALID_SCORE_POLICY" }));
    expect(() => new VersionedShadowScorer({
      ...policy,
      autoLearningEnabled: true,
    } as unknown as ScorePolicyVersion, () => baseTime)).toThrowError(expect.objectContaining({ code: "INVALID_SCORE_POLICY" }));
  });

  it("uses exact weighted components and a deterministic Route-ID tie break", () => {
    const decision = new VersionedShadowScorer(policy, () => baseTime).decide({
      decisionId: "score-tie",
      candidates: [scored("route-b"), scored("route-a")],
    });
    expect(decision).toMatchObject({
      rawWinnerRouteVersionId: "route-a",
      selectedRouteVersionId: "route-a",
      selectionReason: "DETERMINISTIC_TIE_BREAK",
      dispatchMutationPerformed: false,
    });
    expect(decision.candidates.find(({ routeVersionId }) => routeVersionId === "route-a")?.weightedScore).toMatchObject({
      numerator: "9550",
      denominator: "1",
      floorBps: 9550,
    });
  });

  it("holds an eligible incumbent when the exact score advantage is below hysteresis", () => {
    const decision = new VersionedShadowScorer(policy, () => baseTime).decide({
      decisionId: "score-hysteresis",
      incumbentRouteVersionId: "route-b",
      candidates: [
        scored("route-a", { reliability: 901_000 }),
        scored("route-b", { reliability: 900_000 }),
      ],
    });
    expect(decision).toMatchObject({
      rawWinnerRouteVersionId: "route-a",
      selectedRouteVersionId: "route-b",
      selectionReason: "HYSTERESIS_HOLD",
    });
  });

  it("keeps a sticky Route below its override threshold, then deterministically replaces it", () => {
    let clock = baseTime;
    const scorer = new VersionedShadowScorer(policy, () => clock);
    const initial = scorer.decide({
      decisionId: "sticky-initial",
      stickyKey: "project-001:user-001",
      candidates: [
        scored("route-a", { reliability: 800_000, quality: 800_000 }),
        scored("route-b", { reliability: 900_000, quality: 900_000 }),
      ],
    });
    expect(initial.selectedRouteVersionId).toBe("route-b");

    const held = scorer.decide({
      decisionId: "sticky-held",
      stickyKey: "project-001:user-001",
      candidates: [
        scored("route-a", { reliability: 920_000, quality: 920_000 }),
        scored("route-b", { reliability: 900_000, quality: 900_000 }),
      ],
    });
    expect(held).toMatchObject({ rawWinnerRouteVersionId: "route-a", selectedRouteVersionId: "route-b", selectionReason: "STICKY_HOLD" });
    expect(held.stickyKeyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(held)).not.toContain("project-001:user-001");

    const overridden = scorer.decide({
      decisionId: "sticky-overridden",
      stickyKey: "project-001:user-001",
      candidates: [
        scored("route-a", { reliability: 1_000_000, quality: 1_000_000 }),
        scored("route-b", { reliability: 800_000, quality: 800_000 }),
      ],
    });
    expect(overridden).toMatchObject({ rawWinnerRouteVersionId: "route-a", selectedRouteVersionId: "route-a", selectionReason: "STICKY_OVERRIDDEN" });

    clock = new Date(baseTime.getTime() + 901_000);
    const afterExpiry = scorer.decide({
      decisionId: "sticky-expired",
      stickyKey: "project-001:user-001",
      candidates: [scored("route-a"), scored("route-b", { reliability: 950_000 })],
    });
    expect(afterExpiry.selectedRouteVersionId).toBe("route-b");
  });

  it("never lets hysteresis or stickiness resurrect a hard-gate-excluded Route", () => {
    const scorer = new VersionedShadowScorer(policy, () => baseTime);
    scorer.decide({
      decisionId: "sticky-safe-initial",
      stickyKey: "safe-sticky-key",
      candidates: [scored("route-a"), scored("route-b", { reliability: 950_000 })],
    });
    const decision = scorer.decide({
      decisionId: "sticky-safe-exclusion",
      stickyKey: "safe-sticky-key",
      incumbentRouteVersionId: "route-b",
      candidates: [
        scored("route-a"),
        scored("route-b", { rejected: ["CIRCUIT_OPEN"] }),
      ],
    });
    expect(decision).toMatchObject({
      rawWinnerRouteVersionId: "route-a",
      selectedRouteVersionId: "route-a",
      selectionReason: "STICKY_OVERRIDDEN",
      candidates: expect.arrayContaining([
        expect.objectContaining({ routeVersionId: "route-b", eligible: false, weightedScore: null, excludedByHardGates: ["CIRCUIT_OPEN"] }),
      ]),
    });
  });
});
