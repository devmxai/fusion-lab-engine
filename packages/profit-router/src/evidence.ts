import { createHash } from "node:crypto";
import { replayShadowScoreDecision } from "./scoring.ts";
import type {
  ScorePolicyVersion,
  ShadowDecisionRecord,
  ShadowMetricsReport,
  ShadowReplayResult,
  ShadowScoreExecution,
  ShadowScoreRequest,
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

type AppendInput = Readonly<{
  scorePolicy: ScorePolicyVersion;
  request: ShadowScoreRequest;
  execution: ShadowScoreExecution;
}>;

export class InMemoryShadowDecisionEvidenceStore {
  private readonly records: ShadowDecisionRecord[] = [];
  private readonly byDecisionId = new Map<string, ShadowDecisionRecord>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  append(input: AppendInput): ShadowDecisionRecord {
    const replayed = replayShadowScoreDecision(input.scorePolicy, input.request, input.execution.replayContext);
    if (canonicalJson(replayed) !== canonicalJson(input.execution.decision)
      || input.request.decisionId !== input.execution.decision.decisionId
      || input.execution.decision.dispatchMutationPerformed !== false) {
      throw new ProfitRouterError("SHADOW_REPLAY_MISMATCH", "Decision evidence does not replay exactly before append.");
    }
    const prior = this.byDecisionId.get(input.request.decisionId);
    const immutableIntent = {
      scorePolicy: input.scorePolicy,
      request: input.request,
      replayContext: input.execution.replayContext,
      decision: input.execution.decision,
    };
    if (prior) {
      const priorIntent = {
        scorePolicy: prior.scorePolicy,
        request: prior.request,
        replayContext: prior.replayContext,
        decision: prior.decision,
      };
      if (canonicalJson(priorIntent) === canonicalJson(immutableIntent)) return structuredClone(prior);
      throw new ProfitRouterError("SHADOW_DECISION_CONFLICT", "Decision ID was reused with different Shadow evidence.");
    }
    const recordedAt = this.now();
    if (Number.isNaN(recordedAt.getTime())) {
      throw new ProfitRouterError("SHADOW_REPLAY_MISMATCH", "Decision record time must be valid.");
    }
    const sequence = this.records.length + 1;
    const previousRecordHash = this.records.at(-1)?.recordHash ?? null;
    const recordHash = digest({ sequence, previousRecordHash, immutableIntent });
    const record: ShadowDecisionRecord = structuredClone({
      sequence,
      decisionId: input.request.decisionId,
      recordedAt: recordedAt.toISOString(),
      previousRecordHash,
      recordHash,
      ...immutableIntent,
    });
    this.records.push(record);
    this.byDecisionId.set(record.decisionId, record);
    return structuredClone(record);
  }

  replay(decisionId: string): ShadowReplayResult {
    const record = this.byDecisionId.get(decisionId);
    if (!record) throw new ProfitRouterError("SHADOW_DECISION_NOT_FOUND", "Shadow decision evidence was not found.");
    this.verifyChain();
    const replayed = replayShadowScoreDecision(record.scorePolicy, record.request, record.replayContext);
    if (canonicalJson(replayed) !== canonicalJson(record.decision)) {
      throw new ProfitRouterError("SHADOW_REPLAY_MISMATCH", "Stored Shadow decision no longer replays exactly.");
    }
    return {
      decisionId,
      replayedAt: this.now().toISOString(),
      matched: true,
      originalRecordHash: record.recordHash,
      replayedDecisionHash: digest(replayed),
      dispatchMutationPerformed: false,
    };
  }

  verifyChain(): true {
    let previousRecordHash: string | null = null;
    for (const [index, record] of this.records.entries()) {
      const immutableIntent = {
        scorePolicy: record.scorePolicy,
        request: record.request,
        replayContext: record.replayContext,
        decision: record.decision,
      };
      const expected = digest({ sequence: index + 1, previousRecordHash, immutableIntent });
      if (record.sequence !== index + 1
        || record.previousRecordHash !== previousRecordHash
        || record.recordHash !== expected) {
        throw new ProfitRouterError("SHADOW_REPLAY_MISMATCH", "Shadow evidence hash chain is invalid.");
      }
      previousRecordHash = record.recordHash;
    }
    return true;
  }

  list(): readonly ShadowDecisionRecord[] {
    return structuredClone(this.records);
  }

  metrics(actualRoutes: Readonly<Record<string, string>> = {}): ShadowMetricsReport {
    let actualRouteKnownCount = 0;
    let agreements = 0;
    let reliabilityDelta = 0;
    let qualityDelta = 0;
    let comparableReliability = 0;
    let comparableQuality = 0;
    let selectedHardGateViolationCount = 0;
    for (const record of this.records) {
      const selected = record.request.candidates.find(({ foundation }) =>
        foundation.routeVersionId === record.decision.selectedRouteVersionId);
      if (!selected?.foundation.eligible) selectedHardGateViolationCount += 1;
      const actualRoute = actualRoutes[record.decisionId];
      if (!actualRoute) continue;
      actualRouteKnownCount += 1;
      if (actualRoute === record.decision.selectedRouteVersionId) agreements += 1;
      const actual = record.request.candidates.find(({ foundation }) => foundation.routeVersionId === actualRoute);
      if (!actual || !selected) continue;
      reliabilityDelta += selected.reliabilityPpm - actual.reliabilityPpm;
      comparableReliability += 1;
      qualityDelta += selected.qualityPpm - actual.qualityPpm;
      comparableQuality += 1;
    }
    return {
      decisionCount: this.records.length,
      actualRouteKnownCount,
      routeAgreementBps: actualRouteKnownCount === 0 ? null : Math.floor(agreements * 10_000 / actualRouteKnownCount),
      projectedReliabilityDeltaPpm: comparableReliability === 0 ? null : Math.floor(reliabilityDelta / comparableReliability),
      projectedQualityDeltaPpm: comparableQuality === 0 ? null : Math.floor(qualityDelta / comparableQuality),
      selectedHardGateViolationCount,
      dispatchMutationCount: 0,
    };
  }
}
