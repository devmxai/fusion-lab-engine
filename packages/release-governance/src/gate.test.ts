// @vitest-environment node

import { describe, expect, it } from "vitest";
import { evaluateGate16 } from "./gate.ts";
import type { Gate16LocalEvidence } from "./types.ts";

const evaluationTime = new Date("2026-08-14T12:00:00.000Z");
const digest = "a".repeat(64);
const stages = ["INTERNAL_ALPHA", "INVITE_BETA", "ROLLOUT_1", "ROLLOUT_5", "ROLLOUT_25", "ROLLOUT_50", "ROLLOUT_100", "GA_READY"] as const;
const drillTypes = ["LOAD", "SOAK", "CHAOS", "SECURITY", "RESTORE"] as const;
const sloIds = ["QUOTE_P95", "ENGINE_AVAILABILITY", "ACCEPTED_OPERATION_DURABILITY", "LEDGER_INVARIANTS", "CALLBACK_RECONCILIATION", "POLLING_RECONCILIATION", "BACKUP_RPO", "RESTORE_RTO"] as const;
const alertIds = ["LEDGER_DRIFT_OR_NEGATIVE_BALANCE", "SECRET_EXPOSURE_OR_SUSPICIOUS_SPEND", "DUPLICATE_SETTLEMENT_OR_PROVIDER_TASK", "PUBLIC_ASSET_REGRESSION", "PROVIDER_BALANCE_EXPOSURE", "QUEUE_AGE_OR_DLQ", "COST_SHOCK_OR_VARIANCE", "WEBHOOK_VERIFICATION_SPIKE", "INGEST_FAILURES", "AUTH_OR_RLS_DENIAL_ANOMALY"] as const;

const localEvidence: Gate16LocalEvidence = {
  evidenceId: "gate-16-local-evidence-001",
  rolloutPolicy: {
    id: "release-policy-v1", releaseId: "release-local-001", version: 1, lifecycle: "PUBLISHED", releaseDigest: digest,
    requiredFormalGateIds: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], stages,
    requiredApprovalRoles: ["PRODUCT", "ENGINEERING", "SECURITY", "FINANCE"], minimumSamplesPerStage: 100,
    minimumObservationSecondsPerStage: 3600, pauseAtErrorBudgetConsumptionBps: 5000, stopAtErrorBudgetConsumptionBps: 10000,
    requireZeroCriticalHigh: true, requireZeroUnexplainedLedgerDrift: true, promotionAuthority: "LOCAL_CONTRACT_SIMULATION_ONLY",
    productionActivationAllowed: false, publishedAt: evaluationTime.toISOString(),
  },
  rolloutSnapshot: {
    policyVersionId: "release-policy-v1", releaseId: "release-local-001", state: "COMPLETED", currentStage: null,
    completedStages: stages, approvalRoles: ["PRODUCT", "ENGINEERING", "SECURITY", "FINANCE"], readinessEvidenceId: "readiness-1",
    stopReason: null, eventCount: 20, eventChainValid: true, externalTrafficAllowed: false, productionActivationAllowed: false,
  },
  drillPolicy: {
    id: "drill-policy-v1", releaseRolloutPolicyVersionId: "release-policy-v1", version: 1, lifecycle: "PUBLISHED", requiredDrillTypes: drillTypes,
    requiredScenarios: { LOAD: ["QUOTE_BURST", "CONCURRENT_RESERVES"], SOAK: ["LONG_RUNNING_RECONCILIATION"], CHAOS: ["WORKER_CRASH_AFTER_PROVIDER_ACCEPTANCE"], SECURITY: ["JWT_AND_ROLE_ESCALATION"], RESTORE: ["DATABASE_AND_STORAGE_METADATA_RESTORE"] },
    minimumLoadRequestCount: 10000, minimumConcurrentReserveCount: 100, maximumQuoteP95Milliseconds: 500, maximumLoadFailurePpm: 1000,
    minimumSoakDurationSeconds: 86400, maximumRestoreRpoSeconds: 300, maximumRestoreRtoSeconds: 3600, requireZeroCriticalHigh: true,
    requireZeroFinancialInvariantFailure: true, evidenceAuthority: "LOCAL_FIXTURE_ONLY", productionActivationAllowed: false, publishedAt: evaluationTime.toISOString(),
  },
  drillReport: {
    reportId: "drill-report-1", policyVersionId: "drill-policy-v1", outcome: "READY_LOCAL_FIXTURES", passedDrillTypes: drillTypes,
    missingDrillTypes: [], failedDrillIds: [], evidenceHash: digest, productionReadinessGranted: false, externalTrafficObserved: false,
  },
  operationsPolicy: {
    id: "operations-policy-v1", releaseRolloutPolicyVersionId: "release-policy-v1", version: 1, lifecycle: "PUBLISHED", requiredSloIds: sloIds,
    requiredAlertIds: alertIds, p0AlertIds: ["LEDGER_DRIFT_OR_NEGATIVE_BALANCE"], p1AlertIds: ["QUEUE_AGE_OR_DLQ"], errorBudgetPauseConsumptionBps: 5000,
    errorBudgetFreezeConsumptionBps: 10000, unbudgetableIncidentClasses: ["LEDGER_DRIFT", "PUBLIC_ASSET", "DUPLICATE_DEBIT_OR_TASK", "SECRET_EXPOSURE"],
    acknowledgeSeconds: { P0: 300, P1: 900, P2: 86400 }, evidenceAuthority: "LOCAL_FIXTURE_ONLY", productionActivationAllowed: false, publishedAt: evaluationTime.toISOString(),
  },
  operationsReport: {
    evidenceId: "operations-evidence-1", policyVersionId: "operations-policy-v1", outcome: "READY_LOCAL_FIXTURES", reasons: [], sloControlCount: 8,
    alertControlCount: 10, runbookDrillCount: 1, evidenceHash: digest, liveProductionReadinessGranted: false, productionActivationAllowed: false,
  },
  legacyPolicy: {
    id: "legacy-policy-v1", legacySystemId: "fusionlab-v1", replacementReleasePolicyVersionId: "release-policy-v1", version: 1, lifecycle: "PUBLISHED",
    minimumReadOnlyDays: 60, maximumReadOnlyDays: 90, requiredApprovalRoles: ["ENGINEERING", "SECURITY", "FINANCE", "SUPPORT"],
    sequence: ["ACTIVE", "READ_ONLY", "GRANTS_REVOKED", "CODE_RETIRED"], requireSingleReplacementWriter: true, requireZeroUnexplainedLedgerDrift: true,
    financialEvidenceRetentionMode: "IMMUTABLE_LEGAL_RETENTION", destructiveLedgerDeletionAllowed: false, authority: "LOCAL_SIMULATION_ONLY", productionMutationAllowed: false, publishedAt: evaluationTime.toISOString(),
  },
  legacySnapshot: {
    policyVersionId: "legacy-policy-v1", legacySystemId: "fusionlab-v1", state: "CODE_RETIRED", approvalRoles: ["ENGINEERING", "FINANCE", "SECURITY", "SUPPORT"],
    readOnlyStartedAt: "2026-06-15T12:00:00.000Z", grantsRevokedAt: "2026-08-14T12:00:00.000Z", codeRetiredAt: "2026-08-14T12:00:00.000Z", readOnlyDayCount: 60,
    readAllowed: false, writeAllowed: false, grantsActive: false, codeRuntimeActive: false, financialEvidencePreserved: true,
    destructiveLedgerDeletionAllowed: false, eventCount: 8, eventChainValid: true, productionMutationPerformed: false,
  },
  sanitizedEvidenceOnly: true, localFixtureOnly: true, externalTrafficObserved: false, productionActivationAttempted: false, observedAt: evaluationTime.toISOString(),
};

