export class ReleaseGovernanceError extends Error {
  constructor(
    public readonly code:
      | "INVALID_RELEASE_POLICY"
      | "INVALID_RELEASE_APPROVAL"
      | "INVALID_RELEASE_EVIDENCE"
      | "INVALID_DRILL_POLICY"
      | "INVALID_DRILL_EVIDENCE"
      | "INVALID_OPERATIONS_POLICY"
      | "INVALID_OPERATIONS_EVIDENCE"
      | "INVALID_LEGACY_POLICY"
      | "INVALID_LEGACY_EVIDENCE"
      | "INVALID_GATE_16_EVIDENCE"
      | "LEGACY_APPROVAL_DENIED"
      | "RELEASE_COMMAND_CONFLICT"
      | "RELEASE_TRANSITION_DENIED",
    message: string,
  ) {
    super(message);
    this.name = "ReleaseGovernanceError";
  }
}

export type ReleaseStage =
  | "INTERNAL_ALPHA"
  | "INVITE_BETA"
  | "ROLLOUT_1"
  | "ROLLOUT_5"
  | "ROLLOUT_25"
  | "ROLLOUT_50"
  | "ROLLOUT_100"
  | "GA_READY";

export type ReleaseApprovalRole = "PRODUCT" | "ENGINEERING" | "SECURITY" | "FINANCE";

export type ReleaseRolloutPolicyVersion = Readonly<{
  id: string;
  releaseId: string;
  version: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  releaseDigest: string;
  requiredFormalGateIds: readonly number[];
  stages: readonly ReleaseStage[];
  requiredApprovalRoles: readonly ["PRODUCT", "ENGINEERING", "SECURITY", "FINANCE"];
  minimumSamplesPerStage: number;
  minimumObservationSecondsPerStage: number;
  pauseAtErrorBudgetConsumptionBps: 5000;
  stopAtErrorBudgetConsumptionBps: 10000;
  requireZeroCriticalHigh: true;
  requireZeroUnexplainedLedgerDrift: true;
  promotionAuthority: "LOCAL_CONTRACT_SIMULATION_ONLY";
  productionActivationAllowed: false;
  publishedAt: string;
}>;

export type ReleaseReadinessEvidence = Readonly<{
  evidenceId: string;
  policyVersionId: string;
  releaseDigest: string;
  artifactDigest: string;
  sbomDigest: string;
  provenanceDigest: string;
  verifiedFormalGateIds: readonly number[];
  criticalSecurityFindingCount: number;
  highSecurityFindingCount: number;
  unexplainedLedgerDriftCount: number;
  actualCostReconciliationBps: number;
  rollbackDrillPassed: boolean;
  sloPolicyPinned: boolean;
  drPlanPinned: boolean;
  runbooksIndexed: boolean;
  localFixtureOnly: true;
  externalTrafficObserved: false;
  observedAt: string;
}>;

export type ReleaseStageObservation = Readonly<{
  observationId: string;
  policyVersionId: string;
  stage: ReleaseStage;
  sampleCount: number;
  windowStartedAt: string;
  windowEndedAt: string;
  criticalSecurityFindingCount: number;
  highSecurityFindingCount: number;
  unexplainedLedgerDriftCount: number;
  financialInvariantFailureCount: number;
  reconciliationBps: number;
  sloBreached: boolean;
  rollbackAvailable: boolean;
  errorBudgetConsumptionBps: number;
  unbudgetableIncidentCount: number;
  localFixtureOnly: true;
  externalTrafficObserved: false;
}>;

export type ReleaseRolloutEvent = Readonly<{
  sequence: number;
  eventId: string;
  type: "APPROVED" | "ARMED" | "STAGE_STARTED" | "STAGE_PASSED" | "ROLLOUT_PAUSED" | "ROLLOUT_STOPPED";
  actorKeyHash: string;
  stage: ReleaseStage | null;
  reason: "ROLE_APPROVAL" | "READINESS_ACCEPTED" | "ORDERED_PROMOTION" | "ERROR_BUDGET_HALF_CONSUMED" | "RELEASE_BLOCKER";
  occurredAt: string;
  previousEventHash: string | null;
  eventHash: string;
}>;

