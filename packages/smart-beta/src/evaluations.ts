import { canonicalJson, evidenceHash } from "./canonical.ts";
import type {
  AutomatedEvaluationInput,
  AutomatedEvaluationRecord,
  EvaluationPolicyVersion,
  FeedbackReasonCode,
  SmartEvaluationReport,
  SmartFeedbackEvent,
  SmartOutcomeIdentity,
} from "./types.ts";
import { SmartBetaError } from "./types.ts";

const REASON_CODES: readonly FeedbackReasonCode[] = [
  "OUTPUT_QUALITY",
  "PROMPT_ALIGNMENT",
  "SPEED",
  "VALUE",
  "CONSISTENCY",
];

function validBps(weights: Readonly<Record<string, number>>): boolean {
  const values = Object.values(weights);
  return values.every((weight) => Number.isInteger(weight) && weight >= 0)
    && values.reduce((sum, weight) => sum + weight, 0) === 10_000;
}

function validPpm(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 1_000_000;
}

function sameSignature(left: SmartOutcomeIdentity, right: SmartOutcomeIdentity): boolean {
  return left.profileVersionId === right.profileVersionId
    && left.familyVersionId === right.familyVersionId
    && left.modelVersionId === right.modelVersionId
    && left.routeVersionId === right.routeVersionId;
}

export class InMemoryEvaluationPolicyRegistry {
  private readonly policies = new Map<string, EvaluationPolicyVersion>();
  private readonly sequences = new Map<string, string>();

  register(policy: EvaluationPolicyVersion): EvaluationPolicyVersion {
    if (!policy.id
      || !policy.policyKey
      || policy.lifecycle !== "PUBLISHED"
      || !Number.isInteger(policy.version)
      || policy.version <= 0
      || !validBps(policy.automatedMetricWeightsBps)
      || !validBps(policy.compositeWeightsBps)
      || !Number.isInteger(policy.minimumAutomatedSamples)
      || policy.minimumAutomatedSamples <= 0
      || !Number.isInteger(policy.minimumFeedbackSamples)
      || policy.minimumFeedbackSamples <= 0
      || Number.isNaN(Date.parse(policy.publishedAt))) {
      throw new SmartBetaError("INVALID_EVALUATION_POLICY", "Evaluation Policy must be a published immutable 10000-bps contract.");
    }
    if (this.policies.has(policy.id)) {
      throw new SmartBetaError("IMMUTABLE_EVALUATION_POLICY", "Evaluation Policy Version ID cannot be overwritten.");
    }
    const sequence = `${policy.policyKey}:${policy.version}`;
    if (this.sequences.has(sequence)) {
      throw new SmartBetaError("DUPLICATE_EVALUATION_POLICY_SEQUENCE", "Evaluation Policy key/version sequence can be published only once.");
    }
    const stored = Object.freeze({
      ...structuredClone(policy),
      automatedMetricWeightsBps: Object.freeze({ ...policy.automatedMetricWeightsBps }),
      compositeWeightsBps: Object.freeze({ ...policy.compositeWeightsBps }),
    });
    this.policies.set(stored.id, stored);
    this.sequences.set(sequence, stored.id);
    return stored;
  }

  require(id: string): EvaluationPolicyVersion {
    const policy = this.policies.get(id);
    if (!policy) throw new SmartBetaError("EVALUATION_POLICY_NOT_FOUND", "Evaluation Policy Version was not found.");
    return policy;
  }
}

export class InMemoryAutomatedEvaluationStore {
  private readonly evaluations = new Map<string, AutomatedEvaluationRecord>();
  private readonly operationEvaluatorKeys = new Map<string, string>();

  constructor(private readonly policies: InMemoryEvaluationPolicyRegistry) {}

