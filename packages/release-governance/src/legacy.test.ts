// @vitest-environment node

import { describe, expect, it } from "vitest";
import { InMemoryLegacyRetirementController } from "./legacy.ts";
import type {
  LegacyApprovalRole,
  LegacyReadOnlyEvidence,
  LegacyRetirementEvidence,
  LegacyRetirementPolicyVersion,
} from "./types.ts";

const initialTime = new Date("2026-08-13T19:00:00.000Z");
const dayMs = 86_400_000;

const policy: LegacyRetirementPolicyVersion = {
  id: "legacy-policy-v1",
  legacySystemId: "fusionlab-v1",
  replacementReleasePolicyVersionId: "release-policy-v1",
  version: 1,
  lifecycle: "PUBLISHED",
  minimumReadOnlyDays: 60,
  maximumReadOnlyDays: 90,
  requiredApprovalRoles: ["ENGINEERING", "SECURITY", "FINANCE", "SUPPORT"],
  sequence: ["ACTIVE", "READ_ONLY", "GRANTS_REVOKED", "CODE_RETIRED"],
  requireSingleReplacementWriter: true,
  requireZeroUnexplainedLedgerDrift: true,
  financialEvidenceRetentionMode: "IMMUTABLE_LEGAL_RETENTION",
  destructiveLedgerDeletionAllowed: false,
  authority: "LOCAL_SIMULATION_ONLY",
  productionMutationAllowed: false,
  publishedAt: initialTime.toISOString(),
};

const readOnlyEvidence: LegacyReadOnlyEvidence = {
  evidenceId: "read-only-evidence-001",
  policyVersionId: policy.id,
  replacementReleaseDigest: "a".repeat(64),
  replacementIsSingleWriter: true,
  ledgerProjectionReconciled: true,
  unexplainedLedgerDriftCount: 0,
  inFlightOperationsReconciled: true,
  customerExportVerified: true,
  supportRunbookVerified: true,
  rollbackOrForwardFixVerified: true,
  financialEvidencePreserved: true,
  localFixtureOnly: true,
  productionMutationPerformed: false,
  observedAt: initialTime.toISOString(),
};

const retirementEvidence: LegacyRetirementEvidence = {
  evidenceId: "retirement-evidence-001",
  policyVersionId: policy.id,
  legacyWriteCountDuringReadOnly: 0,
  unexplainedLedgerDriftCount: 0,
  unresolvedInFlightOperationCount: 0,
  unresolvedSupportExceptionCount: 0,
  customerExportVerified: true,
  retentionInventoryVerified: true,
  grantsInventoryVerified: true,
  archivedArtifactDigest: "b".repeat(64),
  remainingRuntimeReferenceCount: 0,
  dependencyAndSecretScanPassed: true,
  rollbackOrForwardFixVerified: true,
  financialEvidencePreserved: true,
  destructiveLedgerDeletionPerformed: false,
  localFixtureOnly: true,
  productionMutationPerformed: false,
  observedAt: initialTime.toISOString(),
};

function approveAll(controller: InMemoryLegacyRetirementController): void {
  const roles: LegacyApprovalRole[] = ["ENGINEERING", "SECURITY", "FINANCE", "SUPPORT"];
  roles.forEach((role, index) => controller.approve({
    approvalId: `approval-${role.toLowerCase()}`,
    actorId: `legacy-actor-${index + 1}`,
    role,
  }));
}

function controllerWithClock(): {
  controller: InMemoryLegacyRetirementController;
  moveToDay: (day: number) => void;
} {
  let currentTime = new Date(initialTime);
  const controller = new InMemoryLegacyRetirementController(policy, "legacy-maker", () => currentTime);
  return {
    controller,
    moveToDay: (day) => { currentTime = new Date(initialTime.getTime() + day * dayMs); },
  };
}

function readOnlyController(): ReturnType<typeof controllerWithClock> {
  const result = controllerWithClock();
  approveAll(result.controller);
  result.controller.activateReadOnly(readOnlyEvidence);
  return result;
}

