import { createHash, randomUUID } from "node:crypto";
import { requireAdminPermission } from "./authorization.ts";
import { ImmutableAdminAuditLog } from "./audit.ts";
import {
  AdminControlPlaneError,
  type AdminChangeVersion,
  type AdminIdentity,
  type AdminResourceType,
} from "./types.ts";

type CommandRecord = { intentHash: string; result: AdminChangeVersion };
type PublishHandler = (change: Readonly<AdminChangeVersion>) => void;
export type VersionedAdminChangeState = {
  changes: AdminChangeVersion[];
  commands: Array<{ commandId: string; intentHash: string; result: AdminChangeVersion }>;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return typeof value === "bigint" ? value.toString() : value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function rejectSecretFields(value: unknown, path = "payload"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/(secret|password|api.?key|access.?token|private.?key|credential.?value)/i.test(key)) {
      throw new AdminControlPlaneError(
        "VALIDATION_FAILED",
        `Secret-like field ${path}.${key} is prohibited; use the write-only credential flow.`,
      );
    }
    rejectSecretFields(item, `${path}.${key}`);
  }
}

function requireEvidence(evidenceHash: string): void {
  if (!/^[a-f0-9]{64}$/.test(evidenceHash)) {
    throw new AdminControlPlaneError("VALIDATION_FAILED", "Evidence must be a lowercase SHA-256 hash.");
  }
}

export class VersionedAdminChangeService {
  private readonly changes = new Map<string, AdminChangeVersion>();
  private readonly resourceVersions = new Map<string, string[]>();
  private readonly commands = new Map<string, CommandRecord>();

  constructor(
    readonly audit: ImmutableAdminAuditLog,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
    private readonly onPublish: PublishHandler = () => undefined,
  ) {}

  createDraft(identity: AdminIdentity, commandId: string, input: {
    resourceType: AdminResourceType;
    resourceId: string;
    payload: Record<string, unknown>;
    reasonCode: string;
  }): AdminChangeVersion {
    requireAdminPermission(identity, "DRAFT", input.resourceType);
    rejectSecretFields(input.payload);
    if (!input.resourceId || !input.reasonCode) throw new TypeError("Resource identity and reason code are required.");
    return this.execute(commandId, { action: "DRAFT", identity: identity.actorId, input }, () => {
      const key = this.resourceKey(input.resourceType, input.resourceId);
      const ids = this.resourceVersions.get(key) ?? [];
      const previous = ids.length ? this.changes.get(ids.at(-1)!)! : null;
      const timestamp = this.now().toISOString();
      const change: AdminChangeVersion = {
        id: this.id(),
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        version: (previous?.version ?? 0) + 1,
        state: "DRAFT",
        payload: structuredClone(input.payload),
        payloadHash: hash(input.payload),
        makerId: identity.actorId,
        validatorId: null,
        simulatorId: null,
        approverId: null,
        publisherId: null,
        validationEvidenceHash: null,
        simulationEvidenceHash: null,
        approvalEvidenceHash: null,
        supersedesVersionId: previous?.id ?? null,
        rollbackOfVersionId: null,
        reasonCode: input.reasonCode,
        createdAt: timestamp,
        updatedAt: timestamp,
        publishedAt: null,
      };
      this.changes.set(change.id, change);
      this.resourceVersions.set(key, [...ids, change.id]);
      this.appendAudit(identity, "CHANGE_DRAFTED", change, commandId, input);
      return change;
    });
  }

  validate(identity: AdminIdentity, commandId: string, changeId: string, evidenceHash: string): AdminChangeVersion {
    requireAdminPermission(identity, "VALIDATE");
    requireEvidence(evidenceHash);
    this.validateResourcePayload(this.require(changeId));
    return this.transition(identity, commandId, changeId, "DRAFT", "VALIDATED", {
      validatorId: identity.actorId,
      validationEvidenceHash: evidenceHash,
    });
  }

  simulate(identity: AdminIdentity, commandId: string, changeId: string, evidenceHash: string): AdminChangeVersion {
    requireAdminPermission(identity, "SIMULATE");
    requireEvidence(evidenceHash);
    return this.transition(identity, commandId, changeId, "VALIDATED", "SIMULATED", {
      simulatorId: identity.actorId,
      simulationEvidenceHash: evidenceHash,
    });
  }

