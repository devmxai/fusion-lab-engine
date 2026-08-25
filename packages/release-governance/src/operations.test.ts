// @vitest-environment node

import { describe, expect, it } from "vitest";
import { InMemoryOperationalReadinessEvaluator } from "./operations.ts";
import type {
  OperationalReadinessEvidence,
  OperationalReadinessPolicyVersion,
  ReleaseAlertId,
  ReleaseSloId,
} from "./types.ts";

const observedAt = new Date("2026-08-13T18:00:00.000Z");
const hash = (character: string): string => character.repeat(64);

const slos: ReleaseSloId[] = [
  "QUOTE_P95",
  "ENGINE_AVAILABILITY",
  "ACCEPTED_OPERATION_DURABILITY",
  "LEDGER_INVARIANTS",
  "CALLBACK_RECONCILIATION",
  "POLLING_RECONCILIATION",
  "BACKUP_RPO",
  "RESTORE_RTO",
];

const p0Alerts: ReleaseAlertId[] = [
  "LEDGER_DRIFT_OR_NEGATIVE_BALANCE",
  "SECRET_EXPOSURE_OR_SUSPICIOUS_SPEND",
  "DUPLICATE_SETTLEMENT_OR_PROVIDER_TASK",
  "PUBLIC_ASSET_REGRESSION",
  "PROVIDER_BALANCE_EXPOSURE",
];

const p1Alerts: ReleaseAlertId[] = [
  "QUEUE_AGE_OR_DLQ",
  "COST_SHOCK_OR_VARIANCE",
  "WEBHOOK_VERIFICATION_SPIKE",
  "INGEST_FAILURES",
  "AUTH_OR_RLS_DENIAL_ANOMALY",
];

const alerts = [...p0Alerts, ...p1Alerts];

const policy: OperationalReadinessPolicyVersion = {
  id: "ops-policy-v1",
  releaseRolloutPolicyVersionId: "release-policy-v1",
  version: 1,
  lifecycle: "PUBLISHED",
  requiredSloIds: slos,
  requiredAlertIds: alerts,
  p0AlertIds: p0Alerts,
  p1AlertIds: p1Alerts,
  errorBudgetPauseConsumptionBps: 5000,
  errorBudgetFreezeConsumptionBps: 10000,
  unbudgetableIncidentClasses: ["LEDGER_DRIFT", "PUBLIC_ASSET", "DUPLICATE_DEBIT_OR_TASK", "SECRET_EXPOSURE"],
  acknowledgeSeconds: { P0: 300, P1: 900, P2: 86_400 },
  evidenceAuthority: "LOCAL_FIXTURE_ONLY",
  productionActivationAllowed: false,
  publishedAt: observedAt.toISOString(),
};

function validEvidence(): OperationalReadinessEvidence {
  return {
    evidenceId: "ops-evidence-001",
    policyVersionId: policy.id,
    sloControls: slos.map((sloId, index) => ({
      sloId,
      sliQueryId: `sli-query-${index + 1}`,
      dataSourceId: `data-source-${index + 1}`,
      measurementWindowId: "rolling-30d",
      ownerKeyHash: hash("a"),
      dashboardId: `dashboard-${index + 1}`,
      alertId: alerts[index]!,
      runbookId: "runbook-core",
      errorBudgetDefined: true,
      fastBurnAlertDefined: true,
      slowBurnAlertDefined: true,
      userImpactDocumented: true,
    })),
    alerts: alerts.map((alertId) => ({
      alertId,
      severity: p0Alerts.includes(alertId) ? "P0" as const : "P1" as const,
      ownerKeyHash: hash("b"),
      runbookId: "runbook-core",
      killSwitchId: "kill-switch-core",
    })),
    runbookDrills: [{
      runbookId: "runbook-core",
      ownerKeyHash: hash("c"),
      drillPassed: true,
      containmentStepVerified: true,
      evidencePreservationVerified: true,
      recoveryAndReopenStepVerified: true,
    }],
    onCall: {
      primaryActorKeyHash: hash("d"),
      backupActorKeyHash: hash("e"),
      escalationChannelId: "escalation-local",
      userCommunicationTemplateId: "user-comms-v1",
      publishedCoverageWindow: "LOCAL FIXTURE — 24x7 TARGET",
      p0AcknowledgeSeconds: 300,
      p1AcknowledgeSeconds: 900,
      p2AcknowledgeSeconds: 86_400,
    },
    errorBudgetDrill: {
      halfBudgetPausesRollout: true,
      exhaustedBudgetFreezesAffectedFeature: true,
      unbudgetableIncidentTriggersImmediateP0: true,
      recoveryRequiresOwnerApproval: true,
    },
    sanitizedEvidenceOnly: true,
    liveProductionMonitoringVerified: false,
    localFixtureOnly: true,
    externalTrafficObserved: false,
    observedAt: observedAt.toISOString(),
  };
}

