// @vitest-environment node

import { describe, expect, it } from "vitest";
import { ProfitRouterFoundation, expectedCostPerUsableSuccess } from "./foundation.ts";
import type { ProfitRouteCandidate, RouterPolicyVersion } from "./types.ts";

const now = new Date("2026-08-13T12:00:00.000Z");
const policy: RouterPolicyVersion = {
  id: "profit-router-policy:shadow:v1",
  version: 1,
  lifecycle: "PUBLISHED",
  mode: "SHADOW",
  allowStaleCost: false,
  maximumMetricAgeSeconds: 3600,
  publishedAt: "2026-08-13T00:00:00.000Z",
};

function candidate(overrides: Partial<ProfitRouteCandidate> = {}): ProfitRouteCandidate {
  return {
    routeVersionId: "route:provider-test:video:v1",
    familyVersionId: "family:test-video:v1",
    providerId: "provider-test",
    providerAccountId: "provider-test:local-account",
    lifecycle: "PUBLISHED",
    expiresAt: "2099-01-01T00:00:00.000Z",
    capabilityMatches: true,
    exactEquivalence: { required: false, approved: false, groupId: null },
    cost: { versionId: "cost:provider-test:v1", status: "FRESH", validUntil: "2099-01-01T00:00:00.000Z" },
    credential: { status: "ACTIVE", expiresAt: "2099-01-01T00:00:00.000Z" },
    treasury: { shadowAvailableAtomic: "1000", maximumExposureAtomic: "20" },
    circuitClosed: true,
    capacityAvailable: true,
    privacyCompatible: true,
    actualCostExtractor: "provider-test.actual_provider_credits.v1",
    margin: { projectedMarginBps: 5000, hardFloorMarginBps: 2500 },
    pinnedByQuote: true,
    metricsObservedAt: "2026-08-13T11:30:00.000Z",
    metricSignature: {
      routeVersionId: "route:provider-test:video:v1",
      modelVersionId: "local/test-video-v1",
      inputMode: "text",
      resolution: "720p",
      durationBucket: "10s",
      audioMode: "without_audio",
      referenceMode: "none",
      adapterVersion: "provider-test-http.v1",
      retryPolicyVersionId: "retry:none:v1",
    },
    attempts: [{ attemptNumber: 1, reachProbabilityPpm: 1_000_000, expectedCostMicrousd: "200000", usableSuccessProbabilityPpm: 800_000 }],
    ...overrides,
  };
}

describe("Profit Router hard-gate foundation", () => {
  it("computes exact retry-policy cost per usable success without floating point", () => {
    const metric = expectedCostPerUsableSuccess([
      { attemptNumber: 1, reachProbabilityPpm: 1_000_000, expectedCostMicrousd: "200000", usableSuccessProbabilityPpm: 800_000 },
      { attemptNumber: 2, reachProbabilityPpm: 200_000, expectedCostMicrousd: "200000", usableSuccessProbabilityPpm: 800_000 },
    ]);
    expect(metric).toEqual({
      expectedPolicyCost: { numeratorMicrousdPpm: "240000000000", denominatorPpm: "1000000" },
      usableSuccessProbability: { numerator: "24", denominator: "25" },
      expectedCostPerUsableSuccess: { numeratorMicrousd: "250000", denominator: "1", ceilingMicrousd: "250000" },
    });
  });

  it("allows a higher nominal cost Route to be economically better after usable-success probability", () => {
    const cheapUnreliable = expectedCostPerUsableSuccess([
      { attemptNumber: 1, reachProbabilityPpm: 1_000_000, expectedCostMicrousd: "200000", usableSuccessProbabilityPpm: 500_000 },
    ]);
    const higherReliable = expectedCostPerUsableSuccess([
      { attemptNumber: 1, reachProbabilityPpm: 1_000_000, expectedCostMicrousd: "280000", usableSuccessProbabilityPpm: 900_000 },
    ]);
    expect(cheapUnreliable.expectedCostPerUsableSuccess.ceilingMicrousd).toBe("400000");
    expect(higherReliable.expectedCostPerUsableSuccess.ceilingMicrousd).toBe("311112");
  });

  it("excludes a Route at hard gates and never gives an excluded Route economics or a score input", () => {
    const foundation = new ProfitRouterFoundation(policy, () => now);
    const result = foundation.evaluate("decision-hard-gates", candidate({
      lifecycle: "SUSPENDED",
      capabilityMatches: false,
      exactEquivalence: { required: true, approved: false, groupId: null },
      cost: { versionId: "cost:expired", status: "EXPIRED", validUntil: "2026-08-13T11:00:00.000Z" },
      credential: { status: "REVOKED", expiresAt: null },
      treasury: { shadowAvailableAtomic: "10", maximumExposureAtomic: "20" },
      circuitClosed: false,
      capacityAvailable: false,
      privacyCompatible: false,
      actualCostExtractor: null,
      margin: { projectedMarginBps: 1000, hardFloorMarginBps: 2500 },
      metricsObservedAt: "2026-08-13T10:00:00.000Z",
      pinnedByQuote: false,
    }));
    expect(result).toMatchObject({
      eligible: false,
      economics: null,
      rejectionReasons: [
        "ROUTE_NOT_PUBLISHED",
        "CAPABILITY_MISMATCH",
        "EXACT_EQUIVALENCE_REQUIRED",
        "COST_VERSION_NOT_USABLE",
        "CREDENTIAL_NOT_ACTIVE",
        "SHADOW_BALANCE_INSUFFICIENT",
        "CIRCUIT_OPEN",
        "CAPACITY_UNAVAILABLE",
        "PRIVACY_POLICY_MISMATCH",
        "ACTUAL_COST_EXTRACTOR_MISSING",
        "MARGIN_FLOOR_BREACH",
        "METRICS_NOT_FRESH",
        "ROUTE_NOT_PINNED_BY_QUOTE",
      ],
    });
  });

  it("returns exact economics only after every hard gate passes", () => {
    const result = new ProfitRouterFoundation(policy, () => now).evaluate("decision-eligible", candidate());
    expect(result).toMatchObject({
      policyVersionId: policy.id,
      mode: "SHADOW",
      eligible: true,
      rejectionReasons: [],
      economics: {
        usableSuccessProbability: { numerator: "4", denominator: "5" },
        expectedCostPerUsableSuccess: { numeratorMicrousd: "250000", denominator: "1", ceilingMicrousd: "250000" },
      },
    });
  });
});
