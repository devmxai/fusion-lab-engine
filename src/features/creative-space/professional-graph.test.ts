import { describe, expect, it } from "vitest";
import { addLocalAsset, applyImageOperationResult, createCreativeSpaceProject, createProfessionalAdvancedShot, createProfessionalGroup, createProfessionalSubflow, getProfessionalGraph, getSpaceViewMode, placeReservedImageOperation, prepareProfessionalBatchBranch, saveProfessionalTemplate, setSpaceViewMode } from "./domain";
import { assessProfessionalGraphBudget, PROFESSIONAL_GRAPH_BUDGET, projectToProfessionalGraph } from "./professional-graph";
import { loadCreativeSpaceProject, saveCreativeSpaceProject } from "./storage";

function lineageProject() {
  let project = createCreativeSpaceProject("professional-graph");
  project = addLocalAsset(project, { name: "source.png", mimeType: "image/png", bytes: 42, position: { x: 0, y: 0 } });
  const sourceAssetId = Object.keys(project.assets)[0];
  project = placeReservedImageOperation(project, {
    operation: { id: "operation-1", quoteId: "quote-1", provider: "provider-test", modelId: "local/test-image-v1", state: "RESERVED", financials: { customerQuotedCredits: 4, providerEstimatedCredits: 2 }, createdAt: "2026-08-19T00:00:00.000Z" },
    recipeId: "image.edit", inputAssetId: sourceAssetId, inputRole: "SOURCE", anchor: { x: 320, y: 0 },
  });
  return applyImageOperationResult(project, {
    operationId: "operation-1", state: "SETTLED", resultUrl: "/v1/dev/mock/assets/operation-1", checksumSha256: "a".repeat(64),
    customerChargedCredits: 4, providerChargedCredits: 2, updatedAt: "2026-08-19T00:01:00.000Z",
  });
}