export type ReleaseRolloutSnapshot = Readonly<{
  policyVersionId: string;
  releaseId: string;
  state: "DRAFT" | "ARMED" | "RUNNING" | "PAUSED" | "STOPPED" | "COMPLETED";
  currentStage: ReleaseStage | null;
  completedStages: readonly ReleaseStage[];
  approvalRoles: readonly ReleaseApprovalRole[];
  readinessEvidenceId: string | null;
  stopReason: "ERROR_BUDGET_HALF_CONSUMED" | "RELEASE_BLOCKER" | null;
  eventCount: number;
  eventChainValid: boolean;
  externalTrafficAllowed: false;
  productionActivationAllowed: false;
}>;

export type ReleaseDrillType = "LOAD" | "SOAK" | "CHAOS" | "SECURITY" | "RESTORE";

export type ReleaseDrillScenario =
  | "QUOTE_BURST"
  | "CONCURRENT_RESERVES"
  | "LONG_RUNNING_RECONCILIATION"
  | "WORKER_CRASH_AFTER_PROVIDER_ACCEPTANCE"
  | "QUEUE_REDELIVERY"
  | "PROVIDER_TIMEOUT_OR_OUTAGE"
  | "CALLBACK_DUPLICATION"
  | "JWT_AND_ROLE_ESCALATION"
  | "RLS_AND_RPC_BYPASS"
  | "SSRF_MIME_MALWARE_OVERSIZE"
  | "SECRET_AND_LOG_LEAK"
  | "CORS_CSP_CSRF"
  | "ADMIN_AAL2_MAKER_CHECKER"
  | "DATABASE_AND_STORAGE_METADATA_RESTORE"
  | "PROJECTION_REBUILD"
  | "OUTBOX_INBOX_REPLAY"
  | "IN_FLIGHT_RECONCILIATION"
  | "VAULT_RECOVERY"
  | "OBJECT_INVENTORY_VERIFICATION";

export type ReleaseDrillPolicyVersion = Readonly<{
  id: string;
  releaseRolloutPolicyVersionId: string;
  version: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  requiredDrillTypes: readonly ["LOAD", "SOAK", "CHAOS", "SECURITY", "RESTORE"];
  requiredScenarios: Readonly<Record<ReleaseDrillType, readonly ReleaseDrillScenario[]>>;
  minimumLoadRequestCount: number;
  minimumConcurrentReserveCount: number;
  maximumQuoteP95Milliseconds: 500;
  maximumLoadFailurePpm: number;
  minimumSoakDurationSeconds: number;
  maximumRestoreRpoSeconds: 300;
  maximumRestoreRtoSeconds: 3600;
  requireZeroCriticalHigh: true;
  requireZeroFinancialInvariantFailure: true;
  evidenceAuthority: "LOCAL_FIXTURE_ONLY";
  productionActivationAllowed: false;
  publishedAt: string;
}>;

export type ReleaseDrillEvidence = Readonly<{
  drillId: string;
  policyVersionId: string;
  type: ReleaseDrillType;
  startedAt: string;
  endedAt: string;
  scenarios: readonly Readonly<{
    scenario: ReleaseDrillScenario;
    passed: boolean;
    evidenceDigest: string;
  }>[];
  requestCount: number;
  concurrentReserveCount: number;
  quoteP95Milliseconds: number;
  failurePpm: number;
  financialInvariantFailureCount: number;
  duplicateDebitOrProviderTaskCount: number;
  unexplainedLedgerDriftCount: number;
  criticalSecurityFindingCount: number;
  highSecurityFindingCount: number;
  restoreRpoSeconds: number | null;
  restoreRtoSeconds: number | null;
  projectionRebuildVerified: boolean;
  inFlightReconciliationVerified: boolean;
  sanitizedEvidenceOnly: true;
  secretDetected: false;
  rawProviderPayloadDetected: false;
  productionUserMediaUsed: false;
  localFixtureOnly: true;
  externalTrafficObserved: false;
}>;

export type ReleaseDrillRecord = Readonly<{
  drillId: string;
  policyVersionId: string;
  type: ReleaseDrillType;
  passed: boolean;
  reasons: readonly string[];
  evidenceHash: string;
  recordedAt: string;
  productionEvidence: false;
}>;

export type ReleaseDrillReadinessReport = Readonly<{
  reportId: string;
  policyVersionId: string;
  outcome: "READY_LOCAL_FIXTURES" | "HOLD";
  passedDrillTypes: readonly ReleaseDrillType[];
  missingDrillTypes: readonly ReleaseDrillType[];
  failedDrillIds: readonly string[];
  evidenceHash: string;
  productionReadinessGranted: false;
  externalTrafficObserved: false;
}>;

