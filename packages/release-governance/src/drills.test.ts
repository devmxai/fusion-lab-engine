// @vitest-environment node

import { describe, expect, it } from "vitest";
import { InMemoryReleaseDrillRegistry } from "./drills.ts";
import type {
  ReleaseDrillEvidence,
  ReleaseDrillPolicyVersion,
  ReleaseDrillScenario,
  ReleaseDrillType,
} from "./types.ts";

const observedAt = new Date("2026-08-13T17:00:00.000Z");
const scenarios: Record<ReleaseDrillType, ReleaseDrillScenario[]> = {
  LOAD: ["QUOTE_BURST", "CONCURRENT_RESERVES"],
  SOAK: ["LONG_RUNNING_RECONCILIATION"],
  CHAOS: ["WORKER_CRASH_AFTER_PROVIDER_ACCEPTANCE", "QUEUE_REDELIVERY", "PROVIDER_TIMEOUT_OR_OUTAGE", "CALLBACK_DUPLICATION"],
  SECURITY: ["JWT_AND_ROLE_ESCALATION", "RLS_AND_RPC_BYPASS", "SSRF_MIME_MALWARE_OVERSIZE", "SECRET_AND_LOG_LEAK", "CORS_CSP_CSRF", "ADMIN_AAL2_MAKER_CHECKER"],
  RESTORE: ["DATABASE_AND_STORAGE_METADATA_RESTORE", "PROJECTION_REBUILD", "OUTBOX_INBOX_REPLAY", "IN_FLIGHT_RECONCILIATION", "VAULT_RECOVERY", "OBJECT_INVENTORY_VERIFICATION"],
};

const policy: ReleaseDrillPolicyVersion = {
  id: "drill-policy-v1",
  releaseRolloutPolicyVersionId: "release-policy-v1",
  version: 1,
  lifecycle: "PUBLISHED",
  requiredDrillTypes: ["LOAD", "SOAK", "CHAOS", "SECURITY", "RESTORE"],
  requiredScenarios: scenarios,
  minimumLoadRequestCount: 10_000,
  minimumConcurrentReserveCount: 100,
  maximumQuoteP95Milliseconds: 500,
  maximumLoadFailurePpm: 1_000,
  minimumSoakDurationSeconds: 86_400,
  maximumRestoreRpoSeconds: 300,
  maximumRestoreRtoSeconds: 3_600,
  requireZeroCriticalHigh: true,
  requireZeroFinancialInvariantFailure: true,
  evidenceAuthority: "LOCAL_FIXTURE_ONLY",
  productionActivationAllowed: false,
  publishedAt: observedAt.toISOString(),
};

function evidence(type: ReleaseDrillType, drillId = `drill-${type.toLowerCase()}`): ReleaseDrillEvidence {
  const isSoak = type === "SOAK";
  const isRestore = type === "RESTORE";
  return {
    drillId,
    policyVersionId: policy.id,
    type,
    startedAt: "2026-08-12T00:00:00.000Z",
    endedAt: isSoak ? "2026-08-13T00:00:00.000Z" : "2026-08-12T02:00:00.000Z",
    scenarios: scenarios[type].map((scenario) => ({ scenario, passed: true, evidenceDigest: "a".repeat(64) })),
    requestCount: type === "LOAD" ? 10_000 : 0,
    concurrentReserveCount: type === "LOAD" ? 100 : 0,
    quoteP95Milliseconds: type === "LOAD" ? 500 : 0,
    failurePpm: 0,
    financialInvariantFailureCount: 0,
    duplicateDebitOrProviderTaskCount: 0,
    unexplainedLedgerDriftCount: 0,
    criticalSecurityFindingCount: 0,
    highSecurityFindingCount: 0,
    restoreRpoSeconds: isRestore ? 300 : null,
    restoreRtoSeconds: isRestore ? 3_600 : null,
    projectionRebuildVerified: isRestore,
    inFlightReconciliationVerified: isRestore,
    sanitizedEvidenceOnly: true,
    secretDetected: false,
    rawProviderPayloadDetected: false,
    productionUserMediaUsed: false,
    localFixtureOnly: true,
    externalTrafficObserved: false,
  };
}

