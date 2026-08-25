import type { CreativeSpaceProject, SpaceAsset, SpaceBinding, SpaceOperation } from "./domain";
import { createEmptyStandardProjection, isStandardProjectionV1, type StandardProjectionV1 } from "./standard-projection-contract";
import type { ImageComposerDraft } from "./composer-draft";

export const STANDARD_PROJECTION_OWNERSHIP = Object.freeze({
  domainTruth: ["assets", "operations", "bindings"] as const,
  serverProjection: ["draftsByMedia", "generationSessions", "galleryOrder", "referenceAliases", "trashEntries", "libraryPreferences"] as const,
  localUiOnly: ["viewerOpen", "hoveredAssetId", "scrollPosition", "popover", "selection"] as const,
  forbidden: ["reactFlow", "nodes", "edges", "providerPayload", "providerTaskId", "routeId"] as const,
});

export type StandardWorkspaceProjection = Readonly<{
  schemaVersion: 1;
  projectId: string;
  projection: StandardProjectionV1;
  galleryAssets: readonly SpaceAsset[];
  referenceAssets: readonly SpaceAsset[];
  operations: readonly SpaceOperation[];
  bindings: readonly SpaceBinding[];
}>;

export function getStandardProjection(project: CreativeSpaceProject): StandardProjectionV1 {
  return project.standardProjection && isStandardProjectionV1(project.standardProjection)
    ? project.standardProjection
    : createEmptyStandardProjection(new Date(project.updatedAt));
}

export function setStandardProjection(
  project: CreativeSpaceProject,
  projection: StandardProjectionV1,
  now = new Date(),
): CreativeSpaceProject {
  if (!isStandardProjectionV1(projection)) throw new TypeError("Standard projection v1 is invalid.");
  return { ...project, standardProjection: projection, updatedAt: now.toISOString() };
}

/** Stores customer presentation state only; canonical generation facts stay outside the projection. */
export function writeStandardImageDraft(project: CreativeSpaceProject, draft: ImageComposerDraft, now = new Date()): CreativeSpaceProject {
  const current = getStandardProjection(project);
  const previous = current.draftsByMedia.IMAGE;
  const next: StandardProjectionV1 = {
    ...current,
    draftsByMedia: { ...current.draftsByMedia, IMAGE: {
      draftId: previous?.draftId ?? crypto.randomUUID(), mediaKind: "IMAGE", recipeId: draft.recipeId, prompt: draft.prompt,
      offerId: draft.offerId, bindingIds: draft.inputAssetId ? [`binding:draft:${draft.inputAssetId}`] : [], settings: { ...draft.settings },
      version: (previous?.version ?? 0) + 1, updatedAt: now.toISOString(),
    } },
    updatedAt: now.toISOString(),
  };
  return setStandardProjection(project, next, now);
}

export function appendStandardGenerationSession(project: CreativeSpaceProject, input: { operationId: string; outputAssetId: string | null }, now = new Date()): CreativeSpaceProject {
  const current = getStandardProjection(project);
  const sessionId = crypto.randomUUID();
  const outputAssetIds = input.outputAssetId ? [input.outputAssetId] : [];
  const next: StandardProjectionV1 = {
    ...current,
    generationSessions: [{ sessionId, operationIds: [input.operationId], outputAssetIds, createdAt: now.toISOString() }, ...current.generationSessions].slice(0, 100),
    galleryOrder: input.outputAssetId ? [input.outputAssetId, ...current.galleryOrder.filter((id) => id !== input.outputAssetId)] : current.galleryOrder,
    updatedAt: now.toISOString(),
  };
  return setStandardProjection(project, next, now);
}

/**
 * Hides a generated result from the Standard gallery without deleting the
 * canonical asset, its operation lineage, or its financial evidence. Purge is
 * deliberately a separate, server-governed concern.
 */
export function trashStandardGeneratedAsset(project: CreativeSpaceProject, assetId: string, now = new Date()): CreativeSpaceProject {
  const asset = project.assets[assetId];
  if (!asset || asset.origin !== "GENERATED") throw new TypeError("Only generated assets can be moved to trash.");
  const current = getStandardProjection(project);
  if (current.trashEntries.some((entry) => entry.assetId === assetId)) return project;
  const deletedAt = now.toISOString();
  const purgeAfter = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const next: StandardProjectionV1 = {
    ...current,
    trashEntries: [{ assetId, deletedAt, purgeAfter }, ...current.trashEntries],
    updatedAt: deletedAt,
  };
  return setStandardProjection(project, next, now);
}

/** Restores a hidden gallery item; it never recreates or changes canonical data. */
export function restoreStandardGeneratedAsset(project: CreativeSpaceProject, assetId: string, now = new Date()): CreativeSpaceProject {
  const current = getStandardProjection(project);
  if (!current.trashEntries.some((entry) => entry.assetId === assetId)) return project;
  const next: StandardProjectionV1 = {
    ...current,
    trashEntries: current.trashEntries.filter((entry) => entry.assetId !== assetId),
    galleryOrder: [assetId, ...current.galleryOrder.filter((id) => id !== assetId)],
    updatedAt: now.toISOString(),
  };
  return setStandardProjection(project, next, now);
}

export function projectToStandardWorkspace(project: CreativeSpaceProject): StandardWorkspaceProjection {
  const projection = getStandardProjection(project);
  const trashed = new Set(projection.trashEntries.map((entry) => entry.assetId));
  // Standard is a project workspace, not a generated-only gallery.  A
  // verified customer upload must remain visible and selectable after it is
  // added, otherwise an image-to-video flow appears to have lost the source.
  const visibleAssets = Object.values(project.assets).filter((asset) =>
    (asset.origin === "GENERATED" || asset.origin === "UPLOAD") && !trashed.has(asset.id),
  );
  const generatedById = new Map(visibleAssets.map((asset) => [asset.id, asset]));
  const ordered = projection.galleryOrder.flatMap((assetId) => {
    const asset = generatedById.get(assetId);
    if (!asset) return [];
    generatedById.delete(assetId);
    return [asset];
  });
  const remaining = [...generatedById.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));

  return {
    schemaVersion: 1,
    projectId: project.projectId,
    projection,
    galleryAssets: [...ordered, ...remaining],
    referenceAssets: Object.values(project.assets)
      .filter((asset) => asset.origin !== "GENERATED" && !trashed.has(asset.id))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
    operations: Object.values(project.operations).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
    bindings: Object.values(project.bindings).sort((left, right) => left.operationId.localeCompare(right.operationId) || left.ordinal - right.ordinal),
  };
}