describe("Stage 16 V1 read-only and Legacy retirement", () => {
  it("pins the exact 60–90 day sequence and permanently prohibits destructive Ledger deletion", () => {
    expect(() => new InMemoryLegacyRetirementController({
      ...policy,
      maximumReadOnlyDays: 89 as 90,
    }, "maker")).toThrowError(expect.objectContaining({ code: "INVALID_LEGACY_POLICY" }));
    expect(() => new InMemoryLegacyRetirementController({
      ...policy,
      sequence: ["ACTIVE", "READ_ONLY", "CODE_RETIRED", "GRANTS_REVOKED"] as unknown as typeof policy.sequence,
    }, "maker")).toThrowError(expect.objectContaining({ code: "INVALID_LEGACY_POLICY" }));
  });

  it("requires Engineering, Security, Finance and Support actors distinct from the maker", () => {
    const { controller } = controllerWithClock();
    controller.approve({ approvalId: "approval-engineering", actorId: "actor-1", role: "ENGINEERING" });
    expect(() => controller.approve({ approvalId: "approval-security", actorId: "actor-1", role: "SECURITY" }))
      .toThrowError(expect.objectContaining({ code: "LEGACY_APPROVAL_DENIED" }));
    expect(() => controller.approve({ approvalId: "approval-finance", actorId: "legacy-maker", role: "FINANCE" }))
      .toThrowError(expect.objectContaining({ code: "LEGACY_APPROVAL_DENIED" }));
    expect(() => controller.activateReadOnly(readOnlyEvidence))
      .toThrowError(expect.objectContaining({ code: "RELEASE_TRANSITION_DENIED" }));
  });

  it("activates Read-only only with one replacement writer and reconciled export/support evidence", () => {
    const { controller } = controllerWithClock();
    approveAll(controller);
    expect(() => controller.activateReadOnly({ ...readOnlyEvidence, replacementIsSingleWriter: false }))
      .toThrowError(expect.objectContaining({ code: "INVALID_LEGACY_EVIDENCE" }));
    expect(() => controller.activateReadOnly({ ...readOnlyEvidence, unexplainedLedgerDriftCount: 1 }))
      .toThrowError(expect.objectContaining({ code: "INVALID_LEGACY_EVIDENCE" }));
    expect(controller.activateReadOnly(readOnlyEvidence)).toMatchObject({
      state: "READ_ONLY",
      readAllowed: true,
      writeAllowed: false,
      grantsActive: true,
      productionMutationPerformed: false,
    });
  });

  it("allows Read and Export but blocks Write and financial-evidence deletion during Read-only", () => {
    const { controller } = readOnlyController();
    expect(controller.decideAccess("READ")).toMatchObject({ allowed: true, reason: "READ_ONLY_ACCESS" });
    expect(controller.decideAccess("EXPORT")).toMatchObject({ allowed: true, reason: "READ_ONLY_ACCESS" });
    expect(controller.decideAccess("WRITE")).toMatchObject({ allowed: false, reason: "WRITE_DISABLED" });
    expect(controller.decideAccess("DELETE_FINANCIAL_EVIDENCE")).toMatchObject({
      allowed: false,
      reason: "FINANCIAL_EVIDENCE_IMMUTABLE",
    });
  });

  it("refuses grant retirement before day 60 or after day 90", () => {
    const early = readOnlyController();
    early.moveToDay(59);
    expect(() => early.controller.revokeGrants(retirementEvidence))
      .toThrowError(expect.objectContaining({ code: "RELEASE_TRANSITION_DENIED" }));

    const late = readOnlyController();
    late.moveToDay(91);
    expect(() => late.controller.revokeGrants(retirementEvidence))
      .toThrowError(expect.objectContaining({ code: "RELEASE_TRANSITION_DENIED" }));
  });

  it("requires zero Read-only writes, drift, in-flight work and support exceptions", () => {
    const result = readOnlyController();
    result.moveToDay(60);
    expect(() => result.controller.revokeGrants({
      ...retirementEvidence,
      legacyWriteCountDuringReadOnly: 1,
      unresolvedInFlightOperationCount: 1,
    })).toThrowError(expect.objectContaining({ code: "INVALID_LEGACY_EVIDENCE" }));
  });

  it("revokes grants before code and retires code only after archive, scans and zero references", () => {
    const result = readOnlyController();
    result.moveToDay(60);
    expect(() => result.controller.retireCode(retirementEvidence))
      .toThrowError(expect.objectContaining({ code: "RELEASE_TRANSITION_DENIED" }));
    expect(result.controller.revokeGrants(retirementEvidence)).toMatchObject({
      state: "GRANTS_REVOKED",
      grantsActive: false,
      codeRuntimeActive: true,
      grantsRevokedAt: new Date(initialTime.getTime() + 60 * dayMs).toISOString(),
    });
    expect(() => result.controller.retireCode({ ...retirementEvidence, remainingRuntimeReferenceCount: 1 }))
      .toThrowError(expect.objectContaining({ code: "INVALID_LEGACY_EVIDENCE" }));
    expect(result.controller.retireCode(retirementEvidence)).toMatchObject({
      state: "CODE_RETIRED",
      grantsActive: false,
      codeRuntimeActive: false,
      financialEvidencePreserved: true,
      destructiveLedgerDeletionAllowed: false,
      codeRetiredAt: new Date(initialTime.getTime() + 60 * dayMs).toISOString(),
    });
    expect(result.controller.decideAccess("READ")).toMatchObject({ allowed: false, reason: "CODE_RETIRED" });
  });

  it("also refuses code retirement after the 90-day Read-only maximum", () => {
    const result = readOnlyController();
    result.moveToDay(60);
    result.controller.revokeGrants(retirementEvidence);
    result.moveToDay(91);
    expect(() => result.controller.retireCode(retirementEvidence))
      .toThrowError(expect.objectContaining({ code: "RELEASE_TRANSITION_DENIED" }));
  });

  it("is idempotent, rejects changed intent and keeps a hashed valid event chain", () => {
    const result = controllerWithClock();
    const approval = { approvalId: "approval-engineering", actorId: "actor-engineering", role: "ENGINEERING" as const };
    expect(result.controller.approve(approval).eventCount).toBe(1);
    expect(result.controller.approve(approval).eventCount).toBe(1);
    expect(() => result.controller.approve({ ...approval, actorId: "actor-other" }))
      .toThrowError(expect.objectContaining({ code: "RELEASE_COMMAND_CONFLICT" }));

    const ready = readOnlyController();
    const snapshot = ready.controller.activateReadOnly(readOnlyEvidence);
    expect(ready.controller.activateReadOnly(readOnlyEvidence)).toEqual(snapshot);
    expect(() => ready.controller.activateReadOnly({ ...readOnlyEvidence, observedAt: "2026-08-13T19:01:00.000Z" }))
      .toThrowError(expect.objectContaining({ code: "RELEASE_COMMAND_CONFLICT" }));
    expect(ready.controller.snapshot().eventChainValid).toBe(true);
    expect(ready.controller.entries().every(({ actorKeyHash }) => /^[a-f0-9]{64}$/.test(actorKeyHash))).toBe(true);
  });
});
