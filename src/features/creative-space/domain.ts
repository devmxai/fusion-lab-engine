import type { StandardProjectionV1 } from "./standard-projection-contract";

export type SpaceMediaKind = "IMAGE" | "VIDEO" | "AUDIO";
export type SpaceAssetStatus = "UPLOADING" | "VERIFYING" | "READY" | "FAILED";
export type SpaceViewMode = "STANDARD" | "PROFESSIONAL";
export type ProjectLifecycleState = "ACTIVE" | "ARCHIVED" | "DELETED";

/**
 * Display facts decoded from the private delivered file itself.  They are
 * deliberately separate from the generation request and can never affect a
 * route, quote, provider request, or financial decision.
 */
export type SpaceAssetMediaMetadata = {
  width?: number;
  height?: number;
  durationMs?: number;
  hasAudio?: boolean;
};

export type SpaceAsset = {
  id: string;
  projectId: string;
  kind: SpaceMediaKind;
  name: string;
  mimeType: string;
  bytes: number;
  status: SpaceAssetStatus;
  origin?: "UPLOAD" | "GENERATED";
  operationId?: string;
  /** Stable Engine asset identity. A browser Blob URL is never project truth. */
  deliveryAssetId?: string;
  resultUrl?: string;
  checksumSha256?: string;
  mediaMetadata?: SpaceAssetMediaMetadata;
  createdAt: string;
};

export type SpaceOperationState =
  | "RESERVED" | "QUEUED" | "DISPATCHING" | "SUBMISSION_UNKNOWN"
  | "SUBMITTED" | "RUNNING" | "PROVIDER_SUCCEEDED" | "PROVIDER_FAILED"
  | "ASSET_STORED" | "DELIVERED" | "DELIVERY_FAILED" | "SETTLED"
  | "RECONCILIATION_REQUIRED";

