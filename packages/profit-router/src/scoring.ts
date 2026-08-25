import { createHash } from "node:crypto";
import type {
  CandidateScoreEvidence,
  RationalScore,
  ScoreCandidateInput,
  ScorePolicyVersion,
  ScoreSelectionReason,
  ShadowScoreDecision,
  ShadowScoreExecution,
  ShadowScoreReplayContext,
  ShadowScoreRequest,
} from "./types.ts";
import { ProfitRouterError } from "./types.ts";

type Rational = { numerator: bigint; denominator: bigint };
type StickyAssignment = { routeVersionId: string; expiresAtEpochMs: number };

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function rational(numerator: bigint, denominator: bigint): Rational {
  if (denominator <= 0n) throw new ProfitRouterError("INVALID_SCORE_CANDIDATES", "Score denominator must be positive.");
  const divisor = gcd(numerator, denominator) || 1n;
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function add(left: Rational, right: Rational): Rational {
  return rational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function multiply(left: Rational, right: Rational): Rational {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator);
}

function compare(left: Rational, right: Rational): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference === 0n ? 0 : difference > 0n ? 1 : -1;
}

function subtract(left: Rational, right: Rational): Rational {
  return rational(left.numerator * right.denominator - right.numerator * left.denominator, left.denominator * right.denominator);
}

function publicScore(value: Rational): RationalScore {
  const floor = value.numerator >= 0n
    ? value.numerator / value.denominator
    : -((-value.numerator + value.denominator - 1n) / value.denominator);
  if (floor > BigInt(Number.MAX_SAFE_INTEGER) || floor < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new ProfitRouterError("INVALID_SCORE_CANDIDATES", "Score exceeds the safe public integer range.");
  }
  return { numerator: value.numerator.toString(), denominator: value.denominator.toString(), floorBps: Number(floor) };
}

function economicsRational(candidate: ScoreCandidateInput): Rational {
  const metric = candidate.foundation.economics?.expectedCostPerUsableSuccess;
  if (!metric) throw new ProfitRouterError("INVALID_SCORE_CANDIDATES", "Eligible score candidates require exact usable-success economics.");
  return rational(BigInt(metric.numeratorMicrousd), BigInt(metric.denominator));
}

function differenceMeetsThreshold(challenger: Rational, incumbent: Rational, thresholdBps: number): boolean {
  return compare(subtract(challenger, incumbent), rational(BigInt(thresholdBps), 1n)) >= 0;
}

function validatePolicy(policy: ScorePolicyVersion): void {
  const weights = Object.values(policy.weightsBps);
  if (policy.lifecycle !== "PUBLISHED"
    || policy.version <= 0
    || !policy.id
    || weights.some((weight) => !Number.isInteger(weight) || weight < 0)
    || weights.reduce((total, weight) => total + weight, 0) !== 10_000
    || !Number.isInteger(policy.hysteresisThresholdBps)
    || policy.hysteresisThresholdBps < 0
    || !Number.isInteger(policy.stickyOverrideThresholdBps)
    || policy.stickyOverrideThresholdBps < policy.hysteresisThresholdBps
    || !Number.isInteger(policy.stickyTtlSeconds)
    || policy.stickyTtlSeconds <= 0
    || policy.tieBreak !== "ROUTE_VERSION_ID_ASC"
    || policy.autoLearningEnabled !== false
    || Number.isNaN(Date.parse(policy.publishedAt))) {
    throw new ProfitRouterError("INVALID_SCORE_POLICY", "Score Policy must be a published immutable 10000-bps manual policy.");
  }
}

function validateReplayContext(context: ShadowScoreReplayContext): Date {
  const evaluatedAt = new Date(context.evaluatedAt);
  const stickyExpiry = context.stickyAssignmentBefore ? Date.parse(context.stickyAssignmentBefore.expiresAt) : null;
  if (Number.isNaN(evaluatedAt.getTime())
    || (context.stickyKeyHash !== null && !/^[a-f0-9]{64}$/.test(context.stickyKeyHash))
    || (context.stickyKeyHash === null && context.stickyAssignmentBefore !== null)
    || (stickyExpiry !== null && Number.isNaN(stickyExpiry))) {
    throw new ProfitRouterError("INVALID_SCORE_CANDIDATES", "Replay context must contain a valid time and sanitized sticky state.");
  }
  return evaluatedAt;
}