  append(input: AutomatedEvaluationInput): AutomatedEvaluationRecord {
    const policy = this.policies.require(input.policyVersionId);
    if (!input.evaluationId
      || Object.values(input.outcome).some((value) => !value.trim())
      || !input.evaluatorVersionId
      || !validPpm(input.technicalPpm)
      || !validPpm(input.semanticPpm)
      || !validPpm(input.safetyPpm)
      || Number.isNaN(Date.parse(input.evaluatedAt))) {
      throw new SmartBetaError("INVALID_AUTOMATED_EVALUATION", "Automated Evaluation must pin outcome, evaluator, Policy and bounded integer metrics.");
    }
    const prior = this.evaluations.get(input.evaluationId);
    if (prior) {
      const { qualityPpm: _qualityPpm, evaluationHash: _evaluationHash, ...priorIntent } = prior;
      if (canonicalJson(priorIntent) === canonicalJson(input)) return structuredClone(prior);
      throw new SmartBetaError("AUTOMATED_EVALUATION_CONFLICT", "Evaluation ID was reused with different evidence.");
    }
    const operationEvaluatorKey = `${input.outcome.operationId}:${input.evaluatorVersionId}:${input.policyVersionId}`;
    if (this.operationEvaluatorKeys.has(operationEvaluatorKey)) {
      throw new SmartBetaError("AUTOMATED_EVALUATION_CONFLICT", "One evaluator/policy version may evaluate an operation only once.");
    }
    const weighted = BigInt(input.technicalPpm) * BigInt(policy.automatedMetricWeightsBps.technical)
      + BigInt(input.semanticPpm) * BigInt(policy.automatedMetricWeightsBps.semantic)
      + BigInt(input.safetyPpm) * BigInt(policy.automatedMetricWeightsBps.safety);
    const qualityPpm = Number(weighted / 10_000n);
    const record: AutomatedEvaluationRecord = Object.freeze({
      ...structuredClone(input),
      qualityPpm,
      evaluationHash: evidenceHash({ input, qualityPpm }),
    });
    this.evaluations.set(record.evaluationId, record);
    this.operationEvaluatorKeys.set(operationEvaluatorKey, record.evaluationId);
    return structuredClone(record);
  }

  report(input: {
    policyVersionId: string;
    signature: Pick<SmartOutcomeIdentity, "profileVersionId" | "familyVersionId" | "modelVersionId" | "routeVersionId">;
    feedback: readonly SmartFeedbackEvent[];
  }): SmartEvaluationReport {
    const policy = this.policies.require(input.policyVersionId);
    const signature: SmartOutcomeIdentity = {
      operationId: "signature-only",
      authorizationId: "signature-only",
      ...input.signature,
    };
    const evaluations = [...this.evaluations.values()]
      .filter((evaluation) => evaluation.policyVersionId === policy.id && sameSignature(evaluation.outcome, signature))
      .sort((left, right) => left.evaluationId.localeCompare(right.evaluationId));
    const feedback = input.feedback
      .filter((event) => sameSignature(event.outcome, signature))
      .sort((left, right) => left.eventId.localeCompare(right.eventId));
    const automatedQualityPpm = evaluations.length === 0
      ? null
      : Math.floor(evaluations.reduce((sum, evaluation) => sum + evaluation.qualityPpm, 0) / evaluations.length);
    const userSatisfactionPpm = feedback.length === 0
      ? null
      : Math.floor(feedback.reduce((sum, event) => sum + (event.rating - 1) * 250_000, 0) / feedback.length);
    const ready = evaluations.length >= policy.minimumAutomatedSamples
      && feedback.length >= policy.minimumFeedbackSamples;
    const compositeScorePpm = ready && automatedQualityPpm !== null && userSatisfactionPpm !== null
      ? Number((BigInt(automatedQualityPpm) * BigInt(policy.compositeWeightsBps.automatedQuality)
        + BigInt(userSatisfactionPpm) * BigInt(policy.compositeWeightsBps.userSatisfaction)) / 10_000n)
      : null;
    const feedbackReasonCounts = Object.fromEntries(REASON_CODES.map((reason) => [
      reason,
      feedback.filter(({ reasonCodes }) => reasonCodes.includes(reason)).length,
    ])) as Record<FeedbackReasonCode, number>;
    const evidence = { policyVersionId: policy.id, evaluations, feedback };
    return {
      policyVersionId: policy.id,
      profileVersionId: input.signature.profileVersionId,
      familyVersionId: input.signature.familyVersionId,
      modelVersionId: input.signature.modelVersionId,
      routeVersionId: input.signature.routeVersionId,
      automatedSampleCount: evaluations.length,
      feedbackSampleCount: feedback.length,
      automatedQualityPpm,
      userSatisfactionPpm,
      compositeScorePpm,
      readiness: ready ? "READY" : "INSUFFICIENT_SAMPLES",
      feedbackReasonCounts,
      evidenceHash: evidenceHash(evidence),
      routingMutationPerformed: false,
      autoLearningPerformed: false,
    };
  }
}
