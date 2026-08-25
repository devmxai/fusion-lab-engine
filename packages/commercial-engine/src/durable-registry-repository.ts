import { createHash } from "node:crypto";
import type { SqlExecutor, TransactionalSqlClient } from "../../durable-execution/src/postgres-atomic.js";
import { VersionedCommercialRegistry } from "./registry.js";
import { CommercialEngineError, type CommercialRegistrySnapshot } from "./types.js";

type StoredSnapshotRow = {
  snapshot_id: string;
  snapshot_version: string | number | bigint;
  command_id: string;
  intent_hash: string;
  evidence_sha256: string;
  content_sha256: string;
  payload: Record<string, unknown> | string;
  created_at: string | Date;
};

export type DurableCommercialRegistrySnapshot = Readonly<{
  id: string;
  version: number;
  commandId: string;
  evidenceSha256: string;
  contentSha256: string;
  createdAt: string;
  snapshot: CommercialRegistrySnapshot;
}>;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonical(value: unknown): unknown {
  if (typeof value === "bigint") return { $fusionlabBigInt: value.toString() };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length === 1 && typeof record.$fusionlabBigInt === "string" && /^-?\d+$/.test(record.$fusionlabBigInt)) {
    return BigInt(record.$fusionlabBigInt);
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, decode(item)]));
}

function payload(value: StoredSnapshotRow["payload"]): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Persisted commercial registry payload is malformed.");
  return parsed as Record<string, unknown>;
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function validateSnapshot(snapshot: CommercialRegistrySnapshot): void {
  if (!snapshot.id || snapshot.id.length > 200 || !Number.isSafeInteger(snapshot.version) || snapshot.version < 1) {
    throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Commercial registry identity must be a bounded immutable version.");
  }
  new VersionedCommercialRegistry().registerSnapshot(snapshot);
}

function assertPublishedControlSchema(value: CommercialRegistrySnapshot["capabilities"][number]["controlSchema"]): asserts value is NonNullable<CommercialRegistrySnapshot["capabilities"][number]["controlSchema"]> {
  if (!value || !value.version || value.version.length > 120 || !Array.isArray(value.recipes) || value.recipes.length === 0) {
    throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "A customer-published route requires a non-empty versioned control schema.");
  }
  const recipes = new Set<string>();
  for (const recipe of value.recipes) {
    if (!recipe.recipeId || recipes.has(recipe.recipeId) || !Number.isSafeInteger(recipe.prompt.maxLength) || recipe.prompt.maxLength < 0
      || !Number.isSafeInteger(recipe.bindings.min) || !Number.isSafeInteger(recipe.bindings.max)
      || recipe.bindings.min < 0 || recipe.bindings.max < recipe.bindings.min) {
      throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Published control schema contains an invalid recipe contract.");
    }
    recipes.add(recipe.recipeId);
    if (new Set(recipe.bindings.roles).size !== recipe.bindings.roles.length || recipe.bindings.roles.some((role) => !role || role.length > 100)) {
      throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Published control schema has invalid binding roles.");
    }
    const slots = recipe.bindings.slots ?? [];
    if ((recipe.bindings.max > 0 && slots.length === 0)
      || slots.some((slot) => !slot.role || !recipe.bindings.roles.includes(slot.role)
        || !["IMAGE", "VIDEO", "AUDIO"].includes(slot.kind))
      || new Set(slots.map((slot) => slot.role)).size !== slots.length
      || slots.filter((slot) => slot.required).length > recipe.bindings.max) {
      throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Published control schema must declare valid typed binding slots.");
    }
    const controls = new Set<string>();
    for (const control of recipe.controls) {
      if (!control.id || controls.has(control.id)) throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Published control schema has duplicate controls.");
      if (control.ui && (!control.ui.labelKey || !["BASIC", "ADVANCED"].includes(control.ui.group)
        || !Number.isSafeInteger(control.ui.order) || control.ui.order < 0)) {
        throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Published control UI metadata is invalid.");
      }
      if (control.visibleWhen && (!controls.has(control.visibleWhen.controlId) || control.visibleWhen.controlId === control.id
        || !["EQUALS", "NOT_EQUALS", "IN"].includes(control.visibleWhen.operator)
        || (control.visibleWhen.operator === "IN" ? !Array.isArray(control.visibleWhen.value) || control.visibleWhen.value.length === 0 : Array.isArray(control.visibleWhen.value)))) {
        throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Published control condition must reference an earlier control and use a valid operator.");
      }
      controls.add(control.id);
      if (control.kind === "enum") {
        if (!control.values?.length || !control.values.some((option) => Object.is(option, control.defaultValue))) throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Published enum control must contain its default option.");
      } else if (control.kind === "number") {
        if (typeof control.defaultValue !== "number" || !Number.isFinite(control.defaultValue) || control.min === undefined || control.max === undefined
          || !Number.isFinite(control.min) || !Number.isFinite(control.max) || control.min > control.max
          || control.defaultValue < control.min || control.defaultValue > control.max
          || (control.step !== undefined && (!Number.isFinite(control.step) || control.step <= 0 || (control.defaultValue - control.min) % control.step !== 0))) throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Published numeric control is invalid.");
      } else if (control.kind === "boolean" && typeof control.defaultValue !== "boolean") {
        throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Published boolean control is invalid.");
      }
    }
  }
}

