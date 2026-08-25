import { describe, expect, it } from "vitest";
import { buildPublicReferenceCatalogSnapshot, OpenRouterReferenceCatalogImporter } from "./reference-catalog-importers.ts";
import { InMemoryReferenceCatalogStore } from "./reference-catalog-store.ts";

const importer = new OpenRouterReferenceCatalogImporter();
function snapshot(id: string, models: unknown[], observedAt: string) {
  return buildPublicReferenceCatalogSnapshot({
    id, providerId: "openrouter", observedAt, sourceUrls: [OpenRouterReferenceCatalogImporter.sourceUrl], rawPayload: { models },
    parserVersion: OpenRouterReferenceCatalogImporter.parserVersion, models: importer.import({ data: models }),
  });
}

describe("reference catalog snapshots", () => {
  it("creates an immutable diff against the last snapshot without turning models into routes", () => {
    const store = new InMemoryReferenceCatalogStore();
    const first = store.stage(snapshot("snapshot.openrouter.001", [{ id: "openai/gpt-image-1", name: "GPT Image 1", architecture: { input_modalities: ["text"], output_modalities: ["image"] } }], "2026-08-22T00:00:00.000Z"));
    const second = store.stage(snapshot("snapshot.openrouter.002", [
      { id: "openai/gpt-image-1", name: "GPT Image 1", architecture: { input_modalities: ["text"], output_modalities: ["image"] }, supported_parameters: ["prompt", "size"] },
      { id: "openai/gpt-image-2", name: "GPT Image 2", architecture: { input_modalities: ["text"], output_modalities: ["image"] } },
    ], "2026-08-22T01:00:00.000Z"));
    expect(first.diff).toEqual([{ providerModelId: "openai/gpt-image-1", kind: "ADDED", changedFields: [] }]);
    expect(second).toMatchObject({ baselineSnapshotId: first.id, diff: [
      { providerModelId: "openai/gpt-image-1", kind: "CHANGED", changedFields: expect.arrayContaining(["supportedParameters", "sourceEvidenceSha256"]) },
      { providerModelId: "openai/gpt-image-2", kind: "ADDED", changedFields: [] },
    ] });
    expect(second.models[0]).not.toHaveProperty("routeId");
  });

  it("rebuilds the same immutable history on restart and rejects an invalid baseline", () => {
    const firstStore = new InMemoryReferenceCatalogStore();
    const first = firstStore.stage(snapshot("snapshot.openrouter.001", [{ id: "openai/gpt-image-1", name: "GPT Image 1", architecture: { input_modalities: ["text"], output_modalities: ["image"] } }], "2026-08-22T00:00:00.000Z"));
    const secondStore = new InMemoryReferenceCatalogStore();
    secondStore.restore(firstStore.list());
    expect(secondStore.list()).toEqual([first]);
    expect(() => secondStore.prepare(snapshot("snapshot.openrouter.002", [{ id: "openai/gpt-image-2", name: "GPT Image 2", architecture: { input_modalities: ["text"], output_modalities: ["image"] } }], "2026-08-22T01:00:00.000Z"), "missing"))
      .toThrow("reference_catalog_snapshot_not_found");
  });
});
