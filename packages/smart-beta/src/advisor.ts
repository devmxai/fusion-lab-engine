import { evidenceHash } from "./canonical.ts";
import type {
  CfoAdvisorMetricSnapshot,
  CfoAdvisorPolicyVersion,
  CfoAdvisorProposal,
  CfoAdvisorProposalKind,
  CfoAdvisorReport,
  CfoAdvisorScenario,
  CfoAdvisorSignal,
  CfoAdvisorSnapshot,
} from "./types.ts";
import { SmartBetaError } from "./types.ts";

function unsigned(value: string, code: "INVALID_CFO_ADVISOR_POLICY" | "INVALID_CFO_METRIC_SNAPSHOT"): bigint {
  if (!/^\d+$/.test(value)) throw new SmartBetaError(code, "CFO Advisor money must use unsigned integer microusd strings.");
  return BigInt(value);
}

function validBps(value: number, maximum = 10_000): boolean {
  return Number.isInteger(value) && value >= 0 && value <= maximum;
}

function validatePolicy(policy: CfoAdvisorPolicyVersion): void {
  const maximumExposure = unsigned(policy.maximumUnreconciledExposureMicrousd, "INVALID_CFO_ADVISOR_POLICY");
  if (!policy.id
    || !policy.policyKey.trim()
    || !Number.isInteger(policy.version)
    || policy.version <= 0
    || policy.lifecycle !== "PUBLISHED"
    || !Number.isInteger(policy.minimumSampleCount)
    || policy.minimumSampleCount <= 0
    || !validBps(policy.hardFloorMarginBps, 9_999)
    || !validBps(policy.targetMarginBps, 9_999)
    || policy.targetMarginBps <= policy.hardFloorMarginBps
    || !validBps(policy.costShockTriggerBps, 100_000)
    || policy.costShockTriggerBps <= 0
    || !validBps(policy.maximumRouteConcentrationBps)
    || policy.maximumRouteConcentrationBps <= 0
    || !Number.isInteger(policy.minimumProviderRunwayDays)
    || policy.minimumProviderRunwayDays <= 0
    || !Number.isInteger(policy.targetProviderRunwayDays)
    || policy.targetProviderRunwayDays <= policy.minimumProviderRunwayDays
    || maximumExposure <= 0n
    || policy.reportingCadence !== "WEEKLY"
    || policy.advisorAuthority !== "PROPOSE_AND_SIMULATE_ONLY"
    || Number.isNaN(Date.parse(policy.publishedAt))) {
    throw new SmartBetaError("INVALID_CFO_ADVISOR_POLICY", "CFO Advisor Policy must be immutable, bounded and advisory-only.");
  }
}

type ParsedMetrics = Readonly<{
  value: bigint;
  expected: bigint;
  p90: bigint;
  maximum: bigint;
  actual: bigint;
  observedUnit: bigint;
  baselineUnit: bigint;
  balance: bigint;
  dailyBurn: bigint;
  unreconciled: bigint;
}>;

