import { describe, expect, it } from "vitest";
import { addLocalAsset, createCreativeSpaceProject } from "./domain";
import { createVideoComposerDraft, type VideoComposerDraft } from "./video-composer-draft";
import { planVideoRecipeCompatibility, validateVideoComposerDraft } from "./video-composer-validation";
import type { PublishedOffer } from "./published-offers-client";

function videoProject() {
  let project = createCreativeSpaceProject("video-validation");
  project = addLocalAsset(project, { name: "first.png", mimeType: "image/png", bytes: 10, position: { x: 0, y: 0 } });
  project = addLocalAsset(project, { name: "last.png", mimeType: "image/png", bytes: 10, position: { x: 300, y: 0 } });
  return project;
}

describe("Video binding validation and compatibility diff", () => {
  it("accepts exact Text-to-Video and Image-to-Video contracts", () => {
    const project = videoProject();
    const [firstId] = Object.keys(project.assets);
    const text = { ...createVideoComposerDraft({ projectId: project.projectId, recipeId: "video.text-to-video", anchor: { x: 0, y: 0 } }), prompt: "Camera moves slowly" };
    expect(validateVideoComposerDraft(text, project)).toEqual({ valid: true, issues: [] });
    const image = { ...createVideoComposerDraft({ projectId: project.projectId, recipeId: "video.image-to-video", initialAssetId: firstId, anchor: { x: 0, y: 0 } }), prompt: "Animate the subject" };
    expect(validateVideoComposerDraft(image, project)).toEqual({ valid: true, issues: [] });
  });

  it("fails closed for wrong count, duplicate assets, roles, ordinals, model and settings", () => {
    const project = videoProject();
    const [firstId] = Object.keys(project.assets);
    const base = createVideoComposerDraft({ projectId: project.projectId, recipeId: "video.first-last", initialAssetId: firstId, anchor: { x: 0, y: 0 } });
    const invalid = {
      ...base,
      prompt: "Transition",
      modelId: "unknown/model",
      bindings: [
        { assetId: firstId, slot: "LAST_FRAME", ordinal: 1 },
        { assetId: firstId, slot: "FIRST_FRAME", ordinal: 3 },
      ],
      settings: { ...base.settings, durationSeconds: 7, invented: true },
    } as unknown as VideoComposerDraft;
    expect(validateVideoComposerDraft(invalid, project)).toEqual(expect.objectContaining({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "BINDING_DUPLICATE" }),
        expect.objectContaining({ code: "BINDING_SLOT_INVALID" }),
        expect.objectContaining({ code: "BINDING_ORDINAL_INVALID" }),
        expect.objectContaining({ code: "MODEL_NOT_CERTIFIED" }),
        expect.objectContaining({ code: "SETTING_INVALID" }),
        expect.objectContaining({ code: "SETTING_NOT_ALLOWED" }),
      ]),
    }));
  });

  it("uses the selected published control schema instead of the local test-video manifest", () => {
    const project = videoProject();
    const offer = {
      offerId: "published-video",
      providerModelId: "provider/video-v1",
      capability: {
        controlSchema: {
          version: "video-controls-v1",
          recipes: [{
            recipeId: "video.text-to-video",
            prompt: { required: true, visible: true, maxLength: 40 },
            bindings: { min: 0, max: 0, roles: [] },
            controls: [{ id: "durationSeconds", kind: "enum", defaultValue: 5, values: [5] }],
          }],
        },
      },
    } as unknown as PublishedOffer;
    const base = createVideoComposerDraft({ projectId: project.projectId, recipeId: "video.text-to-video", anchor: { x: 0, y: 0 } });
    const valid = { ...base, offerId: offer.offerId, modelId: offer.providerModelId, prompt: "A concise motion prompt", settings: { durationSeconds: 5 } };
    expect(validateVideoComposerDraft(valid, project, undefined, offer)).toEqual({ valid: true, issues: [] });
    expect(validateVideoComposerDraft({ ...valid, settings: { durationSeconds: 5, audio: false } }, project, undefined, offer)).toEqual(expect.objectContaining({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: "SETTING_NOT_ALLOWED" })]),
    }));
    expect(validateVideoComposerDraft({ ...valid, prompt: "x".repeat(41) }, project, undefined, offer)).toEqual(expect.objectContaining({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: "PROMPT_TOO_LONG" })]),
    }));
  });

  it("uses the selected image when switching Text-to-Video to Image-to-Video", () => {
    const project = videoProject();
    const [firstId] = Object.keys(project.assets);
    const draft = createVideoComposerDraft({ projectId: project.projectId, recipeId: "video.text-to-video", anchor: { x: 0, y: 0 } });
    const diff = planVideoRecipeCompatibility(draft, "video.image-to-video", firstId, new Date("2026-08-12T01:00:00.000Z"));
    expect(diff).toMatchObject({ canApply: true, requiresConfirmation: false, nextDraft: { recipeId: "video.image-to-video", bindings: [{ assetId: firstId, slot: "FIRST_FRAME", ordinal: 0 }] } });
    expect(diff.changes).toContainEqual(expect.objectContaining({ code: "BINDING_ADDED", severity: "INFO" }));
  });

  it("blocks missing required inputs and requires confirmation before dropping or changing bindings", () => {
    const project = videoProject();
    const [firstId, lastId] = Object.keys(project.assets);
    const image = createVideoComposerDraft({ projectId: project.projectId, recipeId: "video.image-to-video", initialAssetId: firstId, anchor: { x: 0, y: 0 } });
    expect(planVideoRecipeCompatibility(image, "video.first-last")).toMatchObject({ canApply: false });
    expect(planVideoRecipeCompatibility(image, "video.first-last", lastId)).toMatchObject({ canApply: true, nextDraft: { bindings: [{ slot: "FIRST_FRAME" }, { assetId: lastId, slot: "LAST_FRAME" }] } });
    const toText = planVideoRecipeCompatibility(image, "video.text-to-video");
    expect(toText).toMatchObject({ canApply: true, requiresConfirmation: true, nextDraft: { bindings: [] } });
    expect(toText.changes).toContainEqual(expect.objectContaining({ code: "BINDING_DROPPED", severity: "WARNING" }));

    const firstLast: VideoComposerDraft = { ...image, recipeId: "video.first-last", bindings: [{ assetId: firstId, slot: "FIRST_FRAME", ordinal: 0 }, { assetId: lastId, slot: "LAST_FRAME", ordinal: 1 }] };
    const toReferences = planVideoRecipeCompatibility(firstLast, "video.multi-reference");
    expect(toReferences).toMatchObject({ canApply: true, requiresConfirmation: true });
    expect(toReferences.changes.filter(({ code }) => code === "BINDING_ROLE_CHANGED")).toHaveLength(2);
    expect(toReferences.nextDraft.bindings.map(({ slot }) => slot)).toEqual(["REFERENCE", "REFERENCE"]);
  });
});
