import { describe, expect, it } from "vitest";
import { addLocalAsset, createCreativeSpaceProject } from "./domain";
import { createImageComposerDraft, updateImageComposerDraft } from "./composer-draft";
import { compareModelCompatibility, planRecipeCompatibility, validateImageComposerDraft } from "./image-composer-validation";

function imageProject() {
  let project = createCreativeSpaceProject("validation-project");
  project = addLocalAsset(project, {
    name: "input.png", mimeType: "image/png", bytes: 42, position: { x: 0, y: 0 },
  });
  return project;
}

describe("Image composer binding validation and compatibility diff", () => {
  it("fails closed until required input and prompt are valid", () => {
    const project = imageProject();
    const draft = createImageComposerDraft({
      projectId: project.projectId, recipeId: "image.edit", anchor: { x: 0, y: 0 },
    });
    expect(validateImageComposerDraft(draft, project)).toEqual(expect.objectContaining({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "INPUT_REQUIRED" }),
        expect.objectContaining({ code: "PROMPT_REQUIRED" }),
      ]),
    }));
  });

  it("accepts an exact ready image binding, certified model, prompt, and manifest settings", () => {
    const project = imageProject();
    const assetId = Object.keys(project.assets)[0];
    let draft = createImageComposerDraft({
      projectId: project.projectId, recipeId: "image.edit", inputAssetId: assetId, anchor: { x: 0, y: 0 },
    });
    draft = updateImageComposerDraft(draft, { prompt: "Add cinematic morning light" });
    expect(validateImageComposerDraft(draft, project)).toEqual({ valid: true, issues: [] });
  });

  it("requires explicit confirmation when a recipe change drops prompt or settings", () => {
    const project = imageProject();
    const assetId = Object.keys(project.assets)[0];
    let draft = createImageComposerDraft({
      projectId: project.projectId, recipeId: "image.edit", inputAssetId: assetId, anchor: { x: 0, y: 0 },
    });
    draft = updateImageComposerDraft(draft, { prompt: "Keep this unless confirmed", settings: { aspectRatio: "16:9", strength: 80 } });
    const diff = planRecipeCompatibility(draft, "image.upscale", new Date("2026-08-12T02:00:00.000Z"));
    expect(diff).toMatchObject({ canApply: true, requiresConfirmation: true });
    expect(diff.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PROMPT_REMOVED", severity: "WARNING" }),
      expect.objectContaining({ code: "SETTING_REMOVED", severity: "WARNING" }),
      expect.objectContaining({ code: "SETTING_ADDED", severity: "INFO" }),
    ]));
    expect(diff.nextDraft).toMatchObject({ recipeId: "image.upscale", prompt: "", settings: { upscaleFactor: "2x" } });
  });

  it("blocks recipe/model changes that are not compatible instead of silently coercing", () => {
    const createDraft = createImageComposerDraft({
      projectId: "no-input", recipeId: "image.create", anchor: { x: 0, y: 0 },
    });
    expect(planRecipeCompatibility(createDraft, "image.edit")).toMatchObject({ canApply: false });
    expect(compareModelCompatibility(createDraft, "unregistered/model")).toEqual([
      expect.objectContaining({ severity: "BLOCKING" }),
    ]);
  });
});