function validateMetrics(metrics: CfoAdvisorMetricSnapshot, policy: CfoAdvisorPolicyVersion): ParsedMetrics {
  const parsed: ParsedMetrics = {
    value: unsigned(metrics.netEconomicValueMicrousd, "INVALID_CFO_METRIC_SNAPSHOT"),
    expected: unsigned(metrics.providerCogsExpectedMicrousd, "INVALID_CFO_METRIC_SNAPSHOT"),
    p90: unsigned(metrics.providerCogsP90Microusd, "INVALID_CFO_METRIC_SNAPSHOT"),
    maximum: unsigned(metrics.providerCogsMaximumMicrousd, "INVALID_CFO_METRIC_SNAPSHOT"),
    actual: unsigned(metrics.providerCogsActualMicrousd, "INVALID_CFO_METRIC_SNAPSHOT"),
    observedUnit: unsigned(metrics.observedUnitCostMicrousd, "INVALID_CFO_METRIC_SNAPSHOT"),
    baselineUnit: unsigned(metrics.baselineUnitCostMicrousd, "INVALID_CFO_METRIC_SNAPSHOT"),
    balance: unsigned(metrics.providerCashBalanceMicrousd, "INVALID_CFO_METRIC_SNAPSHOT"),
    dailyBurn: unsigned(metrics.averageDailyBurnMicrousd, "INVALID_CFO_METRIC_SNAPSHOT"),
    unreconciled: unsigned(metrics.unreconciledExposureMicrousd, "INVALID_CFO_METRIC_SNAPSHOT"),
  };
  const startsAt = Date.parse(metrics.windowStartsAt);
  const endsAt = Date.parse(metrics.windowEndsAt);
  if (!metrics.snapshotId
    || !metrics.routeVersionId
    || !metrics.providerAccountVersionId
    || Number.isNaN(startsAt)
    || Number.isNaN(endsAt)
    || endsAt <= startsAt
    || !Number.isInteger(metrics.sampleCount)
    || metrics.sampleCount < policy.minimumSampleCount
    || parsed.value <= 0n
    || parsed.baselineUnit <= 0n
    || parsed.p90 < parsed.expected
    || parsed.maximum < parsed.p90
    || !validBps(metrics.routeConcentrationBps)
    || metrics.sanitizedMetrics !== true
    || metrics.containsUserIdentifiers !== false
    || metrics.containsPromptsOrAssets !== false
    || metrics.containsCredentials !== false) {
    throw new SmartBetaError("INVALID_CFO_METRIC_SNAPSHOT", "CFO Advisor accepts only sufficient, sanitized, internally consistent aggregate metrics.");
  }
  return parsed;
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function marginBps(value: bigint, cost: bigint): string {
  const numerator = (value - cost) * 10_000n;
  if (numerator >= 0n) return (numerator / value).toString();
  return (-ceilDivide(-numerator, value)).toString();
}

function scenario(
  name: CfoAdvisorScenario["scenario"],
  customerValue: bigint,
  metrics: ParsedMetrics,
): CfoAdvisorScenario {
  return {
    scenario: name,
    customerEconomicValueMicrousd: customerValue.toString(),
    expectedCogsMicrousd: metrics.expected.toString(),
    p90CogsMicrousd: metrics.p90.toString(),
    maximumCogsMicrousd: metrics.maximum.toString(),
    expectedMarginBps: marginBps(customerValue, metrics.expected),
    p90MarginBps: marginBps(customerValue, metrics.p90),
    maximumMarginBps: marginBps(customerValue, metrics.maximum),
  };
}

export class InMemoryCfoAdvisorPolicyRegistry {
  private readonly byId = new Map<string, CfoAdvisorPolicyVersion>();
  private readonly bySequence = new Map<string, string>();

  publish(policy: CfoAdvisorPolicyVersion): CfoAdvisorPolicyVersion {
    validatePolicy(policy);
    const existing = this.byId.get(policy.id);
    if (existing) {
      if (evidenceHash(existing) === evidenceHash(policy)) return structuredClone(existing);
      throw new SmartBetaError("IMMUTABLE_CFO_ADVISOR_POLICY", "A published CFO Advisor Policy cannot be changed.");
    }
    const sequence = `${policy.policyKey}:${policy.version}`;
    if (this.bySequence.has(sequence)) {
      throw new SmartBetaError("DUPLICATE_CFO_ADVISOR_POLICY_SEQUENCE", "CFO Advisor Policy key and version must be unique.");
    }
    const stored = structuredClone(policy);
    this.byId.set(policy.id, stored);
    this.bySequence.set(sequence, policy.id);
    return structuredClone(stored);
  }

  require(policyVersionId: string): CfoAdvisorPolicyVersion {
    const policy = this.byId.get(policyVersionId);
    if (!policy) throw new SmartBetaError("CFO_ADVISOR_POLICY_NOT_FOUND", "CFO Advisor Policy was not found.");
    return structuredClone(policy);
  }
}

export class InMemoryCfoAdvisor {
  private readonly policy: CfoAdvisorPolicyVersion;
  private readonly reports = new Map<string, { intentHash: string; report: CfoAdvisorReport }>();
  private readonly proposalLedger: CfoAdvisorProposal[] = [];

  constructor(
    policy: CfoAdvisorPolicyVersion,
    private readonly now: () => Date = () => new Date(),
  ) {
    validatePolicy(policy);
    this.policy = structuredClone(policy);
  }

  analyze(reportId: string, metrics: CfoAdvisorMetricSnapshot): CfoAdvisorReport {
    const generatedAt = this.now();
    const intentHash = evidenceHash({ reportId, metrics });
    const prior = this.reports.get(reportId);
    if (prior) {
      if (prior.intentHash === intentHash) return structuredClone(prior.report);
      throw new SmartBetaError("CFO_ADVISOR_REPORT_CONFLICT", "CFO Advisor Report ID was reused with different metrics.");
    }
    if (!reportId || Number.isNaN(generatedAt.getTime())) {
      throw new SmartBetaError("INVALID_CFO_METRIC_SNAPSHOT", "CFO Advisor requires a valid server-owned Report ID and timestamp.");
    }
    const parsed = validateMetrics(metrics, this.policy);
    const signals = this.detectSignals(metrics, parsed);
    const recommendedPrice = this.recommendedPrice(parsed);
    const simulations = [
      scenario("CURRENT", parsed.value, parsed),
      scenario("RECOMMENDED_PRICE", recommendedPrice, parsed),
    ] as const;
    const proposals = signals.map((signal) => this.appendProposal(reportId, metrics, parsed, signal, simulations));
    const reportWithoutHash = {
      reportId,
      policyVersionId: this.policy.id,
      metricSnapshotId: metrics.snapshotId,
      metricsEvidenceHash: evidenceHash(metrics),
      routeVersionId: metrics.routeVersionId,
      generatedAt: generatedAt.toISOString(),
      reportingCadence: "WEEKLY" as const,
      signals,
      proposals,
      sanitizedInputOnly: true as const,
      deterministicSimulation: true as const,
      advisorAuthority: "PROPOSE_AND_SIMULATE_ONLY" as const,
      publishedDecisionCreated: false as const,
      runtimeMutationPerformed: false as const,
    };
    const report: CfoAdvisorReport = { ...reportWithoutHash, reportHash: evidenceHash(reportWithoutHash) };
    this.reports.set(reportId, { intentHash, report });
    return structuredClone(report);
  }

  getReport(reportId: string): CfoAdvisorReport {
    const report = this.reports.get(reportId)?.report;
    if (!report) throw new SmartBetaError("INVALID_CFO_METRIC_SNAPSHOT", "CFO Advisor Report was not found.");
    return structuredClone(report);
  }

  proposals(): readonly CfoAdvisorProposal[] {
    return structuredClone(this.proposalLedger);
  }

  snapshot(): CfoAdvisorSnapshot {
    return {
      policyVersionId: this.policy.id,
      reportCount: this.reports.size,
      proposalCount: this.proposalLedger.length,
      proposalChainValid: this.verifyProposalChain(),
      publishedDecisionCount: 0,
      creditMutationCount: 0,
      providerTopUpCount: 0,
      runtimeMutationPerformed: false,
    };
  }

  private detectSignals(metrics: CfoAdvisorMetricSnapshot, parsed: ParsedMetrics): CfoAdvisorSignal[] {
    const signals: CfoAdvisorSignal[] = [];
    if ((parsed.value - parsed.actual) * 10_000n < parsed.value * BigInt(this.policy.hardFloorMarginBps)) {
      signals.push("MARGIN_FLOOR_BREACH");
    }
    if (parsed.actual >= parsed.value) signals.push("LOSS_MAKING_ROUTE");
    if (parsed.observedUnit * 10_000n >= parsed.baselineUnit * BigInt(10_000 + this.policy.costShockTriggerBps)) {
      signals.push("COST_SHOCK");
    }
    if (parsed.dailyBurn > 0n && parsed.balance < parsed.dailyBurn * BigInt(this.policy.minimumProviderRunwayDays)) {
      signals.push("LOW_PROVIDER_RUNWAY");
    }
    if (metrics.routeConcentrationBps > this.policy.maximumRouteConcentrationBps) signals.push("ROUTE_CONCENTRATION");
    if (parsed.unreconciled > unsigned(this.policy.maximumUnreconciledExposureMicrousd, "INVALID_CFO_ADVISOR_POLICY")) {
      signals.push("UNRECONCILED_EXPOSURE");
    }
    return signals;
  }

  private recommendedPrice(metrics: ParsedMetrics): bigint {
    const targetPrice = ceilDivide(metrics.maximum * 10_000n, BigInt(10_000 - this.policy.targetMarginBps));
    return targetPrice > metrics.value ? targetPrice : metrics.value;
  }

  private appendProposal(
    reportId: string,
    metrics: CfoAdvisorMetricSnapshot,
    parsed: ParsedMetrics,
    signal: CfoAdvisorSignal,
    simulations: readonly CfoAdvisorScenario[],
  ): CfoAdvisorProposal {
    const kind = this.proposalKind(signal);
    const sequence = this.proposalLedger.length + 1;
    const previousProposalHash = this.proposalLedger.at(-1)?.proposalHash ?? null;
    const recommendedTreasuryFunding = parsed.dailyBurn * BigInt(this.policy.targetProviderRunwayDays) > parsed.balance
      ? parsed.dailyBurn * BigInt(this.policy.targetProviderRunwayDays) - parsed.balance
      : 0n;
    const intent = {
      sequence,
      proposalId: `cfo-proposal:${reportId}:${sequence}`,
      kind,
      signal,
      routeVersionId: metrics.routeVersionId,
      recommendation: {
        recommendedCustomerValueMicrousd: kind === "PRICE_DRAFT" ? simulations[1]!.customerEconomicValueMicrousd : null,
        proposedMaximumRouteWeightBps: kind === "ROUTE_WEIGHT_DRAFT"
          ? Math.floor(this.policy.maximumRouteConcentrationBps / 2)
          : null,
        recommendedTreasuryFundingMicrousd: kind === "TREASURY_DRAFT" ? recommendedTreasuryFunding.toString() : null,
        suspensionRecommended: kind === "SUSPENSION_DRAFT",
      },
      simulations,
      status: "ADVISORY_DRAFT" as const,
      nextRequiredAction: "MAKER_REVIEW" as const,
      executionAuthority: false as const,
      publishAllowed: false as const,
      creditMutationAllowed: false as const,
      providerTopUpAllowed: false as const,
      secretActivationAllowed: false as const,
      journalDeletionAllowed: false as const,
      previousProposalHash,
    };
    const proposal: CfoAdvisorProposal = { ...intent, proposalHash: evidenceHash(intent) };
    this.proposalLedger.push(proposal);
    return proposal;
  }

  private proposalKind(signal: CfoAdvisorSignal): CfoAdvisorProposalKind {
    if (signal === "MARGIN_FLOOR_BREACH") return "PRICE_DRAFT";
    if (signal === "COST_SHOCK" || signal === "ROUTE_CONCENTRATION") return "ROUTE_WEIGHT_DRAFT";
    if (signal === "LOW_PROVIDER_RUNWAY") return "TREASURY_DRAFT";
    return "SUSPENSION_DRAFT";
  }

  private verifyProposalChain(): boolean {
    let previousProposalHash: string | null = null;
    return this.proposalLedger.every((proposal, index) => {
      const { proposalHash, ...intent } = proposal;
      const valid = proposal.sequence === index + 1
        && proposal.previousProposalHash === previousProposalHash
        && proposalHash === evidenceHash(intent);
      previousProposalHash = proposalHash;
      return valid;
    });
  }
}