export type SpaceOperation = {
  id: string;
  projectId: string;
  quoteId: string;
  recipeId: string;
  modelId: string;
  provider: string;
  state: SpaceOperationState;
  /** Final customer debit when terminal financial evidence exists; null when unproven. */
  customerChargedCredits: number | null;
  customerCredits: number;
  /** Actual provider charge when evidenced; never inferred from the estimate. */
  providerActualCredits: number | null;
  /** Internal/local-fixture observation only. Published customer operations do not receive this value. */
  providerEstimateCredits: number | null;
  outputAssetId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SpaceBinding = {
  id: string;
  operationId: string;
  assetId: string;
  role: "SOURCE" | "FIRST_FRAME" | "LAST_FRAME" | "REFERENCE" | "AUDIO" | "VOICE_AUDIO" | "MOTION";
  ordinal: number;
};

export type SpaceCanvasItem = {
  id: string;
  entityType: "ASSET" | "OPERATION";
  entityId: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
};

export type SpaceViewport = { x: number; y: number; zoom: number };

export type ProfessionalGraphGroup = Readonly<{
  id: string;
  projectId: string;
  title: string;
  canvasItemIds: readonly string[];
  createdAt: string;
}>;

export type ProfessionalSubflow = Readonly<{
  id: string;
  projectId: string;
  title: string;
  operationIds: readonly string[];
  outputAssetIds: readonly string[];
  createdAt: string;
}>;

export type ProfessionalGraphTemplate = Readonly<{
  id: string;
  projectId: string;
  title: string;
  groupId: string;
  canvasItemIds: readonly string[];
  bindingIds: readonly string[];
  createdAt: string;
}>;

export type ProfessionalBatchBranch = Readonly<{
  id: string;
  projectId: string;
  title: string;
  recipeId: string;
  sourceAssetIds: readonly string[];
  state: "DRAFT";
  executionAllowed: false;
  createdAt: string;
}>;

export type ProfessionalAdvancedShot = Readonly<{
  id: string;
  projectId: string;
  title: string;
  sourceAssetId: string;
  durationMs: number;
  state: "DRAFT";
  executionAllowed: false;
  createdAt: string;
}>;

export type ProfessionalTimelineTrack = Readonly<{
  id: string;
  projectId: string;
  title: string;
  kind: "SHOT_PLAN";
  createdAt: string;
}>;

export type ProfessionalTimelineClip = Readonly<{
  id: string;
  projectId: string;
  trackId: string;
  shotId: string;
  startMs: number;
  durationMs: number;
  createdAt: string;
}>;

export type ProfessionalGraphState = Readonly<{
  schemaVersion: 1;
  groups: Record<string, ProfessionalGraphGroup>;
  subflows: Record<string, ProfessionalSubflow>;
  templates: Record<string, ProfessionalGraphTemplate>;
  batchBranches: Record<string, ProfessionalBatchBranch>;
  advancedShots: Record<string, ProfessionalAdvancedShot>;
  timelineTracks: Record<string, ProfessionalTimelineTrack>;
  timelineClips: Record<string, ProfessionalTimelineClip>;
}>;

export type SpaceActivity = {
  id: string;
  type: "PROJECT_CREATED" | "PROJECT_RENAMED" | "PROJECT_ARCHIVED" | "PROJECT_RESTORED" | "PROJECT_DELETED" | "PROJECT_DUPLICATED" | "ASSET_ADDED" | "ITEM_MOVED" | "OPERATION_RESERVED" | "OUTPUT_READY" | "OPERATION_FAILED" | "PROFESSIONAL_GRAPH_UPDATED";
  summary: string;
  occurredAt: string;
};

export type CreativeSpaceProject = {
  schemaVersion: 1;
  projectId: string;
  title: string;
  lifecycle?: { state: ProjectLifecycleState; changedAt: string };
  duplicatedFromProjectId?: string;
  /** Optional so saved Standard projects remain valid without a storage migration. */
  viewMode?: SpaceViewMode;
  /** Optional so saved Standard projects remain valid without a storage migration. */
  professionalGraph?: ProfessionalGraphState;
  /** Optional presentation metadata. Canonical assets, operations and bindings are never duplicated here. */
  standardProjection?: StandardProjectionV1;
  assets: Record<string, SpaceAsset>;
  operations: Record<string, SpaceOperation>;
  bindings: Record<string, SpaceBinding>;
  canvasItems: Record<string, SpaceCanvasItem>;
  viewport: SpaceViewport;
  activity: SpaceActivity[];
  updatedAt: string;
};

export function createCreativeSpaceProject(projectId: string, now = new Date()): CreativeSpaceProject {
  if (!projectId.trim()) throw new TypeError("Project identity is required.");
  const timestamp = now.toISOString();
  return {
    schemaVersion: 1,
    projectId,
    title: projectId === "local-demo" ? "مشروع تجريبي" : `Project ${projectId}`,
    lifecycle: { state: "ACTIVE", changedAt: timestamp },
    assets: {},
    operations: {},
    bindings: {},
    canvasItems: {},
    viewport: { x: 0, y: 0, zoom: 1 },
    activity: [{ id: crypto.randomUUID(), type: "PROJECT_CREATED", summary: "تم إنشاء مساحة المشروع", occurredAt: timestamp }],
    updatedAt: timestamp,
  };
}

export function getSpaceViewMode(project: CreativeSpaceProject): SpaceViewMode {
  return project.viewMode ?? "STANDARD";
}

/**
 * Makes legacy local project documents safe to read without inventing past
 * financial facts. A missing final amount remains unknown, not zero or quote.
 */
export function normalizeOperationFinancialEvidence(project: CreativeSpaceProject): CreativeSpaceProject {
  let changed = false;
  const operations = Object.fromEntries(Object.entries(project.operations).map(([id, operation]) => {
    const legacy = operation as SpaceOperation & Partial<Pick<SpaceOperation, "customerChargedCredits" | "providerActualCredits">>;
    const customerChargedCredits = Number.isSafeInteger(legacy.customerChargedCredits) && legacy.customerChargedCredits >= 0
      ? legacy.customerChargedCredits
      : null;
    const providerActualCredits = Number.isSafeInteger(legacy.providerActualCredits) && legacy.providerActualCredits >= 0
      ? legacy.providerActualCredits
      : null;
    if (legacy.customerChargedCredits !== customerChargedCredits || legacy.providerActualCredits !== providerActualCredits) changed = true;
    return [id, { ...legacy, customerChargedCredits, providerActualCredits }];
  }));
  return changed ? { ...project, operations } : project;
}

/** Changes presentation only; assets, operations, bindings, and canvas data stay untouched. */
export function setSpaceViewMode(
  project: CreativeSpaceProject,
  viewMode: SpaceViewMode,
  now = new Date(),
): CreativeSpaceProject {
  return { ...project, viewMode, updatedAt: now.toISOString() };
}

function emptyProfessionalGraph(): ProfessionalGraphState {
  return { schemaVersion: 1, groups: {}, subflows: {}, templates: {}, batchBranches: {}, advancedShots: {}, timelineTracks: {}, timelineClips: {} };
}

export function getProfessionalGraph(project: CreativeSpaceProject): ProfessionalGraphState {
  const graph = project.professionalGraph;
  if (!graph) return emptyProfessionalGraph();
  const empty = emptyProfessionalGraph();
  return {
    ...empty,
    ...graph,
    groups: graph.groups ?? {}, subflows: graph.subflows ?? {}, templates: graph.templates ?? {}, batchBranches: graph.batchBranches ?? {},
    advancedShots: graph.advancedShots ?? {}, timelineTracks: graph.timelineTracks ?? {}, timelineClips: graph.timelineClips ?? {},
  };
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function graphActivity(summary: string, now: Date): SpaceActivity {
  return { id: crypto.randomUUID(), type: "PROFESSIONAL_GRAPH_UPDATED", summary, occurredAt: now.toISOString() };
}

function persistProfessionalGraph(project: CreativeSpaceProject, professionalGraph: ProfessionalGraphState, summary: string, now: Date): CreativeSpaceProject {
  return {
    ...project,
    professionalGraph,
    activity: [graphActivity(summary, now), ...project.activity].slice(0, 100),
    updatedAt: now.toISOString(),
  };
}

export function createProfessionalGroup(
  project: CreativeSpaceProject,
  input: { title: string; canvasItemIds: readonly string[] },
  now = new Date(),
): CreativeSpaceProject {
  const canvasItemIds = uniqueIds(input.canvasItemIds);
  if (!input.title.trim() || canvasItemIds.length === 0 || canvasItemIds.some((id) => !project.canvasItems[id])) {
    throw new TypeError("Space groups require a title and existing canvas items.");
  }
  const graph = getProfessionalGraph(project);
  const group: ProfessionalGraphGroup = { id: crypto.randomUUID(), projectId: project.projectId, title: input.title.trim(), canvasItemIds, createdAt: now.toISOString() };
  return persistProfessionalGraph(project, { ...graph, groups: { ...graph.groups, [group.id]: group } }, `Space group created · ${group.title}`, now);
}

export function createProfessionalSubflow(
  project: CreativeSpaceProject,
  input: { title: string; operationIds: readonly string[]; outputAssetIds: readonly string[] },
  now = new Date(),
): CreativeSpaceProject {
  const operationIds = uniqueIds(input.operationIds);
  const outputAssetIds = uniqueIds(input.outputAssetIds);
  if (!input.title.trim()
    || operationIds.length === 0
    || operationIds.some((id) => !project.operations[id])
    || outputAssetIds.some((id) => !project.assets[id] || project.assets[id].origin !== "GENERATED")) {
    throw new TypeError("Space subflows require known operations and generated outputs.");
  }
  const graph = getProfessionalGraph(project);
  const subflow: ProfessionalSubflow = { id: crypto.randomUUID(), projectId: project.projectId, title: input.title.trim(), operationIds, outputAssetIds, createdAt: now.toISOString() };
  return persistProfessionalGraph(project, { ...graph, subflows: { ...graph.subflows, [subflow.id]: subflow } }, `Space subflow created · ${subflow.title}`, now);
}

export function saveProfessionalTemplate(
  project: CreativeSpaceProject,
  input: { title: string; groupId: string },
  now = new Date(),
): CreativeSpaceProject {
  const graph = getProfessionalGraph(project);
  const group = graph.groups[input.groupId];
  if (!input.title.trim() || !group) throw new TypeError("Space templates require an existing group and title.");
  const entityIds = new Set(group.canvasItemIds.map((itemId) => project.canvasItems[itemId].entityId));
  const bindingIds = Object.values(project.bindings)
    .filter((binding) => entityIds.has(binding.assetId) || entityIds.has(binding.operationId))
    .map((binding) => binding.id)
    .sort();
  const template: ProfessionalGraphTemplate = {
    id: crypto.randomUUID(), projectId: project.projectId, title: input.title.trim(), groupId: group.id,
    canvasItemIds: [...group.canvasItemIds], bindingIds, createdAt: now.toISOString(),
  };
  return persistProfessionalGraph(project, { ...graph, templates: { ...graph.templates, [template.id]: template } }, `Space template saved · ${template.title}`, now);
}

export function prepareProfessionalBatchBranch(
  project: CreativeSpaceProject,
  input: { title: string; recipeId: string; sourceAssetIds: readonly string[] },
  now = new Date(),
): CreativeSpaceProject {
  const sourceAssetIds = uniqueIds(input.sourceAssetIds);
  if (!input.title.trim()
    || !input.recipeId.trim()
    || sourceAssetIds.length === 0
    || sourceAssetIds.some((id) => !project.assets[id] || project.assets[id].status !== "READY")) {
    throw new TypeError("Space batch branches require a title, recipe, and ready source assets.");
  }
  const graph = getProfessionalGraph(project);
  const batch: ProfessionalBatchBranch = {
    id: crypto.randomUUID(), projectId: project.projectId, title: input.title.trim(), recipeId: input.recipeId.trim(), sourceAssetIds,
    state: "DRAFT", executionAllowed: false, createdAt: now.toISOString(),
  };
  return persistProfessionalGraph(project, { ...graph, batchBranches: { ...graph.batchBranches, [batch.id]: batch } }, `Space batch prepared · ${batch.title}`, now);
}

export function createProfessionalAdvancedShot(
  project: CreativeSpaceProject,
  input: { title: string; sourceAssetId: string; durationMs: number },
  now = new Date(),
): CreativeSpaceProject {
  const source = project.assets[input.sourceAssetId];
  if (!input.title.trim()
    || !source
    || source.status !== "READY"
    || !["IMAGE", "VIDEO"].includes(source.kind)
    || !Number.isSafeInteger(input.durationMs)
    || input.durationMs < 1_000
    || input.durationMs > 60_000) {
    throw new TypeError("Advanced shots require a ready image/video source and a 1–60 second duration.");
  }
  const graph = getProfessionalGraph(project);
  const track = Object.values(graph.timelineTracks).find((candidate) => candidate.kind === "SHOT_PLAN") ?? {
    id: crypto.randomUUID(), projectId: project.projectId, title: "Shot plan", kind: "SHOT_PLAN" as const, createdAt: now.toISOString(),
  };
  const startMs = Object.values(graph.timelineClips)
    .filter((clip) => clip.trackId === track.id)
    .reduce((latest, clip) => Math.max(latest, clip.startMs + clip.durationMs), 0);
  const shot: ProfessionalAdvancedShot = {
    id: crypto.randomUUID(), projectId: project.projectId, title: input.title.trim(), sourceAssetId: source.id, durationMs: input.durationMs,
    state: "DRAFT", executionAllowed: false, createdAt: now.toISOString(),
  };
  const clip: ProfessionalTimelineClip = {
    id: crypto.randomUUID(), projectId: project.projectId, trackId: track.id, shotId: shot.id, startMs, durationMs: shot.durationMs, createdAt: now.toISOString(),
  };
  return persistProfessionalGraph(project, {
    ...graph,
    advancedShots: { ...graph.advancedShots, [shot.id]: shot },
    timelineTracks: { ...graph.timelineTracks, [track.id]: track },
    timelineClips: { ...graph.timelineClips, [clip.id]: clip },
  }, `Advanced shot drafted · ${shot.title}`, now);
}

export function mediaKindFromMime(mimeType: string): SpaceMediaKind | null {
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (mimeType.startsWith("video/")) return "VIDEO";
  if (mimeType.startsWith("audio/")) return "AUDIO";
  return null;
}

export function addLocalAsset(
  project: CreativeSpaceProject,
  input: { name: string; mimeType: string; bytes: number; position: { x: number; y: number } },
  now = new Date(),
): CreativeSpaceProject {
  const kind = mediaKindFromMime(input.mimeType);
  if (!kind) throw new TypeError("Only image, video, or audio files are supported.");
  if (!input.name || !Number.isSafeInteger(input.bytes) || input.bytes < 0) throw new TypeError("Asset metadata is invalid.");
  const assetId = crypto.randomUUID();
  const canvasId = crypto.randomUUID();
  const timestamp = now.toISOString();
  const asset: SpaceAsset = {
    id: assetId,
    projectId: project.projectId,
    kind,
    name: input.name,
    mimeType: input.mimeType,
    bytes: input.bytes,
    status: "READY",
    origin: "UPLOAD",
    createdAt: timestamp,
  };
  const canvasItem: SpaceCanvasItem = {
    id: canvasId,
    entityType: "ASSET",
    entityId: assetId,
    position: { ...input.position },
    size: { width: 248, height: 176 },
    zIndex: Object.keys(project.canvasItems).length + 1,
  };
  const activity: SpaceActivity = {
    id: crypto.randomUUID(),
    type: "ASSET_ADDED",
    summary: `${input.name} · ${kind}`,
    occurredAt: timestamp,
  };
  return {
    ...project,
    assets: { ...project.assets, [assetId]: asset },
    canvasItems: { ...project.canvasItems, [canvasId]: canvasItem },
    activity: [activity, ...project.activity].slice(0, 100),
    updatedAt: timestamp,
  };
}

/** Adds a server-verified private upload to the project using its Engine ID. */
export function addVerifiedUploadedAsset(
  project: CreativeSpaceProject,
  input: { id: string; name: string; mimeType: string; bytes: number; checksumSha256: string; position?: { x: number; y: number } },
  now = new Date(),
): CreativeSpaceProject {
  const kind = mediaKindFromMime(input.mimeType);
  if (kind !== "IMAGE" || !input.id || !/^[a-f0-9]{64}$/.test(input.checksumSha256)) throw new TypeError("Verified image metadata is invalid.");
  if (project.assets[input.id]) return project;
  const timestamp = now.toISOString();
  const asset: SpaceAsset = {
    id: input.id, projectId: project.projectId, kind, name: input.name, mimeType: input.mimeType,
    bytes: input.bytes, status: "READY", origin: "UPLOAD", checksumSha256: input.checksumSha256, createdAt: timestamp,
  };
  const canvasId = `asset:${input.id}`;
  const canvasItem: SpaceCanvasItem = {
    id: canvasId, entityType: "ASSET", entityId: input.id,
    position: input.position ?? { x: 24, y: 24 }, size: { width: 248, height: 176 },
    zIndex: Object.keys(project.canvasItems).length + 1,
  };
  const activity: SpaceActivity = { id: crypto.randomUUID(), type: "ASSET_ADDED", summary: `Asset uploaded · ${input.name}`, occurredAt: timestamp };
  return {
    ...project,
    assets: { ...project.assets, [asset.id]: asset },
    canvasItems: { ...project.canvasItems, [canvasId]: canvasItem },
    activity: [activity, ...project.activity].slice(0, 100), updatedAt: timestamp,
  };
}

export function placeReservedImageOperation(
  project: CreativeSpaceProject,
  input: {
    operation: { id: string; quoteId: string; provider: string; modelId: string; state: "RESERVED"; financials: { customerQuotedCredits: number; providerEstimatedCredits?: number }; createdAt: string };
    recipeId: string;
    inputAssetId: string | null;
    inputRole: SpaceBinding["role"];
    anchor: { x: number; y: number };
  },
  now = new Date(),
): CreativeSpaceProject {
  if (project.operations[input.operation.id]) return project;
  const timestamp = now.toISOString();
  const canvasId = `operation:${input.operation.id}`;
  const operation: SpaceOperation = {
    id: input.operation.id,
    projectId: project.projectId,
    quoteId: input.operation.quoteId,
    recipeId: input.recipeId,
    modelId: input.operation.modelId,
    provider: input.operation.provider,
    state: "RESERVED",
    customerChargedCredits: null,
    customerCredits: input.operation.financials.customerQuotedCredits,
    providerActualCredits: null,
    providerEstimateCredits: input.operation.financials.providerEstimatedCredits ?? null,
    outputAssetId: null,
    createdAt: input.operation.createdAt,
    updatedAt: timestamp,
  };
  const canvasItem: SpaceCanvasItem = {
    id: canvasId,
    entityType: "OPERATION",
    entityId: operation.id,
    position: { ...input.anchor },
    size: { width: 248, height: 176 },
    zIndex: Object.keys(project.canvasItems).length + 1,
  };
  const binding = input.inputAssetId ? {
    id: `binding:${operation.id}:0`,
    operationId: operation.id,
    assetId: input.inputAssetId,
    role: input.inputRole,
    ordinal: 0,
  } satisfies SpaceBinding : null;
  const activity: SpaceActivity = {
    id: crypto.randomUUID(),
    type: "OPERATION_RESERVED",
    summary: `${input.recipeId} · RESERVED · ${operation.customerCredits} credits held`,
    occurredAt: timestamp,
  };
  return {
    ...project,
    operations: { ...project.operations, [operation.id]: operation },
    bindings: binding ? { ...project.bindings, [binding.id]: binding } : project.bindings,
    canvasItems: { ...project.canvasItems, [canvasId]: canvasItem },
    activity: [activity, ...project.activity].slice(0, 100),
    updatedAt: timestamp,
  };
}

export function applyImageOperationResult(
  project: CreativeSpaceProject,
  input: {
    operationId: string;
    state: SpaceOperationState;
    resultUrl: string | null;
    deliveryAssetId?: string | null;
    contentType?: string | null;
    byteLength?: number | null;
    checksumSha256: string | null;
    customerChargedCredits: number;
    providerChargedCredits?: number;
    /** The Engine attests the delivered media type; callers never infer it from a URL. */
    mediaType?: SpaceMediaKind;
    updatedAt: string;
  },
  now = new Date(),
): CreativeSpaceProject {
  const current = project.operations[input.operationId];
  if (!current) throw new TypeError("Operation must exist before applying its result.");
  const timestamp = now.toISOString();
  // A durable Engine delivery identity is sufficient for a settled result.
  // Browser preview URLs are intentionally optional and must never be the
  // sole persisted proof that an asset exists.
  if (input.state !== "SETTLED" || (!input.resultUrl && !input.deliveryAssetId) || !input.checksumSha256) {
    const failed = ["PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"].includes(input.state);
    const chargeProven = ["PROVIDER_FAILED", "DELIVERY_FAILED"].includes(input.state);
    const operation = { ...current, state: input.state, customerChargedCredits: chargeProven ? input.customerChargedCredits : null, providerActualCredits: chargeProven ? input.providerChargedCredits ?? null : null, updatedAt: input.updatedAt };
    const failureActivity: SpaceActivity = { id: crypto.randomUUID(), type: "OPERATION_FAILED", summary: `${current.recipeId} · ${input.state}`, occurredAt: timestamp };
    return {
      ...project,
      operations: { ...project.operations, [current.id]: operation },
      activity: failed ? [failureActivity, ...project.activity].slice(0, 100) : project.activity,
      updatedAt: timestamp,
    };
  }

  const outputAssetId = `output:${current.id}`;
  if (project.assets[outputAssetId]) return project;
  const operationItem = Object.values(project.canvasItems).find(({ entityType, entityId }) => entityType === "OPERATION" && entityId === current.id);
  if (!operationItem) throw new TypeError("Operation canvas item is missing.");
  const output: SpaceAsset = {
    id: outputAssetId,
    projectId: project.projectId,
    kind: input.mediaType ?? "IMAGE",
    name: `Generated · ${current.modelId}`,
    mimeType: input.contentType ?? "application/octet-stream",
    bytes: input.byteLength ?? 0,
    status: "READY",
    origin: "GENERATED",
    operationId: current.id,
    ...(input.deliveryAssetId ? { deliveryAssetId: input.deliveryAssetId } : {}),
    ...(input.resultUrl ? { resultUrl: input.resultUrl } : {}),
    checksumSha256: input.checksumSha256,
    createdAt: input.updatedAt,
  };
  const outputCanvasId = `asset:${outputAssetId}`;
  const outputCanvas: SpaceCanvasItem = {
    id: outputCanvasId,
    entityType: "ASSET",
    entityId: outputAssetId,
    position: { x: operationItem.position.x + operationItem.size.width + 80, y: operationItem.position.y },
    size: { width: 248, height: 176 },
    zIndex: Object.keys(project.canvasItems).length + 1,
  };
  const operation: SpaceOperation = { ...current, state: "SETTLED", customerChargedCredits: input.customerChargedCredits, providerActualCredits: input.providerChargedCredits ?? null, outputAssetId, updatedAt: input.updatedAt };
  const activity: SpaceActivity = {
    id: crypto.randomUUID(),
    type: "OUTPUT_READY",
    summary: `${current.recipeId} · READY · ${input.customerChargedCredits} credits charged`,
    occurredAt: timestamp,
  };
  return {
    ...project,
    assets: { ...project.assets, [outputAssetId]: output },
    operations: { ...project.operations, [current.id]: operation },
    canvasItems: { ...project.canvasItems, [outputCanvasId]: outputCanvas },
    activity: [activity, ...project.activity].slice(0, 100),
    updatedAt: timestamp,
  };
}

export function placeReservedVideoOperation(
  project: CreativeSpaceProject,
  input: {
    operation: { id: string; quoteId: string; provider: string; modelId: string; state: "RESERVED"; financials: { customerQuotedCredits: number; providerEstimatedCredits?: number }; createdAt: string };
    recipeId: string;
    bindings: Array<{ assetId: string; role: "FIRST_FRAME" | "LAST_FRAME" | "REFERENCE"; ordinal: number }>;
    anchor: { x: number; y: number };
  },
  now = new Date(),
): CreativeSpaceProject {
  if (project.operations[input.operation.id]) return project;
  if (new Set(input.bindings.map(({ assetId }) => assetId)).size !== input.bindings.length) {
    throw new TypeError("Video operation bindings must be unique.");
  }
  const timestamp = now.toISOString();
  const operation: SpaceOperation = {
    id: input.operation.id,
    projectId: project.projectId,
    quoteId: input.operation.quoteId,
    recipeId: input.recipeId,
    modelId: input.operation.modelId,
    provider: input.operation.provider,
    state: "RESERVED",
    customerChargedCredits: null,
    customerCredits: input.operation.financials.customerQuotedCredits,
    providerActualCredits: null,
    providerEstimateCredits: input.operation.financials.providerEstimatedCredits ?? null,
    outputAssetId: null,
    createdAt: input.operation.createdAt,
    updatedAt: timestamp,
  };
  const canvasId = `operation:${operation.id}`;
  const canvasItem: SpaceCanvasItem = {
    id: canvasId,
    entityType: "OPERATION",
    entityId: operation.id,
    position: { ...input.anchor },
    size: { width: 248, height: 176 },
    zIndex: Object.keys(project.canvasItems).length + 1,
  };
  const bindings = Object.fromEntries(input.bindings.map((binding) => {
    if (!project.assets[binding.assetId]) throw new TypeError("Video binding asset must exist in the project.");
    const value: SpaceBinding = {
      id: `binding:${operation.id}:${binding.ordinal}`,
      operationId: operation.id,
      assetId: binding.assetId,
      role: binding.role,
      ordinal: binding.ordinal,
    };
    return [value.id, value];
  }));
  const activity: SpaceActivity = {
    id: crypto.randomUUID(),
    type: "OPERATION_RESERVED",
    summary: `${input.recipeId} · RESERVED · ${operation.customerCredits} credits held`,
    occurredAt: timestamp,
  };
  return {
    ...project,
    operations: { ...project.operations, [operation.id]: operation },
    bindings: { ...project.bindings, ...bindings },
    canvasItems: { ...project.canvasItems, [canvasId]: canvasItem },
    activity: [activity, ...project.activity].slice(0, 100),
    updatedAt: timestamp,
  };
}

export function applyVideoOperationResult(
  project: CreativeSpaceProject,
  input: {
    operationId: string;
    state: SpaceOperationState;
    resultUrl: string | null;
    deliveryAssetId?: string | null;
    checksumSha256: string | null;
    customerChargedCredits: number;
    providerChargedCredits?: number;
    updatedAt: string;
  },
  now = new Date(),
): CreativeSpaceProject {
  const current = project.operations[input.operationId];
  if (!current) throw new TypeError("Operation must exist before applying its result.");
  const timestamp = now.toISOString();
  if (input.state !== "SETTLED" || !input.resultUrl || !input.checksumSha256) {
    const failed = ["PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"].includes(input.state);
    const chargeProven = ["PROVIDER_FAILED", "DELIVERY_FAILED"].includes(input.state);
    const operation = { ...current, state: input.state, customerChargedCredits: chargeProven ? input.customerChargedCredits : null, providerActualCredits: chargeProven ? input.providerChargedCredits ?? null : null, updatedAt: input.updatedAt };
    const failureActivity: SpaceActivity = { id: crypto.randomUUID(), type: "OPERATION_FAILED", summary: `${current.recipeId} · ${input.state}`, occurredAt: timestamp };
    return {
      ...project,
      operations: { ...project.operations, [current.id]: operation },
      activity: failed ? [failureActivity, ...project.activity].slice(0, 100) : project.activity,
      updatedAt: timestamp,
    };
  }

  const outputAssetId = `output:${current.id}`;
  if (project.assets[outputAssetId]) return project;
  const operationItem = Object.values(project.canvasItems).find(({ entityType, entityId }) => entityType === "OPERATION" && entityId === current.id);
  if (!operationItem) throw new TypeError("Operation canvas item is missing.");
  const output: SpaceAsset = {
    id: outputAssetId,
    projectId: project.projectId,
    kind: "VIDEO",
    name: `TEST · ${current.recipeId}`,
    mimeType: "video/mp4",
    bytes: 0,
    status: "READY",
    origin: "GENERATED",
    operationId: current.id,
    ...(input.deliveryAssetId ? { deliveryAssetId: input.deliveryAssetId } : {}),
    resultUrl: input.resultUrl,
    checksumSha256: input.checksumSha256,
    createdAt: input.updatedAt,
  };
  const outputCanvasId = `asset:${outputAssetId}`;
  const outputCanvas: SpaceCanvasItem = {
    id: outputCanvasId,
    entityType: "ASSET",
    entityId: outputAssetId,
    position: { x: operationItem.position.x + operationItem.size.width + 80, y: operationItem.position.y },
    size: { width: 248, height: 176 },
    zIndex: Object.keys(project.canvasItems).length + 1,
  };
  const operation: SpaceOperation = { ...current, state: "SETTLED", customerChargedCredits: input.customerChargedCredits, providerActualCredits: input.providerChargedCredits ?? null, outputAssetId, updatedAt: input.updatedAt };
  const activity: SpaceActivity = {
    id: crypto.randomUUID(),
    type: "OUTPUT_READY",
    summary: `${current.recipeId} · READY · ${input.customerChargedCredits} credits charged`,
    occurredAt: timestamp,
  };
  return {
    ...project,
    assets: { ...project.assets, [outputAssetId]: output },
    operations: { ...project.operations, [current.id]: operation },
    canvasItems: { ...project.canvasItems, [outputCanvasId]: outputCanvas },
    activity: [activity, ...project.activity].slice(0, 100),
    updatedAt: timestamp,
  };
}

export function placeReservedAdvancedOperation(
  project: CreativeSpaceProject,
  input: {
    operation: { id: string; quoteId: string; provider: string; modelId: string; state: "RESERVED"; financials: { customerQuotedCredits: number; providerEstimatedCredits?: number }; createdAt: string };
    recipeId: string;
    bindings: Array<{ assetId: string; role: "SOURCE" | "REFERENCE" | "VOICE_AUDIO" | "MOTION"; ordinal: number }>;
    anchor: { x: number; y: number };
  },
  now = new Date(),
): CreativeSpaceProject {
  if (project.operations[input.operation.id]) return project;
  if (new Set(input.bindings.map(({ assetId }) => assetId)).size !== input.bindings.length) throw new TypeError("Advanced operation bindings must be unique.");
  const timestamp = now.toISOString();
  const operation: SpaceOperation = {
    id: input.operation.id, projectId: project.projectId, quoteId: input.operation.quoteId, recipeId: input.recipeId,
    modelId: input.operation.modelId, provider: input.operation.provider, state: "RESERVED",
    customerChargedCredits: null,
    customerCredits: input.operation.financials.customerQuotedCredits,
    providerActualCredits: null,
    providerEstimateCredits: input.operation.financials.providerEstimatedCredits ?? null,
    outputAssetId: null, createdAt: input.operation.createdAt, updatedAt: timestamp,
  };
  const canvasId = `operation:${operation.id}`;
  const canvasItem: SpaceCanvasItem = {
    id: canvasId, entityType: "OPERATION", entityId: operation.id, position: { ...input.anchor },
    size: { width: 248, height: 176 }, zIndex: Object.keys(project.canvasItems).length + 1,
  };
  const bindings = Object.fromEntries(input.bindings.map((binding) => {
    if (!project.assets[binding.assetId]) throw new TypeError("Advanced binding asset must exist in the project.");
    const value: SpaceBinding = { id: `binding:${operation.id}:${binding.ordinal}`, operationId: operation.id, assetId: binding.assetId, role: binding.role, ordinal: binding.ordinal };
    return [value.id, value];
  }));
  const activity: SpaceActivity = { id: crypto.randomUUID(), type: "OPERATION_RESERVED", summary: `${input.recipeId} · RESERVED · ${operation.customerCredits} credits held`, occurredAt: timestamp };
  return {
    ...project,
    operations: { ...project.operations, [operation.id]: operation },
    bindings: { ...project.bindings, ...bindings },
    canvasItems: { ...project.canvasItems, [canvasId]: canvasItem },
    activity: [activity, ...project.activity].slice(0, 100),
    updatedAt: timestamp,
  };
}

export function applyAdvancedOperationResult(
  project: CreativeSpaceProject,
  input: {
    operationId: string;
    state: SpaceOperationState;
    outputKind: "AUDIO" | "VIDEO";
    resultUrl: string | null;
    deliveryAssetId?: string | null;
    checksumSha256: string | null;
    customerChargedCredits: number;
    providerChargedCredits?: number;
    updatedAt: string;
  },
  now = new Date(),
): CreativeSpaceProject {
  const current = project.operations[input.operationId];
  if (!current) throw new TypeError("Operation must exist before applying its result.");
  const timestamp = now.toISOString();
  if (input.state !== "SETTLED" || !input.resultUrl || !input.checksumSha256) {
    const failed = ["PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"].includes(input.state);
    const chargeProven = ["PROVIDER_FAILED", "DELIVERY_FAILED"].includes(input.state);
    const operation = { ...current, state: input.state, customerChargedCredits: chargeProven ? input.customerChargedCredits : null, providerActualCredits: chargeProven ? input.providerChargedCredits ?? null : null, updatedAt: input.updatedAt };
    const failureActivity: SpaceActivity = { id: crypto.randomUUID(), type: "OPERATION_FAILED", summary: `${current.recipeId} · ${input.state}`, occurredAt: timestamp };
    return { ...project, operations: { ...project.operations, [current.id]: operation }, activity: failed ? [failureActivity, ...project.activity].slice(0, 100) : project.activity, updatedAt: timestamp };
  }

  const outputAssetId = `output:${current.id}`;
  if (project.assets[outputAssetId]) return project;
  const operationItem = Object.values(project.canvasItems).find(({ entityType, entityId }) => entityType === "OPERATION" && entityId === current.id);
  if (!operationItem) throw new TypeError("Operation canvas item is missing.");
  const output: SpaceAsset = {
    id: outputAssetId, projectId: project.projectId, kind: input.outputKind,
    name: `TEST · ${current.recipeId}`,
    mimeType: input.outputKind === "AUDIO" ? "audio/wav" : "video/mp4",
    bytes: 0, status: "READY", origin: "GENERATED", operationId: current.id,
    ...(input.deliveryAssetId ? { deliveryAssetId: input.deliveryAssetId } : {}),
    resultUrl: input.resultUrl, checksumSha256: input.checksumSha256, createdAt: input.updatedAt,
  };
  const outputCanvasId = `asset:${outputAssetId}`;
  const outputCanvas: SpaceCanvasItem = {
    id: outputCanvasId, entityType: "ASSET", entityId: outputAssetId,
    position: { x: operationItem.position.x + operationItem.size.width + 80, y: operationItem.position.y },
    size: { width: 248, height: 176 }, zIndex: Object.keys(project.canvasItems).length + 1,
  };
  const operation: SpaceOperation = { ...current, state: "SETTLED", customerChargedCredits: input.customerChargedCredits, providerActualCredits: input.providerChargedCredits ?? null, outputAssetId, updatedAt: input.updatedAt };
  const activity: SpaceActivity = { id: crypto.randomUUID(), type: "OUTPUT_READY", summary: `${current.recipeId} · READY · ${input.customerChargedCredits} credits charged`, occurredAt: timestamp };
  return {
    ...project,
    assets: { ...project.assets, [outputAssetId]: output },
    operations: { ...project.operations, [current.id]: operation },
    canvasItems: { ...project.canvasItems, [outputCanvasId]: outputCanvas },
    activity: [activity, ...project.activity].slice(0, 100),
    updatedAt: timestamp,
  };
}

export function moveCanvasItem(
  project: CreativeSpaceProject,
  canvasItemId: string,
  position: { x: number; y: number },
  now = new Date(),
): CreativeSpaceProject {
  const current = project.canvasItems[canvasItemId];
  if (!current) return project;
  const timestamp = now.toISOString();
  return {
    ...project,
    canvasItems: { ...project.canvasItems, [canvasItemId]: { ...current, position: { ...position } } },
    updatedAt: timestamp,
  };
}

export function setProjectViewport(project: CreativeSpaceProject, viewport: SpaceViewport, now = new Date()): CreativeSpaceProject {
  if (![viewport.x, viewport.y, viewport.zoom].every(Number.isFinite) || viewport.zoom < 0.25 || viewport.zoom > 1.75) {
    throw new TypeError("Viewport is outside the bounded workspace contract.");
  }
  return { ...project, viewport: { ...viewport }, updatedAt: now.toISOString() };
}
