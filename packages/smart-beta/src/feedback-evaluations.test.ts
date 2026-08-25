// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  InMemoryAutomatedEvaluationStore,
  InMemoryEvaluationPolicyRegistry,
} from "./evaluations.ts";
import { InMemorySmartFeedbackStore } from "./feedback.ts";
import type {
  AutomatedEvaluationInput,
  EvaluationPolicyVersion,
  SmartFeedbackCommand,
  SmartOutcomeIdentity,
} from "./types.ts";

const baseTime = new Date("2026-08-13T12:00:00.000Z");
const policy: EvaluationPolicyVersion = {
  id: "smart-evaluation-policy:v1",
  policyKey: "smart-quality-satisfaction",
  version: 1,
  lifecycle: "PUBLISHED",
  automatedMetricWeightsBps: { technical: 3000, semantic: 5000, safety: 2000 },
  compositeWeightsBps: { automatedQuality: 6000, userSatisfaction: 4000 },
  minimumAutomatedSamples: 2,
  minimumFeedbackSamples: 2,
  publishedAt: "2026-08-13T00:00:00.000Z",
};

function outcome(operationId: string, routeVersionId = "route:provider-test-image:v1"): SmartOutcomeIdentity {
  return {
    operationId,
    authorizationId: `authorization:${operationId}`,
    profileVersionId: "smart-profile:best_value:v1",
    familyVersionId: "family:test-image:v1",
    modelVersionId: "local/test-image-v1",
    routeVersionId,
  };
}

function feedback(input: {
  eventId: string;
  userId: string;
  operationId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  revision?: number;
  supersedesEventId?: string | null;
}): SmartFeedbackCommand {
  return {
    eventId: input.eventId,
    actorUserId: input.userId,
    operationOwnerUserId: input.userId,
    outcome: outcome(input.operationId),
    rating: input.rating,
    reasonCodes: ["OUTPUT_QUALITY", "VALUE"],
    revision: input.revision ?? 1,
    supersedesEventId: input.supersedesEventId ?? null,
    occurredAt: baseTime.toISOString(),
  };
}

function evaluation(input: {
  id: string;
  operationId: string;
  technical: number;
  semantic: number;
  safety?: number;
  routeVersionId?: string;
}): AutomatedEvaluationInput {
  return {
    evaluationId: input.id,
    outcome: outcome(input.operationId, input.routeVersionId),
    evaluatorVersionId: "local-evaluator:v1",
    policyVersionId: policy.id,
    technicalPpm: input.technical,
    semanticPpm: input.semantic,
    safetyPpm: input.safety ?? 1_000_000,
    evaluatedAt: baseTime.toISOString(),
  };
}

