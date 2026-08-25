import { describe, expect, it } from "vitest";
import { clearImageComposerDraft, createImageComposerDraft, loadImageComposerDraft, saveImageComposerDraft, updateImageComposerDraft } from "./composer-draft";
import { getImageRecipeManifest, imageRecipeList } from "./image-recipes";

describe("Image-first Recipe manifests and composer draft", () => {
  it("publishes five curated image recipes with real local model identity", () => {
    expect(imageRecipeList.map(({ id }) => id)).toEqual([
      "image.create", "image.edit", "image.remix", "image.inpaint", "image.upscale",
    ]);
    expect(imageRecipeList.every(({ models }) => models.length === 1 && models[0].id === "local/test-image-v1")).toBe(true);
    expect(getImageRecipeManifest("image.create").input.required).toBe(false);
    expect(getImageRecipeManifest("image.upscale").prompt.visible).toBe(false);
  });

  it("creates manifest-driven defaults and recovers the same draft after refresh", () => {
    const draft = createImageComposerDraft({
      projectId: "image-draft-project",
      recipeId: "image.edit",
      inputAssetId: "asset-1",
      anchor: { x: 420, y: 180 },
    }, new Date("2026-08-12T01:00:00.000Z"));
    expect(draft.settings).toEqual({ aspectRatio: "1:1", strength: 65 });
    const changed = updateImageComposerDraft(draft, {
      prompt: "Add cinematic morning light",
      settings: { ...draft.settings, strength: 80 },
    }, new Date("2026-08-12T01:01:00.000Z"));
    saveImageComposerDraft(changed);
    expect(loadImageComposerDraft("image-draft-project")).toEqual(changed);
    clearImageComposerDraft("image-draft-project");
    expect(loadImageComposerDraft("image-draft-project")).toBeNull();
  });
});
