import { createHash } from "node:crypto";
import { type PublicReferenceCatalogSnapshot, type ReferenceModelDraft } from "./reference-catalog-importers.ts";

export type ReferenceCatalogDiff = Readonly<{
  providerModelId: string;
  kind: "ADDED" | "CHANGED" | "REMOVED";
  changedFields: readonly string[];
}>;

export type ReferenceCatalogSnapshotRecord = PublicReferenceCatalogSnapshot & Readonly<{
  baselineSnapshotId: string | null;
  diffSha256: string;
  diff: readonly ReferenceCatalogDiff[];
}>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function sha256(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function changedFields(before: ReferenceModelDraft, after: ReferenceModelDraft): string[] {
  return Object.keys(after).filter((key) => sha256(before[key as keyof ReferenceModelDraft]) !== sha256(after[key as keyof ReferenceModelDraft])).sort();
}

/**
 * Append-only local projection of publicly observed catalog snapshots.
 * It intentionally contains neither credentials nor account availability and
 * never produces a runtime route or a customer-visible offer.
 */
export class InMemoryReferenceCatalogStore {
  private readonly records = new Map<string, ReferenceCatalogSnapshotRecord>();

  prepare(snapshot: PublicReferenceCatalogSnapshot, baselineSnapshotId: string | null = null): ReferenceCatalogSnapshotRecord {
    if (this.records.has(snapshot.id)) throw new Error(`reference_catalog_snapshot_already_staged:${snapshot.id}`);
    const baseline = baselineSnapshotId === null ? this.latest(snapshot.providerId) : this.require(baselineSnapshotId);
    if (baseline && baseline.providerId !== snapshot.providerId) throw new Error("reference_catalog_snapshot_baseline_mismatch");
    const diff = this.diff(baseline?.models ?? [], snapshot.models);
    return { ...structuredClone(snapshot), models: structuredClone(snapshot.models), baselineSnapshotId: baseline?.id ?? null, diff, diffSha256: sha256(diff) };
  }

  commit(record: ReferenceCatalogSnapshotRecord): ReferenceCatalogSnapshotRecord {
    if (this.records.has(record.id)) throw new Error(`reference_catalog_snapshot_already_staged:${record.id}`);
    this.records.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  stage(snapshot: PublicReferenceCatalogSnapshot, baselineSnapshotId: string | null = null): ReferenceCatalogSnapshotRecord {
    return this.commit(this.prepare(snapshot, baselineSnapshotId));
  }

  list(): ReferenceCatalogSnapshotRecord[] {
    return structuredClone([...this.records.values()].sort((left, right) => left.observedAt.localeCompare(right.observedAt)));
  }

  get(snapshotId: string): ReferenceCatalogSnapshotRecord {
    return structuredClone(this.require(snapshotId));
  }

  restore(records: readonly ReferenceCatalogSnapshotRecord[]): void {
    this.records.clear();
    for (const record of [...records].sort((left, right) => left.observedAt.localeCompare(right.observedAt))) {
      const rebuilt = this.stage({
        id: record.id, providerId: record.providerId, observedAt: record.observedAt, sourceUrls: record.sourceUrls,
        rawPayloadSha256: record.rawPayloadSha256, manifestSha256: record.manifestSha256, parserVersion: record.parserVersion,
        sourceScope: record.sourceScope, models: record.models,
      }, record.baselineSnapshotId);
      if (rebuilt.diffSha256 !== record.diffSha256) throw new TypeError("reference_catalog_snapshot_restore_hash_mismatch");
    }
  }

  private latest(providerId: string): ReferenceCatalogSnapshotRecord | null {
    return this.list().filter((record) => record.providerId === providerId).at(-1) ?? null;
  }

  private require(snapshotId: string): ReferenceCatalogSnapshotRecord {
    const record = this.records.get(snapshotId);
    if (!record) throw new Error(`reference_catalog_snapshot_not_found:${snapshotId}`);
    return structuredClone(record);
  }

  private diff(previous: readonly ReferenceModelDraft[], next: readonly ReferenceModelDraft[]): ReferenceCatalogDiff[] {
    const before = new Map(previous.map((model) => [model.providerModelId, model]));
    const after = new Map(next.map((model) => [model.providerModelId, model]));
    const result: ReferenceCatalogDiff[] = [];
    for (const [providerModelId, model] of after) {
      const previousModel = before.get(providerModelId);
      if (!previousModel) result.push({ providerModelId, kind: "ADDED", changedFields: [] });
      else {
        const fields = changedFields(previousModel, model);
        if (fields.length) result.push({ providerModelId, kind: "CHANGED", changedFields: fields });
      }
    }
    for (const providerModelId of before.keys()) if (!after.has(providerModelId)) result.push({ providerModelId, kind: "REMOVED", changedFields: [] });
    return result.sort((left, right) => left.providerModelId.localeCompare(right.providerModelId));
  }
}