describe("structured Smart feedback", () => {
  it("accepts only operation-owner feedback and stores a user hash without raw user identity", () => {
    const store = new InMemorySmartFeedbackStore();
    const command = feedback({ eventId: "feedback-1", userId: "private-user-1", operationId: "operation-1", rating: 5 });
    const event = store.append(command);
    expect(event).toMatchObject({
      rating: 5,
      revision: 1,
      feedbackKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      eventHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(event)).not.toContain("private-user-1");
    expect(() => store.append({
      ...feedback({ eventId: "feedback-2", userId: "attacker", operationId: "operation-2", rating: 1 }),
      operationOwnerUserId: "owner",
    })).toThrowError(expect.objectContaining({ code: "INVALID_FEEDBACK" }));
  });

  it("replays identical feedback idempotently and rejects conflicting Event IDs", () => {
    const store = new InMemorySmartFeedbackStore();
    const command = feedback({ eventId: "feedback-idempotent", userId: "user-1", operationId: "operation-1", rating: 4 });
    expect(store.append(command)).toEqual(store.append(command));
    expect(() => store.append({ ...command, rating: 2 }))
      .toThrowError(expect.objectContaining({ code: "FEEDBACK_CONFLICT" }));
  });

  it("requires append-only contiguous revisions and retains only the latest revision for reports", () => {
    const store = new InMemorySmartFeedbackStore();
    store.append(feedback({ eventId: "feedback-rev-1", userId: "user-1", operationId: "operation-1", rating: 1 }));
    expect(() => store.append(feedback({
      eventId: "feedback-rev-3",
      userId: "user-1",
      operationId: "operation-1",
      rating: 5,
      revision: 3,
      supersedesEventId: "feedback-rev-1",
    }))).toThrowError(expect.objectContaining({ code: "INVALID_FEEDBACK" }));
    store.append(feedback({
      eventId: "feedback-rev-2",
      userId: "user-1",
      operationId: "operation-1",
      rating: 5,
      revision: 2,
      supersedesEventId: "feedback-rev-1",
    }));
    expect(store.latest()).toHaveLength(1);
    expect(store.latest()[0]).toMatchObject({ eventId: "feedback-rev-2", rating: 5, revision: 2 });
  });
});

describe("versioned automated evaluations", () => {
  it("publishes immutable 10000-bps Evaluation Policies and rejects invalid weights", () => {
    const registry = new InMemoryEvaluationPolicyRegistry();
    expect(registry.register(policy)).toEqual(policy);
    expect(Object.isFrozen(registry.require(policy.id))).toBe(true);
    expect(() => registry.register(policy)).toThrowError(expect.objectContaining({ code: "IMMUTABLE_EVALUATION_POLICY" }));
    expect(() => new InMemoryEvaluationPolicyRegistry().register({
      ...policy,
      automatedMetricWeightsBps: { ...policy.automatedMetricWeightsBps, safety: 1999 },
    })).toThrowError(expect.objectContaining({ code: "INVALID_EVALUATION_POLICY" }));
  });

  it("computes exact integer quality, deduplicates retries and rejects evaluator conflicts", () => {
    const policies = new InMemoryEvaluationPolicyRegistry();
    policies.register(policy);
    const store = new InMemoryAutomatedEvaluationStore(policies);
    const input = evaluation({ id: "evaluation-1", operationId: "operation-1", technical: 800_000, semantic: 900_000 });
    expect(store.append(input)).toMatchObject({ qualityPpm: 890_000, evaluationHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(store.append(input)).toEqual(store.append(input));
    expect(() => store.append({ ...input, evaluationId: "evaluation-2", technicalPpm: 700_000 }))
      .toThrowError(expect.objectContaining({ code: "AUTOMATED_EVALUATION_CONFLICT" }));
  });

  it("aggregates only the exact Profile/Model/Route signature and latest feedback revision", () => {
    const policies = new InMemoryEvaluationPolicyRegistry();
    policies.register(policy);
    const evaluations = new InMemoryAutomatedEvaluationStore(policies);
    evaluations.append(evaluation({ id: "evaluation-1", operationId: "operation-1", technical: 800_000, semantic: 900_000 }));
    evaluations.append(evaluation({ id: "evaluation-2", operationId: "operation-2", technical: 700_000, semantic: 800_000 }));
    evaluations.append(evaluation({
      id: "evaluation-other-route",
      operationId: "operation-other",
      technical: 1_000_000,
      semantic: 1_000_000,
      routeVersionId: "route:other:v1",
    }));
    const feedbackStore = new InMemorySmartFeedbackStore();
    feedbackStore.append(feedback({ eventId: "feedback-1a", userId: "user-1", operationId: "operation-1", rating: 1 }));
    feedbackStore.append(feedback({
      eventId: "feedback-1b",
      userId: "user-1",
      operationId: "operation-1",
      rating: 5,
      revision: 2,
      supersedesEventId: "feedback-1a",
    }));
    feedbackStore.append(feedback({ eventId: "feedback-2", userId: "user-2", operationId: "operation-2", rating: 3 }));

    expect(evaluations.report({
      policyVersionId: policy.id,
      signature: {
        profileVersionId: "smart-profile:best_value:v1",
        familyVersionId: "family:test-image:v1",
        modelVersionId: "local/test-image-v1",
        routeVersionId: "route:provider-test-image:v1",
      },
      feedback: feedbackStore.latest(),
    })).toEqual({
      policyVersionId: policy.id,
      profileVersionId: "smart-profile:best_value:v1",
      familyVersionId: "family:test-image:v1",
      modelVersionId: "local/test-image-v1",
      routeVersionId: "route:provider-test-image:v1",
      automatedSampleCount: 2,
      feedbackSampleCount: 2,
      automatedQualityPpm: 850_000,
      userSatisfactionPpm: 750_000,
      compositeScorePpm: 810_000,
      readiness: "READY",
      feedbackReasonCounts: {
        OUTPUT_QUALITY: 2,
        PROMPT_ALIGNMENT: 0,
        SPEED: 0,
        VALUE: 2,
        CONSISTENCY: 0,
      },
      evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      routingMutationPerformed: false,
      autoLearningPerformed: false,
    });
  });

  it("reports insufficient samples explicitly without manufacturing a composite score", () => {
    const policies = new InMemoryEvaluationPolicyRegistry();
    policies.register(policy);
    const evaluations = new InMemoryAutomatedEvaluationStore(policies);
    evaluations.append(evaluation({ id: "evaluation-one", operationId: "operation-one", technical: 800_000, semantic: 900_000 }));
    const report = evaluations.report({
      policyVersionId: policy.id,
      signature: {
        profileVersionId: "smart-profile:best_value:v1",
        familyVersionId: "family:test-image:v1",
        modelVersionId: "local/test-image-v1",
        routeVersionId: "route:provider-test-image:v1",
      },
      feedback: [],
    });
    expect(report).toMatchObject({
      automatedSampleCount: 1,
      feedbackSampleCount: 0,
      readiness: "INSUFFICIENT_SAMPLES",
      userSatisfactionPpm: null,
      compositeScorePpm: null,
      routingMutationPerformed: false,
      autoLearningPerformed: false,
    });
  });
});