  approve(identity: AdminIdentity, commandId: string, changeId: string, evidenceHash: string): AdminChangeVersion {
    const change = this.require(changeId);
    requireAdminPermission(identity, "APPROVE", change.resourceType);
    requireEvidence(evidenceHash);
    if (identity.actorId === change.makerId) {
      throw new AdminControlPlaneError("MAKER_CHECKER_REQUIRED", "Maker cannot approve the same sensitive change.");
    }
    return this.transition(identity, commandId, changeId, "SIMULATED", "APPROVED", {
      approverId: identity.actorId,
      approvalEvidenceHash: evidenceHash,
    });
  }

  publish(identity: AdminIdentity, commandId: string, changeId: string): AdminChangeVersion {
    requireAdminPermission(identity, "PUBLISH");
    const current = this.require(changeId);
    if (!current.approverId || current.approverId === current.makerId) {
      throw new AdminControlPlaneError("MAKER_CHECKER_REQUIRED", "Publish requires recorded independent approval.");
    }
    return this.execute(commandId, { action: "PUBLISH", identity: identity.actorId, changeId }, () => {
      const change = this.requireMutable(changeId, "APPROVED");
      this.onPublish(structuredClone(change));
      change.state = "PUBLISHED";
      change.publisherId = identity.actorId;
      change.publishedAt = this.now().toISOString();
      change.updatedAt = change.publishedAt;
      this.appendAudit(identity, "CHANGE_PUBLISHED", change, commandId, { changeId });
      return change;
    });
  }

  reject(identity: AdminIdentity, commandId: string, changeId: string, evidenceHash: string): AdminChangeVersion {
    requireAdminPermission(identity, "APPROVE");
    requireEvidence(evidenceHash);
    const change = this.require(changeId);
    if (["PUBLISHED", "REJECTED"].includes(change.state)) {
      throw new AdminControlPlaneError("ILLEGAL_CHANGE_TRANSITION", "Published or rejected versions are immutable.");
    }
    return this.execute(commandId, { action: "REJECT", identity: identity.actorId, changeId, evidenceHash }, () => {
      const mutable = this.require(changeId);
      mutable.state = "REJECTED";
      mutable.approverId = identity.actorId;
      mutable.approvalEvidenceHash = evidenceHash;
      mutable.updatedAt = this.now().toISOString();
      this.appendAudit(identity, "CHANGE_REJECTED", mutable, commandId, { changeId, evidenceHash });
      return mutable;
    });
  }

  createRollbackDraft(identity: AdminIdentity, commandId: string, publishedVersionId: string, reasonCode: string): AdminChangeVersion {
    const target = this.require(publishedVersionId);
    if (target.state !== "PUBLISHED") {
      throw new AdminControlPlaneError("ILLEGAL_CHANGE_TRANSITION", "Rollback targets must be published immutable versions.");
    }
    const draft = this.createDraft(identity, commandId, {
      resourceType: target.resourceType,
      resourceId: target.resourceId,
      payload: this.compensatingPayload(target),
      reasonCode,
    });
    this.changes.get(draft.id)!.rollbackOfVersionId = target.id;
    return this.require(draft.id);
  }

  get(identity: AdminIdentity, changeId: string): AdminChangeVersion {
    requireAdminPermission(identity, "READ");
    return structuredClone(this.require(changeId));
  }

  /** Server workflow hook; PUBLISH authorization is sufficient and no payload is mutated. */
  inspectForPublish(identity: AdminIdentity, changeId: string): AdminChangeVersion {
    requireAdminPermission(identity, "PUBLISH");
    return structuredClone(this.require(changeId));
  }

