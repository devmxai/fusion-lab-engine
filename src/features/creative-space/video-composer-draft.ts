import { defaultVideoSettings, getVideoRecipeManifest, type VideoBindingSlot, type VideoRecipeId } from "./video-recipes";

export type VideoDraftBinding = { assetId: string; slot: VideoBindingSlot; ordinal: number };

export type VideoComposerDraft = {
  schemaVersion: 1;
  projectId: string;
  recipeId: VideoRecipeId;
  bindings: VideoDraftBinding[];
  prompt: string;
  offerId: string | null;
  modelId: string;
  settings: Record<string, string | number | boolean>;
  anchor: { x: number; y: number };
  updatedAt: string;
};

const prefix = "fusionlab:video-composer:v1:";
export const videoComposerStorageKey = (projectId: string) => `${prefix}${encodeURIComponent(projectId)}`;

export function createVideoComposerDraft(input: { projectId: string; recipeId: VideoRecipeId; initialAssetId?: string | null; anchor: { x: number; y: number } }, now = new Date()): VideoComposerDraft {
  const manifest = getVideoRecipeManifest(input.recipeId);
  const bindings: VideoDraftBinding[] = input.initialAssetId && manifest.bindings.max > 0
    ? [{ assetId: input.initialAssetId, slot: manifest.bindings.slots[0], ordinal: 0 }]
    : [];
  return { schemaVersion: 1, projectId: input.projectId, recipeId: input.recipeId, bindings, prompt: "", offerId: null, modelId: manifest.models[0].id, settings: defaultVideoSettings(manifest), anchor: { ...input.anchor }, updatedAt: now.toISOString() };
}

function isDraft(value: unknown): value is VideoComposerDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<VideoComposerDraft>;
  return draft.schemaVersion === 1 && typeof draft.projectId === "string" && typeof draft.recipeId === "string"
    && draft.recipeId in videoRecipeIds && Array.isArray(draft.bindings) && typeof draft.prompt === "string"
    && (draft.offerId === null || typeof draft.offerId === "string") && typeof draft.modelId === "string" && !!draft.settings && typeof draft.settings === "object"
    && !!draft.anchor && Number.isFinite(draft.anchor.x) && Number.isFinite(draft.anchor.y);
}

const videoRecipeIds: Record<VideoRecipeId, true> = {
  "video.text-to-video": true, "video.image-to-video": true, "video.first-last": true, "video.multi-reference": true,
};

export function loadVideoComposerDraft(projectId: string, storage: Pick<Storage, "getItem"> = localStorage): VideoComposerDraft | null {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(videoComposerStorageKey(projectId)) ?? "null");
    return isDraft(parsed) && parsed.projectId === projectId ? parsed : null;
  } catch { return null; }
}

export function saveVideoComposerDraft(draft: VideoComposerDraft, storage: Pick<Storage, "setItem"> = localStorage): void {
  storage.setItem(videoComposerStorageKey(draft.projectId), JSON.stringify(draft));
}

export function clearVideoComposerDraft(projectId: string, storage: Pick<Storage, "removeItem"> = localStorage): void {
  storage.removeItem(videoComposerStorageKey(projectId));
}