export function replayShadowScoreDecision(
  policy: ScorePolicyVersion,
  input: ShadowScoreRequest,
  context: ShadowScoreReplayContext,
): ShadowScoreDecision {
  validatePolicy(policy);
  const evaluatedAtDate = validateReplayContext(context);
  if (!input.decisionId || input.candidates.length === 0) {
    throw new ProfitRouterError("INVALID_SCORE_CANDIDATES", "Shadow score decision requires an ID and candidate set.");
  }
  const routeIds = new Set(input.candidates.map(({ foundation }) => foundation.routeVersionId));
  const foundationPolicies = new Set(input.candidates.map(({ foundation }) => foundation.policyVersionId));
  if (routeIds.size !== input.candidates.length || foundationPolicies.size !== 1
    || input.candidates.some(({ foundation }) => foundation.mode !== "SHADOW")) {
    throw new ProfitRouterError("INVALID_SCORE_CANDIDATES", "Candidates must be unique outputs from one Shadow foundation policy.");
  }
  for (const candidate of input.candidates) {
    if (!Number.isInteger(candidate.reliabilityPpm) || candidate.reliabilityPpm < 0 || candidate.reliabilityPpm > 1_000_000
      || !Number.isInteger(candidate.qualityPpm) || candidate.qualityPpm < 0 || candidate.qualityPpm > 1_000_000
      || !Number.isInteger(candidate.p95LatencyMs) || candidate.p95LatencyMs <= 0) {
      throw new ProfitRouterError("INVALID_SCORE_CANDIDATES", "Reliability, quality and p95 latency metrics must be bounded server integers.");
    }
  }

  const eligible = input.candidates.filter(({ foundation }) => foundation.eligible);
  if (eligible.length === 0) throw new ProfitRouterError("NO_ELIGIBLE_ROUTE", "Every candidate failed a hard gate.");
  const costs = eligible.map(economicsRational);
  const minimumCost = costs.reduce((minimum, value) => compare(value, minimum) < 0 ? value : minimum);
  const minimumLatency = Math.min(...eligible.map(({ p95LatencyMs }) => p95LatencyMs));
  const scoreByRoute = new Map<string, { score: Rational; evidence: CandidateScoreEvidence }>();

  for (const candidate of input.candidates) {
    const routeVersionId = candidate.foundation.routeVersionId;
    if (!candidate.foundation.eligible) {
      scoreByRoute.set(routeVersionId, {
        score: rational(-1n, 1n),
        evidence: {
          routeVersionId,
          eligible: false,
          excludedByHardGates: [...candidate.foundation.rejectionReasons],
          components: { cost: null, reliability: null, quality: null, latency: null },
          weightedScore: null,
        },
      });
      continue;
    }
    const candidateCost = economicsRational(candidate);
    const cost = rational(
      minimumCost.numerator * candidateCost.denominator * 10_000n,
      minimumCost.denominator * candidateCost.numerator,
    );
    const reliability = rational(BigInt(candidate.reliabilityPpm), 100n);
    const quality = rational(BigInt(candidate.qualityPpm), 100n);
    const latency = rational(BigInt(minimumLatency) * 10_000n, BigInt(candidate.p95LatencyMs));
    const weightedComponents: readonly [Rational, number][] = [
      [cost, policy.weightsBps.expectedCostPerUsableSuccess],
      [reliability, policy.weightsBps.reliability],
      [quality, policy.weightsBps.quality],
      [latency, policy.weightsBps.latency],
    ];
    const weighted = weightedComponents.reduce(
      (total, [component, weight]) => add(total, multiply(component, rational(BigInt(weight), 10_000n))),
      rational(0n, 1n),
    );
    scoreByRoute.set(routeVersionId, {
      score: weighted,
      evidence: {
        routeVersionId,
        eligible: true,
        excludedByHardGates: [],
        components: {
          cost: publicScore(cost),
          reliability: publicScore(reliability),
          quality: publicScore(quality),
          latency: publicScore(latency),
        },
        weightedScore: publicScore(weighted),
      },
    });
  }

  const ranked = eligible.map(({ foundation }) => foundation.routeVersionId).sort((left, right) => {
    const comparison = compare(scoreByRoute.get(right)!.score, scoreByRoute.get(left)!.score);
    return comparison || left.localeCompare(right);
  });
  const rawWinner = ranked[0]!;
  const rawWinnerScore = scoreByRoute.get(rawWinner)!.score;
  const second = ranked[1] ?? null;
  let selected = rawWinner;
  let reason: ScoreSelectionReason = second && compare(rawWinnerScore, scoreByRoute.get(second)!.score) === 0
    ? "DETERMINISTIC_TIE_BREAK"
    : "HIGHEST_SCORE";
  const sticky = context.stickyAssignmentBefore;
  const stickyActive = sticky && Date.parse(sticky.expiresAt) > evaluatedAtDate.getTime();
  const stickyEvidence = stickyActive ? scoreByRoute.get(sticky.routeVersionId) : undefined;
  if (stickyActive && stickyEvidence?.evidence.eligible && sticky.routeVersionId !== rawWinner) {
    if (!differenceMeetsThreshold(rawWinnerScore, stickyEvidence.score, policy.stickyOverrideThresholdBps)) {
      selected = sticky.routeVersionId;
      reason = "STICKY_HOLD";
    } else {
      reason = "STICKY_OVERRIDDEN";
    }
  } else if (stickyActive && !stickyEvidence?.evidence.eligible) {
    reason = "STICKY_OVERRIDDEN";
  } else if (input.incumbentRouteVersionId && input.incumbentRouteVersionId !== rawWinner) {
    const incumbent = scoreByRoute.get(input.incumbentRouteVersionId);
    if (incumbent?.evidence.eligible) {
      if (!differenceMeetsThreshold(rawWinnerScore, incumbent.score, policy.hysteresisThresholdBps)) {
        selected = input.incumbentRouteVersionId;
        reason = "HYSTERESIS_HOLD";
      }
    } else {
      reason = "INCUMBENT_INELIGIBLE";
    }
  }

  return {
    decisionId: input.decisionId,
    foundationPolicyVersionId: [...foundationPolicies][0]!,
    scorePolicyVersionId: policy.id,
    mode: "SHADOW",
    evaluatedAt: evaluatedAtDate.toISOString(),
    rawWinnerRouteVersionId: rawWinner,
    selectedRouteVersionId: selected,
    selectionReason: reason,
    incumbentRouteVersionId: input.incumbentRouteVersionId ?? null,
    stickyKeyHash: context.stickyKeyHash,
    candidates: input.candidates.map(({ foundation }) => scoreByRoute.get(foundation.routeVersionId)!.evidence),
    dispatchMutationPerformed: false,
  };
}

