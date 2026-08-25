import { describe, expect, it } from "vitest";
import { OpenRouterReferenceCatalogBundleImporter, OpenRouterReferenceSourceLoader, openRouterCatalogSources } from "./openrouter-reference-catalog.ts";

const sourceFixture = {
  models: { data: [{ id: "openai/gpt-image-1", name: "GPT Image 1", architecture: { input_modalities: ["text"], output_modalities: ["image"] }, supported_parameters: ["prompt"] }] },
  images: { data: [{ id: "openai/gpt-image-1", name: "GPT Image 1", architecture: { input_modalities: ["text"], output_modalities: ["image"] }, supported_parameters: { resolution: { type: "enum" } } }] },
  videos: { data: [{ id: "google/veo-3.1", name: "Veo 3.1", supported_durations: [5, 8], supported_resolutions: ["720p"] }] },
};

describe("OpenRouter reference catalog bundle", () => {
  it("merges official source shapes without treating endpoint discovery as a customer route", () => {
    const snapshot = new OpenRouterReferenceCatalogBundleImporter().snapshot({ id: "snapshot.openrouter.bundle.001", observedAt: "2026-08-22T00:00:00.000Z", sources: sourceFixture });
    expect(snapshot.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerModelId: "openai/gpt-image-1", supportedParameters: ["prompt", "resolution"], state: "REFERENCE_ACTIVE" }),
      expect.objectContaining({ providerModelId: "google/veo-3.1", modalities: ["text", "video"], supportedParameters: expect.arrayContaining(["duration", "resolution"]) }),
    ]));
    expect(snapshot.sourceUrls).toEqual(Object.values(openRouterCatalogSources));
    expect(snapshot.models[0]).not.toHaveProperty("routeId");
  });

  it("only reads sources through an injected reader", async () => {
    const requested: string[] = [];
    const result = await new OpenRouterReferenceSourceLoader().load(async (url) => {
      requested.push(url);
      if (url === openRouterCatalogSources.models) return sourceFixture.models;
      if (url === openRouterCatalogSources.images) return sourceFixture.images;
      return sourceFixture.videos;
    });
    expect(result).toEqual(sourceFixture);
    expect(requested).toEqual(Object.values(openRouterCatalogSources));
  });

  it("captures every source independently and refuses a partial snapshot", async () => {
    const loader = new OpenRouterReferenceSourceLoader();
    const bundle = new OpenRouterReferenceCatalogBundleImporter();
    const intake = await loader.capture(async (url) => {
      if (url === openRouterCatalogSources.videos) throw new Error("official video source unavailable");
      return {
        body: url === openRouterCatalogSources.models ? sourceFixture.models : sourceFixture.images,
        observedAt: "2026-08-22T00:00:00.000Z",
        etag: `etag:${url.split("/").at(-1)}`,
        contentType: "application/json",
      };
    });
    expect(intake).toMatchObject({ captures: [expect.anything(), expect.anything()], failures: [{ sourceUrl: openRouterCatalogSources.videos, code: "SOURCE_READ_FAILED" }] });
    expect(() => bundle.snapshotFromIntake({ id: "snapshot.openrouter.partial", intake })).toThrow(/partial/i);
  });

  it("requires a complete bounded intake before building a reviewable snapshot", async () => {
    const loader = new OpenRouterReferenceSourceLoader();
    const intake = await loader.capture(async (url) => ({
      body: url === openRouterCatalogSources.models ? sourceFixture.models : url === openRouterCatalogSources.images ? sourceFixture.images : sourceFixture.videos,
      observedAt: "2026-08-22T01:00:00.000Z",
      etag: "official-etag",
      contentType: "application/json",
    }));
    const snapshot = new OpenRouterReferenceCatalogBundleImporter().snapshotFromIntake({ id: "snapshot.openrouter.complete", intake });
    expect(snapshot).toMatchObject({ id: "snapshot.openrouter.complete", providerId: "openrouter", models: expect.arrayContaining([expect.objectContaining({ providerModelId: "openai/gpt-image-1" })]) });
    expect(intake.captures).toEqual(expect.arrayContaining([expect.objectContaining({ rawPayloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/), byteLength: expect.any(Number), etag: "official-etag" })]));
  });
});
