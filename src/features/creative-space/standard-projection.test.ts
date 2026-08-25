import { describe, expect, it } from "vitest";
import { addLocalAsset, applyImageOperationResult, createCreativeSpaceProject, placeReservedImageOperation, setSpaceViewMode } from "./domain";
import { createEmptyStandardProjection, isStandardProjectionV1 } from "./standard-projection-contract";
import { appendStandardGenerationSession, getStandardProjection, projectToStandardWorkspace, restoreStandardGeneratedAsset, setStandardProjection, STANDARD_PROJECTION_OWNERSHIP, trashStandardGeneratedAsset, writeStandardImageDraft } from "./standard-projection";
import { loadCreativeSpaceProject, saveCreativeSpaceProject } from "./storage";

function projectWithLineage() {
  let project = createCreativeSpaceProject("standard-projection", new Date("2026-08-24T09:00:00.000Z"));
  project = addLocalAsset(project, { name: "source.png", mimeType: "image/png", bytes: 42, position: { x: 0, y: 0 } });
  const sourceAssetId = Object.keys(project.assets)[0];
  project = placeReservedImageOperation(project, {
    operation: { id: "operation-1", quoteId: "quote-1", provider: "kie", modelId: "gpt-image-2", state: "RESERVED", financials: { customerQuotedCredits: 6, providerEstimatedCredits: 3 }, createdAt: "2026-08-24T09:01:00.000Z" },
    recipeId: "image.create", inputAssetId: sourceAssetId, inputRole: "SOURCE", anchor: { x: 300, y: 0 },
  });
  return applyImageOperationResult(project, {
    operationId: "operation-1", state: "SETTLED", resultUrl: "/v2/assets/output", checksumSha256: "a".repeat(64),
    customerChargedCredits: 6, providerChargedCredits: 3, updatedAt: "2026-08-24T09:02:00.000Z",
  });
}

describe("Standard projection v1", () => {
  it("opens a schemaVersion 1 project without a migration", () => {
    const legacy = projectWithLineage();
    expect(legacy.standardProjection).toBeUndefined();
    expect(getStandardProjection(legacy)).toEqual(createEmptyStandardProjection(new Date(legacy.updatedAt)));
    expect(legacy.schemaVersion).toBe(1);
  });

  it("derives Gallery and references from canonical domain truth", () => {
    const project = projectWithLineage();
    const view = projectToStandardWorkspace(project);
    // Uploaded project inputs are reusable assets in Standard as well as
    // generated outputs. Keeping them here makes image-to-image/video flows
    // possible without duplicating the source in projection state.
    expect(view.galleryAssets.map((asset) => asset.id)).toEqual([
      expect.stringMatching(/^[0-9a-f-]{36}$/),
      "output:operation-1",
    ]);
    expect(view.referenceAssets).toHaveLength(1);
    expect(view.operations.map((operation) => operation.id)).toEqual(["operation-1"]);
    expect(view.bindings.map((binding) => binding.role)).toContain("SOURCE");
    expect(STANDARD_PROJECTION_OWNERSHIP.domainTruth).toEqual(["assets", "operations", "bindings"]);
  });

  it("round-trips one project through Standard and Space without conversion or loss", () => {
    const canonical = projectWithLineage();
    const projection = { ...createEmptyStandardProjection(new Date("2026-08-24T10:00:00.000Z")), galleryOrder: ["output:operation-1"] };
    const standard = setStandardProjection(setSpaceViewMode(canonical, "STANDARD"), projection, new Date("2026-08-24T10:00:00.000Z"));
    const space = setSpaceViewMode(standard, "PROFESSIONAL", new Date("2026-08-24T10:01:00.000Z"));
    saveCreativeSpaceProject(space);
    const reopened = loadCreativeSpaceProject(canonical.projectId);

    expect(reopened.assets).toEqual(canonical.assets);
    expect(reopened.operations).toEqual(canonical.operations);
    expect(reopened.bindings).toEqual(canonical.bindings);
    expect(reopened.standardProjection?.galleryOrder).toEqual(["output:operation-1"]);
    expect(projectToStandardWorkspace(setSpaceViewMode(reopened, "STANDARD")).galleryAssets[0].id).toBe("output:operation-1");
    expect(JSON.stringify(reopened.standardProjection)).not.toMatch(/reactFlow|providerPayload|providerTaskId|routeId/);
  });

  it("fails closed for an unknown or payload-bearing projection", () => {
    expect(isStandardProjectionV1({ ...createEmptyStandardProjection(), schemaVersion: 2 })).toBe(false);
    expect(isStandardProjectionV1({ ...createEmptyStandardProjection(), providerPayload: { secret: true } })).toBe(false);
  });

  it("persists image draft presentation and session ordering without copying canonical facts", () => {
    const project = projectWithLineage();
    const drafted = writeStandardImageDraft(project, { schemaVersion: 1, projectId: project.projectId, recipeId: "image.create", inputAssetId: null, prompt: "sunrise", offerId: "offer", modelId: "model", settings: { resolution: "1K", safe: true }, anchor: { x: 0, y: 0 }, updatedAt: "2026-08-24T10:00:00.000Z" }, new Date("2026-08-24T10:00:00.000Z"));
    const sessioned = appendStandardGenerationSession(drafted, { operationId: "operation-1", outputAssetId: "output:operation-1" }, new Date("2026-08-24T10:01:00.000Z"));
    expect(sessioned.standardProjection?.draftsByMedia.IMAGE?.settings).toEqual({ resolution: "1K", safe: true });
    expect(sessioned.standardProjection?.generationSessions[0]?.operationIds).toEqual(["operation-1"]);
    expect(sessioned.standardProjection?.galleryOrder).toEqual(["output:operation-1"]);
    expect(sessioned.standardProjection).not.toHaveProperty("operations");
  });

  it("moves generated work to trash without deleting canonical lineage, then restores it", () => {
    const original = projectWithLineage();
    const trashed = trashStandardGeneratedAsset(original, "output:operation-1", new Date("2026-08-24T11:00:00.000Z"));
    // Trashing a generated result must not hide the uploaded source asset.
    expect(projectToStandardWorkspace(trashed).galleryAssets.map((asset) => asset.id)).toEqual([
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    ]);
    expect(trashed.assets["output:operation-1"]).toEqual(original.assets["output:operation-1"]);
    expect(trashed.operations["operation-1"]).toEqual(original.operations["operation-1"]);
    expect(trashed.standardProjection?.trashEntries[0]).toMatchObject({ assetId: "output:operation-1", deletedAt: "2026-08-24T11:00:00.000Z" });
    const restored = restoreStandardGeneratedAsset(trashed, "output:operation-1", new Date("2026-08-24T11:01:00.000Z"));
    expect(projectToStandardWorkspace(restored).galleryAssets.map((asset) => asset.id)).toEqual([
      "output:operation-1",
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    ]);
    expect(restored.standardProjection?.trashEntries).toEqual([]);
  });
});