describe("Stage 16 release drills", () => {
  it("requires the exact Load, Soak, Chaos, Security and Restore scenario contract", () => {
    expect(() => new InMemoryReleaseDrillRegistry({
      ...policy,
      requiredScenarios: { ...scenarios, CHAOS: scenarios.CHAOS.slice(0, 3) },
    })).toThrowError(expect.objectContaining({ code: "INVALID_DRILL_POLICY" }));
    expect(() => new InMemoryReleaseDrillRegistry({ ...policy, maximumRestoreRtoSeconds: 3_599 as 3_600 }))
      .toThrowError(expect.objectContaining({ code: "INVALID_DRILL_POLICY" }));
  });

  it("enforces quote burst, 100+ concurrent reserves, p95 and failure thresholds", () => {
    const registry = new InMemoryReleaseDrillRegistry(policy, () => observedAt);
    expect(registry.record(evidence("LOAD"))).toMatchObject({ passed: true, type: "LOAD", productionEvidence: false });
    expect(registry.record({
      ...evidence("LOAD", "load-failed"),
      requestCount: 9_999,
      concurrentReserveCount: 99,
      quoteP95Milliseconds: 501,
      failurePpm: 1_001,
    }).reasons).toEqual([
      "LOAD_REQUEST_COUNT_TOO_LOW",
      "CONCURRENT_RESERVE_COUNT_TOO_LOW",
      "QUOTE_P95_BREACH",
      "LOAD_FAILURE_RATE_BREACH",
    ]);
  });

  it("requires the full long-running Soak window", () => {
    const registry = new InMemoryReleaseDrillRegistry(policy, () => observedAt);
    expect(registry.record(evidence("SOAK")).passed).toBe(true);
    expect(registry.record({
      ...evidence("SOAK", "soak-short"),
      endedAt: "2026-08-12T23:59:59.000Z",
    }).reasons).toEqual(["SOAK_DURATION_TOO_SHORT"]);
  });

  it("fails Chaos on any worker, redelivery, outage or duplicate-callback scenario", () => {
    const registry = new InMemoryReleaseDrillRegistry(policy, () => observedAt);
    const failed = evidence("CHAOS");
    expect(registry.record({
      ...failed,
      scenarios: failed.scenarios.map((scenario, index) => ({ ...scenario, passed: index !== 2 })),
    })).toMatchObject({ passed: false, reasons: ["SCENARIO_FAILED"] });
  });

  it("blocks Security findings and rejects secrets, raw payloads or Production user media in evidence", () => {
    const registry = new InMemoryReleaseDrillRegistry(policy, () => observedAt);
    expect(registry.record({ ...evidence("SECURITY"), highSecurityFindingCount: 1 }))
      .toMatchObject({ passed: false, reasons: ["CRITICAL_OR_HIGH_SECURITY_FINDING"] });
    expect(() => registry.record({ ...evidence("SECURITY", "security-secret"), secretDetected: true as false }))
      .toThrowError(expect.objectContaining({ code: "INVALID_DRILL_EVIDENCE" }));
    expect(() => registry.record({ ...evidence("SECURITY", "security-media"), productionUserMediaUsed: true as false }))
      .toThrowError(expect.objectContaining({ code: "INVALID_DRILL_EVIDENCE" }));
  });

  it("requires Restore RPO/RTO, projection rebuild and in-flight reconciliation", () => {
    const registry = new InMemoryReleaseDrillRegistry(policy, () => observedAt);
    expect(registry.record(evidence("RESTORE")).passed).toBe(true);
    expect(registry.record({
      ...evidence("RESTORE", "restore-failed"),
      restoreRpoSeconds: 301,
      restoreRtoSeconds: 3_601,
      projectionRebuildVerified: false,
      inFlightReconciliationVerified: false,
    }).reasons).toEqual([
      "RESTORE_RPO_BREACH",
      "RESTORE_RTO_BREACH",
      "PROJECTION_REBUILD_NOT_VERIFIED",
      "IN_FLIGHT_RECONCILIATION_NOT_VERIFIED",
    ]);
  });

  it("is idempotent for identical Drill evidence and rejects conflicting replay", () => {
    const registry = new InMemoryReleaseDrillRegistry(policy, () => observedAt);
    const load = evidence("LOAD");
    const first = registry.record(load);
    expect(registry.record(load)).toEqual(first);
    expect(registry.entries()).toHaveLength(1);
    expect(() => registry.record({ ...load, requestCount: 10_001 }))
      .toThrowError(expect.objectContaining({ code: "RELEASE_COMMAND_CONFLICT" }));
    expect(first.evidenceHash).toHaveLength(64);
  });

  it("reports readiness only after all five local drills pass, without granting Production readiness", () => {
    const registry = new InMemoryReleaseDrillRegistry(policy, () => observedAt);
    registry.record(evidence("LOAD"));
    expect(registry.assess("report-incomplete")).toMatchObject({
      outcome: "HOLD",
      passedDrillTypes: ["LOAD"],
      missingDrillTypes: ["SOAK", "CHAOS", "SECURITY", "RESTORE"],
      productionReadinessGranted: false,
    });
    (["SOAK", "CHAOS", "SECURITY", "RESTORE"] as const).forEach((type) => registry.record(evidence(type)));
    const report = registry.assess("report-complete");
    expect(report).toMatchObject({
      outcome: "READY_LOCAL_FIXTURES",
      passedDrillTypes: ["LOAD", "SOAK", "CHAOS", "SECURITY", "RESTORE"],
      missingDrillTypes: [],
      failedDrillIds: [],
      productionReadinessGranted: false,
      externalTrafficObserved: false,
    });
    expect(report.evidenceHash).toHaveLength(64);
  });
});
