import { releaseEvidenceHash } from "./canonical.ts";
import type {
  OperationalReadinessEvidence,
  OperationalReadinessPolicyVersion,
  OperationalReadinessReport,
  ReleaseAlertId,
  ReleaseSloId,
} from "./types.ts";
import { ReleaseGovernanceError } from "./types.ts";

const SLOS: readonly ReleaseSloId[] = [
  "QUOTE_P95",
  "ENGINE_AVAILABILITY",
  "ACCEPTED_OPERATION_DURABILITY",
  "LEDGER_INVARIANTS",
  "CALLBACK_RECONCILIATION",
  "POLLING_RECONCILIATION",
  "BACKUP_RPO",
  "RESTORE_RTO",
];

const P0_ALERTS: readonly ReleaseAlertId[] = [
  "LEDGER_DRIFT_OR_NEGATIVE_BALANCE",
  "SECRET_EXPOSURE_OR_SUSPICIOUS_SPEND",
  "DUPLICATE_SETTLEMENT_OR_PROVIDER_TASK",
  "PUBLIC_ASSET_REGRESSION",
  "PROVIDER_BALANCE_EXPOSURE",
];

const P1_ALERTS: readonly ReleaseAlertId[] = [
  "QUEUE_AGE_OR_DLQ",
  "COST_SHOCK_OR_VARIANCE",
  "WEBHOOK_VERIFICATION_SPIKE",
  "INGEST_FAILURES",
  "AUTH_OR_RLS_DENIAL_ANOMALY",
];

const ALERTS: readonly ReleaseAlertId[] = [...P0_ALERTS, ...P1_ALERTS];

