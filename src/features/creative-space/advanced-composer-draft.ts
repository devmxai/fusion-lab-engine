import { defaultAdvancedSettings, getAdvancedRecipeManifest, type AdvancedRecipeId } from "./advanced-recipes";
import type { SpaceMediaKind } from "./domain";

export type AdvancedDraftBinding = { assetId: string; role: "SOURCE" | "REFERENCE" | "VOICE_AUDIO" | "MOTION"; ordinal: number };

export type AdvancedComposerDraft = {
  schemaVersion: 1;
  projectId: string;
  recipeId: AdvancedRecipeId;
  bindings: AdvancedDraftBinding[];
  prompt: string;
  offerId: string | null;
  modelId: string;
  settings: Record<string, string | number | boolean>;
  anchor: { x: number; y: number };
  updatedAt: string;
};

const prefix = "fusionlab:advanced-composer:v1:";
export const advancedComposerStorageKey = (projectId: string) => `${prefix}${encodeURIComponent(projectId)}`;

export function createAdvancedComposerDraft(input: {
  projectId: string;
  recipeId: AdvancedRecipeId;
  initialAsset?: { id: string; kind: SpaceMediaKind } | null;
  anchor: { x: number; y: number };
}, now = new Date()): AdvancedComposerDraft {
  const manifest = getAdvancedRecipeManifest(input.recipeId);
  const slotIndex = input.initialAsset ? manifest.bindings.findIndex(({ kind }) => kind === input.initialAsset?.kind) : -1;
  const bindings: AdvancedDraftBinding[] = slotIndex >= 0 && input.initialAsset
    ? [{ assetId: input.initialAsset.id, role: manifest.bindings[slotIndex].role as AdvancedDraftBinding["role"], ordinal: slotIndex }]
    : [];
  return {
    schemaVersion: 1,
    projectId: input.projectId,
    recipeId: input.recipeId,
    bindings,
    prompt: "",
    offerId: null,
    modelId: manifest.model.id,
    settings: defaultAdvancedSettings(manifest),
    anchor: { ...input.anchor },
    updatedAt: now.toISOString(),
  };
}

function isDraft(value: unknown): value is AdvancedComposerDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<AdvancedComposerDraft>;
  return draft.schemaVersion === 1 && typeof draft.projectId === "string" && typeof draft.recipeId === "string"
    && ["audio.tts", "video.avatar", "video.motion-control", "video.edit", "video.extend"].includes(draft.recipeId)
    && Array.isArray(draft.bindings) && typeof draft.prompt === "string"
    && (draft.offerId === null || typeof draft.offerId === "string") && typeof draft.modelId === "string"
    && !!draft.settings && typeof draft.settings === "object" && !!draft.anchor
    && Number.isFinite(draft.anchor.x) && Number.isFinite(draft.anchor.y);
}

export function loadAdvancedComposerDraft(projectId: string, storage: Pick<Storage, "getItem"> = localStorage): AdvancedComposerDraft | null {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(advancedComposerStorageKey(projectId)) ?? "null");
    return isDraft(parsed) && parsed.projectId === projectId ? parsed : null;
  } catch { return null; }
}

export function saveAdvancedComposerDraft(draft: AdvancedComposerDraft, storage: Pick<Storage, "setItem"> = localStorage): void {
  storage.setItem(advancedComposerStorageKey(draft.projectId), JSON.stringify(draft));
}

export function clearAdvancedComposerDraft(projectId: string, storage: Pick<Storage, "removeItem"> = localStorage): void {
  storage.removeItem(advancedComposerStorageKey(projectId));
}
