import { createHash } from "node:crypto";
import { requireAdminPermission } from "../../../packages/admin-control-plane/src/authorization.js";
import type { AdminIdentity } from "../../../packages/admin-control-plane/src/types.js";
import { PostgresProviderControlPlaneRepository } from "../../../packages/provider-control-plane/src/postgres-repository.js";
import {
  KieDocumentationCatalogImporter,
  isKieGenerativeModelDocumentation,
  kieOfficialCatalogIndexUrl,
  parseKieDocumentationPage,
  type KieDocumentationPageCapture,
} from "../../../packages/providers/src/kie-documentation-catalog.js";
import {
  OpenRouterReferenceCatalogBundleImporter,
  OpenRouterReferenceSourceLoader,
} from "../../../packages/providers/src/openrouter-reference-catalog.js";
import type { PublicReferenceCatalogSnapshot } from "../../../packages/providers/src/reference-catalog-importers.js";
import type { ProductionGatewayConfig } from "./config.js";
import { productionDatabase } from "./database-readiness.js";

type Row = Record<string, unknown>;

export class ProductionCatalogCommandError extends Error {
  constructor(
    readonly code: "CATALOG_COMMAND_INVALID" | "CATALOG_COMMAND_CONFLICT" | "CATALOG_SOURCE_FAILED" | "CATALOG_SOURCE_INCOMPLETE" | "REFERENCE_MODEL_NOT_FOUND" | "MODEL_PRESENTATION_INVALID",
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ProductionCatalogCommandError";
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

type ReviewedPresentationInput = Readonly<{
  productFamily: Readonly<{ id: string; displayName: string }>;
  version?: Readonly<{ id: string; displayName: string }>;
  edition?: Readonly<{ id: string; displayName: string }>;
  experienceCategories: readonly ("IMAGE" | "VIDEO" | "AVATAR" | "AUDIO")[];
}>;

function presentationText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) {
    throw new ProductionCatalogCommandError("MODEL_PRESENTATION_INVALID", `${field} is required and must be concise.`);
  }
  return value.trim();
}

function reviewedPresentation(value: unknown, sourceCatalogSnapshotId: string): ReviewedPresentationInput & { reviewState: "REVIEWED"; schemaVersion: 1; sourceCatalogSnapshotId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProductionCatalogCommandError("MODEL_PRESENTATION_INVALID", "A reviewed customer presentation is required.");
  }
  const input = value as Record<string, unknown>;
  const productFamily = input.productFamily;
  if (!productFamily || typeof productFamily !== "object" || Array.isArray(productFamily)) {
    throw new ProductionCatalogCommandError("MODEL_PRESENTATION_INVALID", "productFamily is required.");
  }
  const hierarchyPart = (candidate: unknown, field: string) => {
    if (candidate === undefined) return undefined;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new ProductionCatalogCommandError("MODEL_PRESENTATION_INVALID", `${field} must be an object when provided.`);
    }
    const item = candidate as Record<string, unknown>;
    return { id: presentationText(item.id, `${field}.id`), displayName: presentationText(item.displayName, `${field}.displayName`) };
  };
  if (!Array.isArray(input.experienceCategories) || input.experienceCategories.length === 0) {
    throw new ProductionCatalogCommandError("MODEL_PRESENTATION_INVALID", "At least one customer experience category is required.");
  }
  const experienceCategories = [...new Set(input.experienceCategories.map(String))];
  if (experienceCategories.some((item) => !["IMAGE", "VIDEO", "AVATAR", "AUDIO"].includes(item))) {
    throw new ProductionCatalogCommandError("MODEL_PRESENTATION_INVALID", "Customer experience categories are invalid.");
  }
  return {
    schemaVersion: 1,
    reviewState: "REVIEWED",
    sourceCatalogSnapshotId,
    productFamily: {
      id: presentationText((productFamily as Record<string, unknown>).id, "productFamily.id"),
      displayName: presentationText((productFamily as Record<string, unknown>).displayName, "productFamily.displayName"),
    },
    ...(hierarchyPart(input.version, "version") ? { version: hierarchyPart(input.version, "version") } : {}),
    ...(hierarchyPart(input.edition, "edition") ? { edition: hierarchyPart(input.edition, "edition") } : {}),
    experienceCategories: experienceCategories as ("IMAGE" | "VIDEO" | "AVATAR" | "AUDIO")[],
  };
}