function view(row: StoredSnapshotRow): DurableCommercialRegistrySnapshot {
  const snapshot = decode(payload(row.payload)) as CommercialRegistrySnapshot;
  validateSnapshot(snapshot);
  if (snapshot.id !== row.snapshot_id || snapshot.version !== Number(row.snapshot_version) || hash(snapshot) !== row.content_sha256) {
    throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Persisted commercial registry evidence does not match its immutable payload.");
  }
  return Object.freeze({
    id: row.snapshot_id,
    version: Number(row.snapshot_version),
    commandId: row.command_id,
    evidenceSha256: row.evidence_sha256,
    contentSha256: row.content_sha256,
    createdAt: iso(row.created_at),
    snapshot: structuredClone(snapshot),
  });
}

/**
 * Durable source of commercial pricing snapshots.  A Release Bundle points to
 * an exact row here; it never relies on the process-local registry that is
 * useful for pure quote calculations but unsafe as a production source.
 */
export class PostgresCommercialRegistryRepository {
  constructor(private readonly database: TransactionalSqlClient, private readonly now: () => Date = () => new Date()) {}

  async appendSnapshot(input: { commandId: string; evidenceSha256: string; snapshot: CommercialRegistrySnapshot }): Promise<DurableCommercialRegistrySnapshot> {
    if (!input.commandId || input.commandId.length < 8 || input.commandId.length > 200) {
      throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Commercial registry command identity is invalid.");
    }
    if (!/^[a-f0-9]{64}$/.test(input.evidenceSha256)) {
      throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Commercial registry evidence must be a SHA-256 hash.");
    }
    validateSnapshot(input.snapshot);
    const contentSha256 = hash(input.snapshot);
    const intentHash = hash({ snapshot: input.snapshot, evidenceSha256: input.evidenceSha256 });
    return this.database.transaction(async (transaction) => {
      const replay = await transaction.query<StoredSnapshotRow>(
        "SELECT * FROM fusion_engine.commercial_registry_snapshots WHERE command_id = $1 FOR UPDATE",
        [input.commandId],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].intent_hash !== intentHash) throw new CommercialEngineError("DUPLICATE_REGISTRY_SNAPSHOT", "Commercial registry command is bound to a different snapshot.");
        return view(replay.rows[0]);
      }
      const existing = await transaction.query<StoredSnapshotRow>(
        "SELECT * FROM fusion_engine.commercial_registry_snapshots WHERE snapshot_id = $1 AND snapshot_version = $2 FOR UPDATE",
        [input.snapshot.id, input.snapshot.version],
      );
      if (existing.rows[0]) {
        throw new CommercialEngineError("DUPLICATE_REGISTRY_SNAPSHOT", "Commercial registry snapshot identity is immutable and already exists.");
      }
      const createdAt = this.now().toISOString();
      const inserted = await transaction.query<StoredSnapshotRow>(
        `INSERT INTO fusion_engine.commercial_registry_snapshots
         (snapshot_id, snapshot_version, command_id, intent_hash, evidence_sha256, content_sha256, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) RETURNING *`,
        [input.snapshot.id, input.snapshot.version, input.commandId, intentHash, input.evidenceSha256, contentSha256, JSON.stringify(canonical(input.snapshot) as JsonValue), createdAt],
      );
      return view(inserted.rows[0]!);
    });
  }

  async require(input: { id: string; version: number; evidenceSha256?: string; publishedOnly?: boolean }): Promise<DurableCommercialRegistrySnapshot> {
    const result = await this.database.query<StoredSnapshotRow>(
      "SELECT * FROM fusion_engine.commercial_registry_snapshots WHERE snapshot_id = $1 AND snapshot_version = $2",
      [input.id, input.version],
    );
    if (!result.rows[0]) throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Commercial registry snapshot is not durable.");
    const resolved = view(result.rows[0]);
    if (input.evidenceSha256 && resolved.evidenceSha256 !== input.evidenceSha256) {
      throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Commercial registry evidence does not match the release reference.");
    }
    if (input.publishedOnly && resolved.snapshot.status !== "PUBLISHED") {
      throw new CommercialEngineError("REGISTRY_NOT_PUBLISHED", "A release requires a published commercial registry snapshot.");
    }
    return resolved;
  }

  async existsForRelease(transaction: SqlExecutor, input: { id: string; version: number; evidenceSha256: string }): Promise<CommercialRegistrySnapshot> {
    const result = await transaction.query<StoredSnapshotRow>(
      "SELECT * FROM fusion_engine.commercial_registry_snapshots WHERE snapshot_id = $1 AND snapshot_version = $2 FOR UPDATE",
      [input.id, input.version],
    );
    if (!result.rows[0]) throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Release references a commercial registry snapshot that is not durable.");
    const resolved = view(result.rows[0]);
    if (resolved.evidenceSha256 !== input.evidenceSha256 || resolved.snapshot.status !== "PUBLISHED") {
      throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Release commercial registry is not the exact published durable snapshot.");
    }
    return resolved.snapshot;
  }
}

