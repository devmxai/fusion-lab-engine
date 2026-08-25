import { describe, expect, it, vi } from "vitest";
import { createCreativeSpaceProject } from "./domain";
import { hydrateStandardImageDraft, persistStandardAssetMediaMetadata, persistStandardGalleryTrash, persistStandardGenerationSession, persistStandardImageDraft, persistStandardImageResult, persistStandardReservedImage } from "./standard-workspace-persistence";

const draft = { schemaVersion: 1 as const, projectId: "project", recipeId: "image.create" as const, inputAssetId: null, prompt: "sunrise", offerId: "offer", modelId: "model", settings: { resolution: "1K", safe: true }, anchor: { x: 0, y: 0 }, updatedAt: "2026-08-24T10:00:00.000Z" };
describe("Standard workspace persistence", () => {
  it("writes the projection through the versioned project save boundary", async () => {
    const project = createCreativeSpaceProject("project", new Date("2026-08-24T09:00:00.000Z")); const save = vi.fn().mockResolvedValue({ projectId: "project", version: 2 });
    await persistStandardImageDraft({ project, version: 1, draft, save: save as any });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ standardProjection: expect.objectContaining({ draftsByMedia: expect.objectContaining({ IMAGE: expect.objectContaining({ prompt: "sunrise" }) }) }) }), 1);
  });
  it("rehydrates draft presentation and records output sessions through the same save boundary", async () => {
    const project = createCreativeSpaceProject("project", new Date("2026-08-24T09:00:00.000Z")); const save = vi.fn().mockResolvedValue({ projectId: "project", version: 2 });
    await persistStandardImageDraft({ project, version: 1, draft, save: save as any });
    const written = save.mock.calls[0][0];
    expect(hydrateStandardImageDraft(written)).toMatchObject({ prompt: "sunrise", settings: { safe: true }, inputAssetId: null });
    await persistStandardGenerationSession({ project: written, version: 2, operationId: "operation", outputAssetId: "asset", save: save as any });
    expect(save.mock.calls[1][0].standardProjection.generationSessions[0].outputAssetIds).toEqual(["asset"]);
  });
  it("rehydrates a saved reference only when its canonical asset still exists", async () => {
    const project = {
      ...createCreativeSpaceProject("project", new Date("2026-08-24T09:00:00.000Z")),
      assets: { reference: { id: "reference", projectId: "project", kind: "IMAGE" as const, name: "Reference", mimeType: "image/png", bytes: 1, status: "READY" as const, origin: "UPLOAD" as const, createdAt: "2026-08-24T09:01:00.000Z" } },
    };
    const save = vi.fn().mockResolvedValue({ projectId: "project", version: 2 });
    await persistStandardImageDraft({ project, version: 1, draft: { ...draft, inputAssetId: "reference" }, save: save as any });
    expect(hydrateStandardImageDraft(save.mock.calls[0][0])).toMatchObject({ inputAssetId: "reference" });
    const stale = { ...save.mock.calls[0][0], assets: {} };
    expect(hydrateStandardImageDraft(stale)).toMatchObject({ inputAssetId: null });
  });
  it("records a confirmed reservation in canonical operations before later recovery", async () => {
    const project = createCreativeSpaceProject("project", new Date("2026-08-24T09:00:00.000Z")); const save = vi.fn().mockResolvedValue({ projectId: "project", version: 2 });
    await persistStandardReservedImage({ project, version: 1, draft, confirmed: { quote: {} as any, operation: { id: "operation", quoteId: "quote", provider: "kie", modelId: "model", state: "RESERVED", financials: { customerQuotedCredits: 6, customerChargedCredits: 0 }, events: [], createdAt: "2026-08-24T10:00:00.000Z", updatedAt: "2026-08-24T10:00:00.000Z", localOnly: false }, localOnly: false }, save: save as any });
    expect(save.mock.calls[0][0].operations.operation.state).toBe("RESERVED");
  });
  it("records a settled result as a canonical asset with its private delivery reference", async () => {
    const project = createCreativeSpaceProject("project", new Date("2026-08-24T09:00:00.000Z"));
    const reservedSave = vi.fn().mockResolvedValue({ projectId: "project", version: 2 });
    await persistStandardReservedImage({ project, version: 1, draft, confirmed: { quote: {} as any, operation: { id: "operation", quoteId: "quote", provider: "kie", modelId: "model", state: "RESERVED", financials: { customerQuotedCredits: 6, customerChargedCredits: 0 }, events: [], createdAt: "2026-08-24T10:00:00.000Z", updatedAt: "2026-08-24T10:00:00.000Z", localOnly: false }, localOnly: false }, save: reservedSave as any });
    const reserved = reservedSave.mock.calls[0][0];
    const resultSave = vi.fn().mockResolvedValue({ projectId: "project", version: 3 });
    await persistStandardImageResult({ project: reserved, version: 2, execution: { quote: {} as any, localOnly: false, timeline: [], operation: { id: "operation", quoteId: "quote", provider: "kie", modelId: "model", state: "SETTLED", financials: { customerQuotedCredits: 6, customerChargedCredits: 6 }, resultUrl: "blob:browser-local", assetChecksumSha256: "checksum", delivery: { assetId: "private-asset", mediaType: "image", contentType: "image/png", byteLength: 42, checksumSha256: "checksum" }, events: [], createdAt: "2026-08-24T10:00:00.000Z", updatedAt: "2026-08-24T10:01:00.000Z", localOnly: false } }, save: resultSave as any });
    expect(resultSave.mock.calls[0][0].operations.operation).toMatchObject({ state: "SETTLED", outputAssetId: "output:operation", customerChargedCredits: 6 });
    expect(resultSave.mock.calls[0][0].assets["output:operation"]).toMatchObject({ deliveryAssetId: "private-asset", status: "READY" });
    expect(resultSave.mock.calls[0][0].assets["output:operation"].resultUrl).toBeUndefined();
  });
  it("records provider failure without inventing a delivered asset or a successful charge", async () => {
    const project = createCreativeSpaceProject("project", new Date("2026-08-24T09:00:00.000Z"));
    const reservedSave = vi.fn().mockResolvedValue({ projectId: "project", version: 2 });
    await persistStandardReservedImage({ project, version: 1, draft, confirmed: { quote: {} as any, operation: { id: "operation", quoteId: "quote", provider: "kie", modelId: "model", state: "RESERVED", financials: { customerQuotedCredits: 6, customerChargedCredits: 0 }, events: [], createdAt: "2026-08-24T10:00:00.000Z", updatedAt: "2026-08-24T10:00:00.000Z", localOnly: false }, localOnly: false }, save: reservedSave as any });
    const resultSave = vi.fn().mockResolvedValue({ projectId: "project", version: 3 });
    await persistStandardImageResult({ project: reservedSave.mock.calls[0][0], version: 2, execution: { quote: {} as any, localOnly: false, timeline: [], operation: { id: "operation", quoteId: "quote", provider: "kie", modelId: "model", state: "PROVIDER_FAILED", financials: { customerQuotedCredits: 6, customerChargedCredits: 0, providerChargedCredits: 2 }, resultUrl: null, assetChecksumSha256: null, delivery: null, events: [], createdAt: "2026-08-24T10:00:00.000Z", updatedAt: "2026-08-24T10:01:00.000Z", localOnly: false } }, save: resultSave as any });
    expect(resultSave.mock.calls[0][0].operations.operation).toMatchObject({ state: "PROVIDER_FAILED", customerChargedCredits: 0, providerActualCredits: 2, outputAssetId: null });
    expect(resultSave.mock.calls[0][0].assets["output:operation"]).toBeUndefined();
  });
  it("persists gallery trash through the same versioned save boundary", async () => {
    let project = createCreativeSpaceProject("project", new Date("2026-08-24T09:00:00.000Z"));
    project = { ...project, assets: { generated: { id: "generated", name: "Result", kind: "IMAGE", origin: "GENERATED", status: "READY", mimeType: "image/png", bytes: 1, createdAt: "2026-08-24T09:01:00.000Z", position: { x: 0, y: 0 }, operationId: "operation" } } } as any;
    const save = vi.fn().mockResolvedValue({ projectId: "project", version: 2 });
    await persistStandardGalleryTrash({ project, version: 1, assetId: "generated", action: "TRASH", save: save as any });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ standardProjection: expect.objectContaining({ trashEntries: [expect.objectContaining({ assetId: "generated" })] }) }), 1);
  });
  it("persists decoded media facts without changing the canonical asset identity", async () => {
    const project = {
      ...createCreativeSpaceProject("project", new Date("2026-08-24T09:00:00.000Z")),
      assets: {
        generated: {
          id: "generated", projectId: "project", name: "Result", kind: "IMAGE" as const,
          origin: "GENERATED" as const, status: "READY" as const, mimeType: "image/png",
          bytes: 1, deliveryAssetId: "private-delivery", createdAt: "2026-08-24T09:01:00.000Z",
        },
      },
    };
    const save = vi.fn().mockResolvedValue({ projectId: "project", version: 2 });
    await persistStandardAssetMediaMetadata({
      project,
      version: 1,
      assetId: "generated",
      metadata: { width: 1080, height: 1920 },
      save: save as any,
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        assets: expect.objectContaining({
          generated: expect.objectContaining({
            deliveryAssetId: "private-delivery",
            mediaMetadata: { width: 1080, height: 1920 },
          }),
        }),
      }),
      1,
    );
  });
});