export type ReleaseSloId =
  | "QUOTE_P95"
  | "ENGINE_AVAILABILITY"
  | "ACCEPTED_OPERATION_DURABILITY"
  | "LEDGER_INVARIANTS"
  | "CALLBACK_RECONCILIATION"
  | "POLLING_RECONCILIATION"
  | "BACKUP_RPO"
  | "RESTORE_RTO";

export type ReleaseAlertId =
  | "LEDGER_DRIFT_OR_NEGATIVE_BALANCE"
  | "SECRET_EXPOSURE_OR_SUSPICIOUS_SPEND"
  | "DUPLICATE_SETTLEMENT_OR_PROVIDER_TASK"
  | "PUBLIC_ASSET_REGRESSION"
  | "PROVIDER_BALANCE_EXPOSURE"
  | "QUEUE_AGE_OR_DLQ"
  | "COST_SHOCK_OR_VARIANCE"
  | "WEBHOOK_VERIFICATION_SPIKE"
  | "INGEST_FAILURES"
  | "AUTH_OR_RLS_DENIAL_ANOMALY";

export type OperationalReadinessPolicyVersion = Readonly<{
  id: string;
  releaseRolloutPolicyVersionId: string;
  version: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  requiredSloIds: readonly ReleaseSloId[];
  requiredAlertIds: readonly ReleaseAlertId[];
  p0AlertIds: readonly ReleaseAlertId[];
  p1AlertIds: readonly ReleaseAlertId[];
  errorBudgetPauseConsumptionBps: 5000;
  errorBudgetFreezeConsumptionBps: 10000;
  unbudgetableIncidentClasses: readonly ["LEDGER_DRIFT", "PUBLIC_ASSET", "DUPLICATE_DEBIT_OR_TASK", "SECRET_EXPOSURE"];
  acknowledgeSeconds: Readonly<{ P0: 300; P1: 900; P2: 86400 }>;
  evidenceAuthority: "LOCAL_FIXTURE_ONLY";
  productionActivationAllowed: false;
  publishedAt: string;
}>;

export type OperationalReadinessEvidence = Readonly<{
  evidenceId: string;
  policyVersionId: string;
  sloControls: readonly Readonly<{
    sloId: ReleaseSloId;
    sliQueryId: string;
    dataSourceId: string;
    measurementWindowId: string;
    ownerKeyHash: string;
    dashboardId: string;
    alertId: string;
    runbookId: string;
    errorBudgetDefined: boolean;
    fastBurnAlertDefined: boolean;
    slowBurnAlertDefined: boolean;
    userImpactDocumented: boolean;
  }>[];
  alerts: readonly Readonly<{
    alertId: ReleaseAlertId;
    severity: "P0" | "P1";
    ownerKeyHash: string;
    runbookId: string;
    killSwitchId: string;
  }>[];
  runbookDrills: readonly Readonly<{
    runbookId: string;
    ownerKeyHash: string;
    drillPassed: boolean;
    containmentStepVerified: boolean;
    evidencePreservationVerified: boolean;
    recoveryAndReopenStepVerified: boolean;
  }>[];
  onCall: Readonly<{
    primaryActorKeyHash: string;
    backupActorKeyHash: string;
    escalationChannelId: string;
    userCommunicationTemplateId: string;
    publishedCoverageWindow: string;
    p0AcknowledgeSeconds: number;
    p1AcknowledgeSeconds: number;
    p2AcknowledgeSeconds: number;
  }>;
  errorBudgetDrill: Readonly<{
    halfBudgetPausesRollout: boolean;
    exhaustedBudgetFreezesAffectedFeature: boolean;
    unbudgetableIncidentTriggersImmediateP0: boolean;
    recoveryRequiresOwnerApproval: boolean;
  }>;
  sanitizedEvidenceOnly: true;
  liveProductionMonitoringVerified: false;
  localFixtureOnly: true;
  externalTrafficObserved: false;
  observedAt: string;
}>;

