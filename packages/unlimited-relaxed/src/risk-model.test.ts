// @vitest-environment node

import { describe, expect, it } from "vitest";
import { InMemoryUnlimitedCohortBudget } from "./budget.ts";
import { evidenceHash } from "./canonical.ts";
import { InMemoryUnlimitedRiskModel } from "./risk-model.ts";
import type {
  UnlimitedCohortBudgetPolicyVersion,
  UnlimitedRiskModelPolicyVersion,
  UnlimitedUserUsageAggregate,
} from "./types.ts";

const budgetPolicy: UnlimitedCohortBudgetPolicyVersion = {
  id: "unlimited-cohort-budget:v1",
  cohortId: "cohort:relaxed-pilot:1",
  version: 1,
  lifecycle: "PUBLISHED",
  offerPolicyVersionId: "unlimited-relaxed-offer:v1",
  netCohortSubscriptionEconomicValueMicrousd: "20000000",
  approvedCogsRatioBps: 5000,
  maximumCogsPerOperationMicrousd: "500000",
  periodStartsAt: "2026-08-01T00:00:00.000Z",
  periodEndsAt: "2026-10-31T00:00:00.000Z",
  calculation: "NET_COHORT_VALUE_TIMES_APPROVED_COGS_RATIO_FLOOR",
  budgetAuthority: "LOCAL_SIMULATION_ONLY",
  pilotActivationAllowed: false,
  publishedAt: "2026-08-01T00:00:00.000Z",
};

const riskPolicy: UnlimitedRiskModelPolicyVersion = {
  id: "unlimited-risk-model:v1",
  policyKey: "relaxed-pilot-risk",
  version: 1,
  lifecycle: "PUBLISHED",
  offerPolicyVersionId: budgetPolicy.offerPolicyVersionId,
  cohortBudgetPolicyVersionId: budgetPolicy.id,
  minimumUserSampleCount: 100,
  minimumRepresentativeDays: 60,
  minimumFinancialCycles: 2,
  percentiles: [50, 90, 95, 99],
  priceShockBps: [1000, 2500, 5000],
  quantileMethod: "NEAREST_RANK",
  analysisAuthority: "SIMULATE_ONLY",
  pilotActivationAllowed: false,
  publishedAt: "2026-08-01T00:00:00.000Z",
};

function observations(costs: readonly number[]): UnlimitedUserUsageAggregate[] {
  return costs.map((cost, index) => ({
    aggregateId: `usage-aggregate:${index + 1}`,
    userKeyHash: evidenceHash(`private-user:${index + 1}`),
    operationCount: index % 5 + 1,
    actualCogsMicrousd: cost.toString(),
    sanitizedAggregate: true,
    containsUserIdentifier: false,
    containsPromptOrAsset: false,
  }));
}

function budget(netValue = "20000000", ratioBps = 5000) {
  return new InMemoryUnlimitedCohortBudget({
    ...budgetPolicy,
    netCohortSubscriptionEconomicValueMicrousd: netValue,
    approvedCogsRatioBps: ratioBps,
  }, () => new Date("2026-08-13T12:00:00.000Z")).snapshot();
}

function input(overrides: Partial<Parameters<InMemoryUnlimitedRiskModel["analyze"]>[0]> = {}) {
  return {
    reportId: "risk-report:1",
    budget: budget(),
    windowStartsAt: "2026-06-01T00:00:00.000Z",
    windowEndsAt: "2026-08-01T00:00:00.000Z",
    completedFinancialCycles: 0,
    observations: observations(Array.from({ length: 100 }, (_, index) => (index + 1) * 1000)),
    ...overrides,
  };
}

