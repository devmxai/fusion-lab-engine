import { createHash } from "node:crypto";
import { z } from "zod";
import { CatalogScopeSchema, ProviderRouteManifestSchema, type ProviderRouteManifest } from "../../contracts/src/provider-catalog.ts";

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/i);
export const CatalogSnapshotInputSchema = z.object({
  snapshotId: z.string().min(1).max(200),
  providerId: z.string().min(1).max(200),
  scope: CatalogScopeSchema,
  sourceLabel: z.string().min(1).max(200),
  observedAt: z.string().datetime({ offset: true }),
  rawPayloadSha256: HashSchema,
  parserVersion: z.string().min(1).max(80),
  routes: z.array(ProviderRouteManifestSchema).min(1).max(500),
}).strict().superRefine((value, context) => {
  if (value.routes.some((route) => route.providerId !== value.providerId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["routes"], message: "snapshot routes must share its provider" });
  }
  if (value.routes.some((route) => route.certification.scope !== value.scope)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["routes"], message: "snapshot routes must share its scope" });
  }
});

export type CatalogSnapshotInput = z.infer<typeof CatalogSnapshotInputSchema>;
export type CatalogRouteDiff = { routeId: string; kind: "ADDED" | "REMOVED" | "CHANGED"; changedFields: string[] };
export type CatalogSnapshotRecord = CatalogSnapshotInput & { manifestSha256: string; diffSha256: string; baselineSnapshotId: string | null; diff: CatalogRouteDiff[] };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  return value;
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex"); }
function routeShape(route: ProviderRouteManifest) {
  return { providerModelId: route.providerModel.providerModelId, capability: route.capability, costGuard: route.costGuard, providerCostVersion: route.providerCostVersion, certification: route.certification };
}

export class InMemoryCatalogSnapshotStore {
  private readonly records = new Map<string, CatalogSnapshotRecord>();

  /** Validates and calculates a snapshot without changing store state. */
  prepare(input: CatalogSnapshotInput, baselineSnapshotId: string | null = null): CatalogSnapshotRecord {
    const parsed = CatalogSnapshotInputSchema.parse(input);
    if (this.records.has(parsed.snapshotId)) throw new Error(`catalog_snapshot_already_staged:${parsed.snapshotId}`);
    const baseline = baselineSnapshotId ? this.require(baselineSnapshotId) : null;
    if (baseline && (baseline.providerId !== parsed.providerId || baseline.scope !== parsed.scope)) throw new Error("catalog_snapshot_baseline_mismatch");
    const diff = this.diff(baseline?.routes ?? [], parsed.routes);
    return { ...structuredClone(parsed), routes: structuredClone(parsed.routes), manifestSha256: hash(parsed.routes), diffSha256: hash(diff), baselineSnapshotId, diff };
  }

  /** Commits a record prepared against the current store state. */
  commit(record: CatalogSnapshotRecord): CatalogSnapshotRecord {
    if (this.records.has(record.snapshotId)) throw new Error(`catalog_snapshot_already_staged:${record.snapshotId}`);
    this.records.set(record.snapshotId, record);
    return structuredClone(record);
  }

  stage(input: CatalogSnapshotInput, baselineSnapshotId: string | null = null): CatalogSnapshotRecord {
    return this.commit(this.prepare(input, baselineSnapshotId));
  }

  get(snapshotId: string): CatalogSnapshotRecord { return structuredClone(this.require(snapshotId)); }

  list(): CatalogSnapshotRecord[] {
    return structuredClone([...this.records.values()].sort((left, right) => left.observedAt.localeCompare(right.observedAt)));
  }

  restore(records: ReadonlyArray<CatalogSnapshotRecord>): void {
    this.records.clear();
    for (const record of [...records].sort((left, right) => left.observedAt.localeCompare(right.observedAt))) {
      const rebuilt = this.stage({
        snapshotId: record.snapshotId, providerId: record.providerId, scope: record.scope,
        sourceLabel: record.sourceLabel, observedAt: record.observedAt, rawPayloadSha256: record.rawPayloadSha256,
        parserVersion: record.parserVersion, routes: record.routes,
      }, record.baselineSnapshotId);
      if (rebuilt.manifestSha256 !== record.manifestSha256 || rebuilt.diffSha256 !== record.diffSha256) {
        throw new TypeError("catalog_snapshot_restore_hash_mismatch");
      }
    }
  }

  private require(snapshotId: string): CatalogSnapshotRecord {
    const record = this.records.get(snapshotId);
    if (!record) throw new Error(`catalog_snapshot_not_found:${snapshotId}`);
    return record;
  }

  private diff(previous: ProviderRouteManifest[], next: ProviderRouteManifest[]): CatalogRouteDiff[] {
    const before = new Map(previous.map((route) => [route.routeId, route]));
    const after = new Map(next.map((route) => [route.routeId, route]));
    const result: CatalogRouteDiff[] = [];
    for (const routeId of after.keys()) {
      if (!before.has(routeId)) result.push({ routeId, kind: "ADDED", changedFields: [] });
      else {
        const oldShape = routeShape(before.get(routeId)!); const newShape = routeShape(after.get(routeId)!);
        const changedFields = Object.keys(newShape).filter((key) => hash(oldShape[key as keyof typeof oldShape]) !== hash(newShape[key as keyof typeof newShape]));
        if (changedFields.length) result.push({ routeId, kind: "CHANGED", changedFields });
      }
    }
    for (const routeId of before.keys()) if (!after.has(routeId)) result.push({ routeId, kind: "REMOVED", changedFields: [] });
    return result.sort((a, b) => a.routeId.localeCompare(b.routeId));
  }
}
