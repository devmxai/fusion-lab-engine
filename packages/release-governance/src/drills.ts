import { releaseEvidenceHash } from "./canonical.ts";
import type {
  ReleaseDrillEvidence,
  ReleaseDrillPolicyVersion,
  ReleaseDrillReadinessReport,
  ReleaseDrillRecord,
  ReleaseDrillScenario,
  ReleaseDrillType,
} from "./types.ts";
import { ReleaseGovernanceError } from "./types.ts";

const DRILL_TYPES: readonly ReleaseDrillType[] = ["LOAD", "SOAK", "CHAOS", "SECURITY", "RESTORE"];

const EXPECTED_SCENARIOS: Readonly<Record<ReleaseDrillType, readonly ReleaseDrillScenario[]>> = {
  LOAD: ["QUOTE_BURST", "CONCURRENT_RESERVES"],
  SOAK: ["LONG_RUNNING_RECONCILIATION"],
  CHAOS: ["WORKER_CRASH_AFTER_PROVIDER_ACCEPTANCE", "QUEUE_REDELIVERY", "PROVIDER_TIMEOUT_OR_OUTAGE", "CALLBACK_DUPLICATION"],
  SECURITY: ["JWT_AND_ROLE_ESCALATION", "RLS_AND_RPC_BYPASS", "SSRF_MIME_MALWARE_OVERSIZE", "SECRET_AND_LOG_LEAK", "CORS_CSP_CSRF", "ADMIN_AAL2_MAKER_CHECKER"],
  RESTORE: ["DATABASE_AND_STORAGE_METADATA_RESTORE", "PROJECTION_REBUILD", "OUTBOX_INBOX_REPLAY", "IN_FLIGHT_RECONCILIATION", "VAULT_RECOVERY", "OBJECT_INVENTORY_VERIFICATION"],
};

