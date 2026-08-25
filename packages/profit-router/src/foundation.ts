import type {
  AttemptMetric,
  CandidateFoundationEvaluation,
  ExpectedCostPerUsableSuccess,
  ProfitRouteCandidate,
  RouteHardGateCode,
  RouterPolicyVersion,
} from "./types.ts";
import { ProfitRouterError } from "./types.ts";

const PPM = 1_000_000n;

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function reduce(numerator: bigint, denominator: bigint) {
  const divisor = gcd(numerator, denominator) || 1n;
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function requireNonEmptySignature(candidate: ProfitRouteCandidate) {
  if (Object.values(candidate.metricSignature).some((value) => !value.trim())) {
    throw new ProfitRouterError("INVALID_ROUTE_CANDIDATE", "Every route metric signature dimension must be pinned.");
  }
  if (candidate.metricSignature.routeVersionId !== candidate.routeVersionId) {
    throw new ProfitRouterError("INVALID_ROUTE_CANDIDATE", "Metric signature route must match the candidate Route Version.");
  }
}

function validateAttempts(attempts: readonly AttemptMetric[]) {
  if (attempts.length === 0 || attempts[0]?.attemptNumber !== 1 || attempts[0]?.reachProbabilityPpm !== 1_000_000) {
    throw new ProfitRouterError("INVALID_ATTEMPT_METRICS", "Attempt policy must begin at attempt 1 with 1000000 ppm reach probability.");
  }
  let priorReach = 1_000_001;
  for (const [index, attempt] of attempts.entries()) {
    if (attempt.attemptNumber !== index + 1
      || !Number.isInteger(attempt.reachProbabilityPpm)
      || attempt.reachProbabilityPpm < 0
      || attempt.reachProbabilityPpm > 1_000_000
      || attempt.reachProbabilityPpm > priorReach
      || !Number.isInteger(attempt.usableSuccessProbabilityPpm)
      || attempt.usableSuccessProbabilityPpm < 0
      || attempt.usableSuccessProbabilityPpm > 1_000_000
      || !/^\d+$/.test(attempt.expectedCostMicrousd)
      || BigInt(attempt.expectedCostMicrousd) <= 0n) {
      throw new ProfitRouterError("INVALID_ATTEMPT_METRICS", "Retry attempt metrics must be ordered, bounded integer ppm values with positive microusd cost.");
    }
    priorReach = attempt.reachProbabilityPpm;
  }
  if (attempts.every(({ usableSuccessProbabilityPpm }) => usableSuccessProbabilityPpm === 0)) {
    throw new ProfitRouterError("INVALID_ATTEMPT_METRICS", "At least one attempt must have a measurable usable-success probability.");
  }
}

export function expectedCostPerUsableSuccess(attempts: readonly AttemptMetric[]): ExpectedCostPerUsableSuccess {
  validateAttempts(attempts);
  const expectedCostNumerator = attempts.reduce(
    (total, attempt) => total + BigInt(attempt.reachProbabilityPpm) * BigInt(attempt.expectedCostMicrousd),
    0n,
  );
  const failureProduct = attempts.reduce((product, attempt) =>
    product * (PPM - BigInt(attempt.usableSuccessProbabilityPpm)), 1n);
  const successDenominator = PPM ** BigInt(attempts.length);
  const success = reduce(successDenominator - failureProduct, successDenominator);
  const ratio = reduce(expectedCostNumerator * success.denominator, PPM * success.numerator);
  return {
    expectedPolicyCost: {
      numeratorMicrousdPpm: expectedCostNumerator.toString(),
      denominatorPpm: PPM.toString(),
    },
    usableSuccessProbability: {
      numerator: success.numerator.toString(),
      denominator: success.denominator.toString(),
    },
    expectedCostPerUsableSuccess: {
      numeratorMicrousd: ratio.numerator.toString(),
      denominator: ratio.denominator.toString(),
      ceilingMicrousd: ceilDiv(ratio.numerator, ratio.denominator).toString(),
    },
  };
}

export class ProfitRouterFoundation {
  constructor(
    private readonly policy: RouterPolicyVersion,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (policy.lifecycle !== "PUBLISHED"
      || policy.version <= 0
      || !policy.id
      || policy.maximumMetricAgeSeconds <= 0
      || Number.isNaN(Date.parse(policy.publishedAt))) {
      throw new ProfitRouterError("INVALID_ROUTER_POLICY", "Profit Router requires one valid published policy version.");
    }
  }

  evaluate(decisionId: string, candidate: ProfitRouteCandidate): CandidateFoundationEvaluation {
    if (!decisionId) throw new ProfitRouterError("INVALID_ROUTE_CANDIDATE", "Decision ID is required.");
    requireNonEmptySignature(candidate);
    validateAttempts(candidate.attempts);
    const evaluatedAtDate = this.now();
    const evaluatedAt = evaluatedAtDate.toISOString();
    const routeExpiry = Date.parse(candidate.expiresAt);
    const costExpiry = Date.parse(candidate.cost.validUntil);
    const credentialExpiry = candidate.credential.expiresAt === null ? null : Date.parse(candidate.credential.expiresAt);
    const metricsObservedAt = Date.parse(candidate.metricsObservedAt);
    if (Number.isNaN(routeExpiry)
      || Number.isNaN(costExpiry)
      || (credentialExpiry !== null && Number.isNaN(credentialExpiry))
      || Number.isNaN(metricsObservedAt)
      || !Number.isInteger(candidate.margin.projectedMarginBps)
      || !Number.isInteger(candidate.margin.hardFloorMarginBps)) {
      throw new ProfitRouterError("INVALID_ROUTE_CANDIDATE", "Route candidate timestamps and margin basis points must be valid server snapshots.");
    }
    const reasons: RouteHardGateCode[] = [];
    if (candidate.lifecycle !== "PUBLISHED") reasons.push("ROUTE_NOT_PUBLISHED");
    if (routeExpiry <= evaluatedAtDate.getTime()) reasons.push("ROUTE_EXPIRED");
    if (!candidate.capabilityMatches) reasons.push("CAPABILITY_MISMATCH");
    if (candidate.exactEquivalence.required
      && (!candidate.exactEquivalence.approved || !candidate.exactEquivalence.groupId)) {
      reasons.push("EXACT_EQUIVALENCE_REQUIRED");
    }
    const costUsable = costExpiry > evaluatedAtDate.getTime()
      && (candidate.cost.status === "FRESH"
        || candidate.cost.status === "PROMOTIONAL"
        || (candidate.cost.status === "STALE" && this.policy.allowStaleCost));
    if (!costUsable) reasons.push("COST_VERSION_NOT_USABLE");
    if (candidate.credential.status !== "ACTIVE"
      || (credentialExpiry !== null && credentialExpiry <= evaluatedAtDate.getTime())) {
      reasons.push("CREDENTIAL_NOT_ACTIVE");
    }
    if (!/^\d+$/.test(candidate.treasury.shadowAvailableAtomic)
      || !/^\d+$/.test(candidate.treasury.maximumExposureAtomic)) {
      throw new ProfitRouterError("INVALID_ROUTE_CANDIDATE", "Treasury exposure values must be unsigned integer strings.");
    }
    if (BigInt(candidate.treasury.shadowAvailableAtomic) < BigInt(candidate.treasury.maximumExposureAtomic)) {
      reasons.push("SHADOW_BALANCE_INSUFFICIENT");
    }
    if (!candidate.circuitClosed) reasons.push("CIRCUIT_OPEN");
    if (!candidate.capacityAvailable) reasons.push("CAPACITY_UNAVAILABLE");
    if (!candidate.privacyCompatible) reasons.push("PRIVACY_POLICY_MISMATCH");
    if (!candidate.actualCostExtractor?.trim()) reasons.push("ACTUAL_COST_EXTRACTOR_MISSING");
    if (candidate.margin.projectedMarginBps < candidate.margin.hardFloorMarginBps) reasons.push("MARGIN_FLOOR_BREACH");
    const metricAgeMs = evaluatedAtDate.getTime() - metricsObservedAt;
    if (metricAgeMs < 0 || metricAgeMs > this.policy.maximumMetricAgeSeconds * 1000) reasons.push("METRICS_NOT_FRESH");
    if (!candidate.pinnedByQuote) reasons.push("ROUTE_NOT_PINNED_BY_QUOTE");
    return {
      decisionId,
      policyVersionId: this.policy.id,
      mode: this.policy.mode,
      routeVersionId: candidate.routeVersionId,
      evaluatedAt,
      eligible: reasons.length === 0,
      rejectionReasons: reasons,
      metricSignature: structuredClone(candidate.metricSignature),
      economics: reasons.length === 0 ? expectedCostPerUsableSuccess(candidate.attempts) : null,
    };
  }
}
