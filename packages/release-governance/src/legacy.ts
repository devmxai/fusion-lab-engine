import { releaseEvidenceHash } from "./canonical.ts";
import type {
  LegacyAccessDecision,
  LegacyApprovalRole,
  LegacyReadOnlyEvidence,
  LegacyRetirementEvent,
  LegacyRetirementEvidence,
  LegacyRetirementPolicyVersion,
  LegacyRetirementSnapshot,
} from "./types.ts";
import { ReleaseGovernanceError } from "./types.ts";

const ROLES: readonly LegacyApprovalRole[] = ["ENGINEERING", "SECURITY", "FINANCE", "SUPPORT"];
const SEQUENCE = ["ACTIVE", "READ_ONLY", "GRANTS_REVOKED", "CODE_RETIRED"] as const;

function exactList<T>(actual: readonly T[], expected: readonly T[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function validatePolicy(policy: LegacyRetirementPolicyVersion): void {
  if (!policy.id
    || !policy.legacySystemId
    || !policy.replacementReleasePolicyVersionId
    || !Number.isInteger(policy.version)
    || policy.version <= 0
    || policy.lifecycle !== "PUBLISHED"
    || policy.minimumReadOnlyDays !== 60
    || policy.maximumReadOnlyDays !== 90
    || !exactList(policy.requiredApprovalRoles, ROLES)
    || !exactList(policy.sequence, SEQUENCE)
    || policy.requireSingleReplacementWriter !== true
    || policy.requireZeroUnexplainedLedgerDrift !== true
    || policy.financialEvidenceRetentionMode !== "IMMUTABLE_LEGAL_RETENTION"
    || policy.destructiveLedgerDeletionAllowed !== false
    || policy.authority !== "LOCAL_SIMULATION_ONLY"
    || policy.productionMutationAllowed !== false
    || Number.isNaN(Date.parse(policy.publishedAt))) {
    throw new ReleaseGovernanceError("INVALID_LEGACY_POLICY", "Legacy Policy must pin Read-only 60–90 days, grants-before-code retirement and immutable financial evidence.");
  }
}

function validDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

export class InMemoryLegacyRetirementController {
  private state: LegacyRetirementSnapshot["state"] = "ACTIVE";
  private readonly approvals = new Map<LegacyApprovalRole, { approvalId: string; actorId: string; intentHash: string }>();
  private readonly commands = new Map<string, string>();
  private readonly events: LegacyRetirementEvent[] = [];
  private readOnlyStartedAt: Date | null = null;
  private grantsRevokedAt: Date | null = null;
  private codeRetiredAt: Date | null = null;

  constructor(
    private readonly policy: LegacyRetirementPolicyVersion,
    private readonly makerId: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    validatePolicy(policy);
    if (!makerId) throw new ReleaseGovernanceError("LEGACY_APPROVAL_DENIED", "Legacy retirement requires a named maker.");
  }

  approve(input: { approvalId: string; actorId: string; role: LegacyApprovalRole }): LegacyRetirementSnapshot {
    const intentHash = releaseEvidenceHash(input);
    const key = `approval:${input.approvalId}`;
    const previous = this.commands.get(key);
    if (previous) {
      if (previous === intentHash) return this.snapshot();
      throw new ReleaseGovernanceError("RELEASE_COMMAND_CONFLICT", "Legacy approval ID was reused with different intent.");
    }
    if (this.state !== "ACTIVE"
      || !input.approvalId
      || !input.actorId
      || input.actorId === this.makerId
      || !this.policy.requiredApprovalRoles.includes(input.role)
      || this.approvals.has(input.role)
      || [...this.approvals.values()].some(({ actorId }) => actorId === input.actorId)) {
      throw new ReleaseGovernanceError("LEGACY_APPROVAL_DENIED", "Engineering, Security, Finance and Support approvals require distinct actors independent from the maker.");
    }
    this.approvals.set(input.role, { approvalId: input.approvalId, actorId: input.actorId, intentHash });
    this.commands.set(key, intentHash);
    this.appendEvent(`legacy-event:${input.approvalId}`, "APPROVED", input.actorId);
    return this.snapshot();
  }

  activateReadOnly(evidence: LegacyReadOnlyEvidence): LegacyRetirementSnapshot {
    const key = `read-only:${evidence.evidenceId}`;
    const intentHash = releaseEvidenceHash(evidence);
    const previous = this.commands.get(key);
    if (previous) {
      if (previous === intentHash) return this.snapshot();
      throw new ReleaseGovernanceError("RELEASE_COMMAND_CONFLICT", "Read-only Evidence ID was reused with different intent.");
    }
    if (this.state !== "ACTIVE" || this.policy.requiredApprovalRoles.some((role) => !this.approvals.has(role))) {
      throw new ReleaseGovernanceError("RELEASE_TRANSITION_DENIED", "Read-only requires the active legacy system and all separated approvals.");
    }
    if (!evidence.evidenceId
      || evidence.policyVersionId !== this.policy.id
      || !validDigest(evidence.replacementReleaseDigest)
      || !evidence.replacementIsSingleWriter
      || !evidence.ledgerProjectionReconciled
      || evidence.unexplainedLedgerDriftCount !== 0
      || !evidence.inFlightOperationsReconciled
      || !evidence.customerExportVerified
      || !evidence.supportRunbookVerified
      || !evidence.rollbackOrForwardFixVerified
      || evidence.financialEvidencePreserved !== true
      || evidence.localFixtureOnly !== true
      || evidence.productionMutationPerformed !== false
      || Number.isNaN(Date.parse(evidence.observedAt))) {
      throw new ReleaseGovernanceError("INVALID_LEGACY_EVIDENCE", "Read-only cutover requires one replacement writer, reconciled Ledger/in-flight work, export, support and rollback evidence.");
    }
    this.commands.set(key, intentHash);
    this.state = "READ_ONLY";
    this.readOnlyStartedAt = this.now();
    this.appendEvent(`legacy-event:${evidence.evidenceId}`, "READ_ONLY_ACTIVATED", "system:legacy-controller");
    return this.snapshot();
  }

  revokeGrants(evidence: LegacyRetirementEvidence): LegacyRetirementSnapshot {
    const key = `revoke-grants:${evidence.evidenceId}`;
    const intentHash = releaseEvidenceHash(evidence);
    const previous = this.commands.get(key);
    if (previous) {
      if (previous === intentHash) return this.snapshot();
      throw new ReleaseGovernanceError("RELEASE_COMMAND_CONFLICT", "Grant-revocation Evidence ID was reused with different intent.");
    }
    this.validateRetirementEvidence(evidence);
    if (this.state !== "READ_ONLY" || !this.readOnlyStartedAt) {
      throw new ReleaseGovernanceError("RELEASE_TRANSITION_DENIED", "Legacy grants may be revoked only after the Read-only window.");
    }
    const days = this.readOnlyDays();
    if (days < this.policy.minimumReadOnlyDays || days > this.policy.maximumReadOnlyDays) {
      throw new ReleaseGovernanceError("RELEASE_TRANSITION_DENIED", "Legacy grants retirement must occur inside the published 60–90 day Read-only window.");
    }
    this.commands.set(key, intentHash);
    this.state = "GRANTS_REVOKED";
    this.grantsRevokedAt = this.now();
    this.appendEvent(`legacy-event:${evidence.evidenceId}:grants`, "GRANTS_REVOKED", "system:legacy-controller");
    return this.snapshot();
  }

  retireCode(evidence: LegacyRetirementEvidence): LegacyRetirementSnapshot {
    const key = `retire-code:${evidence.evidenceId}`;
    const intentHash = releaseEvidenceHash(evidence);
    const previous = this.commands.get(key);
    if (previous) {
      if (previous === intentHash) return this.snapshot();
      throw new ReleaseGovernanceError("RELEASE_COMMAND_CONFLICT", "Code-retirement Evidence ID was reused with different intent.");
    }
    this.validateRetirementEvidence(evidence);
    if (this.state !== "GRANTS_REVOKED") {
      throw new ReleaseGovernanceError("RELEASE_TRANSITION_DENIED", "Legacy code retirement requires grants to be revoked first.");
    }
    const days = this.readOnlyDays();
    if (!this.readOnlyStartedAt || days < this.policy.minimumReadOnlyDays || days > this.policy.maximumReadOnlyDays) {
      throw new ReleaseGovernanceError("RELEASE_TRANSITION_DENIED", "Legacy code retirement must remain inside the published 60–90 day Read-only window.");
    }
    if (!validDigest(evidence.archivedArtifactDigest)
      || evidence.remainingRuntimeReferenceCount !== 0
      || !evidence.dependencyAndSecretScanPassed
      || !evidence.rollbackOrForwardFixVerified) {
      throw new ReleaseGovernanceError("INVALID_LEGACY_EVIDENCE", "Code retirement requires archived artifact, zero runtime references, scans and recovery evidence.");
    }
    this.commands.set(key, intentHash);
    this.state = "CODE_RETIRED";
    this.codeRetiredAt = this.now();
    this.appendEvent(`legacy-event:${evidence.evidenceId}:code`, "CODE_RETIRED", "system:legacy-controller");
    return this.snapshot();
  }

  decideAccess(action: LegacyAccessDecision["action"]): LegacyAccessDecision {
    if (action === "DELETE_FINANCIAL_EVIDENCE") {
      return { state: this.state, action, allowed: false, reason: "FINANCIAL_EVIDENCE_IMMUTABLE", productionMutationPerformed: false };
    }
    if (this.state === "CODE_RETIRED") return { state: this.state, action, allowed: false, reason: "CODE_RETIRED", productionMutationPerformed: false };
    if (this.state === "GRANTS_REVOKED") return { state: this.state, action, allowed: false, reason: "GRANTS_REVOKED", productionMutationPerformed: false };
    if (this.state === "READ_ONLY") {
      const allowed = action === "READ" || action === "EXPORT";
      return { state: this.state, action, allowed, reason: allowed ? "READ_ONLY_ACCESS" : "WRITE_DISABLED", productionMutationPerformed: false };
    }
    return { state: this.state, action, allowed: true, reason: "ACTIVE", productionMutationPerformed: false };
  }

  snapshot(): LegacyRetirementSnapshot {
    return {
      policyVersionId: this.policy.id,
      legacySystemId: this.policy.legacySystemId,
      state: this.state,
      approvalRoles: [...this.approvals.keys()].sort(),
      readOnlyStartedAt: this.readOnlyStartedAt?.toISOString() ?? null,
      grantsRevokedAt: this.grantsRevokedAt?.toISOString() ?? null,
      codeRetiredAt: this.codeRetiredAt?.toISOString() ?? null,
      readOnlyDayCount: this.readOnlyDays(),
      readAllowed: this.state === "ACTIVE" || this.state === "READ_ONLY",
      writeAllowed: this.state === "ACTIVE",
      grantsActive: this.state === "ACTIVE" || this.state === "READ_ONLY",
      codeRuntimeActive: this.state !== "CODE_RETIRED",
      financialEvidencePreserved: true,
      destructiveLedgerDeletionAllowed: false,
      eventCount: this.events.length,
      eventChainValid: this.verifyEventChain(),
      productionMutationPerformed: false,
    };
  }

  entries(): readonly LegacyRetirementEvent[] {
    return structuredClone(this.events);
  }

  private validateRetirementEvidence(evidence: LegacyRetirementEvidence): void {
    const counts = [
      evidence.legacyWriteCountDuringReadOnly,
      evidence.unexplainedLedgerDriftCount,
      evidence.unresolvedInFlightOperationCount,
      evidence.unresolvedSupportExceptionCount,
      evidence.remainingRuntimeReferenceCount,
    ];
    if (!evidence.evidenceId
      || evidence.policyVersionId !== this.policy.id
      || counts.some((value) => !Number.isInteger(value) || value < 0)
      || evidence.legacyWriteCountDuringReadOnly !== 0
      || evidence.unexplainedLedgerDriftCount !== 0
      || evidence.unresolvedInFlightOperationCount !== 0
      || evidence.unresolvedSupportExceptionCount !== 0
      || !evidence.customerExportVerified
      || !evidence.retentionInventoryVerified
      || !evidence.grantsInventoryVerified
      || evidence.financialEvidencePreserved !== true
      || evidence.destructiveLedgerDeletionPerformed !== false
      || evidence.localFixtureOnly !== true
      || evidence.productionMutationPerformed !== false
      || Number.isNaN(Date.parse(evidence.observedAt))) {
      throw new ReleaseGovernanceError("INVALID_LEGACY_EVIDENCE", "Legacy retirement requires zero writes/drift/open work, verified export/retention/grants and preserved financial evidence.");
    }
  }

  private readOnlyDays(): number {
    if (!this.readOnlyStartedAt) return 0;
    return Math.floor((this.now().getTime() - this.readOnlyStartedAt.getTime()) / 86_400_000);
  }

  private appendEvent(eventId: string, type: LegacyRetirementEvent["type"], actorId: string): void {
    const previousEventHash = this.events.at(-1)?.eventHash ?? null;
    const intent = {
      sequence: this.events.length + 1,
      eventId,
      type,
      actorKeyHash: releaseEvidenceHash(actorId),
      occurredAt: this.now().toISOString(),
      previousEventHash,
    };
    this.events.push({ ...intent, eventHash: releaseEvidenceHash(intent) });
  }

  private verifyEventChain(): boolean {
    let prior: string | null = null;
    return this.events.every((event, index) => {
      const { eventHash, ...intent } = event;
      const valid = event.sequence === index + 1 && event.previousEventHash === prior && eventHash === releaseEvidenceHash(intent);
      prior = eventHash;
      return valid;
    });
  }
}
