import { defaultRecipeSettings, getImageRecipeManifest, type ImageRecipeId } from "./image-recipes";

export type ImageComposerDraft = {
  schemaVersion: 1;
  projectId: string;
  recipeId: ImageRecipeId;
  inputAssetId: string | null;
  prompt: string;
  /** The sole customer executable selection. modelId is display-only legacy state. */
  offerId: string | null;
  modelId: string;
  /** Capability v2 also permits boolean controls. */
  settings: Record<string, string | number | boolean>;
  anchor: { x: number; y: number };
  updatedAt: string;
};

const draftPrefix = "fusionlab:image-composer:v1:";

export function imageComposerStorageKey(projectId: string): string {
  return `${draftPrefix}${encodeURIComponent(projectId)}`;
}

export function createImageComposerDraft(input: {
  projectId: string;
  recipeId: ImageRecipeId;
  inputAssetId?: string | null;
  anchor: { x: number; y: number };
}, now = new Date()): ImageComposerDraft {
  const manifest = getImageRecipeManifest(input.recipeId);
  return {
    schemaVersion: 1,
    projectId: input.projectId,
    recipeId: input.recipeId,
    inputAssetId: input.inputAssetId ?? null,
    prompt: "",
    offerId: null,
    modelId: manifest.models[0].id,
    settings: defaultRecipeSettings(manifest),
    anchor: { ...input.anchor },
    updatedAt: now.toISOString(),
  };
}

export function updateImageComposerDraft(
  draft: ImageComposerDraft,
  update: Partial<Pick<ImageComposerDraft, "prompt" | "offerId" | "modelId" | "settings" | "inputAssetId">>,
  now = new Date(),
): ImageComposerDraft {
  return {
    ...draft,
    ...update,
    settings: update.settings ? { ...update.settings } : draft.settings,
    updatedAt: now.toISOString(),
  };
}

function isDraft(value: unknown): value is ImageComposerDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<ImageComposerDraft>;
  return draft.schemaVersion === 1
    && typeof draft.projectId === "string"
    && typeof draft.recipeId === "string"
    && draft.recipeId in ({
      "image.create": true, "image.edit": true, "image.remix": true,
      "image.inpaint": true, "image.upscale": true,
    } satisfies Record<ImageRecipeId, true>)
    && (draft.inputAssetId === null || typeof draft.inputAssetId === "string")
    && typeof draft.prompt === "string"
    && (draft.offerId === null || typeof draft.offerId === "string")
    && typeof draft.modelId === "string"
    && !!draft.settings && typeof draft.settings === "object"
    && !!draft.anchor && Number.isFinite(draft.anchor.x) && Number.isFinite(draft.anchor.y);
}

export function loadImageComposerDraft(projectId: string, storage: Pick<Storage, "getItem"> = localStorage): ImageComposerDraft | null {
  try {
    const raw = storage.getItem(imageComposerStorageKey(projectId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) && parsed.projectId === projectId ? parsed : null;
  } catch {
    return null;
  }
}

export function saveImageComposerDraft(draft: ImageComposerDraft, storage: Pick<Storage, "setItem"> = localStorage): void {
  storage.setItem(imageComposerStorageKey(draft.projectId), JSON.stringify(draft));
}

export function clearImageComposerDraft(projectId: string, storage: Pick<Storage, "removeItem"> = localStorage): void {
  storage.removeItem(imageComposerStorageKey(projectId));
}
