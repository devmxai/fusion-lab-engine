// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  InMemoryCfoAdvisor,
  InMemoryCfoAdvisorPolicyRegistry,
} from "./advisor.ts";
import type {
  CfoAdvisorMetricSnapshot,
  CfoAdvisorPolicyVersion,
} from "./types.ts";

const now = new Date("2026-08-13T12:00:00.000Z");

const policy: CfoAdvisorPolicyVersion = {
  id: "cfo-advisor-policy:v1",
  policyKey: "weekly-route-finance",
  version: 1,
  lifecycle: "PUBLISHED",
  minimumSampleCount: 100,
  targetMarginBps: 3000,
  hardFloorMarginBps: 2000,
  costShockTriggerBps: 2000,
  maximumRouteConcentrationBps: 5000,
  minimumProviderRunwayDays: 7,
  targetProviderRunwayDays: 30,
  maximumUnreconciledExposureMicrousd: "200000",
  reportingCadence: "WEEKLY",
  advisorAuthority: "PROPOSE_AND_SIMULATE_ONLY",
  publishedAt: "2026-08-13T00:00:00.000Z",
};

function metrics(overrides: Partial<CfoAdvisorMetricSnapshot> = {}): CfoAdvisorMetricSnapshot {
  return {
    snapshotId: "sanitized-route-metrics:week-32",
    routeVersionId: "route:test-image:v3",
    providerAccountVersionId: "provider-account:test:v2",
    windowStartsAt: "2026-08-06T00:00:00.000Z",
    windowEndsAt: "2026-08-13T00:00:00.000Z",
    sampleCount: 1000,
    netEconomicValueMicrousd: "1000000",
    providerCogsExpectedMicrousd: "500000",
    providerCogsP90Microusd: "600000",
    providerCogsMaximumMicrousd: "700000",
    providerCogsActualMicrousd: "600000",
    observedUnitCostMicrousd: "100",
    baselineUnitCostMicrousd: "100",
    providerCashBalanceMicrousd: "3000000",
    averageDailyBurnMicrousd: "100000",
    unreconciledExposureMicrousd: "10000",
    routeConcentrationBps: 3000,
    sanitizedMetrics: true,
    containsUserIdentifiers: false,
    containsPromptsOrAssets: false,
    containsCredentials: false,
    ...overrides,
  };
}

function distressedMetrics(overrides: Partial<CfoAdvisorMetricSnapshot> = {}): CfoAdvisorMetricSnapshot {
  return metrics({
    providerCogsExpectedMicrousd: "900000",
    providerCogsP90Microusd: "1100000",
    providerCogsMaximumMicrousd: "1200000",
    providerCogsActualMicrousd: "1100000",
    observedUnitCostMicrousd: "130",
    providerCashBalanceMicrousd: "500000",
    routeConcentrationBps: 6000,
    unreconciledExposureMicrousd: "200001",
    ...overrides,
  });
}