describe("Unlimited Relaxed percentile and shock Risk Model", () => {
  it("requires immutable P50/P90/P95/P99 nearest-rank policy and ordered bounded shocks", () => {
    expect(() => new InMemoryUnlimitedRiskModel({
      ...riskPolicy,
      percentiles: [50, 90, 95, 95],
    } as unknown as UnlimitedRiskModelPolicyVersion))
      .toThrowError(expect.objectContaining({ code: "INVALID_RISK_MODEL_POLICY" }));
    expect(() => new InMemoryUnlimitedRiskModel({ ...riskPolicy, priceShockBps: [5000, 1000] }))
      .toThrowError(expect.objectContaining({ code: "INVALID_RISK_MODEL_POLICY" }));
  });

  it("rejects duplicate users, sensitive aggregates and a mismatched or unreconciled budget", () => {
    const model = new InMemoryUnlimitedRiskModel(riskPolicy);
    const rows = observations(Array.from({ length: 100 }, () => 1000));
    rows[1] = { ...rows[1]!, userKeyHash: rows[0]!.userKeyHash };
    expect(() => model.analyze(input({ reportId: "duplicate", observations: rows })))
      .toThrowError(expect.objectContaining({ code: "INVALID_RISK_OBSERVATIONS" }));
    expect(() => model.analyze(input({
      reportId: "sensitive",
      observations: observations(Array.from({ length: 100 }, () => 1000)).map((row, index) =>
        index === 0 ? { ...row, containsUserIdentifier: true as false } : row),
    }))).toThrowError(expect.objectContaining({ code: "INVALID_RISK_OBSERVATIONS" }));
    expect(() => model.analyze(input({
      reportId: "budget-drift",
      budget: { ...budget(), projectionReconciled: false },
    }))).toThrowError(expect.objectContaining({ code: "INVALID_RISK_OBSERVATIONS" }));
  });

  it("does not mark data representative before 60 days or two completed financial cycles", () => {
    const report = new InMemoryUnlimitedRiskModel(riskPolicy).analyze(input({
      windowStartsAt: "2026-07-01T00:00:00.000Z",
      windowEndsAt: "2026-07-31T00:00:00.000Z",
      completedFinancialCycles: 1,
    }));
    expect(report).toMatchObject({
      representativeDayCount: 30,
      dataReadiness: "INSUFFICIENT_DATA",
      representativeBasis: "INSUFFICIENT",
      riskOutcome: "INSUFFICIENT_DATA",
      pilotActivationAllowed: false,
    });
  });

  it("calculates exact nearest-rank P50/P90/P95/P99 and heavy-user share", () => {
    const report = new InMemoryUnlimitedRiskModel(riskPolicy).analyze(input());
    expect(report).toMatchObject({
      representativeDayCount: 61,
      userSampleCount: 100,
      operationSampleCount: 300,
      totalActualCogsMicrousd: "5050000",
      meanUserCogsMicrousd: "50500",
      percentilesMicrousd: {
        p50: "50000",
        p90: "90000",
        p95: "95000",
        p99: "99000",
      },
      p99ToP50RatioBps: "19800",
      heavyUserThresholdMicrousd: "99000",
      heavyUserCount: 2,
      heavyUserCogsShareBps: "394",
      dataReadiness: "REPRESENTATIVE",
      representativeBasis: "SIXTY_DAYS",
      riskOutcome: "WITHIN_APPROVED_BUDGET",
      decisionUsesAverageOnly: false,
    });
  });

  it("simulates conservative price shocks and reports the exact budget loss", () => {
    const report = new InMemoryUnlimitedRiskModel(riskPolicy).analyze(input({
      budget: budget("12000000", 5000),
    }));
    expect(report.scenarios).toEqual([
      expect.objectContaining({ scenario: "CURRENT", projectedCohortCogsMicrousd: "5050000", budgetBreached: false }),
      expect.objectContaining({ scenario: "PRICE_SHOCK", shockBps: 1000, projectedCohortCogsMicrousd: "5555000", budgetBreached: false }),
      expect.objectContaining({ scenario: "PRICE_SHOCK", shockBps: 2500, projectedCohortCogsMicrousd: "6312500", projectedBudgetLossMicrousd: "312500", budgetBreached: true }),
      expect.objectContaining({ scenario: "PRICE_SHOCK", shockBps: 5000, projectedCohortCogsMicrousd: "7575000", projectedBudgetLossMicrousd: "1575000", budgetBreached: true }),
      expect.objectContaining({ scenario: "ALL_USERS_AT_P99", projectedCohortCogsMicrousd: "9900000", projectedBudgetLossMicrousd: "3900000", budgetBreached: true }),
    ]);
    expect(report.riskOutcome).toBe("BUDGET_BREACH_PROJECTED");
  });

  it("detects heavy-tail risk even when arithmetic mean matches a flat cohort", () => {
    const flat = observations(Array.from({ length: 100 }, () => 100000));
    const heavyTail = observations([
      ...Array.from({ length: 98 }, () => 0),
      5000000,
      5000000,
    ]);
    const model = new InMemoryUnlimitedRiskModel(riskPolicy);
    const flatReport = model.analyze(input({ reportId: "flat", observations: flat, budget: budget("30000000", 5000) }));
    const tailReport = model.analyze(input({ reportId: "tail", observations: heavyTail, budget: budget("30000000", 5000) }));
    expect(flatReport.meanUserCogsMicrousd).toBe("100000");
    expect(tailReport.meanUserCogsMicrousd).toBe("100000");
    expect(flatReport.percentilesMicrousd.p99).toBe("100000");
    expect(tailReport.percentilesMicrousd.p99).toBe("5000000");
    expect(flatReport.scenarios.at(-1)).toMatchObject({ projectedCohortCogsMicrousd: "10000000", budgetBreached: false });
    expect(tailReport.scenarios.at(-1)).toMatchObject({ projectedCohortCogsMicrousd: "500000000", budgetBreached: true });
  });

  it("accepts two completed financial cycles as the alternative representative basis", () => {
    const report = new InMemoryUnlimitedRiskModel(riskPolicy).analyze(input({
      windowStartsAt: "2026-07-01T00:00:00.000Z",
      windowEndsAt: "2026-07-31T00:00:00.000Z",
      completedFinancialCycles: 2,
    }));
    expect(report).toMatchObject({
      representativeDayCount: 30,
      dataReadiness: "REPRESENTATIVE",
      representativeBasis: "TWO_FINANCIAL_CYCLES",
    });
  });

  it("deduplicates identical reports, rejects changed evidence and never activates the Pilot", () => {
    const model = new InMemoryUnlimitedRiskModel(riskPolicy);
    const analysis = input();
    const first = model.analyze(analysis);
    expect(model.analyze(analysis)).toEqual(first);
    expect(first).toMatchObject({
      sanitizedInputOnly: true,
      simulationOnly: true,
      pilotActivationAllowed: false,
      externalDispatchPerformed: false,
    });
    expect(first.evidenceHash).toHaveLength(64);
    expect(() => model.analyze({ ...analysis, completedFinancialCycles: 2 }))
      .toThrowError(expect.objectContaining({ code: "RISK_REPORT_CONFLICT" }));
  });
});
