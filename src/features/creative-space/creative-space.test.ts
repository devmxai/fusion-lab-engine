import { describe, expect, it } from "vitest";
import { addLocalAsset, applyAdvancedOperationResult, applyImageOperationResult, applyVideoOperationResult, createCreativeSpaceProject, moveCanvasItem, normalizeOperationFinancialEvidence, placeReservedAdvancedOperation, placeReservedImageOperation, placeReservedVideoOperation, setProjectViewport } from "./domain";
import { creativeSpaceStorageKey, loadCreativeSpaceProject, saveCreativeSpaceProject } from "./storage";
import { projectDocumentForPersistence } from "./project-client";
import { projectToFlow } from "./xyflow-adapter";

describe("Creative Space domain and xyflow adapter", () => {
  it("persists domain positions and viewport without storing React Flow JSON as project truth", () => {
    let project = createCreativeSpaceProject("project-refresh", new Date("2026-08-12T00:00:00.000Z"));
    project = addLocalAsset(project, {
      name: "reference.png", mimeType: "image/png", bytes: 1024, position: { x: 120, y: 240 },
    });
    const canvasId = Object.keys(project.canvasItems)[0];
    project = moveCanvasItem(project, canvasId, { x: 640, y: 360 });
    project = setProjectViewport(project, { x: -120, y: 44, zoom: 0.8 });
    saveCreativeSpaceProject(project);

    const restored = loadCreativeSpaceProject("project-refresh");
    expect(restored.canvasItems[canvasId].position).toEqual({ x: 640, y: 360 });
    expect(restored.viewport).toEqual({ x: -120, y: 44, zoom: 0.8 });
    expect(localStorage.getItem(creativeSpaceStorageKey("project-refresh"))).not.toContain("reactFlow");
    expect(projectToFlow(restored).nodes[0].position).toEqual({ x: 640, y: 360 });
  });

  it("keeps the durable asset identity but never persists a browser Blob URL", () => {
    let project = createCreativeSpaceProject("project-private-preview");
    project = addLocalAsset(project, { name: "preview.png", mimeType: "image/png", bytes: 1, position: { x: 0, y: 0 } });
    const assetId = Object.keys(project.assets)[0];
    project = {
      ...project,
      assets: { ...project.assets, [assetId]: { ...project.assets[assetId], deliveryAssetId: "asset-private-1", resultUrl: "blob:browser-only-preview" } },
    };
    expect(projectDocumentForPersistence(project).assets[assetId]).toMatchObject({ deliveryAssetId: "asset-private-1" });
    expect(projectDocumentForPersistence(project).assets[assetId].resultUrl).toBeUndefined();
  });

  it("adapts a 100-card project with stable domain identities", () => {
    let project = createCreativeSpaceProject("project-100");
    for (let index = 0; index < 100; index += 1) {
      project = addLocalAsset(project, {
        name: `asset-${index}.png`, mimeType: "image/png", bytes: index,
        position: { x: (index % 10) * 280, y: Math.floor(index / 10) * 210 },
      });
    }
    const startedAt = performance.now();
    const flow = projectToFlow(project);
    const projectionMs = performance.now() - startedAt;
    expect(flow.nodes).toHaveLength(100);
    expect(new Set(flow.nodes.map(({ id }) => id)).size).toBe(100);
    expect(Object.keys(project.assets)).toHaveLength(100);
    expect(projectionMs).toBeLessThan(100);
  });

  it("rejects unsupported media and an unbounded viewport", () => {
    const project = createCreativeSpaceProject("project-bounds");
    expect(() => addLocalAsset(project, {
      name: "payload.exe", mimeType: "application/octet-stream", bytes: 10, position: { x: 0, y: 0 },
    })).toThrow(/image, video, or audio/);
    expect(() => setProjectViewport(project, { x: 0, y: 0, zoom: 9 })).toThrow(/bounded workspace/);
  });

  it("projects immutable input → operation → generated output lineage", () => {
    let project = createCreativeSpaceProject("project-lineage", new Date("2026-08-12T00:00:00.000Z"));
    project = addLocalAsset(project, { name: "source.png", mimeType: "image/png", bytes: 200, position: { x: 0, y: 0 } });
    const sourceId = Object.keys(project.assets)[0];
    project = placeReservedImageOperation(project, {
      operation: {
        id: "operation-1", quoteId: "quote-1", provider: "provider-test", modelId: "local/test-image-v1",
        state: "RESERVED", financials: { customerQuotedCredits: 4, providerEstimatedCredits: 2 }, createdAt: "2026-08-12T00:01:00.000Z",
      },
      recipeId: "image.edit",
      inputAssetId: sourceId,
      inputRole: "SOURCE",
      anchor: { x: 328, y: 0 },
    });
    expect(projectToFlow(project)).toMatchObject({ nodes: expect.arrayContaining([expect.objectContaining({ type: "spaceOperation" })]), edges: [expect.objectContaining({ data: { role: "SOURCE", ordinal: 0 } })] });

    project = applyImageOperationResult(project, {
      operationId: "operation-1",
      state: "SETTLED",
      resultUrl: "/v1/dev/mock/assets/operation-1?token=test",
      checksumSha256: "a".repeat(64),
      customerChargedCredits: 4,
      providerChargedCredits: 2,
      updatedAt: "2026-08-12T00:02:00.000Z",
    });
    const output = project.assets["output:operation-1"];
    expect(output).toMatchObject({ origin: "GENERATED", operationId: "operation-1", status: "READY" });
    expect(project.assets[sourceId]).toBeDefined();
    expect(project.operations["operation-1"]).toMatchObject({ state: "SETTLED", outputAssetId: output.id, customerChargedCredits: 4, providerActualCredits: 2 });
    const flow = projectToFlow(project);
    expect(flow.nodes).toHaveLength(3);
    expect(flow.edges.map(({ data }) => data?.role)).toEqual(expect.arrayContaining(["SOURCE", "OUTPUT"]));
  });
  it("projects ordered video bindings and a generated MP4 output without changing source assets", () => {
    let project = createCreativeSpaceProject("video-lineage", new Date("2026-08-13T00:00:00.000Z"));
    project = addLocalAsset(project, { name: "first.png", mimeType: "image/png", bytes: 100, position: { x: 0, y: 0 } });
    project = addLocalAsset(project, { name: "last.png", mimeType: "image/png", bytes: 100, position: { x: 0, y: 220 } });
    const [firstId, lastId] = Object.keys(project.assets);
    project = placeReservedVideoOperation(project, {
      operation: {
        id: "video-operation-1", quoteId: "video-quote-1", provider: "provider-test", modelId: "local/test-video-v1",
        state: "RESERVED", financials: { customerQuotedCredits: 20, providerEstimatedCredits: 10 }, createdAt: "2026-08-13T00:01:00.000Z",
      },
      recipeId: "video.first-last",
      bindings: [
        { assetId: firstId, role: "FIRST_FRAME", ordinal: 0 },
        { assetId: lastId, role: "LAST_FRAME", ordinal: 1 },
      ],
      anchor: { x: 340, y: 80 },
    });
    expect(projectToFlow(project).edges.map(({ data }) => data?.role)).toEqual(expect.arrayContaining(["FIRST_FRAME", "LAST_FRAME"]));

    project = applyVideoOperationResult(project, {
      operationId: "video-operation-1",
      state: "SETTLED",
      resultUrl: "/v1/dev/mock/assets/video-operation-1?token=test",
      checksumSha256: "b".repeat(64),
      customerChargedCredits: 20,
      providerChargedCredits: 10,
      updatedAt: "2026-08-13T00:02:00.000Z",
    });
    expect(project.assets["output:video-operation-1"]).toMatchObject({ kind: "VIDEO", mimeType: "video/mp4", origin: "GENERATED", status: "READY" });
    expect(project.assets[firstId]).toBeDefined();
    expect(project.assets[lastId]).toBeDefined();
    expect(project.operations["video-operation-1"]).toMatchObject({ state: "SETTLED", outputAssetId: "output:video-operation-1", customerChargedCredits: 20, providerActualCredits: 10 });
    expect(projectToFlow(project).edges.map(({ data }) => data?.role)).toEqual(expect.arrayContaining(["FIRST_FRAME", "LAST_FRAME", "OUTPUT"]));
  });

  it("creates an Audio Output for TTS through the same Operation lineage contract", () => {
    let project = createCreativeSpaceProject("tts-lineage", new Date("2026-08-13T01:00:00.000Z"));
    project = placeReservedAdvancedOperation(project, {
      operation: {
        id: "tts-operation-1", quoteId: "tts-quote-1", provider: "provider-test", modelId: "local/test-audio-v1",
        state: "RESERVED", financials: { customerQuotedCredits: 4, providerEstimatedCredits: 2 }, createdAt: "2026-08-13T01:01:00.000Z",
      },
      recipeId: "audio.tts",
      bindings: [],
      anchor: { x: 200, y: 100 },
    });
    project = applyAdvancedOperationResult(project, {
      operationId: "tts-operation-1",
      state: "SETTLED",
      outputKind: "AUDIO",
      resultUrl: "/v1/dev/mock/assets/tts-operation-1?token=test",
      checksumSha256: "c".repeat(64),
      customerChargedCredits: 4,
      providerChargedCredits: 2,
      updatedAt: "2026-08-13T01:02:00.000Z",
    });
    expect(project.assets["output:tts-operation-1"]).toMatchObject({ kind: "AUDIO", mimeType: "audio/wav", origin: "GENERATED", operationId: "tts-operation-1" });
    expect(project.operations["tts-operation-1"]).toMatchObject({ customerChargedCredits: 4, providerActualCredits: 2 });
    expect(projectToFlow(project).edges.map(({ data }) => data?.role)).toContain("OUTPUT");
  });

  it("never converts a quote into a final debit when delivery or reconciliation is unproven", () => {
    let project = createCreativeSpaceProject("financial-evidence");
    project = placeReservedAdvancedOperation(project, {
      operation: {
        id: "financial-operation", quoteId: "financial-quote", provider: "provider-test", modelId: "local/test-audio-v1",
        state: "RESERVED", financials: { customerQuotedCredits: 4, providerEstimatedCredits: 2 }, createdAt: "2026-08-13T01:01:00.000Z",
      },
      recipeId: "audio.tts", bindings: [], anchor: { x: 0, y: 0 },
    });
    project = applyAdvancedOperationResult(project, {
      operationId: "financial-operation", state: "RECONCILIATION_REQUIRED", outputKind: "AUDIO", resultUrl: null,
      checksumSha256: null, customerChargedCredits: 4, providerChargedCredits: 2, updatedAt: "2026-08-13T01:02:00.000Z",
    });
    expect(project.operations["financial-operation"]).toMatchObject({
      customerCredits: 4, providerEstimateCredits: 2, customerChargedCredits: null, providerActualCredits: null,
    });
  });

  it("records a proven zero customer debit separately from an unknown reconciliation outcome", () => {
    let project = createCreativeSpaceProject("financial-zero-evidence");
    project = placeReservedAdvancedOperation(project, {
      operation: {
        id: "failed-operation", quoteId: "failed-quote", provider: "provider-test", modelId: "local/test-audio-v1",
        state: "RESERVED", financials: { customerQuotedCredits: 4, providerEstimatedCredits: 2 }, createdAt: "2026-08-13T01:01:00.000Z",
      },
      recipeId: "audio.tts", bindings: [], anchor: { x: 0, y: 0 },
    });
    project = applyAdvancedOperationResult(project, {
      operationId: "failed-operation", state: "DELIVERY_FAILED", outputKind: "AUDIO", resultUrl: null,
      checksumSha256: null, customerChargedCredits: 0, providerChargedCredits: 2, updatedAt: "2026-08-13T01:02:00.000Z",
    });
    expect(project.operations["failed-operation"]).toMatchObject({ customerChargedCredits: 0, providerActualCredits: 2 });
  });

  it("hydrates legacy documents without inventing zero or quoted final charges", () => {
    let project = createCreativeSpaceProject("legacy-financial-document");
    project = placeReservedAdvancedOperation(project, {
      operation: {
        id: "legacy-operation", quoteId: "legacy-quote", provider: "provider-test", modelId: "local/test-audio-v1",
        state: "RESERVED", financials: { customerQuotedCredits: 4, providerEstimatedCredits: 2 }, createdAt: "2026-08-13T01:01:00.000Z",
      },
      recipeId: "audio.tts", bindings: [], anchor: { x: 0, y: 0 },
    });
    const legacy = structuredClone(project);
    const legacyOperation = legacy.operations["legacy-operation"] as unknown as Record<string, unknown>;
    delete legacyOperation.customerChargedCredits;
    delete legacyOperation.providerActualCredits;

    const hydrated = normalizeOperationFinancialEvidence(legacy);
    expect(hydrated.operations["legacy-operation"]).toMatchObject({ customerChargedCredits: null, providerActualCredits: null });
  });
});