export type OperationalReadinessReport = Readonly<{
  evidenceId: string;
  policyVersionId: string;
  outcome: "READY_LOCAL_FIXTURES" | "HOLD";
  reasons: readonly string[];
  sloControlCount: number;
  alertControlCount: number;
  runbookDrillCount: number;
  evidenceHash: string;
  liveProductionReadinessGranted: false;
  productionActivationAllowed: false;
}>;

export type LegacyApprovalRole = "ENGINEERING" | "SECURITY" | "FINANCE" | "SUPPORT";

export type LegacyRetirementPolicyVersion = Readonly<{
  id: string;
  legacySystemId: string;
  replacementReleasePolicyVersionId: string;
  version: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  minimumReadOnlyDays: 60;
  maximumReadOnlyDays: 90;
  requiredApprovalRoles: readonly ["ENGINEERING", "SECURITY", "FINANCE", "SUPPORT"];
  sequence: readonly ["ACTIVE", "READ_ONLY", "GRANTS_REVOKED", "CODE_RETIRED"];
  requireSingleReplacementWriter: true;
  requireZeroUnexplainedLedgerDrift: true;
  financialEvidenceRetentionMode: "IMMUTABLE_LEGAL_RETENTION";
  destructiveLedgerDeletionAllowed: false;
  authority: "LOCAL_SIMULATION_ONLY";
  productionMutationAllowed: false;
  publishedAt: string;
}>;

export type LegacyReadOnlyEvidence = Readonly<{
  evidenceId: string;
  policyVersionId: string;
  replacementReleaseDigest: string;
  replacementIsSingleWriter: boolean;
  ledgerProjectionReconciled: boolean;
  unexplainedLedgerDriftCount: number;
  inFlightOperationsReconciled: boolean;
  customerExportVerified: boolean;
  supportRunbookVerified: boolean;
  rollbackOrForwardFixVerified: boolean;
  financialEvidencePreserved: true;
  localFixtureOnly: true;
  productionMutationPerformed: false;
  observedAt: string;
}>;

export type LegacyRetirementEvidence = Readonly<{
  evidenceId: string;
  policyVersionId: string;
  legacyWriteCountDuringReadOnly: number;
  unexplainedLedgerDriftCount: number;
  unresolvedInFlightOperationCount: number;
  unresolvedSupportExceptionCount: number;
  customerExportVerified: boolean;
  retentionInventoryVerified: boolean;
  grantsInventoryVerified: boolean;
  archivedArtifactDigest: string;
  remainingRuntimeReferenceCount: number;
  dependencyAndSecretScanPassed: boolean;
  rollbackOrForwardFixVerified: boolean;
  financialEvidencePreserved: true;
  destructiveLedgerDeletionPerformed: false;
  localFixtureOnly: true;
  productionMutationPerformed: false;
  observedAt: string;
}>;

export type LegacyRetirementEvent = Readonly<{
  sequence: number;
  eventId: string;
  type: "APPROVED" | "READ_ONLY_ACTIVATED" | "GRANTS_REVOKED" | "CODE_RETIRED";
  actorKeyHash: string;
  occurredAt: string;
  previousEventHash: string | null;
  eventHash: string;
}>;

export type LegacyRetirementSnapshot = Readonly<{
  policyVersionId: string;
  legacySystemId: string;
  state: "ACTIVE" | "READ_ONLY" | "GRANTS_REVOKED" | "CODE_RETIRED";
  approvalRoles: readonly LegacyApprovalRole[];
  readOnlyStartedAt: string | null;
  grantsRevokedAt: string | null;
  codeRetiredAt: string | null;
  readOnlyDayCount: number;
  readAllowed: boolean;
  writeAllowed: boolean;
  grantsActive: boolean;
  codeRuntimeActive: boolean;
  financialEvidencePreserved: true;
  destructiveLedgerDeletionAllowed: false;
  eventCount: number;
  eventChainValid: boolean;
  productionMutationPerformed: false;
}>;

export type LegacyAccessDecision = Readonly<{
  state: LegacyRetirementSnapshot["state"];
  action: "READ" | "WRITE" | "EXPORT" | "DELETE_FINANCIAL_EVIDENCE";
  allowed: boolean;
  reason: "ACTIVE" | "READ_ONLY_ACCESS" | "WRITE_DISABLED" | "GRANTS_REVOKED" | "CODE_RETIRED" | "FINANCIAL_EVIDENCE_IMMUTABLE";
  productionMutationPerformed: false;
}>;