export class VersionedShadowScorer {
  private readonly stickyAssignments = new Map<string, StickyAssignment>();

  constructor(
    private readonly policy: ScorePolicyVersion,
    private readonly now: () => Date = () => new Date(),
  ) {
    validatePolicy(policy);
  }

  decide(input: ShadowScoreRequest & { stickyKey?: string | null }): ShadowScoreDecision {
    return this.decideWithReplay(input).decision;
  }

  decideWithReplay(input: ShadowScoreRequest & { stickyKey?: string | null }): ShadowScoreExecution {
    const evaluatedAt = this.now();
    const stickyKeyHash = input.stickyKey
      ? createHash("sha256").update(input.stickyKey).digest("hex")
      : null;
    const stickyBefore = stickyKeyHash ? this.stickyAssignments.get(stickyKeyHash) : undefined;
    const request: ShadowScoreRequest = {
      decisionId: input.decisionId,
      candidates: input.candidates,
      incumbentRouteVersionId: input.incumbentRouteVersionId,
    };
    const replayContext: ShadowScoreReplayContext = {
      evaluatedAt: evaluatedAt.toISOString(),
      stickyKeyHash,
      stickyAssignmentBefore: stickyBefore ? {
        routeVersionId: stickyBefore.routeVersionId,
        expiresAt: new Date(stickyBefore.expiresAtEpochMs).toISOString(),
      } : null,
    };
    const decision = replayShadowScoreDecision(this.policy, request, replayContext);
    if (stickyKeyHash) {
      this.stickyAssignments.set(stickyKeyHash, {
        routeVersionId: decision.selectedRouteVersionId,
        expiresAtEpochMs: evaluatedAt.getTime() + this.policy.stickyTtlSeconds * 1000,
      });
    }
    return { decision, replayContext };
  }
}
