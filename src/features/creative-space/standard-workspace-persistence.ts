import type { ImageComposerDraft } from "./composer-draft";
import { applyImageOperationResult, placeReservedImageOperation, type CreativeSpaceProject, type SpaceAssetMediaMetadata } from "./domain";
import type { ConfirmedImageQuote, ExecutedImageOperation } from "./image-quote-client";
import type { ConfirmedVideoQuote, ExecutedVideoOperation } from "./video-quote-client";
import { type PersistedCreativeSpaceProject, savePersistedCreativeSpaceProject } from "./project-client";
import { appendStandardGenerationSession, getStandardProjection, restoreStandardGeneratedAsset, trashStandardGeneratedAsset, writeStandardImageDraft } from "./standard-projection";

export function hydrateStandardImageDraft(project: CreativeSpaceProject): ImageComposerDraft | null {
  const saved = getStandardProjection(project).draftsByMedia.IMAGE;
  if (!saved) return null;
  // The projection stores an explicit presentation binding instead of copying
  // mutable asset data into the draft.  Rehydrate it only when the canonical
  // project asset still exists; a stale or trashed client value must never be
  // invented as a valid generation input.
  const inputAssetId = saved.bindingIds
    .find((bindingId) => bindingId.startsWith("binding:draft:"))
    ?.slice("binding:draft:".length) ?? null;
  return {
    schemaVersion: 1,
    projectId: project.projectId,
    recipeId: saved.recipeId as ImageComposerDraft["recipeId"],
    inputAssetId: inputAssetId && project.assets[inputAssetId] ? inputAssetId : null,
    prompt: saved.prompt,
    offerId: saved.offerId,
    modelId: "",
    settings: { ...saved.settings },
    anchor: { x: 0, y: 0 },
    updatedAt: saved.updatedAt,
  };
}

export async function persistStandardImageDraft(input: { project: CreativeSpaceProject; version: number; draft: ImageComposerDraft; save?: typeof savePersistedCreativeSpaceProject }): Promise<PersistedCreativeSpaceProject> {
  const next = writeStandardImageDraft(input.project, input.draft);
  return (input.save ?? savePersistedCreativeSpaceProject)(next, input.version);
}

export async function persistStandardGenerationSession(input: { project: CreativeSpaceProject; version: number; operationId: string; outputAssetId: string | null; save?: typeof savePersistedCreativeSpaceProject }): Promise<PersistedCreativeSpaceProject> {
  const next = appendStandardGenerationSession(input.project, { operationId: input.operationId, outputAssetId: input.outputAssetId });
  return (input.save ?? savePersistedCreativeSpaceProject)(next, input.version);
}

export async function persistStandardGalleryTrash(input: { project: CreativeSpaceProject; version: number; assetId: string; action: "TRASH" | "RESTORE"; save?: typeof savePersistedCreativeSpaceProject }): Promise<PersistedCreativeSpaceProject> {
  const next = input.action === "TRASH"
    ? trashStandardGeneratedAsset(input.project, input.assetId)
    : restoreStandardGeneratedAsset(input.project, input.assetId);
  return (input.save ?? savePersistedCreativeSpaceProject)(next, input.version);
}

/** Stores only decoded display facts for a canonical project asset. */
export async function persistStandardAssetMediaMetadata(input: {
  project: CreativeSpaceProject;
  version: number;
  assetId: string;
  metadata: SpaceAssetMediaMetadata;
  save?: typeof savePersistedCreativeSpaceProject;
}): Promise<PersistedCreativeSpaceProject> {
  const asset = input.project.assets[input.assetId];
  if (!asset) throw new TypeError("Asset must exist before its media metadata can be stored.");
  const current = asset.mediaMetadata ?? {};
  const nextMetadata = {
    ...current,
    ...Object.fromEntries(
      Object.entries(input.metadata).filter(([, value]) =>
        typeof value === "boolean" || (Number.isSafeInteger(value) && Number(value) >= 0),
      ),
    ),
  } as SpaceAssetMediaMetadata;
  const next: CreativeSpaceProject = {
    ...input.project,
    assets: { ...input.project.assets, [asset.id]: { ...asset, mediaMetadata: nextMetadata } },
    updatedAt: new Date().toISOString(),
  };
  return (input.save ?? savePersistedCreativeSpaceProject)(next, input.version);
}

export async function persistStandardReservedImage(input: { project: CreativeSpaceProject; version: number; confirmed: ConfirmedImageQuote; draft: ImageComposerDraft; save?: typeof savePersistedCreativeSpaceProject }): Promise<PersistedCreativeSpaceProject> {
  return persistStandardReservedMedia({
    project: input.project, version: input.version, confirmed: input.confirmed,
    recipeId: input.draft.recipeId, inputAssetId: input.draft.inputAssetId,
    inputRole: "SOURCE", anchor: input.draft.anchor, save: input.save,
  });
}

/** Persists a Standard operation without coupling the durable project to one media type. */
export async function persistStandardReservedMedia(input: {
  project: CreativeSpaceProject; version: number; confirmed: ConfirmedImageQuote | ConfirmedVideoQuote;
  recipeId: string; inputAssetId: string | null; inputRole: "SOURCE" | "FIRST_FRAME";
  anchor: { x: number; y: number }; save?: typeof savePersistedCreativeSpaceProject;
}): Promise<PersistedCreativeSpaceProject> {
  const operation = input.confirmed.operation;
  const next = placeReservedImageOperation(input.project, {
    operation: { id: operation.id, quoteId: operation.quoteId, provider: operation.provider, modelId: operation.modelId, state: "RESERVED", financials: { customerQuotedCredits: operation.financials.customerQuotedCredits, providerEstimatedCredits: operation.financials.providerEstimatedCredits }, createdAt: operation.createdAt },
    recipeId: input.recipeId, inputAssetId: input.inputAssetId, inputRole: input.inputRole, anchor: input.anchor,
  });
  return (input.save ?? savePersistedCreativeSpaceProject)(next, input.version);
}

export async function persistStandardImageResult(input: { project: CreativeSpaceProject; version: number; execution: ExecutedImageOperation; save?: typeof savePersistedCreativeSpaceProject }): Promise<PersistedCreativeSpaceProject> {
  return persistStandardMediaResult({ ...input, mediaType: "IMAGE" });
}

export async function persistStandardMediaResult(input: {
  project: CreativeSpaceProject; version: number; execution: ExecutedImageOperation | ExecutedVideoOperation;
  mediaType: "IMAGE" | "VIDEO" | "AUDIO"; save?: typeof savePersistedCreativeSpaceProject;
}): Promise<PersistedCreativeSpaceProject> {
  const operation = input.execution.operation;
  const next = applyImageOperationResult(input.project, {
    operationId: operation.id,
    state: operation.state,
    // Delivery is the durable source of truth. A browser Blob URL is useful
    // only for the current view and must not become project state.
    resultUrl: operation.delivery?.assetId ? null : operation.resultUrl ?? null,
    deliveryAssetId: operation.delivery?.assetId ?? null,
    contentType: operation.delivery?.contentType ?? null,
    byteLength: operation.delivery?.byteLength ?? null,
    checksumSha256: operation.assetChecksumSha256 ?? operation.delivery?.checksumSha256 ?? null,
    customerChargedCredits: operation.financials.customerChargedCredits,
    providerChargedCredits: operation.financials.providerChargedCredits,
    mediaType: input.mediaType,
    updatedAt: operation.updatedAt,
  });
  return (input.save ?? savePersistedCreativeSpaceProject)(next, input.version);
}
