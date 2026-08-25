import { createHash, randomUUID } from "node:crypto";
import type { AdminIdentity, AdminResourceType, AuditRecord } from "./types.ts";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Audit evidence can cross a JSONB persistence boundary, which does not retain
 * JavaScript insertion order.  Sign a canonical representation so restoring a
 * valid record is independent of object-key ordering.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function recordDigest(base: Omit<AuditRecord, "recordHash">): string {
  return digest(canonicalJson(base));
}

export class ImmutableAdminAuditLog {
  private readonly records: AuditRecord[] = [];

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
  ) {}

  append(input: {
    identity: AdminIdentity;
    action: string;
    resourceType: AdminResourceType;
    resourceId: string;
    versionId: string;
    commandHash: string;
  }): AuditRecord {
    const previousHash = this.records.at(-1)?.recordHash ?? "0".repeat(64);
    const base = {
      sequence: this.records.length + 1,
      id: this.id(),
      actorId: input.identity.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      versionId: input.versionId,
      commandHash: input.commandHash,
      previousHash,
      occurredAt: this.now().toISOString(),
    };
    const record = { ...base, recordHash: recordDigest(base) };
    this.records.push(record);
    return structuredClone(record);
  }

  verify(): boolean {
    return this.records.every((record, index) => {
      const previousHash = index === 0 ? "0".repeat(64) : this.records[index - 1].recordHash;
      const { recordHash, ...base } = record;
      return record.previousHash === previousHash && recordDigest(base) === recordHash;
    });
  }

  snapshot(): ReadonlyArray<Readonly<AuditRecord>> {
    return structuredClone(this.records);
  }

  /** Hydration is accepted only when the append-only chain still verifies. */
  restore(records: ReadonlyArray<AuditRecord>): void {
    const candidate = structuredClone(records);
    const valid = candidate.every((record, index) => {
      const previousHash = index === 0 ? "0".repeat(64) : candidate[index - 1].recordHash;
      const { recordHash, ...base } = record;
      return record.sequence === index + 1 && record.previousHash === previousHash && recordDigest(base) === recordHash;
    });
    if (!valid) throw new TypeError("admin_audit_restore_chain_invalid");
    this.records.splice(0, this.records.length, ...candidate);
  }
}