describe("Gate 16 local evaluator", () => {
  it("passes complete source evidence locally but always holds formal authorization", () => {
    const decision = evaluateGate16({ local: localEvidence, now: evaluationTime });
    expect(decision).toMatchObject({
      gate: 16, localDecision: "PASS", formalGate: "HOLD", productionAuthorization: "DENIED",
      releaseState: "GA_READY_LOCAL_FIXTURES", localReasons: [], formalBlockers: ["FORMAL_EVALUATION_NOT_AVAILABLE_IN_LOCAL_RUNTIME"],
    });
    expect(decision.evidenceDigest).toHaveLength(64);
    expect(decision.decisionHash).toHaveLength(64);
  });

  it("rejects partial rollout state instead of accepting a stage counter", () => {
    const decision = evaluateGate16({ local: { ...localEvidence, rolloutSnapshot: { ...localEvidence.rolloutSnapshot, completedStages: stages.slice(0, 2) } }, now: evaluationTime });
    expect(decision.localDecision).toBe("HOLD");
    expect(decision.localReasons).toContain("ROLLOUT_POLICY_INCOMPLETE");
    expect(decision.localReasons).toContain("SKIPPED_STAGE_DETECTED");
  });

  it("rejects incomplete drill and operations reports", () => {
    const decision = evaluateGate16({ local: {
      ...localEvidence,
      drillReport: { ...localEvidence.drillReport, failedDrillIds: ["drill-security-1"] },
      operationsReport: { ...localEvidence.operationsReport, alertControlCount: 9 },
    }, now: evaluationTime });
    expect(decision.localReasons).toContain("DRILL_EVIDENCE_INCOMPLETE");
    expect(decision.localReasons).toContain("FAILED_DRILL_SCENARIOS_DETECTED");
    expect(decision.localReasons).toContain("OPERATIONS_EVIDENCE_INCOMPLETE");
  });

  it("rejects an incomplete or unsafe legacy retirement snapshot", () => {
    const decision = evaluateGate16({ local: { ...localEvidence, legacySnapshot: { ...localEvidence.legacySnapshot, grantsActive: true } }, now: evaluationTime });
    expect(decision.localReasons).toContain("LEGACY_EVIDENCE_INCOMPLETE");
    expect(decision.localReasons).toContain("UNREVOKED_LEGACY_GRANTS_DETECTED");
  });

  it("cannot be supplied with formal booleans to authorize Production", () => {
    const attempt = { local: localEvidence, formal: { productionTrafficAuthorized: true }, now: evaluationTime };
    const decision = evaluateGate16(attempt);
    expect(decision.productionAuthorization).toBe("DENIED");
    expect(decision.formalGate).toBe("HOLD");
  });

  it("rejects corrupt or non-local evidence at the boundary", () => {
    expect(() => evaluateGate16({ local: { ...localEvidence, evidenceId: "" }, now: evaluationTime }))
      .toThrowError("Gate 16 evidence must be a valid, sanitized local-only report.");
  });
});