  list(identity: AdminIdentity): ReadonlyArray<Readonly<AdminChangeVersion>> {
    requireAdminPermission(identity, "READ");
    return structuredClone([...this.changes.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
  }

  published(identity: AdminIdentity, resourceType: AdminResourceType, resourceId: string): AdminChangeVersion | null {
    requireAdminPermission(identity, "READ");
    const ids = this.resourceVersions.get(this.resourceKey(resourceType, resourceId)) ?? [];
    const result = ids.map((id) => this.changes.get(id)!)
      .filter(({ state }) => state === "PUBLISHED")
      .sort((left, right) => right.version - left.version)[0];
    return result ? structuredClone(result) : null;
  }

  snapshotState(): VersionedAdminChangeState {
    return {
      changes: structuredClone([...this.changes.values()]),
      commands: structuredClone([...this.commands.entries()].map(([commandId, value]) => ({ commandId, ...value }))),
    };
  }

  /** Rebuilds derived indexes without replaying commands or publish side effects. */
  restoreState(state: VersionedAdminChangeState): void {
    const changes = structuredClone(state.changes);
    const commands = structuredClone(state.commands);
    const ids = new Set<string>();
    const resourceVersions = new Map<string, string[]>();
    for (const change of changes) {
      if (!change.id || ids.has(change.id) || change.version < 1) throw new TypeError("admin_change_restore_invalid");
      ids.add(change.id);
      const key = this.resourceKey(change.resourceType, change.resourceId);
      resourceVersions.set(key, [...(resourceVersions.get(key) ?? []), change.id]);
    }
    for (const [key, versionIds] of resourceVersions) {
      const versions = versionIds.map((id) => changes.find((change) => change.id === id)!.version);
      if (new Set(versions).size !== versions.length) throw new TypeError(`admin_change_restore_duplicate_version:${key}`);
    }
    if (new Set(commands.map(({ commandId }) => commandId)).size !== commands.length) throw new TypeError("admin_change_restore_duplicate_command");
    this.changes.clear(); this.resourceVersions.clear(); this.commands.clear();
    for (const change of changes) this.changes.set(change.id, change);
    for (const [key, versionIds] of resourceVersions) this.resourceVersions.set(key, versionIds);
    for (const command of commands) this.commands.set(command.commandId, { intentHash: command.intentHash, result: command.result });
  }

  private transition(
    identity: AdminIdentity,
    commandId: string,
    changeId: string,
    expected: AdminChangeVersion["state"],
    next: AdminChangeVersion["state"],
    update: Partial<AdminChangeVersion>,
  ): AdminChangeVersion {
    return this.execute(commandId, { action: next, identity: identity.actorId, changeId, update }, () => {
      const change = this.requireMutable(changeId, expected);
      Object.assign(change, structuredClone(update));
      change.state = next;
      change.updatedAt = this.now().toISOString();
      this.appendAudit(identity, `CHANGE_${next}`, change, commandId, update);
      return change;
    });
  }

  private compensatingPayload(target: AdminChangeVersion): Record<string, unknown> {
    if (target.resourceType !== "FINANCIAL_ADJUSTMENT") return structuredClone(target.payload);
    const direction = target.payload.direction;
    if (direction !== "CREDIT" && direction !== "DEBIT") {
      throw new AdminControlPlaneError("VALIDATION_FAILED", "Financial adjustment direction is invalid.");
    }
    return { ...structuredClone(target.payload), direction: direction === "CREDIT" ? "DEBIT" : "CREDIT" };
  }

  private validateResourcePayload(change: AdminChangeVersion): void {
    const payload = change.payload;
    const fail = (message: string): never => {
      throw new AdminControlPlaneError("VALIDATION_FAILED", message);
    };
    if (change.resourceType === "ROUTE_CONTROL") {
      if (typeof payload.enabled !== "boolean") fail("Route control requires an enabled boolean.");
      if (payload.enabled === true && (typeof payload.reasonCode !== "string" || payload.reasonCode.length < 3)) {
        fail("An enabled route kill switch requires a reason code.");
      }
    } else if (change.resourceType === "TREASURY_POLICY") {
      for (const field of ["safetyReserveAtomic", "perJobAtomic", "dailyAtomic", "monthlyAtomic"] as const) {
        if (typeof payload[field] !== "string" || !/^[1-9]\d*$/.test(payload[field])) {
          fail(`Treasury ${field} must be a positive integer string.`);
        }
      }
    } else if (change.resourceType === "PRICING_POLICY") {
      if (!Number.isInteger(payload.customerCredits) || Number(payload.customerCredits) <= 0) {
        fail("Pricing policy requires positive whole customer credits.");
      }
      if (!Number.isInteger(payload.hardFloorMarginBps)
        || Number(payload.hardFloorMarginBps) < 0
        || Number(payload.hardFloorMarginBps) >= 10_000) {
        fail("Pricing hard floor must be an integer from 0 through 9999 bps.");
      }
    } else if (change.resourceType === "FINANCIAL_ADJUSTMENT") {
      if (payload.direction !== "CREDIT" && payload.direction !== "DEBIT") fail("Adjustment direction is invalid.");
      if (!Number.isInteger(payload.credits) || Number(payload.credits) <= 0 || typeof payload.ownerId !== "string") {
        fail("Financial adjustment requires owner and positive whole credits.");
      }
    } else if (change.resourceType === "USER_ANONYMIZATION") {
      if (typeof payload.userId !== "string" || typeof payload.retentionPolicyVersionId !== "string") {
        fail("Anonymization requires user and retention-policy version identities.");
      }
    } else if (change.resourceType === "CATALOG_SNAPSHOT") {
      for (const field of ["providerId", "snapshotHash", "diffHash"] as const) {
        if (typeof payload[field] !== "string" || (field !== "providerId" && !/^[a-f0-9]{64}$/.test(payload[field] as string))) {
          fail(`Catalog snapshot ${field} is invalid.`);
        }
      }
      if (payload.scope !== "LOCAL_TEST_ONLY") fail("This local catalog workflow only accepts LOCAL_TEST_ONLY snapshots.");
    } else if (change.resourceType === "REFERENCE_CATALOG_SNAPSHOT") {
      for (const field of ["id", "providerId", "observedAt", "parserVersion", "rawPayloadSha256", "manifestSha256", "evidenceSha256"] as const) {
        if (typeof payload[field] !== "string" || payload[field].length === 0) fail(`Reference catalog snapshot ${field} is required.`);
      }
      for (const field of ["rawPayloadSha256", "manifestSha256", "evidenceSha256"] as const) {
        if (!/^[a-f0-9]{64}$/.test(payload[field] as string)) fail(`Reference catalog snapshot ${field} must be a SHA-256 hash.`);
      }
      if (Number.isNaN(new Date(payload.observedAt as string).getTime())) fail("Reference catalog snapshot observedAt is invalid.");
      if (payload.sourceScope !== "PUBLIC_REFERENCE") fail("Reference catalog snapshots must be scoped to PUBLIC_REFERENCE.");
      if (!Array.isArray(payload.sourceUrls) || payload.sourceUrls.length === 0 || payload.sourceUrls.some((url) => {
        try { return typeof url !== "string" || new URL(url).protocol !== "https:"; } catch { return true; }
      })) fail("Reference catalog snapshot sourceUrls must be non-empty HTTPS URLs.");
    } else if (["PROVIDER", "PROVIDER_ACCOUNT", "REFERENCE_MODEL", "ROUTE_CANDIDATE", "RELEASE_BUNDLE"].includes(change.resourceType)) {
      if (typeof payload.evidenceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(payload.evidenceSha256)) {
        fail("Control-plane changes require immutable source evidence.");
      }
      if (change.resourceType === "RELEASE_BUNDLE") {
        for (const field of ["id", "scope", "effectiveAt", "financeSimulationEvidenceSha256", "securityEvidenceSha256", "canaryEvidenceSha256", "makerId", "checkerId"] as const) {
          if (typeof payload[field] !== "string" || payload[field].length === 0) fail(`Release bundle ${field} is required.`);
        }
        if (payload.makerId === payload.checkerId || !Array.isArray(payload.offers) || payload.offers.length === 0) fail("Release bundle requires distinct maker/checker identities and offers.");
      }
    } else if (change.resourceType === "PUBLISHED_OFFER") {
      fail("Published offers are created only by an approved atomic release bundle.");
    }
  }

  private execute(commandId: string, intent: unknown, work: () => AdminChangeVersion): AdminChangeVersion {
    if (commandId.length < 8 || commandId.length > 200) throw new TypeError("Admin command ID must contain 8 to 200 characters.");
    const intentHash = hash(intent);
    const existing = this.commands.get(commandId);
    if (existing) {
      if (existing.intentHash !== intentHash) {
        throw new AdminControlPlaneError("ADMIN_COMMAND_CONFLICT", "Admin command ID was reused with different intent.");
      }
      return structuredClone(existing.result);
    }
    const result = structuredClone(work());
    this.commands.set(commandId, { intentHash, result });
    return structuredClone(result);
  }

  private appendAudit(
    identity: AdminIdentity,
    action: string,
    change: AdminChangeVersion,
    commandId: string,
    intent: unknown,
  ): void {
    this.audit.append({
      identity,
      action,
      resourceType: change.resourceType,
      resourceId: change.resourceId,
      versionId: change.id,
      commandHash: hash({ commandId, intent }),
    });
  }

  private resourceKey(resourceType: AdminResourceType, resourceId: string): string {
    return JSON.stringify([resourceType, resourceId]);
  }

  private require(changeId: string): AdminChangeVersion {
    const change = this.changes.get(changeId);
    if (!change) throw new AdminControlPlaneError("CHANGE_NOT_FOUND", "Admin change does not exist.");
    return change;
  }

  private requireMutable(changeId: string, expectedState?: AdminChangeVersion["state"]): AdminChangeVersion {
    const change = this.require(changeId);
    if (change.state === "PUBLISHED" || change.state === "REJECTED") {
      throw new AdminControlPlaneError("IMMUTABLE_VERSION", "Published and rejected versions cannot be mutated.");
    }
    if (expectedState && change.state !== expectedState) {
      throw new AdminControlPlaneError(
        "ILLEGAL_CHANGE_TRANSITION",
        `Change must be ${expectedState} before it can advance.`,
      );
    }
    return change;
  }
}