async function readExisting(commandId: string, config: ProductionGatewayConfig): Promise<Record<string, unknown> | null> {
  const result = await productionDatabase(config).query<Row>(
    "SELECT entity_id,version,effective_at,payload FROM fusion_engine.provider_control_versions WHERE command_id=$1",
    [`${commandId}:snapshot`],
  );
  const row = result.rows[0];
  if (!row) return null;
  const value = typeof row.payload === "string" ? JSON.parse(row.payload) as Record<string, unknown> : row.payload as Record<string, unknown>;
  const count = await productionDatabase(config).query<Row>(
    "SELECT count(*) AS model_count FROM fusion_engine.provider_control_versions WHERE entity_type='REFERENCE_MODEL' AND payload->>'catalogSnapshotId'=$1",
    [row.entity_id],
  );
  return {
    snapshotId: row.entity_id,
    providerId: value.providerId,
    version: Number(row.version),
    observedAt: new Date(String(value.observedAt ?? row.effective_at)).toISOString(),
    modelCount: Number(count.rows[0]?.model_count ?? 0),
    replayed: true,
  };
}

async function responseBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.ok) throw new ProductionCatalogCommandError("CATALOG_SOURCE_FAILED", `Official catalog source returned HTTP ${response.status}.`, 502);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new ProductionCatalogCommandError("CATALOG_SOURCE_FAILED", "Official catalog source exceeded the intake limit.", 502);
  return text;
}