export function assertCommercialReleaseBinding(input: {
  snapshot: CommercialRegistrySnapshot;
  commercialRouteVersionId: string;
  familyVersionId: string;
  recipeVersionId: string;
  customerPriceVersionId: string;
  providerId: string;
  providerAccountId: string;
  providerModelId: string;
  adapterVersion: string;
}): void {
  validateSnapshot(input.snapshot);
  if (input.snapshot.status !== "PUBLISHED") throw new CommercialEngineError("REGISTRY_NOT_PUBLISHED", "Release requires a published commercial registry snapshot.");
  const route = input.snapshot.routes.find((candidate) => candidate.id === input.commercialRouteVersionId);
  const family = input.snapshot.families.find((candidate) => candidate.id === input.familyVersionId);
  const recipe = input.snapshot.recipes.find((candidate) => candidate.id === input.recipeVersionId);
  const price = input.snapshot.customerPriceVersions.find((candidate) => candidate.id === input.customerPriceVersionId);
  if (!route || !family || !recipe || !price || route.familyVersionId !== family.id || !recipe.familyVersionIds.includes(family.id)
    || route.lifecycle !== "PUBLISHED" || price.lifecycle !== "PUBLISHED") {
    throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Release commercial bindings are unresolved or not published.");
  }
  if (route.providerId !== input.providerId || route.providerAccountId !== input.providerAccountId
    || route.providerModelId !== input.providerModelId || route.adapterVersion !== input.adapterVersion) {
    throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Commercial route differs from the frozen provider route.");
  }
  const capability = input.snapshot.capabilities.find((candidate) => candidate.id === route.capabilityVersionId);
  if (!capability || capability.lifecycle !== "PUBLISHED") {
    throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Commercial route lacks a published capability contract.");
  }
  assertPublishedControlSchema(capability.controlSchema);
}