export type Gate16LocalDecisionReason =
  | "ROLLOUT_TESTS_FAILED"
  | "DRILL_TESTS_FAILED"
  | "OPERATIONS_TESTS_FAILED"
  | "LEGACY_TESTS_FAILED"
  | "GATE_16_EVALUATOR_TESTS_FAILED"
  | "ROLLOUT_POLICY_INCOMPLETE"
  | "UNARMED_ROLLOUT_DETECTED"
  | "SKIPPED_STAGE_DETECTED"
  | "ROLLOUT_BLOCKER_DETECTED"
  | "ERROR_BUDGET_EXHAUSTED"
  | "UNEXPLAINED_LEDGER_DRIFT_DETECTED"
  | "ACTUAL_COST_RECONCILIATION_FAILED"
  | "CRITICAL_OR_HIGH_SECURITY_FINDINGS_DETECTED"
  | "DRILL_EVIDENCE_INCOMPLETE"
  | "FAILED_DRILL_SCENARIOS_DETECTED"
  | "RPO_OR_RTO_THRESHOLD_BREACHED"
  | "OPERATIONS_EVIDENCE_INCOMPLETE"
  | "SLO_BREACH_DETECTED"
  | "UNPAGED_ALERT_DETECTED"
  | "UNCOVERED_ON_CALL_DETECTED"
  | "LEGACY_EVIDENCE_INCOMPLETE"
  | "LEGACY_WRITES_DETECTED_DURING_READ_ONLY"
  | "UNREVOKED_LEGACY_GRANTS_DETECTED"
  | "RETIRED_CODE_RUNTIME_DETECTED"
  | "FINANCIAL_EVIDENCE_DESTRUCTION_ATTEMPTED"
  | "EXTERNAL_TRAFFIC_DETECTED"
  | "PRODUCTION_ACTIVATION_DETECTED";

export type Gate16FormalBlocker =
  | "FORMAL_EVALUATION_NOT_AVAILABLE_IN_LOCAL_RUNTIME"
  | "FORMAL_UPSTREAM_GATES_HOLD"
  | "NAMED_HUMAN_APPROVALS_MISSING"
  | "LIVE_INFRASTRUCTURE_DRILLS_MISSING"
  | "LIVE_TELEMETRY_AND_PAGING_MISSING"
  | "LIVE_ON_CALL_ROTA_MISSING"
  | "PRODUCTION_TRAFFIC_AUTHORIZATION_DENIED";

export type Gate16LocalEvidence = Readonly<{
  evidenceId: string;
  rolloutPolicy: ReleaseRolloutPolicyVersion;
  rolloutSnapshot: ReleaseRolloutSnapshot;
  drillPolicy: ReleaseDrillPolicyVersion;
  drillReport: ReleaseDrillReadinessReport;
  operationsPolicy: OperationalReadinessPolicyVersion;
  operationsReport: OperationalReadinessReport;
  legacyPolicy: LegacyRetirementPolicyVersion;
  legacySnapshot: LegacyRetirementSnapshot;
  sanitizedEvidenceOnly: true;
  localFixtureOnly: true;
  externalTrafficObserved: false;
  productionActivationAttempted: false;
  observedAt: string;
}>;

/** A data-only contract for a future separately deployed formal authority. */
export type FormalGate16EvidenceContract = Readonly<{
  releaseDigest: string;
  upstreamGateReceipts: readonly Readonly<{ gateId: number; evidenceHash: string; approvedAt: string }>[];
  namedApprovals: readonly Readonly<{
    approvalId: string;
    role: ReleaseApprovalRole;
    actorKeyHash: string;
    signedAt: string;
    releaseDigest: string;
    evidenceHash: string;
  }>[];
  liveDrillEvidenceHash: string;
  liveTelemetryEvidenceHash: string;
  onCallRotaEvidenceHash: string;
}>;

export type Gate16Decision = Readonly<{
  gate: 16;
  evaluatedAt: string;
  localDecision: "PASS" | "HOLD";
  formalGate: "HOLD";
  productionAuthorization: "DENIED";
  releaseState: "GA_READY_LOCAL_FIXTURES" | "HOLD";
  localReasons: readonly Gate16LocalDecisionReason[];
  formalBlockers: readonly Gate16FormalBlocker[];
  evidenceDigest: string;
  decisionHash: string;
}>;