describe("Stage 16 operational readiness", () => {
  it("pins the exact baseline SLO, alert, Error Budget and response-time policy", () => {
    expect(() => new InMemoryOperationalReadinessEvaluator({
      ...policy,
      requiredSloIds: slos.slice(0, 7),
    })).toThrowError(expect.objectContaining({ code: "INVALID_OPERATIONS_POLICY" }));
    expect(() => new InMemoryOperationalReadinessEvaluator({
      ...policy,
      acknowledgeSeconds: { ...policy.acknowledgeSeconds, P0: 301 as 300 },
    })).toThrowError(expect.objectContaining({ code: "INVALID_OPERATIONS_POLICY" }));
  });

  it("accepts a complete local SLO, alert, runbook and On-call evidence pack", () => {
    const report = new InMemoryOperationalReadinessEvaluator(policy).evaluate(validEvidence());
    expect(report).toMatchObject({
      outcome: "READY_LOCAL_FIXTURES",
      reasons: [],
      sloControlCount: 8,
      alertControlCount: 10,
      runbookDrillCount: 1,
      liveProductionReadinessGranted: false,
      productionActivationAllowed: false,
    });
    expect(report.evidenceHash).toHaveLength(64);
  });

  it("requires every SLO exactly once and linked to an existing Alert", () => {
    const evaluator = new InMemoryOperationalReadinessEvaluator(policy);
    const evidence = validEvidence();
    expect(() => evaluator.evaluate({ ...evidence, sloControls: evidence.sloControls.slice(0, 7) }))
      .toThrowError(expect.objectContaining({ code: "INVALID_OPERATIONS_EVIDENCE" }));
    expect(() => evaluator.evaluate({
      ...evidence,
      evidenceId: "ops-bad-alert-link",
      sloControls: evidence.sloControls.map((control, index) => index === 0 ? { ...control, alertId: "invented-alert" } : control),
    })).toThrowError(expect.objectContaining({ code: "INVALID_OPERATIONS_EVIDENCE" }));
  });

  it("requires SLI query, data source, window, owner, dashboard, burns and user impact", () => {
    const evaluator = new InMemoryOperationalReadinessEvaluator(policy);
    const evidence = validEvidence();
    const [first, ...rest] = evidence.sloControls;
    expect(() => evaluator.evaluate({
      ...evidence,
      sloControls: [{ ...first!, fastBurnAlertDefined: false }, ...rest],
    })).toThrowError(expect.objectContaining({ code: "INVALID_OPERATIONS_EVIDENCE" }));
  });

  it("enforces P0/P1 severity, owner, Runbook and Kill Switch links", () => {
    const evaluator = new InMemoryOperationalReadinessEvaluator(policy);
    const evidence = validEvidence();
    expect(() => evaluator.evaluate({
      ...evidence,
      alerts: evidence.alerts.map((alert, index) => index === 0 ? { ...alert, severity: "P1" } : alert),
    })).toThrowError(expect.objectContaining({ code: "INVALID_OPERATIONS_EVIDENCE" }));
    expect(() => evaluator.evaluate({
      ...evidence,
      evidenceId: "ops-no-kill",
      alerts: evidence.alerts.map((alert, index) => index === 0 ? { ...alert, killSwitchId: "" } : alert),
    })).toThrowError(expect.objectContaining({ code: "INVALID_OPERATIONS_EVIDENCE" }));
  });

  it("requires distinct primary/backup On-call and the exact P0/P1/P2 response targets", () => {
    const evaluator = new InMemoryOperationalReadinessEvaluator(policy);
    const evidence = validEvidence();
    expect(() => evaluator.evaluate({
      ...evidence,
      onCall: { ...evidence.onCall, backupActorKeyHash: evidence.onCall.primaryActorKeyHash },
    })).toThrowError(expect.objectContaining({ code: "INVALID_OPERATIONS_EVIDENCE" }));
    expect(() => evaluator.evaluate({
      ...evidence,
      evidenceId: "ops-slow-p0",
      onCall: { ...evidence.onCall, p0AcknowledgeSeconds: 301 },
    })).toThrowError(expect.objectContaining({ code: "INVALID_OPERATIONS_EVIDENCE" }));
  });

  it("holds until every Error Budget and unbudgetable-incident action is proven", () => {
    const evidence = validEvidence();
    const report = new InMemoryOperationalReadinessEvaluator(policy).evaluate({
      ...evidence,
      errorBudgetDrill: {
        halfBudgetPausesRollout: false,
        exhaustedBudgetFreezesAffectedFeature: false,
        unbudgetableIncidentTriggersImmediateP0: false,
        recoveryRequiresOwnerApproval: false,
      },
    });
    expect(report).toMatchObject({
      outcome: "HOLD",
      reasons: [
        "HALF_ERROR_BUDGET_PAUSE_NOT_PROVEN",
        "EXHAUSTED_ERROR_BUDGET_FREEZE_NOT_PROVEN",
        "UNBUDGETABLE_P0_NOT_PROVEN",
        "RECOVERY_APPROVAL_NOT_PROVEN",
      ],
    });
  });

  it("is idempotent, rejects conflicting evidence and never grants live Production readiness", () => {
    const evaluator = new InMemoryOperationalReadinessEvaluator(policy);
    const evidence = validEvidence();
    const first = evaluator.evaluate(evidence);
    expect(evaluator.evaluate(evidence)).toEqual(first);
    expect(() => evaluator.evaluate({ ...evidence, observedAt: "2026-08-13T18:01:00.000Z" }))
      .toThrowError(expect.objectContaining({ code: "RELEASE_COMMAND_CONFLICT" }));
    expect(first.liveProductionReadinessGranted).toBe(false);
    expect(first.productionActivationAllowed).toBe(false);
  });
});
