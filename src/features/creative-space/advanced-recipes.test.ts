import { describe, expect, it } from "vitest";
import { addLocalAsset, createCreativeSpaceProject } from "./domain";
import { createAdvancedComposerDraft, loadAdvancedComposerDraft, saveAdvancedComposerDraft } from "./advanced-composer-draft";
import { advancedRecipeList } from "./advanced-recipes";
import { validateAdvancedComposerDraft } from "./advanced-composer-validation";
import type { PublishedOffer } from "./published-offers-client";

describe("advanced multimodal recipe manifests", () => {
  it("publishes only the five certified local recipes and two real local models", () => {
    expect(advancedRecipeList.map(({ id }) => id)).toEqual(["audio.tts", "video.avatar", "video.motion-control", "video.edit", "video.extend"]);
    expect(new Set(advancedRecipeList.map(({ model }) => model.id))).toEqual(new Set(["local/test-audio-v1", "local/test-video-v1"]));
  });

  it("validates TTS and exact Avatar bindings, then persists the draft", () => {
    let project = createCreativeSpaceProject("advanced-test");
    project = addLocalAsset(project, { name: "face.png", mimeType: "image/png", bytes: 10, position: { x: 0, y: 0 } });
    project = addLocalAsset(project, { name: "voice.wav", mimeType: "audio/wav", bytes: 10, position: { x: 0, y: 200 } });
    const [imageId, audioId] = Object.keys(project.assets);
    const tts = { ...createAdvancedComposerDraft({ projectId: project.projectId, recipeId: "audio.tts", anchor: { x: 0, y: 0 } }), prompt: "مرحبا من الاختبار المحلي" };
    expect(validateAdvancedComposerDraft(tts, project)).toEqual({ valid: true, issues: [] });
    const avatar = {
      ...createAdvancedComposerDraft({ projectId: project.projectId, recipeId: "video.avatar", initialAsset: { id: imageId, kind: "IMAGE" }, anchor: { x: 10, y: 20 } }),
      bindings: [
        { assetId: imageId, role: "SOURCE" as const, ordinal: 0 },
        { assetId: audioId, role: "VOICE_AUDIO" as const, ordinal: 1 },
      ],
    };
    expect(validateAdvancedComposerDraft(avatar, project)).toEqual({ valid: true, issues: [] });
    saveAdvancedComposerDraft(avatar);
    expect(loadAdvancedComposerDraft(project.projectId)).toEqual(avatar);
  });

  it("blocks missing, wrong-kind and invented settings before Quote", () => {
    let project = createCreativeSpaceProject("advanced-invalid");
    project = addLocalAsset(project, { name: "face.png", mimeType: "image/png", bytes: 10, position: { x: 0, y: 0 } });
    const imageId = Object.keys(project.assets)[0];
    const draft = createAdvancedComposerDraft({ projectId: project.projectId, recipeId: "video.motion-control", initialAsset: { id: imageId, kind: "IMAGE" }, anchor: { x: 0, y: 0 } });
    const result = validateAdvancedComposerDraft({ ...draft, settings: { ...draft.settings, hidden: 9 } }, project);
    expect(result.valid).toBe(false);
    expect(result.issues.map(({ code }) => code)).toEqual(expect.arrayContaining(["BINDING_REQUIRED", "SETTING_NOT_ALLOWED"]));
  });

  it("uses typed bindings and controls from the selected published offer", () => {
    let project = createCreativeSpaceProject("advanced-published");
    project = addLocalAsset(project, { name: "face.png", mimeType: "image/png", bytes: 10, position: { x: 0, y: 0 } });
    project = addLocalAsset(project, { name: "voice.wav", mimeType: "audio/wav", bytes: 10, position: { x: 0, y: 200 } });
    const [imageId, audioId] = Object.keys(project.assets);
    const offer = {
      offerId: "published-avatar", providerModelId: "provider/avatar-v1",
      capability: { controlSchema: { version: "avatar-controls-v1", recipes: [{
        recipeId: "video.avatar", prompt: { required: false, visible: true, maxLength: 50 },
        bindings: { min: 2, max: 2, roles: ["SOURCE", "VOICE_AUDIO"], slots: [{ role: "SOURCE", kind: "IMAGE", required: true }, { role: "VOICE_AUDIO", kind: "AUDIO", required: true }] },
        controls: [{ id: "audio", kind: "boolean", defaultValue: true, values: [true] }],
      }] } },
    } as unknown as PublishedOffer;
    const base = createAdvancedComposerDraft({ projectId: project.projectId, recipeId: "video.avatar", anchor: { x: 0, y: 0 } });
    const valid = { ...base, offerId: offer.offerId, modelId: offer.providerModelId, bindings: [{ assetId: imageId, role: "SOURCE" as const, ordinal: 0 }, { assetId: audioId, role: "VOICE_AUDIO" as const, ordinal: 1 }], settings: { audio: true } };
    expect(validateAdvancedComposerDraft(valid, project, offer)).toEqual({ valid: true, issues: [] });
    expect(validateAdvancedComposerDraft({ ...valid, bindings: [{ assetId: audioId, role: "SOURCE" as const, ordinal: 0 }, { assetId: imageId, role: "VOICE_AUDIO" as const, ordinal: 1 }] }, project, offer)).toEqual(expect.objectContaining({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: "BINDING_INVALID" })]),
    }));
  });
});