function exactList<T>(actual: readonly T[], expected: readonly T[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function validatePolicy(policy: ReleaseDrillPolicyVersion): void {
  if (!policy.id
    || !policy.releaseRolloutPolicyVersionId
    || !Number.isInteger(policy.version)
    || policy.version <= 0
    || policy.lifecycle !== "PUBLISHED"
    || !exactList(policy.requiredDrillTypes, DRILL_TYPES)
    || DRILL_TYPES.some((type) => !exactList(policy.requiredScenarios[type], EXPECTED_SCENARIOS[type]))
    || !Number.isInteger(policy.minimumLoadRequestCount)
    || policy.minimumLoadRequestCount <= 0
    || !Number.isInteger(policy.minimumConcurrentReserveCount)
    || policy.minimumConcurrentReserveCount < 100
    || policy.maximumQuoteP95Milliseconds !== 500
    || !Number.isInteger(policy.maximumLoadFailurePpm)
    || policy.maximumLoadFailurePpm < 0
    || policy.maximumLoadFailurePpm > 1_000_000
    || !Number.isInteger(policy.minimumSoakDurationSeconds)
    || policy.minimumSoakDurationSeconds < 3_600
    || policy.maximumRestoreRpoSeconds !== 300
    || policy.maximumRestoreRtoSeconds !== 3_600
    || policy.requireZeroCriticalHigh !== true
    || policy.requireZeroFinancialInvariantFailure !== true
    || policy.evidenceAuthority !== "LOCAL_FIXTURE_ONLY"
    || policy.productionActivationAllowed !== false
    || Number.isNaN(Date.parse(policy.publishedAt))) {
    throw new ReleaseGovernanceError("INVALID_DRILL_POLICY", "Drill Policy must pin Load, Soak, Chaos, Security and Restore scenarios with fail-closed local thresholds.");
  }
}

function validateEvidence(policy: ReleaseDrillPolicyVersion, evidence: ReleaseDrillEvidence): number {
  const startedAt = Date.parse(evidence.startedAt);
  const endedAt = Date.parse(evidence.endedAt);
  const integers = [
    evidence.requestCount,
    evidence.concurrentReserveCount,
    evidence.quoteP95Milliseconds,
    evidence.failurePpm,
    evidence.financialInvariantFailureCount,
    evidence.duplicateDebitOrProviderTaskCount,
    evidence.unexplainedLedgerDriftCount,
    evidence.criticalSecurityFindingCount,
    evidence.highSecurityFindingCount,
  ];
  const restoreIntegers = [evidence.restoreRpoSeconds, evidence.restoreRtoSeconds]
    .filter((value): value is number => value !== null);
  const required = policy.requiredScenarios[evidence.type];
  const provided = evidence.scenarios.map(({ scenario }) => scenario);
  if (!evidence.drillId
    || evidence.policyVersionId !== policy.id
    || !policy.requiredDrillTypes.includes(evidence.type)
    || Number.isNaN(startedAt)
    || Number.isNaN(endedAt)
    || endedAt <= startedAt
    || integers.some((value) => !Number.isInteger(value) || value < 0)
    || restoreIntegers.some((value) => !Number.isInteger(value) || value < 0)
    || evidence.failurePpm > 1_000_000
    || !exactList(provided, required)
    || new Set(provided).size !== provided.length
    || evidence.scenarios.some(({ evidenceDigest }) => !/^[a-f0-9]{64}$/.test(evidenceDigest))
    || evidence.sanitizedEvidenceOnly !== true
    || evidence.secretDetected !== false
    || evidence.rawProviderPayloadDetected !== false
    || evidence.productionUserMediaUsed !== false
    || evidence.localFixtureOnly !== true
    || evidence.externalTrafficObserved !== false) {
    throw new ReleaseGovernanceError("INVALID_DRILL_EVIDENCE", "Drill evidence must contain the exact sanitized local scenarios and bounded measurements for its Policy Version.");
  }
  return Math.floor((endedAt - startedAt) / 1000);
}

function evaluate(policy: ReleaseDrillPolicyVersion, evidence: ReleaseDrillEvidence, durationSeconds: number): string[] {
  const reasons: string[] = [];
  if (evidence.scenarios.some(({ passed }) => !passed)) reasons.push("SCENARIO_FAILED");
  if (evidence.financialInvariantFailureCount > 0) reasons.push("FINANCIAL_INVARIANT_FAILURE");
  if (evidence.duplicateDebitOrProviderTaskCount > 0) reasons.push("DUPLICATE_DEBIT_OR_PROVIDER_TASK");
  if (evidence.unexplainedLedgerDriftCount > 0) reasons.push("UNEXPLAINED_LEDGER_DRIFT");
  if (evidence.criticalSecurityFindingCount > 0 || evidence.highSecurityFindingCount > 0) {
    reasons.push("CRITICAL_OR_HIGH_SECURITY_FINDING");
  }
  if (evidence.type === "LOAD") {
    if (evidence.requestCount < policy.minimumLoadRequestCount) reasons.push("LOAD_REQUEST_COUNT_TOO_LOW");
    if (evidence.concurrentReserveCount < policy.minimumConcurrentReserveCount) reasons.push("CONCURRENT_RESERVE_COUNT_TOO_LOW");
    if (evidence.quoteP95Milliseconds > policy.maximumQuoteP95Milliseconds) reasons.push("QUOTE_P95_BREACH");
    if (evidence.failurePpm > policy.maximumLoadFailurePpm) reasons.push("LOAD_FAILURE_RATE_BREACH");
  }
  if (evidence.type === "SOAK" && durationSeconds < policy.minimumSoakDurationSeconds) reasons.push("SOAK_DURATION_TOO_SHORT");
  if (evidence.type === "RESTORE") {
    if (evidence.restoreRpoSeconds === null || evidence.restoreRpoSeconds > policy.maximumRestoreRpoSeconds) reasons.push("RESTORE_RPO_BREACH");
    if (evidence.restoreRtoSeconds === null || evidence.restoreRtoSeconds > policy.maximumRestoreRtoSeconds) reasons.push("RESTORE_RTO_BREACH");
    if (!evidence.projectionRebuildVerified) reasons.push("PROJECTION_REBUILD_NOT_VERIFIED");
    if (!evidence.inFlightReconciliationVerified) reasons.push("IN_FLIGHT_RECONCILIATION_NOT_VERIFIED");
  }
  return reasons;
}

export class InMemoryReleaseDrillRegistry {
  private readonly recordsById = new Map<string, { intentHash: string; record: ReleaseDrillRecord }>();

  constructor(
    private readonly policy: ReleaseDrillPolicyVersion,
    private readonly now: () => Date = () => new Date(),
  ) {
    validatePolicy(policy);
  }

  record(evidence: ReleaseDrillEvidence): ReleaseDrillRecord {
    const intentHash = releaseEvidenceHash(evidence);
    const prior = this.recordsById.get(evidence.drillId);
    if (prior) {
      if (prior.intentHash === intentHash) return structuredClone(prior.record);
      throw new ReleaseGovernanceError("RELEASE_COMMAND_CONFLICT", "Drill ID was reused with different evidence.");
    }
    const durationSeconds = validateEvidence(this.policy, evidence);
    const reasons = evaluate(this.policy, evidence, durationSeconds);
    const record: ReleaseDrillRecord = {
      drillId: evidence.drillId,
      policyVersionId: this.policy.id,
      type: evidence.type,
      passed: reasons.length === 0,
      reasons,
      evidenceHash: intentHash,
      recordedAt: this.now().toISOString(),
      productionEvidence: false,
    };
    this.recordsById.set(evidence.drillId, { intentHash, record });
    return structuredClone(record);
  }

  assess(reportId: string): ReleaseDrillReadinessReport {
    if (!reportId) throw new ReleaseGovernanceError("INVALID_DRILL_EVIDENCE", "Drill readiness requires a Report ID.");
    const records = [...this.recordsById.values()].map(({ record }) => record);
    const passedDrillTypes = DRILL_TYPES.filter((type) => records.some((record) => record.type === type && record.passed));
    const missingDrillTypes = DRILL_TYPES.filter((type) => !passedDrillTypes.includes(type));
    const failedDrillIds = records.filter(({ passed }) => !passed).map(({ drillId }) => drillId).sort();
    const reportWithoutHash = {
      reportId,
      policyVersionId: this.policy.id,
      outcome: missingDrillTypes.length === 0 && failedDrillIds.length === 0 ? "READY_LOCAL_FIXTURES" as const : "HOLD" as const,
      passedDrillTypes,
      missingDrillTypes,
      failedDrillIds,
      productionReadinessGranted: false as const,
      externalTrafficObserved: false as const,
    };
    return { ...reportWithoutHash, evidenceHash: releaseEvidenceHash({ policy: this.policy, records, report: reportWithoutHash }) };
  }

  entries(): readonly ReleaseDrillRecord[] {
    return [...this.recordsById.values()].map(({ record }) => structuredClone(record));
  }
}
