// @vitest-environment node

import { describe, expect, it } from "vitest";
import { InMemoryShadowDecisionEvidenceStore } from "./evidence.ts";
import { InMemoryRouteOutcomeStore } from "./metrics.ts";
import { VersionedShadowScorer } from "./scoring.ts";
import type {
  CandidateFoundationEvaluation,
  MetricAggregationPolicyVersion,
  RouteMetricSignature,
  RouteOutcomeObservation,
  ScoreCandidateInput,
  ScorePolicyVersion,
  ShadowScoreRequest,
} from "./types.ts";

const baseTime = new Date("2026-08-13T12:00:00.000Z");
const signature: RouteMetricSignature = {
  routeVersionId: "route-a",
  modelVersionId: "local/test-image-v1",
  inputMode: "text",
  resolution: "1024x1024",
  durationBucket: "none",
  audioMode: "none",
  referenceMode: "none",
  adapterVersion: "provider-test-http.v1",
  retryPolicyVersionId: "retry:none:v1",
};
const metricPolicy: MetricAggregationPolicyVersion = {
  id: "route-metrics:v1",
  version: 1,
  lifecycle: "PUBLISHED",
  windowSeconds: 3600,
  minimumSamples: 4,
  publishedAt: "2026-08-13T00:00:00.000Z",
};
const scorePolicy: ScorePolicyVersion = {
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

function outcome(
  index: number,
  values: Partial<RouteOutcomeObservation> = {},
): RouteOutcomeObservation {
  return {
    observationId: `observation-${index}`,
    operationId: `operation-${index}`,
    metricSignature: signature,
    status: "USABLE_SUCCESS",
    qualityPpm: 900_000,
    latencyMs: index * 100,
    observedAt: new Date(baseTime.getTime() - index * 60_000).toISOString(),
    ...values,
  };
}

function foundation(routeVersionId: string): CandidateFoundationEvaluation {
  return {
    decisionId: `foundation:${routeVersionId}`,
    policyVersionId: "profit-router-policy:shadow:v1",
    mode: "SHADOW",
    routeVersionId,
    evaluatedAt: baseTime.toISOString(),
    eligible: true,
    rejectionReasons: [],
    metricSignature: { ...signature, routeVersionId },
    economics: {
      expectedPolicyCost: { numeratorMicrousdPpm: "250000000000", denominatorPpm: "1000000" },
      usableSuccessProbability: { numerator: "1", denominator: "1" },
      expectedCostPerUsableSuccess: { numeratorMicrousd: "250000", denominator: "1", ceilingMicrousd: "250000" },
    },
  };
}

function candidate(routeVersionId: string, reliabilityPpm: number, qualityPpm = reliabilityPpm): ScoreCandidateInput {
  return {
    foundation: foundation(routeVersionId),
    reliabilityPpm,
    qualityPpm,
    p95LatencyMs: 1000,
  };
}

describe("route outcome metrics", () => {
  it("deduplicates immutable outcomes and rejects conflicting operation evidence", () => {
    const store = new InMemoryRouteOutcomeStore();
    const first = outcome(1);
    expect(store.append(first)).toEqual(first);
    expect(store.append(first)).toEqual(first);
    expect(() => store.append({ ...first, status: "PROVIDER_FAILURE", qualityPpm: null }))
      .toThrowError(expect.objectContaining({ code: "ROUTE_OUTCOME_CONFLICT" }));
    expect(() => store.append(outcome(2, { status: "INGEST_FAILURE", qualityPpm: 100_000 })))
      .toThrowError(expect.objectContaining({ code: "INVALID_ROUTE_OUTCOME" }));
  });

  it("aggregates signature-scoped reliability, rated quality and nearest-rank p95 deterministically", () => {
    const store = new InMemoryRouteOutcomeStore();
    store.append(outcome(1, { qualityPpm: 900_000, latencyMs: 100 }));
    store.append(outcome(2, { qualityPpm: 800_000, latencyMs: 200 }));
    store.append(outcome(3, { qualityPpm: null, latencyMs: 300 }));
    store.append(outcome(4, { status: "PROVIDER_FAILURE", qualityPpm: null, latencyMs: 400 }));
    store.append(outcome(5, {
      metricSignature: { ...signature, routeVersionId: "route-b" },
      qualityPpm: 1_000_000,
    }));

    expect(store.aggregate(signature, metricPolicy, baseTime)).toMatchObject({
      metricPolicyVersionId: "route-metrics:v1",
      sampleCount: 4,
      usableSuccessCount: 3,
      ratedSuccessCount: 2,
      readiness: "READY",
      reliabilityPpm: 750_000,
      qualityPpm: 850_000,
      p95LatencyMs: 400,
      signatureHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      observationsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("marks an undersized metric window as insufficient instead of inventing readiness", () => {
    const store = new InMemoryRouteOutcomeStore();
    store.append(outcome(1));
    expect(store.aggregate(signature, metricPolicy, baseTime)).toMatchObject({
      sampleCount: 1,
      readiness: "INSUFFICIENT_SAMPLES",
    });
  });
});

describe("append-only Shadow decision evidence", () => {
  it("records a hash chain and exactly replays highest-score and sticky decisions without raw keys", () => {
    const scorer = new VersionedShadowScorer(scorePolicy, () => baseTime);
    const store = new InMemoryShadowDecisionEvidenceStore(() => baseTime);
    const firstCandidates = [candidate("route-a", 800_000), candidate("route-b", 900_000)];
    const firstRequest: ShadowScoreRequest = { decisionId: "decision-1", candidates: firstCandidates };
    const firstExecution = scorer.decideWithReplay({
      ...firstRequest,
      stickyKey: "project-001:user-001",
    });
    const firstRecord = store.append({ scorePolicy, request: firstRequest, execution: firstExecution });

    const secondCandidates = [candidate("route-a", 920_000), candidate("route-b", 900_000)];
    const secondRequest: ShadowScoreRequest = { decisionId: "decision-2", candidates: secondCandidates };
    const secondExecution = scorer.decideWithReplay({
      ...secondRequest,
      stickyKey: "project-001:user-001",
    });
    const secondRecord = store.append({ scorePolicy, request: secondRequest, execution: secondExecution });

    expect(firstRecord).toMatchObject({ sequence: 1, previousRecordHash: null });
    expect(secondRecord).toMatchObject({
      sequence: 2,
      previousRecordHash: firstRecord.recordHash,
      decision: { selectionReason: "STICKY_HOLD", dispatchMutationPerformed: false },
    });
    expect(store.verifyChain()).toBe(true);
    expect(store.replay("decision-1")).toMatchObject({ matched: true, dispatchMutationPerformed: false });
    expect(store.replay("decision-2")).toMatchObject({ matched: true, dispatchMutationPerformed: false });
    expect(JSON.stringify(store.list())).not.toContain("project-001:user-001");
  });

  it("is idempotent for identical evidence and rejects a changed decision before append", () => {
    const candidates = [candidate("route-a", 900_000), candidate("route-b", 800_000)];
    const request: ShadowScoreRequest = { decisionId: "decision-idempotent", candidates };
    const execution = new VersionedShadowScorer(scorePolicy, () => baseTime).decideWithReplay(request);
    const store = new InMemoryShadowDecisionEvidenceStore(() => baseTime);
    expect(store.append({ scorePolicy, request, execution }).sequence).toBe(1);
    expect(store.append({ scorePolicy, request, execution }).sequence).toBe(1);
    expect(() => store.append({
      scorePolicy,
      request,
      execution: {
        ...execution,
        decision: { ...execution.decision, selectedRouteVersionId: "route-b" },
      },
    })).toThrowError(expect.objectContaining({ code: "SHADOW_REPLAY_MISMATCH" }));
  });

  it("reports projected reliability and quality deltas against the still-active pinned Route", () => {
    const candidates = [
      candidate("route-a", 950_000, 920_000),
      candidate("route-b", 900_000, 880_000),
    ];
    const request: ShadowScoreRequest = { decisionId: "decision-report", candidates };
    const execution = new VersionedShadowScorer(scorePolicy, () => baseTime).decideWithReplay(request);
    const store = new InMemoryShadowDecisionEvidenceStore(() => baseTime);
    store.append({ scorePolicy, request, execution });
    expect(store.metrics({ "decision-report": "route-b" })).toEqual({
      decisionCount: 1,
      actualRouteKnownCount: 1,
      routeAgreementBps: 0,
      projectedReliabilityDeltaPpm: 50_000,
      projectedQualityDeltaPpm: 40_000,
      selectedHardGateViolationCount: 0,
      dispatchMutationCount: 0,
    });
  });
});
