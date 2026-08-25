import { releaseEvidenceHash } from "./canonical.ts";
import type {
  Gate16Decision,
  Gate16FormalBlocker,
  Gate16LocalDecisionReason,
  Gate16LocalEvidence,
  ReleaseAlertId,
  ReleaseApprovalRole,
  ReleaseDrillType,
  ReleaseSloId,
  ReleaseStage,
} from "./types.ts";
import { ReleaseGovernanceError } from "./types.ts";

const STAGES: readonly ReleaseStage[] = ["INTERNAL_ALPHA", "INVITE_BETA", "ROLLOUT_1", "ROLLOUT_5", "ROLLOUT_25", "ROLLOUT_50", "ROLLOUT_100", "GA_READY"];
const RELEASE_ROLES: readonly ReleaseApprovalRole[] = ["PRODUCT", "ENGINEERING", "SECURITY", "FINANCE"];
const DRILL_TYPES: readonly ReleaseDrillType[] = ["LOAD", "SOAK", "CHAOS", "SECURITY", "RESTORE"];
const SLO_IDS: readonly ReleaseSloId[] = ["QUOTE_P95", "ENGINE_AVAILABILITY", "ACCEPTED_OPERATION_DURABILITY", "LEDGER_INVARIANTS", "CALLBACK_RECONCILIATION", "POLLING_RECONCILIATION", "BACKUP_RPO", "RESTORE_RTO"];
const ALERT_IDS: readonly ReleaseAlertId[] = ["LEDGER_DRIFT_OR_NEGATIVE_BALANCE", "SECRET_EXPOSURE_OR_SUSPICIOUS_SPEND", "DUPLICATE_SETTLEMENT_OR_PROVIDER_TASK", "PUBLIC_ASSET_REGRESSION", "PROVIDER_BALANCE_EXPOSURE", "QUEUE_AGE_OR_DLQ", "COST_SHOCK_OR_VARIANCE", "WEBHOOK_VERIFICATION_SPIKE", "INGEST_FAILURES", "AUTH_OR_RLS_DENIAL_ANOMALY"];
const LEGACY_POLICY_ROLES = ["ENGINEERING", "SECURITY", "FINANCE", "SUPPORT"] as const;
const LEGACY_SNAPSHOT_ROLES = ["ENGINEERING", "FINANCE", "SECURITY", "SUPPORT"] as const;