describe("Professional Graph domain projection", () => {
  it("opens a saved Standard project as Standard without a migration", () => {
    const standard = lineageProject();
    const legacy = { ...standard };
    delete legacy.viewMode;
    saveCreativeSpaceProject(legacy);
    expect(getSpaceViewMode(loadCreativeSpaceProject("professional-graph"))).toBe("STANDARD");
  });

  it("fails closed to a new Standard project for an invalid persisted view mode", () => {
    const project = lineageProject();
    saveCreativeSpaceProject({ ...project, viewMode: "RAW_PROVIDER" as never });
    const restored = loadCreativeSpaceProject("professional-graph");
    expect(getSpaceViewMode(restored)).toBe("STANDARD");
    expect(restored.assets).toEqual({});
  });

  it("switches views without converting or losing canonical project data", () => {
    const standard = lineageProject();
    const professional = setSpaceViewMode(standard, "PROFESSIONAL");
    const restored = setSpaceViewMode(professional, "STANDARD");
    expect(getSpaceViewMode(professional)).toBe("PROFESSIONAL");
    expect(getSpaceViewMode(restored)).toBe("STANDARD");
    expect(restored.assets).toEqual(standard.assets);
    expect(restored.operations).toEqual(standard.operations);
    expect(restored.bindings).toEqual(standard.bindings);
    expect(restored.canvasItems).toEqual(standard.canvasItems);
  });

  it("projects persistent semantic ports and lineage edges without provider execution data", () => {
    const projection = projectToProfessionalGraph(lineageProject());
    const operation = projection.nodes.find((node) => node.kind === "OPERATION");
    expect(operation).toMatchObject({
      kind: "OPERATION", operationId: "operation-1", recipeId: "image.edit",
      ports: expect.arrayContaining([
        expect.objectContaining({ direction: "INPUT", semantic: "SOURCE" }),
        expect.objectContaining({ direction: "OUTPUT", semantic: "OUTPUT", connectedEntityId: "output:operation-1" }),
      ]),
    });
    expect(projection.edges.map((edge) => edge.semantic)).toEqual(expect.arrayContaining(["SOURCE", "OUTPUT"]));
    expect(JSON.stringify(projection)).not.toContain("provider-test");
    expect(JSON.stringify(projection)).not.toContain("quote-1");
  });

  it("persists groups, subflows, templates and non-executable batch drafts against canonical entities", () => {
    let project = lineageProject();
    project = createProfessionalGroup(project, { title: "Edit sequence", canvasItemIds: Object.keys(project.canvasItems) });
    const group = Object.values(getProfessionalGraph(project).groups)[0];
    project = createProfessionalSubflow(project, { title: "Image edit", operationIds: ["operation-1"], outputAssetIds: ["output:operation-1"] });
    project = saveProfessionalTemplate(project, { title: "Edit template", groupId: group.id });
    project = prepareProfessionalBatchBranch(project, { title: "Source batch", recipeId: "image.edit", sourceAssetIds: [Object.keys(project.assets).find((id) => id !== "output:operation-1")!] });
    const graph = getProfessionalGraph(project);
    expect(Object.values(graph.groups)[0]).toMatchObject({ title: "Edit sequence", canvasItemIds: expect.any(Array) });
    expect(Object.values(graph.subflows)[0]).toMatchObject({ operationIds: ["operation-1"], outputAssetIds: ["output:operation-1"] });
    expect(Object.values(graph.templates)[0]).toMatchObject({ groupId: group.id, bindingIds: ["binding:operation-1:0"] });
    expect(Object.values(graph.batchBranches)[0]).toMatchObject({ recipeId: "image.edit", state: "DRAFT", executionAllowed: false });
  });

  it("rejects non-existent entities and empty batch drafts", () => {
    const project = lineageProject();
    expect(() => createProfessionalGroup(project, { title: "Bad", canvasItemIds: ["missing"] })).toThrow(/existing canvas items/);
    expect(() => prepareProfessionalBatchBranch(project, { title: "Empty", recipeId: "image.edit", sourceAssetIds: [] })).toThrow(/ready source assets/);
  });

  it("adds non-executable advanced shots sequentially to a read-only timeline", () => {
    let project = lineageProject();
    const sourceAssetId = Object.keys(project.assets).find((id) => id !== "output:operation-1")!;
    project = createProfessionalAdvancedShot(project, { title: "Opening shot", sourceAssetId, durationMs: 5_000 });
    project = createProfessionalAdvancedShot(project, { title: "Detail shot", sourceAssetId, durationMs: 3_000 });
    const graph = getProfessionalGraph(project);
    const clips = Object.values(graph.timelineClips).sort((left, right) => left.startMs - right.startMs);
    expect(Object.values(graph.advancedShots).map((shot) => ({ state: shot.state, executionAllowed: shot.executionAllowed }))).toEqual([
      { state: "DRAFT", executionAllowed: false }, { state: "DRAFT", executionAllowed: false },
    ]);
    expect(Object.values(graph.timelineTracks)).toHaveLength(1);
    expect(clips.map(({ startMs, durationMs }) => ({ startMs, durationMs }))).toEqual([{ startMs: 0, durationMs: 5_000 }, { startMs: 5_000, durationMs: 3_000 }]);
  });

  it("rejects an advanced shot without a ready visual source or bounded duration", () => {
    const project = lineageProject();
    expect(() => createProfessionalAdvancedShot(project, { title: "Bad", sourceAssetId: "missing", durationMs: 5_000 })).toThrow(/ready image\/video source/);
    const sourceAssetId = Object.keys(project.assets).find((id) => id !== "output:operation-1")!;
    expect(() => createProfessionalAdvancedShot(project, { title: "Bad", sourceAssetId, durationMs: 61_000 })).toThrow(/1–60 second duration/);
  });

  it("passes the published large-graph projection budget and reports a bounded overflow", () => {
    let project = createCreativeSpaceProject("professional-budget");
    for (let index = 0; index < PROFESSIONAL_GRAPH_BUDGET.maxNodes; index += 1) {
      project = addLocalAsset(project, { name: `asset-${index}.png`, mimeType: "image/png", bytes: index, position: { x: index * 4, y: 0 } });
    }
    const startedAt = performance.now();
    const projection = projectToProfessionalGraph(project);
    const projectionMilliseconds = performance.now() - startedAt;
    expect(assessProfessionalGraphBudget(projection, { timelineClipCount: 0, projectionMilliseconds })).toMatchObject({ withinBudget: true, nodeCount: 250, reasons: [] });
    project = addLocalAsset(project, { name: "overflow.png", mimeType: "image/png", bytes: 1, position: { x: 1_100, y: 0 } });
    expect(assessProfessionalGraphBudget(projectToProfessionalGraph(project), { timelineClipCount: 0, projectionMilliseconds: 1 })).toMatchObject({ withinBudget: false, reasons: ["NODE_BUDGET_EXCEEDED"] });
  });
});