function exactList<T>(actual: readonly T[], expected: readonly T[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function actorHash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function validatePolicy(policy: OperationalReadinessPolicyVersion): void {
  if (!policy.id
    || !policy.releaseRolloutPolicyVersionId
    || !Number.isInteger(policy.version)
    || policy.version <= 0
    || policy.lifecycle !== "PUBLISHED"
    || !exactList(policy.requiredSloIds, SLOS)
    || !exactList(policy.requiredAlertIds, ALERTS)
    || !exactList(policy.p0AlertIds, P0_ALERTS)
    || !exactList(policy.p1AlertIds, P1_ALERTS)
    || policy.errorBudgetPauseConsumptionBps !== 5000
    || policy.errorBudgetFreezeConsumptionBps !== 10000
    || !exactList(policy.unbudgetableIncidentClasses, ["LEDGER_DRIFT", "PUBLIC_ASSET", "DUPLICATE_DEBIT_OR_TASK", "SECRET_EXPOSURE"])
    || policy.acknowledgeSeconds.P0 !== 300
    || policy.acknowledgeSeconds.P1 !== 900
    || policy.acknowledgeSeconds.P2 !== 86_400
    || policy.evidenceAuthority !== "LOCAL_FIXTURE_ONLY"
    || policy.productionActivationAllowed !== false
    || Number.isNaN(Date.parse(policy.publishedAt))) {
    throw new ReleaseGovernanceError("INVALID_OPERATIONS_POLICY", "Operations Policy must pin baseline SLOs, P0/P1 alerts, Error Budget actions and On-call response times.");
  }
}

function validateEvidence(policy: OperationalReadinessPolicyVersion, evidence: OperationalReadinessEvidence): void {
  const sloIds = evidence.sloControls.map(({ sloId }) => sloId);
  const alertIds = evidence.alerts.map(({ alertId }) => alertId);
  const runbookIds = new Set(evidence.runbookDrills.map(({ runbookId }) => runbookId));
  if (!evidence.evidenceId
    || evidence.policyVersionId !== policy.id
    || Number.isNaN(Date.parse(evidence.observedAt))
    || !exactList(sloIds, policy.requiredSloIds)
    || new Set(sloIds).size !== sloIds.length
    || !exactList(alertIds, policy.requiredAlertIds)
    || new Set(alertIds).size !== alertIds.length
    || evidence.sloControls.some((control) => !control.sliQueryId
      || !control.dataSourceId
      || !control.measurementWindowId
      || !actorHash(control.ownerKeyHash)
      || !control.dashboardId
      || !control.alertId
      || !alertIds.includes(control.alertId as ReleaseAlertId)
      || !control.runbookId
      || !control.errorBudgetDefined
      || !control.fastBurnAlertDefined
      || !control.slowBurnAlertDefined
      || !control.userImpactDocumented
      || !runbookIds.has(control.runbookId))
    || evidence.alerts.some((alert) => !actorHash(alert.ownerKeyHash)
      || !alert.runbookId
      || !runbookIds.has(alert.runbookId)
      || !alert.killSwitchId
      || (policy.p0AlertIds.includes(alert.alertId) ? alert.severity !== "P0" : alert.severity !== "P1"))
    || evidence.runbookDrills.length === 0
    || evidence.runbookDrills.some((drill) => !drill.runbookId
      || !actorHash(drill.ownerKeyHash)
      || !drill.drillPassed
      || !drill.containmentStepVerified
      || !drill.evidencePreservationVerified
      || !drill.recoveryAndReopenStepVerified)
    || !actorHash(evidence.onCall.primaryActorKeyHash)
    || !actorHash(evidence.onCall.backupActorKeyHash)
    || evidence.onCall.primaryActorKeyHash === evidence.onCall.backupActorKeyHash
    || !evidence.onCall.escalationChannelId
    || !evidence.onCall.userCommunicationTemplateId
    || !evidence.onCall.publishedCoverageWindow
    || evidence.onCall.p0AcknowledgeSeconds !== policy.acknowledgeSeconds.P0
    || evidence.onCall.p1AcknowledgeSeconds !== policy.acknowledgeSeconds.P1
    || evidence.onCall.p2AcknowledgeSeconds !== policy.acknowledgeSeconds.P2
    || evidence.sanitizedEvidenceOnly !== true
    || evidence.liveProductionMonitoringVerified !== false
    || evidence.localFixtureOnly !== true
    || evidence.externalTrafficObserved !== false) {
    throw new ReleaseGovernanceError("INVALID_OPERATIONS_EVIDENCE", "Operations evidence must link every SLO and alert to owner, dashboard, runbook, kill switch and separated On-call coverage.");
  }
}

export class InMemoryOperationalReadinessEvaluator {
  private readonly reports = new Map<string, { intentHash: string; report: OperationalReadinessReport }>();

  constructor(private readonly policy: OperationalReadinessPolicyVersion) {
    validatePolicy(policy);
  }

  evaluate(evidence: OperationalReadinessEvidence): OperationalReadinessReport {
    const intentHash = releaseEvidenceHash(evidence);
    const prior = this.reports.get(evidence.evidenceId);
    if (prior) {
      if (prior.intentHash === intentHash) return structuredClone(prior.report);
      throw new ReleaseGovernanceError("RELEASE_COMMAND_CONFLICT", "Operations Evidence ID was reused with different intent.");
    }
    validateEvidence(this.policy, evidence);
    const reasons: string[] = [];
    if (!evidence.errorBudgetDrill.halfBudgetPausesRollout) reasons.push("HALF_ERROR_BUDGET_PAUSE_NOT_PROVEN");
    if (!evidence.errorBudgetDrill.exhaustedBudgetFreezesAffectedFeature) reasons.push("EXHAUSTED_ERROR_BUDGET_FREEZE_NOT_PROVEN");
    if (!evidence.errorBudgetDrill.unbudgetableIncidentTriggersImmediateP0) reasons.push("UNBUDGETABLE_P0_NOT_PROVEN");
    if (!evidence.errorBudgetDrill.recoveryRequiresOwnerApproval) reasons.push("RECOVERY_APPROVAL_NOT_PROVEN");
    const reportWithoutHash = {
      evidenceId: evidence.evidenceId,
      policyVersionId: this.policy.id,
      outcome: reasons.length === 0 ? "READY_LOCAL_FIXTURES" as const : "HOLD" as const,
      reasons,
      sloControlCount: evidence.sloControls.length,
      alertControlCount: evidence.alerts.length,
      runbookDrillCount: evidence.runbookDrills.length,
      liveProductionReadinessGranted: false as const,
      productionActivationAllowed: false as const,
    };
    const report = { ...reportWithoutHash, evidenceHash: releaseEvidenceHash({ policy: this.policy, evidence, report: reportWithoutHash }) };
    this.reports.set(evidence.evidenceId, { intentHash, report });
    return structuredClone(report);
  }
}