async function fetchJson(url: string, request: typeof fetch): Promise<{ body: unknown; observedAt: string; etag: string | null; contentType: string | null }> {
  let response: Response;
  try {
    response = await request(url, { headers: { accept: "application/json", "user-agent": "FusionLab-Catalog-Intake/1.0" }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new ProductionCatalogCommandError("CATALOG_SOURCE_FAILED", "Official catalog source could not be reached.", 502);
  }
  const text = await responseBody(response, 5 * 1024 * 1024);
  let body: unknown;
  try { body = JSON.parse(text); }
  catch { throw new ProductionCatalogCommandError("CATALOG_SOURCE_FAILED", "Official catalog source did not return valid JSON.", 502); }
  return { body, observedAt: new Date().toISOString(), etag: response.headers.get("etag"), contentType: response.headers.get("content-type") };
}

async function openRouterSnapshot(snapshotId: string, request: typeof fetch): Promise<PublicReferenceCatalogSnapshot> {
  const intake = await new OpenRouterReferenceSourceLoader().capture((url) => fetchJson(url, request));
  if (intake.failures.length) throw new ProductionCatalogCommandError("CATALOG_SOURCE_INCOMPLETE", "OpenRouter official catalog intake was incomplete; nothing was stored.", 502);
  return new OpenRouterReferenceCatalogBundleImporter().snapshotFromIntake({ id: snapshotId, intake });
}

async function fetchKieCapture(entry: { title: string; documentationUrl: string }, request: typeof fetch): Promise<KieDocumentationPageCapture | null> {
  const rawUrl = entry.documentationUrl.endsWith(".md") ? entry.documentationUrl : `${entry.documentationUrl}.md`;
  try {
    const response = await request(rawUrl, { headers: { accept: "text/markdown", "user-agent": "FusionLab-Catalog-Intake/1.0" }, signal: AbortSignal.timeout(15_000) });
    const rawMarkdown = await responseBody(response, 512 * 1024);
    const capture = { title: entry.title, documentationUrl: entry.documentationUrl, rawMarkdown };
    parseKieDocumentationPage(capture);
    return capture;
  } catch {
    // An index entry is admitted only when its own official page proves both
    // model ID and modality. Unparseable pages remain excluded evidence.
    return null;
  }
}

async function kieSnapshot(snapshotId: string, request: typeof fetch): Promise<PublicReferenceCatalogSnapshot> {
  let indexResponse: Response;
  try {
    indexResponse = await request(kieOfficialCatalogIndexUrl, { headers: { accept: "text/plain", "user-agent": "FusionLab-Catalog-Intake/1.0" }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new ProductionCatalogCommandError("CATALOG_SOURCE_FAILED", "KIE official documentation index could not be reached.", 502);
  }
  const indexMarkdown = await responseBody(indexResponse, 1024 * 1024);
  const importer = new KieDocumentationCatalogImporter();
  const candidates = importer.discover(indexMarkdown).filter((entry) => isKieGenerativeModelDocumentation(entry.title));
  const captures: KieDocumentationPageCapture[] = [];
  for (let offset = 0; offset < candidates.length; offset += 16) {
    const batch = await Promise.all(candidates.slice(offset, offset + 16).map((entry) => fetchKieCapture(entry, request)));
    captures.push(...batch.filter((entry): entry is KieDocumentationPageCapture => entry !== null));
  }
  const deduplicated = new Map<string, KieDocumentationPageCapture>();
  for (const capture of captures) {
    const descriptor = parseKieDocumentationPage(capture);
    if (!deduplicated.has(descriptor.providerModelId)) deduplicated.set(descriptor.providerModelId, capture);
  }
  if (!deduplicated.size) throw new ProductionCatalogCommandError("CATALOG_SOURCE_INCOMPLETE", "KIE index contained no model pages with verified request examples.", 502);
  return importer.snapshot({ id: snapshotId, observedAt: new Date().toISOString(), indexMarkdown, captures: [...deduplicated.values()] });
}

export async function importProductionReferenceCatalog(input: {
  providerId: "kie" | "openrouter";
  commandId: string | undefined;
  identity: AdminIdentity;
  config: ProductionGatewayConfig;
  request?: typeof fetch;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  requireAdminPermission(input.identity, "DRAFT", "REFERENCE_CATALOG_SNAPSHOT");
  if (!input.commandId || input.commandId.length < 8 || input.commandId.length > 120) {
    throw new ProductionCatalogCommandError("CATALOG_COMMAND_INVALID", "A valid idempotency key is required.");
  }
  const replay = await readExisting(input.commandId, input.config);
  if (replay) return { status: 200, body: replay };
  const snapshotId = `snapshot.${input.providerId}.public.${sha256(input.commandId).slice(0, 24)}`;
  const snapshot = input.providerId === "openrouter"
    ? await openRouterSnapshot(snapshotId, input.request ?? fetch)
    : await kieSnapshot(snapshotId, input.request ?? fetch);
  const repository = new PostgresProviderControlPlaneRepository(productionDatabase(input.config), () => new Date(snapshot.observedAt));
  const stored = await repository.appendReferenceCatalog({
    commandId: input.commandId,
    approvalEvidenceSha256: snapshot.manifestSha256,
    effectiveAt: snapshot.observedAt,
    snapshot: {
      id: snapshot.id,
      providerId: snapshot.providerId,
      observedAt: snapshot.observedAt,
      sourceUrls: snapshot.sourceUrls,
      rawPayloadSha256: snapshot.rawPayloadSha256,
      manifestSha256: snapshot.manifestSha256,
      parserVersion: snapshot.parserVersion,
      sourceScope: snapshot.sourceScope,
    },
    models: snapshot.models.map((model) => ({
      id: model.id,
      providerId: model.providerId,
      providerModelId: model.providerModelId,
      familyId: model.familyId,
      displayName: model.displayName,
      modalities: model.modalities,
      state: model.state,
      catalogSnapshotId: snapshot.id,
      sourceEvidenceSha256: model.sourceEvidenceSha256,
      canonicalSlug: model.canonicalSlug,
      supportedParameters: model.supportedParameters,
      sourceUrls: model.sourceUrls,
      taxonomyHint: model.taxonomyHint,
    })),
  });
  return { status: 201, body: { snapshotId: stored.snapshot.entityId, providerId: snapshot.providerId, version: stored.snapshot.version, observedAt: snapshot.observedAt, modelCount: stored.models.length, replayed: false } };
}

function selectionMetadata(row: Row): Record<string, unknown> {
  return {
    referenceModelId: String(row.reference_model_id),
    providerId: String(row.provider_id),
    catalogSnapshotId: String(row.catalog_snapshot_id),
    state: String(row.state),
    version: Number(row.version),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function changeProductionModelSelection(input: {
  referenceModelId: string;
  action: "SELECT" | "UNSELECT";
  commandId: string | undefined;
  identity: AdminIdentity;
  config: ProductionGatewayConfig;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  requireAdminPermission(input.identity, "DRAFT", "ROUTE_CANDIDATE");
  if (!input.commandId || input.commandId.length < 8 || input.commandId.length > 160 || !/^reference\.(kie|openrouter)\.[a-f0-9]{24}$/.test(input.referenceModelId)) {
    throw new ProductionCatalogCommandError("CATALOG_COMMAND_INVALID", "A valid model reference and idempotency key are required.");
  }
  const database = productionDatabase(input.config);
  const requestHash = sha256(JSON.stringify({ action: input.action, referenceModelId: input.referenceModelId }));
  const prior = await database.query<Row>("SELECT request_hash,response FROM fusion_engine.provider_model_selection_commands WHERE command_id=$1", [input.commandId]);
  if (prior.rows[0]) {
    if (prior.rows[0].request_hash !== requestHash) throw new ProductionCatalogCommandError("CATALOG_COMMAND_CONFLICT", "The idempotency key is bound to another model-selection intent.", 409);
    const response = typeof prior.rows[0].response === "string" ? JSON.parse(prior.rows[0].response) as Record<string, unknown> : prior.rows[0].response as Record<string, unknown>;
    return { status: 200, body: response };
  }
  const model = await database.query<Row>(`SELECT version.payload FROM fusion_engine.provider_control_entities entity
    JOIN fusion_engine.provider_control_versions version ON version.entity_type=entity.entity_type AND version.entity_id=entity.entity_id AND version.version=entity.current_version
    WHERE entity.entity_type='REFERENCE_MODEL' AND entity.entity_id=$1`, [input.referenceModelId]);
  if (!model.rows[0]) throw new ProductionCatalogCommandError("REFERENCE_MODEL_NOT_FOUND", "The official reference model does not exist.", 404);
  const modelPayload = typeof model.rows[0].payload === "string" ? JSON.parse(model.rows[0].payload) as Record<string, unknown> : model.rows[0].payload as Record<string, unknown>;
  const targetState = input.action === "SELECT" ? "SELECTED" : "UNSELECTED";
  const response = await database.transaction(async (transaction) => {
    const repeated = await transaction.query<Row>("SELECT request_hash,response FROM fusion_engine.provider_model_selection_commands WHERE command_id=$1 FOR UPDATE", [input.commandId]);
    if (repeated.rows[0]) {
      if (repeated.rows[0].request_hash !== requestHash) throw new ProductionCatalogCommandError("CATALOG_COMMAND_CONFLICT", "The idempotency key is bound to another model-selection intent.", 409);
      return typeof repeated.rows[0].response === "string" ? JSON.parse(repeated.rows[0].response) as Record<string, unknown> : repeated.rows[0].response as Record<string, unknown>;
    }
    const before = await transaction.query<Row>("SELECT * FROM fusion_engine.provider_model_selections WHERE reference_model_id=$1 FOR UPDATE", [input.referenceModelId]);
    const version = Number(before.rows[0]?.version ?? 0) + 1;
    const updated = await transaction.query<Row>(`INSERT INTO fusion_engine.provider_model_selections
      (reference_model_id,provider_id,catalog_snapshot_id,state,version,selected_by,selected_at,unselected_by,unselected_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $4='SELECTED' THEN now() ELSE NULL END,$7,CASE WHEN $4='UNSELECTED' THEN now() ELSE NULL END,now())
      ON CONFLICT(reference_model_id) DO UPDATE SET provider_id=excluded.provider_id,catalog_snapshot_id=excluded.catalog_snapshot_id,state=excluded.state,version=excluded.version,
      selected_by=CASE WHEN excluded.state='SELECTED' THEN excluded.selected_by ELSE fusion_engine.provider_model_selections.selected_by END,
      selected_at=CASE WHEN excluded.state='SELECTED' THEN now() ELSE fusion_engine.provider_model_selections.selected_at END,
      unselected_by=CASE WHEN excluded.state='UNSELECTED' THEN excluded.unselected_by ELSE fusion_engine.provider_model_selections.unselected_by END,
      unselected_at=CASE WHEN excluded.state='UNSELECTED' THEN now() ELSE fusion_engine.provider_model_selections.unselected_at END,updated_at=now() RETURNING *`,
      [input.referenceModelId, modelPayload.providerId, modelPayload.catalogSnapshotId, targetState, version, input.action === "SELECT" ? input.identity.actorId : null, input.action === "UNSELECT" ? input.identity.actorId : null]);
    const value = selectionMetadata(updated.rows[0]!);
    await transaction.query("INSERT INTO fusion_engine.provider_model_selection_commands(command_id,actor_id,action,request_hash,reference_model_id,response) VALUES($1,$2,$3,$4,$5,$6::jsonb)", [input.commandId, input.identity.actorId, input.action, requestHash, input.referenceModelId, JSON.stringify(value)]);
    await transaction.query("INSERT INTO fusion_engine.provider_model_selection_audit(command_id,actor_id,action,reference_model_id,before_state,after_state,evidence_hash) VALUES($1,$2,$3,$4,$5,$6,$7)", [input.commandId, input.identity.actorId, `MODEL_${input.action}ED`, input.referenceModelId, before.rows[0]?.state ?? null, targetState, sha256(`${requestHash}:${version}:${targetState}`)]);
    return value;
  });
  return { status: 200, body: response };
}

/**
 * Records the customer-safe product hierarchy as an immutable model revision.
 * It does not select a route, sync pricing, call a provider, or publish an
 * offer. The source snapshot is pinned so a later catalog refresh cannot
 * silently change a name shown to customers.
 */
export async function reviewProductionModelPresentation(input: {
  referenceModelId: string;
  presentation: unknown;
  commandId: string | undefined;
  identity: AdminIdentity;
  config: ProductionGatewayConfig;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  requireAdminPermission(input.identity, "DRAFT", "REFERENCE_MODEL");
  if (!input.commandId || input.commandId.length < 8 || input.commandId.length > 160 || !/^reference\.(kie|openrouter)\.[a-f0-9]{24}$/.test(input.referenceModelId)) {
    throw new ProductionCatalogCommandError("CATALOG_COMMAND_INVALID", "A valid model reference and idempotency key are required.");
  }
  const database = productionDatabase(input.config);
  const current = await database.query<Row>(`SELECT version.version,version.payload FROM fusion_engine.provider_control_entities entity
    JOIN fusion_engine.provider_control_versions version ON version.entity_type=entity.entity_type AND version.entity_id=entity.entity_id AND version.version=entity.current_version
    WHERE entity.entity_type='REFERENCE_MODEL' AND entity.entity_id=$1`, [input.referenceModelId]);
  if (!current.rows[0]) throw new ProductionCatalogCommandError("REFERENCE_MODEL_NOT_FOUND", "The official reference model does not exist.", 404);
  const currentPayload = typeof current.rows[0].payload === "string" ? JSON.parse(current.rows[0].payload) as Record<string, unknown> : current.rows[0].payload as Record<string, unknown>;
  const catalogSnapshotId = presentationText(currentPayload.catalogSnapshotId, "catalogSnapshotId");
  const taxonomy = reviewedPresentation(input.presentation, catalogSnapshotId);
  const nextPayload = { ...currentPayload, reviewedTaxonomy: taxonomy };
  const stored = await new PostgresProviderControlPlaneRepository(database).appendVersion({
    entityType: "REFERENCE_MODEL",
    entityId: input.referenceModelId,
    commandId: input.commandId,
    payload: nextPayload,
    evidenceSha256: sha256(JSON.stringify({ referenceModelId: input.referenceModelId, catalogSnapshotId, sourceVersion: Number(current.rows[0].version), taxonomy })),
    effectiveAt: new Date().toISOString(),
  });
  return { status: 200, body: { referenceModelId: stored.entityId, version: stored.version, reviewedTaxonomy: taxonomy } };
}
