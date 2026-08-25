import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  ProviderGenerationRequestSchema,
  type ProviderGenerationRequest,
} from "../../../../packages/contracts/src/provider.ts";
import {
  PostgresAtomicGenerationRepository,
  type RouteExecutionEvidence,
  type TransactionalSqlClient,
} from "../../../../packages/durable-execution/src/postgres-atomic.ts";
import { PostgresWorkerCoordinator } from "../../../../packages/durable-execution/src/postgres-worker.ts";
import { PrivateMediaPipeline } from "../../../../packages/media-pipeline/src/pipeline.ts";
import { FilePrivateObjectStore } from "../../../../packages/media-pipeline/src/private-store.ts";
import { join } from "node:path";
import { defaultLocalMediaPolicy } from "../../../../packages/media-pipeline/src/types.ts";
import { ProviderSourceUrlGuard } from "../../../../packages/media-pipeline/src/url-guard.ts";
import { LocalSignatureScanner } from "../../../../packages/media-pipeline/src/validator.ts";
import { ProviderRegistry } from "../../../../packages/providers/src/registry.ts";
import { FrozenPublishedOfferRuntimeResolver } from "../../../../packages/providers/src/provider-runtime-resolver.ts";
import { ProviderDefinitiveError, type ProviderAdapter } from "../../../../packages/providers/src/types.ts";
import { DurableAssetDeliveryWorker } from "./asset-delivery-worker.ts";
import { DurableProviderAttemptWorker } from "./provider-attempt-worker.ts";
import type { OperationProviderAdapterAccess } from "./provider-adapter-access.ts";

const schemaSql = await readFile(
  new URL("../../../../packages/durable-execution/sql/001_generation_v2_durability.sql", import.meta.url),
  "utf8",
);

type DispatchPayload = {
  operationId: string;
  providerId: string;
  request: ProviderGenerationRequest;
  projectId: string;
};

export type DurableRuntimeStatus = {
  database: "ready" | "closed";
  worker: "idle" | "running" | "failed";
  lastErrorCode: string | null;
  operations: Record<string, number>;
  outbox: Record<string, number>;
};

export type DurableCreativeProject = {
  projectId: string;
  document: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

function creativeProjectLifecycleState(document: Record<string, unknown>): "ACTIVE" | "ARCHIVED" | "DELETED" {
  const lifecycle = document.lifecycle && typeof document.lifecycle === "object" && !Array.isArray(document.lifecycle)
    ? document.lifecycle as Record<string, unknown> : null;
  return lifecycle?.state === "ARCHIVED" || lifecycle?.state === "DELETED" ? lifecycle.state : "ACTIVE";
}

export type RouteDispatchGuard = (
  providerId: string,
  modelId: string,
) => { allowed: boolean; reasonCode: string | null; versionId: string | null };

export class DurableProjectConflictError extends Error {
  constructor(message: string) { super(message); this.name = "DurableProjectConflictError"; }
}

export class DurableAdminStateConflictError extends Error {
  constructor(message: string) { super(message); this.name = "DurableAdminStateConflictError"; }
}

function client(database: PGlite): TransactionalSqlClient {
  return database as unknown as TransactionalSqlClient;
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.name) return error.name.toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  return "DURABLE_RUNTIME_ERROR";
}

function isProviderAdapter(value: unknown): value is ProviderAdapter {
  if (!value || typeof value !== "object") return false;
  const adapter = value as Partial<ProviderAdapter>;
  return typeof adapter.id === "string"
    && typeof adapter.version === "string"
    && typeof adapter.submit === "function"
    && typeof adapter.lookupByIdempotency === "function"
    && typeof adapter.getTask === "function"
    && typeof adapter.fetchAsset === "function"
    && !!adapter.assetSourcePolicy;
}

export class LocalDurableRuntime {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private closed = false;
  private lastErrorCode: string | null = null;
  private publishedOfferRuntime: FrozenPublishedOfferRuntimeResolver | null = null;

  private constructor(
    private readonly database: PGlite,
    private readonly atomic: PostgresAtomicGenerationRepository,
    private readonly coordinator: PostgresWorkerCoordinator,
    private readonly providerWorker: DurableProviderAttemptWorker,
    private readonly assetWorker: DurableAssetDeliveryWorker,
    private readonly media: PrivateMediaPipeline,
    private readonly providers: ProviderRegistry,
    private readonly routeDispatchGuard: RouteDispatchGuard,
    private readonly tickMilliseconds: number,
    private readonly attemptTimeoutMs: number,
    private readonly now: () => Date,
  ) {}

  static async create(input: {
    dataDir: string;
    providers: ProviderRegistry;
    tickMilliseconds?: number;
    attemptTimeoutMs?: number;
    now?: () => Date;
    media?: PrivateMediaPipeline;
    routeDispatchGuard?: RouteDispatchGuard;
  }): Promise<LocalDurableRuntime> {
    const now = input.now ?? (() => new Date());
    // PGlite creates its own database files, but not a missing parent path.
    // The local Engine must boot from a fresh working copy without a manual
    // `.local` directory setup step.
    await mkdir(input.dataDir, { recursive: true });
    const database = await PGlite.create(input.dataDir);
    await database.exec(schemaSql);
    const coordinator = new PostgresWorkerCoordinator(client(database), now);
    const media = input.media ?? new PrivateMediaPipeline(
      new FilePrivateObjectStore(join(input.dataDir, "media"), now),
      new ProviderSourceUrlGuard(),
      new LocalSignatureScanner(),
      defaultLocalMediaPolicy,
    );
    let runtime!: LocalDurableRuntime;
    const operationAdapters: OperationProviderAdapterAccess = {
      withAdapter: (input, work) => runtime.withOperationProviderAdapter(input, work),
    };
    runtime = new LocalDurableRuntime(
      database,
      new PostgresAtomicGenerationRepository(client(database), now),
      coordinator,
      new DurableProviderAttemptWorker(coordinator, input.providers, 3, randomUUID, operationAdapters),
      new DurableAssetDeliveryWorker(coordinator, input.providers, media, randomUUID, operationAdapters),
      media,
      input.providers,
      input.routeDispatchGuard ?? (() => ({ allowed: true, reasonCode: null, versionId: null })),
      input.tickMilliseconds ?? 500,
      input.attemptTimeoutMs ?? 15 * 60 * 1_000,
      now,
    );
    return runtime;
  }

