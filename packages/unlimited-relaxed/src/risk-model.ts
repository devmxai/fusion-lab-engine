import { evidenceHash } from "./canonical.ts";
import type {
  UnlimitedCohortBudgetSnapshot,
  UnlimitedRiskModelPolicyVersion,
  UnlimitedRiskReport,
  UnlimitedRiskScenario,
  UnlimitedUserUsageAggregate,
} from "./types.ts";
import { UnlimitedRelaxedError } from "./types.ts";

function unsigned(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new UnlimitedRelaxedError("INVALID_RISK_OBSERVATIONS", "Risk Model money must use unsigned integer microusd strings.");
  }
  return BigInt(value);
}

function validatePolicy(policy: UnlimitedRiskModelPolicyVersion): void {
  const shocks = new Set(policy.priceShockBps);
  const orderedShocks = [...policy.priceShockBps].sort((left, right) => left - right);
  if (!policy.id
    || !policy.policyKey.trim()
    || !policy.offerPolicyVersionId
    || !policy.cohortBudgetPolicyVersionId
    || !Number.isInteger(policy.version)
    || policy.version <= 0
    || policy.lifecycle !== "PUBLISHED"
    || !Number.isInteger(policy.minimumUserSampleCount)
    || policy.minimumUserSampleCount < 20
    || policy.minimumRepresentativeDays !== 60
    || policy.minimumFinancialCycles !== 2
    || policy.percentiles.join(",") !== "50,90,95,99"
    || policy.priceShockBps.length === 0
    || shocks.size !== policy.priceShockBps.length
    || policy.priceShockBps.some((shock) => !Number.isInteger(shock) || shock <= 0 || shock > 100_000)
    || policy.priceShockBps.some((shock, index) => shock !== orderedShocks[index])
    || policy.quantileMethod !== "NEAREST_RANK"
    || policy.analysisAuthority !== "SIMULATE_ONLY"
    || policy.pilotActivationAllowed !== false
    || Number.isNaN(Date.parse(policy.publishedAt))) {
    throw new UnlimitedRelaxedError("INVALID_RISK_MODEL_POLICY", "Unlimited Risk Model Policy must pin P50/P90/P95/P99, representative-data gates and ordered bounded shock scenarios.");
  }
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function nearestRank(sortedValues: readonly bigint[], percentile: 50 | 90 | 95 | 99): bigint {
  const rank = Math.ceil(percentile * sortedValues.length / 100);
  return sortedValues[Math.max(0, rank - 1)]!;
}

function scenario(
  kind: UnlimitedRiskScenario["scenario"],
  shockBps: number,
  baseCogs: bigint,
  approvedCogs: bigint,
): UnlimitedRiskScenario {
  const projected = shockBps === 0
    ? baseCogs
    : ceilDivide(baseCogs * BigInt(10_000 + shockBps), 10_000n);
  const loss = projected > approvedCogs ? projected - approvedCogs : 0n;
  return {
    scenario: kind,
    shockBps,
    projectedCohortCogsMicrousd: projected.toString(),
    approvedCohortCogsMicrousd: approvedCogs.toString(),
    projectedBudgetLossMicrousd: loss.toString(),
    budgetBreached: loss > 0n,
  };
}

export class InMemoryUnlimitedRiskModel {
  private readonly policy: UnlimitedRiskModelPolicyVersion;
  private readonly reports = new Map<string, { intentHash: string; report: UnlimitedRiskReport }>();

  constructor(policy: UnlimitedRiskModelPolicyVersion) {
    validatePolicy(policy);
    this.policy = structuredClone(policy);
  }

  analyze(input: {
    reportId: string;
    budget: UnlimitedCohortBudgetSnapshot;
    windowStartsAt: string;
    windowEndsAt: string;
    completedFinancialCycles: number;
    observations: readonly UnlimitedUserUsageAggregate[];
  }): UnlimitedRiskReport {
    const intentHash = evidenceHash(input);
    const prior = this.reports.get(input.reportId);
    if (prior) {
      if (prior.intentHash === intentHash) return structuredClone(prior.report);
      throw new UnlimitedRelaxedError("RISK_REPORT_CONFLICT", "Risk Report ID was reused with different evidence.");
    }
    const windowStart = Date.parse(input.windowStartsAt);
    const windowEnd = Date.parse(input.windowEndsAt);
    const representativeDayCount = Number.isNaN(windowStart) || Number.isNaN(windowEnd)
      ? -1
      : Math.floor((windowEnd - windowStart) / 86_400_000);
    const aggregateIds = new Set(input.observations.map(({ aggregateId }) => aggregateId));
    const userHashes = new Set(input.observations.map(({ userKeyHash }) => userKeyHash));
    if (!input.reportId
      || input.budget.policyVersionId !== this.policy.cohortBudgetPolicyVersionId
      || input.budget.offerPolicyVersionId !== this.policy.offerPolicyVersionId
      || input.budget.pilotActivationAllowed !== false
      || input.budget.externalDispatchPerformed !== false
      || !input.budget.projectionReconciled
      || representativeDayCount <= 0
      || !Number.isInteger(input.completedFinancialCycles)
      || input.completedFinancialCycles < 0
      || input.observations.length === 0
      || aggregateIds.size !== input.observations.length
      || userHashes.size !== input.observations.length
      || input.observations.some((observation) => !observation.aggregateId
        || !/^[a-f0-9]{64}$/.test(observation.userKeyHash)
        || !Number.isInteger(observation.operationCount)
        || observation.operationCount <= 0
        || unsigned(observation.actualCogsMicrousd) < 0n
        || observation.sanitizedAggregate !== true
        || observation.containsUserIdentifier !== false
        || observation.containsPromptOrAsset !== false)) {
      throw new UnlimitedRelaxedError("INVALID_RISK_OBSERVATIONS", "Risk analysis requires unique sanitized per-user aggregates and a matching reconciled Cohort Budget.");
    }
    const costs = input.observations.map(({ actualCogsMicrousd }) => unsigned(actualCogsMicrousd));
    const sorted = [...costs].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    const total = costs.reduce((sum, cost) => sum + cost, 0n);
    const operationCount = input.observations.reduce((sum, observation) => sum + observation.operationCount, 0);
    const p50 = nearestRank(sorted, 50);
    const p90 = nearestRank(sorted, 90);
    const p95 = nearestRank(sorted, 95);
    const p99 = nearestRank(sorted, 99);
    const heavy = costs.filter((cost) => cost >= p99);
    const heavyTotal = heavy.reduce((sum, cost) => sum + cost, 0n);
    const approvedCogs = unsigned(input.budget.allowedCohortCogsMicrousd);
    const scenarios: UnlimitedRiskScenario[] = [scenario("CURRENT", 0, total, approvedCogs)];
    for (const shock of this.policy.priceShockBps) scenarios.push(scenario("PRICE_SHOCK", shock, total, approvedCogs));
    scenarios.push(scenario("ALL_USERS_AT_P99", 0, p99 * BigInt(costs.length), approvedCogs));

    const enoughSamples = costs.length >= this.policy.minimumUserSampleCount;
    const sixtyDays = representativeDayCount >= this.policy.minimumRepresentativeDays;
    const twoCycles = input.completedFinancialCycles >= this.policy.minimumFinancialCycles;
    const dataReadiness: UnlimitedRiskReport["dataReadiness"] = enoughSamples && (sixtyDays || twoCycles) ? "REPRESENTATIVE" : "INSUFFICIENT_DATA";
    const representativeBasis: UnlimitedRiskReport["representativeBasis"] = dataReadiness === "INSUFFICIENT_DATA"
      ? "INSUFFICIENT"
      : sixtyDays ? "SIXTY_DAYS" : "TWO_FINANCIAL_CYCLES";
    const riskOutcome: UnlimitedRiskReport["riskOutcome"] = dataReadiness === "INSUFFICIENT_DATA"
      ? "INSUFFICIENT_DATA"
      : scenarios.some(({ budgetBreached }) => budgetBreached)
        ? "BUDGET_BREACH_PROJECTED"
        : "WITHIN_APPROVED_BUDGET";
    const reportWithoutHash = {
      reportId: input.reportId,
      policyVersionId: this.policy.id,
      offerPolicyVersionId: this.policy.offerPolicyVersionId,
      cohortBudgetPolicyVersionId: this.policy.cohortBudgetPolicyVersionId,
      cohortId: input.budget.cohortId,
      windowStartsAt: new Date(windowStart).toISOString(),
      windowEndsAt: new Date(windowEnd).toISOString(),
      representativeDayCount,
      completedFinancialCycles: input.completedFinancialCycles,
      userSampleCount: costs.length,
      operationSampleCount: operationCount,
      totalActualCogsMicrousd: total.toString(),
      meanUserCogsMicrousd: (total / BigInt(costs.length)).toString(),
      percentilesMicrousd: {
        p50: p50.toString(),
        p90: p90.toString(),
        p95: p95.toString(),
        p99: p99.toString(),
      },
      p99ToP50RatioBps: p50 === 0n ? "0" : (p99 * 10_000n / p50).toString(),
      heavyUserThresholdMicrousd: p99.toString(),
      heavyUserCount: heavy.length,
      heavyUserCogsShareBps: total === 0n ? "0" : (heavyTotal * 10_000n / total).toString(),
      scenarios,
      dataReadiness,
      representativeBasis,
      riskOutcome,
      decisionUsesAverageOnly: false as const,
      sanitizedInputOnly: true as const,
      simulationOnly: true as const,
      pilotActivationAllowed: false as const,
      externalDispatchPerformed: false as const,
    };
    const report: UnlimitedRiskReport = { ...reportWithoutHash, evidenceHash: evidenceHash(reportWithoutHash) };
    this.reports.set(input.reportId, { intentHash, report });
    return structuredClone(report);
  }
}