function exactList<T>(actual: readonly T[], expected: readonly T[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function isDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function validateEvidence(evidence: Gate16LocalEvidence): void {
  if (!evidence.evidenceId
    || Number.isNaN(Date.parse(evidence.observedAt))
    || evidence.sanitizedEvidenceOnly !== true
    || evidence.localFixtureOnly !== true
    || evidence.externalTrafficObserved !== false
    || evidence.productionActivationAttempted !== false) {
    throw new ReleaseGovernanceError("INVALID_GATE_16_EVIDENCE", "Gate 16 evidence must be a valid, sanitized local-only report.");
  }
}

/** Evaluates local fixtures only. Production authorization is structurally unavailable here. */
export function evaluateGate16(input: { local: Gate16LocalEvidence; now?: Date }): Gate16Decision {
  validateEvidence(input.local);
  const evaluatedAt = input.now ?? new Date();
  if (Number.isNaN(evaluatedAt.getTime())) {
    throw new ReleaseGovernanceError("INVALID_GATE_16_EVIDENCE", "Gate 16 evaluation timestamp must be valid.");
  }

  const local = input.local;
  const localReasons: Gate16LocalDecisionReason[] = [];
  const rollout = local.rolloutSnapshot;
  if (local.rolloutPolicy.lifecycle !== "PUBLISHED"
    || local.rolloutPolicy.productionActivationAllowed !== false
    || !exactList(local.rolloutPolicy.stages, STAGES)
    || !exactList(local.rolloutPolicy.requiredApprovalRoles, RELEASE_ROLES)
    || rollout.policyVersionId !== local.rolloutPolicy.id
    || rollout.state !== "COMPLETED"
    || rollout.currentStage !== null
    || !exactList(rollout.completedStages, STAGES)
    || !exactList(rollout.approvalRoles, RELEASE_ROLES)
    || !rollout.readinessEvidenceId
    || !rollout.eventChainValid) localReasons.push("ROLLOUT_POLICY_INCOMPLETE");
  if (rollout.state === "DRAFT" || rollout.state === "ARMED") localReasons.push("UNARMED_ROLLOUT_DETECTED");
  if (!exactList(rollout.completedStages, STAGES)) localReasons.push("SKIPPED_STAGE_DETECTED");
  if (rollout.stopReason !== null) localReasons.push("ROLLOUT_BLOCKER_DETECTED");
  if (rollout.externalTrafficAllowed !== false || rollout.productionActivationAllowed !== false) localReasons.push("EXTERNAL_TRAFFIC_DETECTED");

  const drills = local.drillReport;
  if (local.drillPolicy.lifecycle !== "PUBLISHED"
    || local.drillPolicy.releaseRolloutPolicyVersionId !== local.rolloutPolicy.id
    || !exactList(local.drillPolicy.requiredDrillTypes, DRILL_TYPES)
    || local.drillPolicy.productionActivationAllowed !== false
    || drills.policyVersionId !== local.drillPolicy.id
    || drills.outcome !== "READY_LOCAL_FIXTURES"
    || !exactList(drills.passedDrillTypes, DRILL_TYPES)
    || drills.missingDrillTypes.length !== 0
    || drills.failedDrillIds.length !== 0
    || !isDigest(drills.evidenceHash)
    || drills.productionReadinessGranted !== false
    || drills.externalTrafficObserved !== false) localReasons.push("DRILL_EVIDENCE_INCOMPLETE");
  if (drills.failedDrillIds.length > 0) localReasons.push("FAILED_DRILL_SCENARIOS_DETECTED");
  if (local.drillPolicy.maximumRestoreRpoSeconds > 300 || local.drillPolicy.maximumRestoreRtoSeconds > 3600) localReasons.push("RPO_OR_RTO_THRESHOLD_BREACHED");

  const operations = local.operationsReport;
  if (local.operationsPolicy.lifecycle !== "PUBLISHED"
    || local.operationsPolicy.releaseRolloutPolicyVersionId !== local.rolloutPolicy.id
    || !exactList(local.operationsPolicy.requiredSloIds, SLO_IDS)
    || !exactList(local.operationsPolicy.requiredAlertIds, ALERT_IDS)
    || local.operationsPolicy.productionActivationAllowed !== false
    || operations.policyVersionId !== local.operationsPolicy.id
    || operations.outcome !== "READY_LOCAL_FIXTURES"
    || operations.reasons.length !== 0
    || operations.sloControlCount !== SLO_IDS.length
    || operations.alertControlCount !== ALERT_IDS.length
    || operations.runbookDrillCount < 1
    || !isDigest(operations.evidenceHash)
    || operations.liveProductionReadinessGranted !== false
    || operations.productionActivationAllowed !== false) localReasons.push("OPERATIONS_EVIDENCE_INCOMPLETE");

  const legacy = local.legacySnapshot;
  if (local.legacyPolicy.lifecycle !== "PUBLISHED"
    || local.legacyPolicy.replacementReleasePolicyVersionId !== local.rolloutPolicy.id
    || !exactList(local.legacyPolicy.requiredApprovalRoles, LEGACY_POLICY_ROLES)
    || local.legacyPolicy.productionMutationAllowed !== false
    || legacy.policyVersionId !== local.legacyPolicy.id
    || legacy.state !== "CODE_RETIRED"
    || !exactList(legacy.approvalRoles, LEGACY_SNAPSHOT_ROLES)
    || legacy.readOnlyDayCount < 60
    || legacy.readOnlyDayCount > 90
    || !legacy.readOnlyStartedAt
    || !legacy.grantsRevokedAt
    || !legacy.codeRetiredAt
    || legacy.readAllowed !== false
    || legacy.writeAllowed !== false
    || legacy.grantsActive !== false
    || legacy.codeRuntimeActive !== false
    || legacy.financialEvidencePreserved !== true
    || legacy.destructiveLedgerDeletionAllowed !== false
    || !legacy.eventChainValid
    || legacy.productionMutationPerformed !== false) localReasons.push("LEGACY_EVIDENCE_INCOMPLETE");
  if (legacy.writeAllowed) localReasons.push("LEGACY_WRITES_DETECTED_DURING_READ_ONLY");
  if (legacy.grantsActive) localReasons.push("UNREVOKED_LEGACY_GRANTS_DETECTED");
  if (legacy.codeRuntimeActive) localReasons.push("RETIRED_CODE_RUNTIME_DETECTED");
  if (legacy.destructiveLedgerDeletionAllowed) localReasons.push("FINANCIAL_EVIDENCE_DESTRUCTION_ATTEMPTED");

  const formalBlockers: Gate16FormalBlocker[] = ["FORMAL_EVALUATION_NOT_AVAILABLE_IN_LOCAL_RUNTIME"];
  const localDecision: Gate16Decision["localDecision"] = localReasons.length === 0 ? "PASS" : "HOLD";
  const evidenceDigest = releaseEvidenceHash(local);
  const decisionPayload = {
    gate: 16 as const,
    evaluatedAt: evaluatedAt.toISOString(),
    localDecision,
    formalGate: "HOLD" as const,
    productionAuthorization: "DENIED" as const,
    releaseState: localDecision === "PASS" ? "GA_READY_LOCAL_FIXTURES" as const : "HOLD" as const,
    localReasons,
    formalBlockers,
    evidenceDigest,
  };

  return { ...decisionPayload, decisionHash: releaseEvidenceHash(decisionPayload) };
}
