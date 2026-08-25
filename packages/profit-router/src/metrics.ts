import { createHash } from "node:crypto";
import type {
  MetricAggregationPolicyVersion,
  RouteMetricAggregate,
  RouteMetricSignature,
  RouteOutcomeObservation,
} from "./types.ts";
import { ProfitRouterError } from "./types.ts";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function validateSignature(signature: RouteMetricSignature): void {
  if (Object.values(signature).some((value) => !value.trim())) {
    throw new ProfitRouterError("INVALID_ROUTE_OUTCOME", "Every outcome metric signature dimension must be pinned.");
  }
}

function validatePolicy(policy: MetricAggregationPolicyVersion): void {
  if (!policy.id
    || policy.lifecycle !== "PUBLISHED"
    || !Number.isInteger(policy.version)
    || policy.version <= 0
    || !Number.isInteger(policy.windowSeconds)
    || policy.windowSeconds <= 0
    || !Number.isInteger(policy.minimumSamples)
    || policy.minimumSamples <= 0
    || Number.isNaN(Date.parse(policy.publishedAt))) {
    throw new ProfitRouterError("INVALID_METRIC_POLICY", "Metric aggregation requires one valid published Policy Version.");
  }
}

export class InMemoryRouteOutcomeStore {
  private readonly byObservationId = new Map<string, RouteOutcomeObservation>();
  private readonly byOperationId = new Map<string, RouteOutcomeObservation>();

  append(observation: RouteOutcomeObservation): RouteOutcomeObservation {
    validateSignature(observation.metricSignature);
    const observedAt = Date.parse(observation.observedAt);
    if (!observation.observationId
      || !observation.operationId
      || Number.isNaN(observedAt)
      || !Number.isInteger(observation.latencyMs)
      || observation.latencyMs <= 0
      || (observation.qualityPpm !== null
        && (!Number.isInteger(observation.qualityPpm) || observation.qualityPpm < 0 || observation.qualityPpm > 1_000_000))
      || (observation.status !== "USABLE_SUCCESS" && observation.qualityPpm !== null)) {
      throw new ProfitRouterError("INVALID_ROUTE_OUTCOME", "Route outcome must contain valid immutable server observations.");
    }
    const priorById = this.byObservationId.get(observation.observationId);
    const priorByOperation = this.byOperationId.get(observation.operationId);
    const prior = priorById ?? priorByOperation;
    if (prior) {
      if (canonicalJson(prior) === canonicalJson(observation)) return structuredClone(prior);
      throw new ProfitRouterError("ROUTE_OUTCOME_CONFLICT", "Observation or Operation ID was reused with different outcome evidence.");
    }
    const stored = structuredClone(observation);
    this.byObservationId.set(stored.observationId, stored);
    this.byOperationId.set(stored.operationId, stored);
    return structuredClone(stored);
  }

  aggregate(
    metricSignature: RouteMetricSignature,
    policy: MetricAggregationPolicyVersion,
    windowEnd: Date,
  ): RouteMetricAggregate {
    validateSignature(metricSignature);
    validatePolicy(policy);
    if (Number.isNaN(windowEnd.getTime())) {
      throw new ProfitRouterError("INVALID_METRIC_POLICY", "Metric window end must be valid.");
    }
    const windowStartMs = windowEnd.getTime() - policy.windowSeconds * 1000;
    const signatureHash = digest(metricSignature);
    const samples = [...this.byObservationId.values()]
      .filter((observation) => digest(observation.metricSignature) === signatureHash)
      .filter((observation) => {
        const observedAt = Date.parse(observation.observedAt);
        return observedAt > windowStartMs && observedAt <= windowEnd.getTime();
      })
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.observationId.localeCompare(right.observationId));
    const usable = samples.filter(({ status }) => status === "USABLE_SUCCESS");
    const rated = usable.filter((sample): sample is RouteOutcomeObservation & { qualityPpm: number } => sample.qualityPpm !== null);
    const latencies = samples.map(({ latencyMs }) => latencyMs).sort((left, right) => left - right);
    const p95Index = latencies.length === 0 ? -1 : Math.ceil(latencies.length * 95 / 100) - 1;
    return {
      metricPolicyVersionId: policy.id,
      signatureHash,
      metricSignature: structuredClone(metricSignature),
      windowStart: new Date(windowStartMs).toISOString(),
      windowEnd: windowEnd.toISOString(),
      sampleCount: samples.length,
      usableSuccessCount: usable.length,
      ratedSuccessCount: rated.length,
      readiness: samples.length >= policy.minimumSamples ? "READY" : "INSUFFICIENT_SAMPLES",
      reliabilityPpm: samples.length === 0 ? 0 : Math.floor(usable.length * 1_000_000 / samples.length),
      qualityPpm: rated.length === 0 ? null : Math.floor(rated.reduce((sum, sample) => sum + sample.qualityPpm, 0) / rated.length),
      p95LatencyMs: p95Index < 0 ? 0 : latencies[p95Index]!,
      observationsHash: digest(samples),
    };
  }
}