describe("Fusion CFO Advisor proposals and deterministic simulations", () => {
  it("publishes only immutable advisory-only Policy Versions", () => {
    const registry = new InMemoryCfoAdvisorPolicyRegistry();
    const published = registry.publish(policy);
    expect(registry.publish(policy)).toEqual(published);
    expect(() => registry.publish({ ...policy, targetMarginBps: 3500 }))
      .toThrowError(expect.objectContaining({ code: "IMMUTABLE_CFO_ADVISOR_POLICY" }));
    expect(() => new InMemoryCfoAdvisor({
      ...policy,
      advisorAuthority: "PUBLISH",
    } as unknown as CfoAdvisorPolicyVersion, () => now))
      .toThrowError(expect.objectContaining({ code: "INVALID_CFO_ADVISOR_POLICY" }));
  });

  it("accepts only sufficient sanitized aggregate metrics with no identity, prompt, asset or credential", () => {
    const advisor = new InMemoryCfoAdvisor(policy, () => now);
    expect(() => advisor.analyze("report:identity", metrics({
      containsUserIdentifiers: true,
    } as unknown as Partial<CfoAdvisorMetricSnapshot>)))
      .toThrowError(expect.objectContaining({ code: "INVALID_CFO_METRIC_SNAPSHOT" }));
    expect(() => advisor.analyze("report:small-sample", metrics({ sampleCount: 99 })))
      .toThrowError(expect.objectContaining({ code: "INVALID_CFO_METRIC_SNAPSHOT" }));
    expect(() => advisor.analyze("report:invalid-cost-order", metrics({
      providerCogsP90Microusd: "800000",
      providerCogsMaximumMicrousd: "700000",
    })))
      .toThrowError(expect.objectContaining({ code: "INVALID_CFO_METRIC_SNAPSHOT" }));
  });

  it("produces a healthy weekly report without manufacturing a proposal", () => {
    const advisor = new InMemoryCfoAdvisor(policy, () => now);
    const report = advisor.analyze("report:healthy", metrics());
    expect(report).toMatchObject({
      reportingCadence: "WEEKLY",
      signals: [],
      proposals: [],
      sanitizedInputOnly: true,
      deterministicSimulation: true,
      advisorAuthority: "PROPOSE_AND_SIMULATE_ONLY",
      publishedDecisionCreated: false,
      runtimeMutationPerformed: false,
    });
    expect(report.metricsEvidenceHash).toHaveLength(64);
    expect(report.reportHash).toHaveLength(64);
  });

  it("detects loss, cost shock, low runway, concentration and unreconciled exposure deterministically", () => {
    const advisor = new InMemoryCfoAdvisor(policy, () => now);
    const report = advisor.analyze("report:distressed", distressedMetrics());
    expect(report.signals).toEqual([
      "MARGIN_FLOOR_BREACH",
      "LOSS_MAKING_ROUTE",
      "COST_SHOCK",
      "LOW_PROVIDER_RUNWAY",
      "ROUTE_CONCENTRATION",
      "UNRECONCILED_EXPOSURE",
    ]);
    expect(report.proposals.map(({ kind }) => kind)).toEqual([
      "PRICE_DRAFT",
      "SUSPENSION_DRAFT",
      "ROUTE_WEIGHT_DRAFT",
      "TREASURY_DRAFT",
      "ROUTE_WEIGHT_DRAFT",
      "SUSPENSION_DRAFT",
    ]);
  });

  it("uses exact conservative integer simulation and recommends a price above the hard floor", () => {
    const advisor = new InMemoryCfoAdvisor(policy, () => now);
    const price = advisor.analyze("report:price", distressedMetrics()).proposals[0]!;
    expect(price.recommendation.recommendedCustomerValueMicrousd).toBe("1714286");
    expect(price.simulations).toEqual([
      expect.objectContaining({
        scenario: "CURRENT",
        customerEconomicValueMicrousd: "1000000",
        maximumMarginBps: "-2000",
      }),
      expect.objectContaining({
        scenario: "RECOMMENDED_PRICE",
        customerEconomicValueMicrousd: "1714286",
        maximumMarginBps: "3000",
      }),
    ]);
  });

  it("recommends treasury funding but can never execute a provider top-up", () => {
    const advisor = new InMemoryCfoAdvisor(policy, () => now);
    const treasury = advisor.analyze("report:treasury", distressedMetrics()).proposals
      .find(({ kind }) => kind === "TREASURY_DRAFT")!;
    expect(treasury.recommendation.recommendedTreasuryFundingMicrousd).toBe("2500000");
    expect(treasury).toMatchObject({
      status: "ADVISORY_DRAFT",
      nextRequiredAction: "MAKER_REVIEW",
      executionAuthority: false,
      publishAllowed: false,
      creditMutationAllowed: false,
      providerTopUpAllowed: false,
      secretActivationAllowed: false,
      journalDeletionAllowed: false,
    });
    expect(advisor.snapshot()).toMatchObject({
      publishedDecisionCount: 0,
      creditMutationCount: 0,
      providerTopUpCount: 0,
      runtimeMutationPerformed: false,
    });
  });

  it("deduplicates report retries and rejects changed metrics under the same Report ID", () => {
    const advisor = new InMemoryCfoAdvisor(policy, () => now);
    const input = distressedMetrics();
    const first = advisor.analyze("report:idempotent", input);
    expect(advisor.analyze("report:idempotent", input)).toEqual(first);
    expect(advisor.snapshot()).toMatchObject({ reportCount: 1, proposalCount: 6 });
    expect(() => advisor.analyze("report:idempotent", distressedMetrics({ observedUnitCostMicrousd: "140" })))
      .toThrowError(expect.objectContaining({ code: "CFO_ADVISOR_REPORT_CONFLICT" }));
  });

  it("preserves an append-only tamper-evident Proposal ledger across weekly reports", () => {
    const advisor = new InMemoryCfoAdvisor(policy, () => now);
    advisor.analyze("report:week-1", distressedMetrics({ snapshotId: "metrics:week-1" }));
    advisor.analyze("report:week-2", distressedMetrics({ snapshotId: "metrics:week-2" }));
    const proposals = advisor.proposals();
    expect(proposals).toHaveLength(12);
    expect(proposals[0]).toMatchObject({ sequence: 1, previousProposalHash: null });
    expect(proposals[1]?.previousProposalHash).toBe(proposals[0]?.proposalHash);
    expect(proposals[11]).toMatchObject({ sequence: 12 });
    expect(advisor.snapshot()).toMatchObject({ reportCount: 2, proposalCount: 12, proposalChainValid: true });
  });
});