  start(): void {
    if (this.closed) throw new Error("durable_runtime_closed");
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.tickMilliseconds);
    this.timer.unref();
    void this.tick();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.ticking) await new Promise((resolve) => setTimeout(resolve, 10));
    await this.database.close();
  }

  /**
   * Narrow database capability for the immutable Provider Control Plane.
   * It is intentionally not exposed to HTTP handlers or browser code.
   */
  providerControlSqlClient(): TransactionalSqlClient {
    if (this.closed) throw new Error("durable_runtime_closed");
    return client(this.database);
  }

  /** Installs the server-only published offer resolver once after the durable
   * Control Plane and encrypted credential vault have both been constructed. */
  installPublishedOfferRuntimeResolver(resolver: FrozenPublishedOfferRuntimeResolver): void {
    if (this.publishedOfferRuntime && this.publishedOfferRuntime !== resolver) {
      throw new Error("published_offer_runtime_resolver_already_installed");
    }
    this.publishedOfferRuntime = resolver;
  }

  async grantLocalCredits(input: { ownerId: string; credits: number }): Promise<void> {
    await this.atomic.grantCredits({
      ownerId: input.ownerId,
      credits: input.credits,
      journalId: randomUUID(),
      commandId: `local-durable-grant:${randomUUID()}`,
      reasonCode: "LOCAL_DURABLE_RUNTIME_SEED",
    });
  }

  /** Local-only convenience; the stable command id makes the seed restart-safe. */
  async ensureLocalDevelopmentCredits(ownerId: string, credits = 1_000): Promise<void> {
    const ownerHash = Buffer.from(ownerId).toString("base64url").slice(0, 80);
    await this.atomic.grantCreditsOnce({
      ownerId,
      credits,
      journalId: randomUUID(),
      commandId: `local-durable-bootstrap:${ownerHash}:v1`,
      reasonCode: "LOCAL_DURABLE_DEVELOPMENT_BOOTSTRAP",
    });
  }

  async issueLocalQuote(input: {
    id?: string;
    ownerId: string;
    requestHash: string;
    customerCredits: number;
    expiresAt: string;
    metadata?: {
      projectId: string;
      recipeId: string;
      providerId: string;
      providerRequestTemplate: Record<string, unknown>;
      pricingSnapshot: Record<string, unknown>;
      executionEvidence: RouteExecutionEvidence;
    };
  }): Promise<string> {
    const id = input.id ?? randomUUID();
    await this.atomic.issueQuote({ id, ...input });
    return id;
  }

  /**
   * Produces the immutable route/account/model/version binding that is stored
   * beside a quote. A provider id alone is never dispatch authorization.
   */
  executionEvidenceFor(
    providerId: string,
    request: Omit<ProviderGenerationRequest, "operationId">,
  ): RouteExecutionEvidence {
    const adapter = this.providers.require(providerId);
    const route = this.providers.listRoutes({ providerId }).find((candidate) => (
      candidate.providerModel.providerModelId === request.model
      && candidate.capability.mediaType === request.mediaType
    ));
    if (!route) throw new Error("durable_route_evidence_not_registered");
    const evidence = {
      routeId: route.routeId,
      providerId: route.providerId,
      providerAccountId: route.providerAccount.id,
      providerAccountScope: route.providerAccount.scope,
      providerModelBindingId: route.providerModel.id,
      providerModelId: route.providerModel.providerModelId,
      catalogSnapshotId: route.sourceSnapshot.id,
      catalogSnapshotHash: route.sourceSnapshot.rawPayloadSha256.toLowerCase(),
      providerCostVersionId: route.providerCostVersion.id,
      providerCostVersion: route.providerCostVersion.version,
      adapterVersion: adapter.version,
      usageExtractorVersion: route.usageExtractorVersion,
      certificationLifecycle: route.certification.lifecycle,
    } satisfies Omit<RouteExecutionEvidence, "evidenceSha256">;
    return {
      ...evidence,
      evidenceSha256: createHash("sha256").update(JSON.stringify(evidence)).digest("hex"),
    };
  }

  async quoteMetadata(quoteId: string) {
    const result = await this.database.query<{
      id: string; owner_id: string; request_hash: string; customer_credits: string | number | bigint;
      state: string; expires_at: string | Date; project_id: string; recipe_id: string; provider_id: string;
      provider_request_template: Record<string, unknown> | string; pricing_snapshot: Record<string, unknown> | string;
      execution_evidence: RouteExecutionEvidence | string;
    }>(`SELECT q.id, q.owner_id, q.request_hash, q.customer_credits, q.state, q.expires_at,
          m.project_id, m.recipe_id, m.provider_id, m.provider_request_template, m.pricing_snapshot, m.execution_evidence
        FROM fusion_engine.quotes q
        JOIN fusion_engine.generation_quote_metadata m ON m.quote_id = q.id
        WHERE q.id = $1`, [quoteId]);
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      id: row.id, ownerId: row.owner_id, requestHash: row.request_hash, customerCredits: Number(row.customer_credits),
      state: row.state, expiresAt: new Date(row.expires_at).toISOString(), projectId: row.project_id,
      recipeId: row.recipe_id, providerId: row.provider_id,
      providerRequestTemplate: typeof row.provider_request_template === "string" ? JSON.parse(row.provider_request_template) : row.provider_request_template,
      pricingSnapshot: typeof row.pricing_snapshot === "string" ? JSON.parse(row.pricing_snapshot) : row.pricing_snapshot,
      executionEvidence: typeof row.execution_evidence === "string" ? JSON.parse(row.execution_evidence) : row.execution_evidence,
    };
  }

  private async withOperationProviderAdapter<T>(
    input: Readonly<{ operationId: string; providerId: string }>,
    work: (adapter: ProviderAdapter) => Promise<T>,
  ): Promise<T> {
    const operation = await this.coordinator.operation(input.operationId);
    const quote = await this.quoteMetadata(operation.quoteId);
    if (!quote) throw new ProviderDefinitiveError("PUBLISHED_RUNTIME_NOT_CONFIGURED", "The operation has no durable quote metadata.");
    const evidence = quote.executionEvidence;
    if (evidence.dispatchSource !== "PUBLISHED_OFFER") {
      try {
        return await work(this.providers.require(input.providerId));
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("provider_adapter_not_registered:")) {
          throw new ProviderDefinitiveError("PROVIDER_RUNTIME_NOT_CONFIGURED", "No certified provider runtime is configured for this operation.");
        }
        throw error;
      }
    }
    if (!evidence.publishedOfferId || evidence.providerId !== input.providerId) {
      throw new ProviderDefinitiveError("PUBLISHED_RUNTIME_EVIDENCE_INVALID", "Published operation evidence does not match its provider dispatch.");
    }
    if (!this.publishedOfferRuntime) {
      // No provider factory, key lease, network call, or provider charge can
      // happen on this path. The attempt worker records confirmed zero cost.
      throw new ProviderDefinitiveError("PUBLISHED_RUNTIME_NOT_CONFIGURED", "The published provider runtime has not been configured.");
    }
    let adapterEntered = false;
    try {
      return await this.publishedOfferRuntime.withAdapter({
        offerId: evidence.publishedOfferId,
        releaseBundleId: evidence.releaseBundleId!,
        releaseBundleVersion: evidence.releaseBundleVersion!,
        providerId: evidence.providerId,
        providerAccountId: evidence.providerAccountId,
        routeId: evidence.routeId,
        providerModelId: evidence.providerModelId,
        adapterVersion: evidence.adapterVersion,
      }, async (candidate, resolution) => {
        if (resolution.providerId !== input.providerId || !isProviderAdapter(candidate)) {
          throw new ProviderDefinitiveError("PUBLISHED_RUNTIME_EVIDENCE_INVALID", "Published provider adapter does not match the frozen release route.");
        }
        adapterEntered = true;
        return work(candidate);
      });
    } catch (error) {
      // Factory/lease failures occur before an adapter exists and therefore
      // before a provider request. Make them definitive zero-charge failures.
      if (!adapterEntered && !(error instanceof ProviderDefinitiveError)) {
        throw new ProviderDefinitiveError("PUBLISHED_RUNTIME_NOT_CONFIGURED", "The published provider credential or adapter cannot be leased.");
      }
      throw error;
    }
  }

  async enqueueLocalGeneration(input: {
    ownerId: string;
    quoteId: string;
    generationIntentId: string;
    idempotencyKey: string;
    requestHash: string;
    providerId: string;
    request: Omit<ProviderGenerationRequest, "operationId">;
    projectId: string;
    executionEvidence: RouteExecutionEvidence;
  }): Promise<string> {
    const published = input.executionEvidence.dispatchSource === "PUBLISHED_OFFER";
    if (!published) this.providersRequire(input.providerId);
    if (input.executionEvidence.providerId !== input.providerId
      || input.executionEvidence.providerModelId !== input.request.model
      || (!published && input.executionEvidence.adapterVersion !== this.providers.require(input.providerId).version)) {
      throw new Error("durable_execution_evidence_mismatch");
    }
    if (published && (!input.executionEvidence.publishedOfferId || !input.executionEvidence.releaseBundleId)) {
      throw new Error("durable_published_offer_evidence_incomplete");
    }
    const routeGate = this.routeDispatchGuard(input.providerId, input.executionEvidence.providerModelId);
    if (!routeGate.allowed) {
      throw new Error(`durable_route_kill_switch_active:${routeGate.reasonCode ?? "unspecified"}:${routeGate.versionId ?? "unknown"}`);
    }
    const operationId = randomUUID();
    const request = ProviderGenerationRequestSchema.parse({ ...input.request, operationId });
    const committed = await this.atomic.commitGeneration({
      operationId,
      reservationId: randomUUID(),
      journalId: randomUUID(),
      journalCommandId: `local-durable-reserve:${operationId}`,
      operationEventId: randomUUID(),
      outboxEventId: randomUUID(),
      ownerId: input.ownerId,
      quoteId: input.quoteId,
      generationIntentId: input.generationIntentId,
      idempotencyKey: input.idempotencyKey,
      route: "POST /v2/durable/operations",
      requestHash: input.requestHash,
      outboxPayload: {
        operationId,
        providerId: input.providerId,
        request,
        projectId: input.projectId,
      } satisfies DispatchPayload,
    });
    return committed.operation.id;
  }

  async enqueueFromQuoteMetadata(input: {
    ownerId: string;
    quoteId: string;
    generationIntentId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<string> {
    const quote = await this.quoteMetadata(input.quoteId);
    if (!quote || quote.ownerId !== input.ownerId || quote.requestHash !== input.requestHash) {
      throw new Error("durable_quote_metadata_not_found_or_mismatched");
    }
    if (quote.state !== "ISSUED") {
      const operation = await this.database.query<{ consumed_operation_id: string | null }>(
        "SELECT consumed_operation_id FROM fusion_engine.quotes WHERE id = $1", [input.quoteId],
      );
      if (operation.rows[0]?.consumed_operation_id) return operation.rows[0].consumed_operation_id;
    }
    return this.enqueueLocalGeneration({
      ownerId: input.ownerId,
      quoteId: input.quoteId,
      generationIntentId: input.generationIntentId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      providerId: quote.providerId,
      request: quote.providerRequestTemplate as Omit<ProviderGenerationRequest, "operationId">,
      projectId: quote.projectId,
      executionEvidence: quote.executionEvidence,
    });
  }

  async tick(): Promise<void> {
    if (this.closed || this.ticking) return;
    this.ticking = true;
    try {
      await this.relayOneOutbox();
      await this.reconcileExpiredAttempts();
      const runnable = await this.coordinator.runnableAttempts();
      for (const item of runnable) {
        const before = await this.coordinator.attempt(item.operationId, item.attemptNumber);
        if (["DISPATCHING", "SUBMISSION_UNKNOWN", "SUBMITTED", "RUNNING"].includes(before.state)) {
          await this.providerWorker.driveOnce(item.operationId, item.attemptNumber);
        }
        const after = await this.coordinator.attempt(item.operationId, item.attemptNumber);
        if (["PROVIDER_SUCCEEDED", "ASSET_STORED", "DELIVERED"].includes(after.operationState)) {
          const payload = await this.dispatchPayload(item.operationId);
          await this.assetWorker.driveOnce({
            operationId: item.operationId,
            attemptNumber: item.attemptNumber,
            projectId: payload.projectId,
          });
        }
      }
      this.lastErrorCode = null;
    } catch (error) {
      this.lastErrorCode = errorCode(error);
    } finally {
      this.ticking = false;
    }
  }

  async drainUntilIdle(maxTicks = 40): Promise<void> {
    for (let index = 0; index < maxTicks; index += 1) {
      await this.tick();
      const status = await this.status();
      const active = Object.entries(status.operations)
        .some(([state, count]) => count > 0 && !["SETTLED", "PROVIDER_FAILED", "DELIVERY_FAILED", "CANCELLED", "RECONCILIATION_REQUIRED"].includes(state));
      const pendingOutbox = (status.outbox.PENDING ?? 0) + (status.outbox.LEASED ?? 0);
      if (!active && pendingOutbox === 0) return;
    }
    throw new Error("durable_runtime_drain_budget_exhausted");
  }

  async status(): Promise<DurableRuntimeStatus> {
    if (this.closed) return { database: "closed", worker: "idle", lastErrorCode: this.lastErrorCode, operations: {}, outbox: {} };
    const [operations, outbox] = await Promise.all([
      this.database.query<{ state: string; count: string | number | bigint }>(
        "SELECT state, count(*) FROM fusion_engine.operations GROUP BY state",
      ),
      this.database.query<{ status: string; count: string | number | bigint }>(
        "SELECT status, count(*) FROM fusion_engine.outbox_events GROUP BY status",
      ),
    ]);
    return {
      database: "ready",
      worker: this.ticking ? "running" : this.lastErrorCode ? "failed" : "idle",
      lastErrorCode: this.lastErrorCode,
      operations: Object.fromEntries(operations.rows.map((row) => [row.state, Number(row.count)])),
      outbox: Object.fromEntries(outbox.rows.map((row) => [row.status, Number(row.count)])),
    };
  }

  async operation(operationId: string) {
    return this.coordinator.operation(operationId);
  }

  /**
   * Workspace documents are owned aggregates.  A caller must present the
   * revision it last read, so a second browser cannot silently overwrite a
   * newer canvas/layout change.
   */
  async creativeProject(ownerId: string, projectId: string): Promise<DurableCreativeProject | null> {
    const result = await this.database.query<{
      project_id: string; document: Record<string, unknown> | string; version: string | number | bigint;
      created_at: string | Date; updated_at: string | Date;
    }>(`SELECT project_id, document, version, created_at, updated_at
        FROM fusion_engine.creative_projects WHERE project_id = $1 AND owner_id = $2`, [projectId, ownerId]);
    const row = result.rows[0];
    return row ? this.projectView(row) : null;
  }

  async creativeProjects(ownerId: string): Promise<Array<{
    projectId: string; title: string; assetCount: number; operationCount: number;
    lifecycleState: "ACTIVE" | "ARCHIVED" | "DELETED"; version: number; createdAt: string; updatedAt: string;
  }>> {
    const result = await this.database.query<{
      project_id: string; document: Record<string, unknown> | string; version: string | number | bigint;
      created_at: string | Date; updated_at: string | Date;
    }>(`SELECT project_id, document, version, created_at, updated_at
        FROM fusion_engine.creative_projects WHERE owner_id = $1
        ORDER BY updated_at DESC, project_id ASC LIMIT 100`, [ownerId]);
    return result.rows.map((row) => {
      const project = this.projectView(row);
      const assets = project.document.assets && typeof project.document.assets === "object" && !Array.isArray(project.document.assets)
        ? Object.keys(project.document.assets).length : 0;
      const operations = project.document.operations && typeof project.document.operations === "object" && !Array.isArray(project.document.operations)
        ? Object.keys(project.document.operations).length : 0;
      return {
        projectId: project.projectId,
        title: typeof project.document.title === "string" && project.document.title.trim() ? project.document.title.trim() : "مشروع بدون عنوان",
        lifecycleState: creativeProjectLifecycleState(project.document),
        assetCount: assets,
        operationCount: operations,
        version: project.version,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
    });
  }

  async saveCreativeProject(input: {
    ownerId: string;
    projectId: string;
    document: Record<string, unknown>;
    expectedVersion: number | null;
    allowInactive?: boolean;
  }): Promise<DurableCreativeProject> {
    const current = await this.database.query<{
      owner_id: string; version: string | number | bigint; document: Record<string, unknown> | string;
    }>("SELECT owner_id, version, document FROM fusion_engine.creative_projects WHERE project_id = $1", [input.projectId]);
    const existing = current.rows[0];
    if (existing && existing.owner_id !== input.ownerId) throw new DurableProjectConflictError("creative_project_not_found");
    if (!existing) {
      if (input.expectedVersion !== null && input.expectedVersion !== 0) throw new DurableProjectConflictError("creative_project_version_conflict");
      const created = await this.database.query<{
        project_id: string; document: Record<string, unknown> | string; version: string | number | bigint;
        created_at: string | Date; updated_at: string | Date;
      }>(`INSERT INTO fusion_engine.creative_projects (project_id, owner_id, document)
          VALUES ($1, $2, $3::jsonb)
          RETURNING project_id, document, version, created_at, updated_at`, [input.projectId, input.ownerId, JSON.stringify(input.document)]);
      return this.projectView(created.rows[0]);
    }
    const existingDocument = typeof existing.document === "string" ? JSON.parse(existing.document) as Record<string, unknown> : existing.document;
    if (!input.allowInactive && creativeProjectLifecycleState(existingDocument) !== "ACTIVE") throw new DurableProjectConflictError("creative_project_not_active");
    if (input.expectedVersion === null || input.expectedVersion !== Number(existing.version)) {
      throw new DurableProjectConflictError("creative_project_version_conflict");
    }
    const updated = await this.database.query<{
      project_id: string; document: Record<string, unknown> | string; version: string | number | bigint;
      created_at: string | Date; updated_at: string | Date;
    }>(`UPDATE fusion_engine.creative_projects
          SET document = $3::jsonb, version = version + 1, updated_at = $4
        WHERE project_id = $1 AND owner_id = $2 AND version = $5
        RETURNING project_id, document, version, created_at, updated_at`, [
      input.projectId, input.ownerId, JSON.stringify(input.document), this.now().toISOString(), input.expectedVersion,
    ]);
    if (!updated.rows[0]) throw new DurableProjectConflictError("creative_project_version_conflict");
    return this.projectView(updated.rows[0]);
  }

  async adminControlPlaneState(): Promise<{ document: Record<string, unknown>; version: number; updatedAt: string } | null> {
    const result = await this.database.query<{
      document: Record<string, unknown> | string; version: string | number | bigint; updated_at: string | Date;
    }>("SELECT document, version, updated_at FROM fusion_engine.admin_control_plane_state WHERE state_key = 'local-admin-v2'");
    const row = result.rows[0];
    if (!row) return null;
    return {
      document: structuredClone(typeof row.document === "string" ? JSON.parse(row.document) : row.document),
      version: Number(row.version), updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async saveAdminControlPlaneState(input: { document: Record<string, unknown>; expectedVersion: number | null }) {
    const current = await this.adminControlPlaneState();
    if (!current) {
      if (input.expectedVersion !== null && input.expectedVersion !== 0) throw new DurableAdminStateConflictError("admin_state_version_conflict");
      const created = await this.database.query<{ version: string | number | bigint; updated_at: string | Date }>(
        `INSERT INTO fusion_engine.admin_control_plane_state (state_key, document, version, updated_at)
         VALUES ('local-admin-v2', $1::jsonb, 1, $2) RETURNING version, updated_at`,
        [JSON.stringify(input.document), this.now().toISOString()],
      );
      return { version: Number(created.rows[0].version), updatedAt: new Date(created.rows[0].updated_at).toISOString() };
    }
    if (input.expectedVersion === null || input.expectedVersion !== current.version) throw new DurableAdminStateConflictError("admin_state_version_conflict");
    const updated = await this.database.query<{ version: string | number | bigint; updated_at: string | Date }>(
      `UPDATE fusion_engine.admin_control_plane_state SET document = $1::jsonb, version = version + 1, updated_at = $2
       WHERE state_key = 'local-admin-v2' AND version = $3 RETURNING version, updated_at`,
      [JSON.stringify(input.document), this.now().toISOString(), input.expectedVersion],
    );
    if (!updated.rows[0]) throw new DurableAdminStateConflictError("admin_state_version_conflict");
    return { version: Number(updated.rows[0].version), updatedAt: new Date(updated.rows[0].updated_at).toISOString() };
  }

  /**
   * Consumer-safe operation projection. It deliberately exposes the delivered
   * asset identifier rather than the provider's source URL or private object key.
   */
  async generationOperationView(operationId: string) {
    const operation = await this.coordinator.operation(operationId);
    const [attempt, reservation, asset, delivery, outcome, events] = await Promise.all([
      this.database.query<{
        provider_id: string; provider_task_id: string | null; actual_provider_credits: string | number | bigint | null;
      }>(`SELECT provider_id, provider_task_id, actual_provider_credits
          FROM fusion_engine.operation_attempts WHERE operation_id = $1 ORDER BY attempt_number DESC LIMIT 1`, [operationId]),
      this.database.query<{ quoted_credits: string | number | bigint; captured_credits: string | number | bigint }>(
        "SELECT quoted_credits, captured_credits FROM fusion_engine.credit_reservations WHERE operation_id = $1", [operationId],
      ),
      this.database.query<{ id: string; checksum_sha256: string; media_type: string }>(
        "SELECT id, checksum_sha256, media_type FROM fusion_engine.operation_assets WHERE operation_id = $1", [operationId],
      ),
      this.database.query<{ id: string }>(
        "SELECT id FROM fusion_engine.operation_deliveries WHERE operation_id = $1", [operationId],
      ),
      this.database.query<{ provider_credits: string | number | bigint; disposition: string }>(
        "SELECT provider_credits, disposition FROM fusion_engine.provider_cost_outcomes WHERE operation_id = $1", [operationId],
      ),
      this.database.query<{ sequence: string | number | bigint; state: string; state_version: string | number | bigint; occurred_at: string | Date }>(
        "SELECT sequence, state, state_version, occurred_at FROM fusion_engine.operation_events WHERE operation_id = $1 ORDER BY sequence", [operationId],
      ),
    ]);
    const held = reservation.rows[0];
    const providerChargedCredits = outcome.rows[0]
      ? Number(outcome.rows[0].provider_credits)
      : Number(attempt.rows[0]?.actual_provider_credits ?? 0);
    const deliveredAsset = asset.rows[0];
    return {
      id: operation.id,
      quoteId: operation.quoteId,
      provider: attempt.rows[0]?.provider_id ?? null,
      providerTaskId: attempt.rows[0]?.provider_task_id ?? null,
      state: operation.state,
      stateVersion: operation.stateVersion,
      generationIntentId: operation.generationIntentId,
      financials: {
        customerQuotedCredits: operation.customerCredits,
        customerChargedCredits: Number(held?.captured_credits ?? 0),
        providerChargedCredits,
        providerCostDisposition: outcome.rows[0]?.disposition ?? null,
      },
      delivery: deliveredAsset && delivery.rows[0] ? {
        assetId: deliveredAsset.id,
        mediaType: deliveredAsset.media_type,
        checksumSha256: deliveredAsset.checksum_sha256,
      } : null,
      events: events.rows.map((event) => ({
        sequence: Number(event.sequence), state: event.state, version: Number(event.state_version), at: new Date(event.occurred_at).toISOString(),
      })),
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt,
      localOnly: true,
    };
  }

  async issueAssetAccessGrant(input: { ownerId: string; assetId: string; ttlSeconds?: number }) {
    const asset = await this.requireOwnedAsset(input.ownerId, input.assetId);
    const ttlSeconds = input.ttlSeconds ?? 300;
    const token = this.media.refreshAccessGrant(asset.privateObjectId, input.ownerId, ttlSeconds);
    await this.recordAssetAccess({ assetId: input.assetId, ownerId: input.ownerId, action: "GRANT_ISSUED", token });
    return { token, expiresAt: new Date(this.now().getTime() + ttlSeconds * 1_000).toISOString() };
  }

  async readAssetWithGrant(input: { ownerId: string; assetId: string; token: string }) {
    const asset = await this.requireOwnedAsset(input.ownerId, input.assetId);
    try {
      const read = this.media.readWithGrant(asset.privateObjectId, input.token);
      await this.recordAssetAccess({ assetId: input.assetId, ownerId: input.ownerId, action: "READ_ALLOWED", token: input.token });
      return { bytes: read.bytes, contentType: read.object.contentType, checksumSha256: read.object.checksumSha256 };
    } catch (error) {
      await this.recordAssetAccess({ assetId: input.assetId, ownerId: input.ownerId, action: "READ_DENIED", token: input.token });
      throw error;
    }
  }

  async assetAccessAudit(assetId: string) {
    const result = await this.database.query<{ action: string; count: string | number | bigint }>(
      "SELECT action, count(*) FROM fusion_engine.asset_access_events WHERE asset_id = $1 GROUP BY action", [assetId],
    );
    return Object.fromEntries(result.rows.map((row) => [row.action, Number(row.count)]));
  }

  async adminOverview(limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new TypeError("invalid_durable_admin_limit");
    const [operations, holds, reconciliations, outcomes] = await Promise.all([
      this.database.query<{ state: string; count: string | number | bigint }>(
        "SELECT state, count(*) FROM fusion_engine.operations GROUP BY state",
      ),
      this.database.query<{
        operation_id: string; owner_id: string; state: string; held_credits: string | number | bigint;
        quoted_credits: string | number | bigint; updated_at: string | Date;
      }>(`SELECT r.operation_id, r.owner_id, r.state, r.held_credits, r.quoted_credits, r.updated_at
          FROM fusion_engine.credit_reservations r
          WHERE r.state IN ('HELD', 'MANUAL_REVIEW')
          ORDER BY r.updated_at DESC LIMIT $1`, [limit]),
      this.database.query<{ id: string; owner_id: string; state_version: string | number | bigint; updated_at: string | Date }>(
        `SELECT id, owner_id, state_version, updated_at FROM fusion_engine.operations
         WHERE state = 'RECONCILIATION_REQUIRED' ORDER BY updated_at DESC LIMIT $1`,
        [limit],
      ),
      this.database.query<{
        operation_id: string; provider_id: string; provider_credits: string | number | bigint;
        disposition: string; recorded_at: string | Date;
      }>(`SELECT operation_id, provider_id, provider_credits, disposition, recorded_at
          FROM fusion_engine.provider_cost_outcomes ORDER BY recorded_at DESC LIMIT $1`, [limit]),
    ]);
    return {
      operationCounts: Object.fromEntries(operations.rows.map((row) => [row.state, Number(row.count)])),
      holds: holds.rows.map((row) => ({
        operationId: row.operation_id, ownerId: row.owner_id, state: row.state,
        heldCredits: Number(row.held_credits), quotedCredits: Number(row.quoted_credits), updatedAt: new Date(row.updated_at).toISOString(),
      })),
      reconciliations: reconciliations.rows.map((row) => ({
        operationId: row.id, ownerId: row.owner_id, stateVersion: Number(row.state_version), updatedAt: new Date(row.updated_at).toISOString(),
      })),
      providerCostOutcomes: outcomes.rows.map((row) => ({
        operationId: row.operation_id, providerId: row.provider_id, providerCredits: Number(row.provider_credits),
        disposition: row.disposition, recordedAt: new Date(row.recorded_at).toISOString(),
      })),
    };
  }

  /** Redacted, bounded admin projection for the Operations History table. */
  async adminOperations(limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new TypeError("invalid_durable_admin_limit");
    const result = await this.database.query<{
      id: string; owner_id: string; state: string; state_version: string | number | bigint;
      customer_credits: string | number | bigint; created_at: string | Date; updated_at: string | Date;
      reservation_state: string | null; held_credits: string | number | bigint | null;
      captured_credits: string | number | bigint | null; released_credits: string | number | bigint | null;
      provider_id: string | null; provider_credits: string | number | bigint | null; disposition: string | null;
    }>(`SELECT o.id, o.owner_id, o.state, o.state_version, o.customer_credits, o.created_at, o.updated_at,
          r.state AS reservation_state, r.held_credits, r.captured_credits, r.released_credits,
          a.provider_id, c.provider_credits, c.disposition
        FROM fusion_engine.operations o
        LEFT JOIN fusion_engine.credit_reservations r ON r.operation_id = o.id
        LEFT JOIN fusion_engine.operation_attempts a ON a.id = (
          SELECT id FROM fusion_engine.operation_attempts
          WHERE operation_id = o.id ORDER BY attempt_number DESC LIMIT 1
        )
        LEFT JOIN fusion_engine.provider_cost_outcomes c ON c.operation_id = o.id
        ORDER BY o.updated_at DESC LIMIT $1`, [limit]);
    return result.rows.map((row) => ({
      operationId: row.id, ownerId: row.owner_id, state: row.state, stateVersion: Number(row.state_version),
      customerCredits: Number(row.customer_credits), providerId: row.provider_id,
      reservation: row.reservation_state ? {
        state: row.reservation_state, heldCredits: Number(row.held_credits ?? 0),
        capturedCredits: Number(row.captured_credits ?? 0), releasedCredits: Number(row.released_credits ?? 0),
      } : null,
      providerCost: row.provider_credits === null ? null : {
        credits: Number(row.provider_credits), disposition: row.disposition ?? "UNKNOWN",
      },
      createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  /** Redacted customer directory derived from the durable wallet and operation records. */
  async adminOwnerDirectory(limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new TypeError("invalid_durable_admin_limit");
    const result = await this.database.query<{
      owner_id: string; available_credits: string | number | bigint | null; held_credits: string | number | bigint | null;
      spent_credits: string | number | bigint | null; operation_count: string | number | bigint;
      active_operation_count: string | number | bigint; last_operation_at: string | Date | null; wallet_updated_at: string | Date | null;
    }>(`WITH owners AS (
          SELECT owner_id FROM fusion_engine.wallets
          UNION
          SELECT owner_id FROM fusion_engine.operations
        )
        SELECT owners.owner_id, w.available_credits, w.held_credits, w.spent_credits,
          count(o.id) AS operation_count,
          count(o.id) FILTER (WHERE o.state NOT IN ('SETTLED', 'CANCELLED')) AS active_operation_count,
          max(o.updated_at) AS last_operation_at, max(w.updated_at) AS wallet_updated_at
        FROM owners
        LEFT JOIN fusion_engine.wallets w ON w.owner_id = owners.owner_id
        LEFT JOIN fusion_engine.operations o ON o.owner_id = owners.owner_id
        GROUP BY owners.owner_id, w.available_credits, w.held_credits, w.spent_credits
        ORDER BY COALESCE(max(o.updated_at), max(w.updated_at)) DESC
        LIMIT $1`, [limit]);
    return result.rows.map((row) => ({
      ownerId: row.owner_id,
      wallet: row.available_credits === null ? null : {
        availableCredits: Number(row.available_credits), heldCredits: Number(row.held_credits ?? 0), spentCredits: Number(row.spent_credits ?? 0),
      },
      operationCount: Number(row.operation_count), activeOperationCount: Number(row.active_operation_count),
      lastActivityAt: new Date(row.last_operation_at ?? row.wallet_updated_at ?? 0).toISOString(),
    }));
  }

  /** Explicit, fail-closed queue of durable states requiring operator attention. */
  async adminExceptionQueue(limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new TypeError("invalid_durable_admin_limit");
    const result = await this.database.query<{
      operation_id: string; owner_id: string; state: string; category: string; severity: "HIGH" | "CRITICAL";
      reason: string; updated_at: string | Date;
    }>(`SELECT o.id AS operation_id, o.owner_id, o.state,
          CASE
            WHEN a.last_error_code = 'SUCCESS_EVIDENCE_INCOMPLETE' THEN 'PROVIDER_SUCCESS_EVIDENCE_INCOMPLETE'
            WHEN a.last_error_code = 'SUCCESS_EVIDENCE_MISSING_PROVIDER_TASK_OR_RESULT_URL' THEN 'PROVIDER_SUCCESS_RESULT_MISSING'
            WHEN a.last_error_code = 'FAILED_PROVIDER_CHARGE_NOT_PROVEN_ZERO' THEN 'REFUND_EVIDENCE_REQUIRED'
            WHEN a.last_error_code LIKE 'ASSET_INGEST_UNPROVEN:%' OR a.last_error_code LIKE 'DELIVERY_UNPROVEN:%' THEN 'DELIVERY_EVIDENCE_REQUIRED'
            ELSE 'RECONCILIATION_REQUIRED'
          END AS category,
          'CRITICAL' AS severity,
          coalesce(a.last_error_code, 'protected_hold_requires_reconciliation') AS reason, o.updated_at
        FROM fusion_engine.operations o
        LEFT JOIN fusion_engine.operation_attempts a ON a.id = (
          SELECT id FROM fusion_engine.operation_attempts
          WHERE operation_id = o.id ORDER BY attempt_number DESC LIMIT 1
        )
        WHERE o.state = 'RECONCILIATION_REQUIRED'
      UNION ALL
      SELECT id AS operation_id, owner_id, state, 'SUBMISSION_UNKNOWN' AS category,
          'HIGH' AS severity, 'provider_acceptance_not_proven' AS reason, updated_at
        FROM fusion_engine.operations WHERE state = 'SUBMISSION_UNKNOWN'
      UNION ALL
      SELECT o.id AS operation_id, o.owner_id, o.state, 'OUTBOX_DEAD_LETTER' AS category,
          'HIGH' AS severity, coalesce(e.last_error_code, 'outbox_delivery_failed') AS reason, e.updated_at
        FROM fusion_engine.outbox_events e JOIN fusion_engine.operations o ON o.id = e.aggregate_id
        WHERE e.status = 'DEAD_LETTER'
      ORDER BY updated_at DESC LIMIT $1`, [limit]);
    return result.rows.map((row) => ({
      operationId: row.operation_id, ownerId: row.owner_id, state: row.state, category: row.category,
      severity: row.severity, reason: row.reason, updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  /** Read-only owner financial profile; no PII, prompt, asset path or mutation. */
  async adminOwnerFinanceView(ownerId: string, limit = 50) {
    if (!ownerId || ownerId.length > 200) throw new TypeError("invalid_durable_owner_id");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new TypeError("invalid_durable_admin_limit");
    const [wallet, operations, journals] = await Promise.all([
      this.database.query<{
        owner_id: string; available_credits: string | number | bigint; held_credits: string | number | bigint;
        spent_credits: string | number | bigint; version: string | number | bigint; updated_at: string | Date;
      }>("SELECT * FROM fusion_engine.wallets WHERE owner_id = $1", [ownerId]),
      this.database.query<{
        id: string; state: string; customer_credits: string | number | bigint; updated_at: string | Date;
      }>(`SELECT id, state, customer_credits, updated_at FROM fusion_engine.operations
          WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT $2`, [ownerId, limit]),
      this.database.query<{ kind: string; count: string | number | bigint }>(
        `SELECT j.kind, count(DISTINCT j.id) FROM fusion_engine.ledger_journals j
         LEFT JOIN fusion_engine.operations o ON o.id = j.operation_id
         LEFT JOIN fusion_engine.ledger_entries e ON e.journal_id = j.id
         WHERE o.owner_id = $1 OR e.account_id LIKE ('owner:' || $1 || ':%')
         GROUP BY j.kind`, [ownerId],
      ),
    ]);
    const current = wallet.rows[0];
    if (!current && !operations.rows.length) return null;
    return {
      ownerId,
      wallet: current ? {
        availableCredits: Number(current.available_credits), heldCredits: Number(current.held_credits), spentCredits: Number(current.spent_credits),
        version: Number(current.version), updatedAt: new Date(current.updated_at).toISOString(),
      } : null,
      operationCounts: operations.rows.reduce<Record<string, number>>((counts, operation) => {
        counts[operation.state] = (counts[operation.state] ?? 0) + 1; return counts;
      }, {}),
      journalCounts: Object.fromEntries(journals.rows.map((row) => [row.kind, Number(row.count)])),
      operations: operations.rows.map((operation) => ({
        operationId: operation.id, state: operation.state, customerCredits: Number(operation.customer_credits), updatedAt: new Date(operation.updated_at).toISOString(),
      })),
    };
  }

  private projectView(row: {
    project_id: string; document: Record<string, unknown> | string; version: string | number | bigint;
    created_at: string | Date; updated_at: string | Date;
  }): DurableCreativeProject {
    const document = typeof row.document === "string" ? JSON.parse(row.document) : row.document;
    return {
      projectId: row.project_id,
      document: structuredClone(document),
      version: Number(row.version),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async adminOperationHistory(operationId: string) {
    const operation = await this.database.query<Record<string, unknown>>(
      "SELECT * FROM fusion_engine.operations WHERE id = $1",
      [operationId],
    );
    if (!operation.rows[0]) return null;
    const [events, attempts, reservation, asset, delivery, outcome, journals] = await Promise.all([
      this.database.query<Record<string, unknown>>(
        "SELECT * FROM fusion_engine.operation_events WHERE operation_id = $1 ORDER BY sequence", [operationId],
      ),
      this.database.query<Record<string, unknown>>(
        "SELECT * FROM fusion_engine.operation_attempts WHERE operation_id = $1 ORDER BY attempt_number", [operationId],
      ),
      this.database.query<Record<string, unknown>>(
        "SELECT * FROM fusion_engine.credit_reservations WHERE operation_id = $1", [operationId],
      ),
      this.database.query<Record<string, unknown>>(
        "SELECT * FROM fusion_engine.operation_assets WHERE operation_id = $1", [operationId],
      ),
      this.database.query<Record<string, unknown>>(
        "SELECT * FROM fusion_engine.operation_deliveries WHERE operation_id = $1", [operationId],
      ),
      this.database.query<Record<string, unknown>>(
        "SELECT * FROM fusion_engine.provider_cost_outcomes WHERE operation_id = $1", [operationId],
      ),
      this.database.query<Record<string, unknown>>(
        `SELECT j.*, coalesce(json_agg(json_build_object('accountId', e.account_id, 'amount', e.amount)
           ORDER BY e.id) FILTER (WHERE e.id IS NOT NULL), '[]'::json) AS entries
         FROM fusion_engine.ledger_journals j
         LEFT JOIN fusion_engine.ledger_entries e ON e.journal_id = j.id
         WHERE j.operation_id = $1 GROUP BY j.id ORDER BY j.created_at`, [operationId],
      ),
    ]);
    return {
      operation: operation.rows[0],
      events: events.rows,
      attempts: attempts.rows,
      reservation: reservation.rows[0] ?? null,
      asset: asset.rows[0] ?? null,
      delivery: delivery.rows[0] ?? null,
      providerCostOutcome: outcome.rows[0] ?? null,
      journals: journals.rows,
    };
  }

  private async relayOneOutbox(): Promise<void> {
    const lease = await this.coordinator.claimNextOutbox("local-durable-relay", 10_000);
    if (!lease) return;
    try {
      const payload = ProviderGenerationRequestSchema.safeParse((lease.payload as Partial<DispatchPayload>).request);
      const providerId = (lease.payload as Partial<DispatchPayload>).providerId;
      const projectId = (lease.payload as Partial<DispatchPayload>).projectId;
      if (!payload.success || typeof providerId !== "string" || typeof projectId !== "string") {
        throw new Error("durable_outbox_payload_invalid");
      }
      const operation = await this.coordinator.operation(lease.operationId);
      const metadata = await this.quoteMetadata(operation.quoteId);
      const published = metadata?.executionEvidence.dispatchSource === "PUBLISHED_OFFER";
      if (!published) this.providersRequire(providerId);
      if (published && (metadata.executionEvidence.providerId !== providerId || metadata.executionEvidence.providerModelId !== payload.data.model)) {
        throw new Error("durable_published_offer_relay_evidence_mismatch");
      }
      const delivery = await this.coordinator.consumeQueuedDelivery({
        consumerName: "local-durable-generation-relay",
        eventId: lease.eventId,
        operationId: lease.operationId,
        payload: lease.payload,
        eventRecordId: randomUUID(),
      });
      if (delivery.operation.state === "QUEUED") {
        const routeGate = this.routeDispatchGuard(providerId, payload.data.model);
        if (!routeGate.allowed) {
          await this.coordinator.cancelQueuedBeforeDispatch({
            operationId: lease.operationId,
            expectedVersion: delivery.operation.stateVersion,
            commandId: `release-pre-dispatch:${lease.operationId}`,
            journalId: randomUUID(),
            eventRecordId: randomUUID(),
            evidenceHash: createHash("sha256").update(JSON.stringify({
              providerId,
              modelId: payload.data.model,
              reasonCode: routeGate.reasonCode,
              controlVersionId: routeGate.versionId,
            })).digest("hex"),
            reasonCode: `ADMIN_ROUTE_KILL_SWITCH:${routeGate.reasonCode ?? "UNSPECIFIED"}`,
          });
          await this.coordinator.acknowledgeOutbox(lease.eventId, lease.workerId);
          return;
        }
        await this.coordinator.beginDispatch({
          operationId: lease.operationId,
          expectedVersion: delivery.operation.stateVersion,
          attemptId: randomUUID(),
          attemptNumber: 1,
          providerId,
          providerIdempotencyKey: `provider-attempt:${lease.operationId}:1`,
          requestHash: delivery.operation.requestHash,
          requestPayload: payload.data,
          dispatchDeadlineAt: new Date(this.now().getTime() + this.attemptTimeoutMs).toISOString(),
          eventRecordId: randomUUID(),
        });
      }
      await this.coordinator.acknowledgeOutbox(lease.eventId, lease.workerId);
    } catch (error) {
      await this.coordinator.rejectOutbox({
        eventId: lease.eventId,
        workerId: lease.workerId,
        errorCode: errorCode(error),
        retryAt: new Date(this.now().getTime() + 1_000).toISOString(),
        maxAttempts: 5,
      });
    }
  }

  private async reconcileExpiredAttempts(): Promise<void> {
    const expired = await this.coordinator.expiredAttempts(this.now().toISOString());
    for (const item of expired) {
      const attempt = await this.coordinator.attempt(item.operationId, item.attemptNumber);
      if (!["SUBMISSION_UNKNOWN", "SUBMITTED", "RUNNING"].includes(attempt.state)) continue;
      await this.coordinator.advanceAttempt({
        operationId: attempt.operationId,
        attemptNumber: attempt.attemptNumber,
        expectedOperationState: attempt.operationState,
        expectedOperationVersion: attempt.operationStateVersion,
        expectedAttemptState: attempt.state,
        expectedAttemptVersion: attempt.version,
        nextAttemptState: "RECONCILIATION_REQUIRED",
        event: "operation.reconciliation_required.v1",
        actor: "reconciler",
        eventRecordId: randomUUID(),
        evidenceHash: createHash("sha256").update(JSON.stringify({
          attemptId: attempt.id,
          providerId: attempt.providerId,
          deadlineAt: attempt.dispatchDeadlineAt,
          observedAt: this.now().toISOString(),
        })).digest("hex"),
        lastErrorCode: "PROVIDER_ATTEMPT_DEADLINE_EXCEEDED",
      });
    }
  }

  private async requireOwnedAsset(ownerId: string, assetId: string): Promise<{ privateObjectId: string }> {
    const result = await this.database.query<{ private_object_id: string; owner_id: string }>(
      "SELECT private_object_id, owner_id FROM fusion_engine.operation_assets WHERE id = $1", [assetId],
    );
    if (!result.rows[0] || result.rows[0].owner_id !== ownerId) throw new Error("durable_asset_not_found_or_access_denied");
    return { privateObjectId: result.rows[0].private_object_id };
  }

  private async recordAssetAccess(input: { assetId: string; ownerId: string; action: "GRANT_ISSUED" | "READ_ALLOWED" | "READ_DENIED"; token: string }): Promise<void> {
    await this.database.query(
      `INSERT INTO fusion_engine.asset_access_events (id, asset_id, owner_id, action, token_hash, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), input.assetId, input.ownerId, input.action, createHash("sha256").update(input.token).digest("hex"), this.now().toISOString()],
    );
  }

  private async dispatchPayload(operationId: string): Promise<DispatchPayload> {
    const result = await this.database.query<{ payload: Record<string, unknown> | string }>(
      "SELECT payload FROM fusion_engine.outbox_events WHERE aggregate_id = $1 ORDER BY created_at LIMIT 1",
      [operationId],
    );
    if (!result.rows[0]) throw new Error("durable_dispatch_payload_not_found");
    const raw = typeof result.rows[0].payload === "string" ? JSON.parse(result.rows[0].payload) : result.rows[0].payload;
    const request = ProviderGenerationRequestSchema.parse((raw as Partial<DispatchPayload>).request);
    const providerId = (raw as Partial<DispatchPayload>).providerId;
    const projectId = (raw as Partial<DispatchPayload>).projectId;
    if (typeof providerId !== "string" || typeof projectId !== "string") throw new Error("durable_dispatch_payload_invalid");
    return { operationId, providerId, request, projectId };
  }

  private providersRequire(providerId: string): void {
    this.providers.require(providerId);
  }
}
