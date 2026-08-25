import { describe, expect, it } from "vitest";
import { createVideoComposerDraft, loadVideoComposerDraft, saveVideoComposerDraft } from "./video-composer-draft";
import { getVideoRecipeManifest, videoRecipeList } from "./video-recipes";

describe("video recipe manifests", () => {
  it("publishes only real Provider For Test video capability with explicit binding contracts", () => {
    expect(videoRecipeList.map(({ id }) => id)).toEqual([
      "video.text-to-video", "video.image-to-video", "video.first-last", "video.multi-reference",
    ]);
    expect(new Set(videoRecipeList.flatMap(({ models }) => models.map(({ id }) => id)))).toEqual(new Set(["local/test-video-v1"]));
    expect(getVideoRecipeManifest("video.text-to-video").bindings).toMatchObject({ min: 0, max: 0 });
    expect(getVideoRecipeManifest("video.image-to-video").bindings).toMatchObject({ min: 1, max: 1, slots: ["FIRST_FRAME"] });
    expect(getVideoRecipeManifest("video.first-last").bindings).toMatchObject({ min: 2, max: 2, slots: ["FIRST_FRAME", "LAST_FRAME"] });
    expect(getVideoRecipeManifest("video.multi-reference").bindings).toMatchObject({ min: 1, max: 4, slots: ["REFERENCE"] });
  });

  it("creates and restores a project-scoped first-frame draft without React Flow state", () => {
    const draft = createVideoComposerDraft({ projectId: "video-project", recipeId: "video.image-to-video", initialAssetId: "asset-1", anchor: { x: 320, y: 90 } }, new Date("2026-08-12T00:00:00.000Z"));
    expect(draft).toMatchObject({ modelId: "local/test-video-v1", bindings: [{ assetId: "asset-1", slot: "FIRST_FRAME", ordinal: 0 }], settings: { durationSeconds: 5, resolution: "720p", aspectRatio: "16:9", audio: false } });
    saveVideoComposerDraft(draft);
    expect(loadVideoComposerDraft("video-project")).toEqual(draft);
    expect(JSON.stringify(draft)).not.toContain("reactFlow");
  });
});

