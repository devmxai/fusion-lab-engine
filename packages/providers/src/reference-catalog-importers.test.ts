import { describe, expect, it } from "vitest";
import { buildPublicReferenceCatalogSnapshot, KieReferenceCatalogImporter, OpenRouterReferenceCatalogImporter } from "./reference-catalog-importers.ts";

describe("provider public reference catalog importers", () => {
  it("normalizes stable OpenRouter public models without treating aliases/free variants as activatable references", () => {
    const models = new OpenRouterReferenceCatalogImporter().import({ data: [
      { id: "openai/gpt-image-1", name: "GPT Image 1", architecture: { input_modalities: ["text", "image"], output_modalities: ["image"] }, supported_parameters: ["prompt", "size"] },
      { id: "openai/gpt-image-1:free", name: "Free variant", architecture: { input_modalities: ["text"], output_modalities: ["image"] } },
      { id: "openai/gpt-image-1~latest", name: "Moving alias", architecture: { input_modalities: ["text"], output_modalities: ["image"] } },
    ] });
    expect(models).toEqual([expect.objectContaining({ providerModelId: "openai/gpt-image-1", state: "REFERENCE_ACTIVE", modalities: ["image", "text"], sourceUrls: ["https://openrouter.ai/api/v1/models"] })]);
    expect(models[0]?.taxonomyHint).toMatchObject({
      reviewState: "UNREVIEWED", source: "OFFICIAL_MODELS_API", productFamily: { id: "family.openrouter.openai" }, experienceCategories: ["IMAGE"],
    });
  });

  it("requires KIE documentation evidence for every imported model", () => {
    const models = new KieReferenceCatalogImporter().import([{
      providerModelId: "kling-v1-example", displayName: "Kling Example", familyId: "family.kie.kling", modalities: ["video"],
      supportedParameters: ["prompt", "duration"], documentationUrl: "https://docs.kie.ai/kling/example", requestExampleSha256: "a".repeat(64),
    }]);
    expect(models[0]).toMatchObject({ providerId: "kie", providerModelId: "kling-v1-example", state: "REFERENCE_ACTIVE" });
    expect(models[0]?.taxonomyHint).toMatchObject({ reviewState: "UNREVIEWED", source: "OFFICIAL_DOCUMENTATION", experienceCategories: ["VIDEO"] });
    expect(() => new KieReferenceCatalogImporter().import([{ providerModelId: "guessed", displayName: "Guessed", familyId: "family", modalities: ["video"], supportedParameters: [], documentationUrl: "not-a-url", requestExampleSha256: "a".repeat(64) }])).toThrow();
  });

  it("makes a deterministic immutable public snapshot and rejects provider/model mismatch", () => {
    const models = new OpenRouterReferenceCatalogImporter().import({ data: [{ id: "openai/gpt-image-1", name: "GPT Image 1", architecture: { input_modalities: ["text"], output_modalities: ["image"] } }] });
    const snapshot = buildPublicReferenceCatalogSnapshot({ id: "snapshot.openrouter.public.001", providerId: "openrouter", observedAt: "2026-08-22T00:00:00.000Z", sourceUrls: [OpenRouterReferenceCatalogImporter.sourceUrl], rawPayload: { fixture: true }, parserVersion: OpenRouterReferenceCatalogImporter.parserVersion, models });
    expect(snapshot).toMatchObject({ sourceScope: "PUBLIC_REFERENCE", models, rawPayloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/), manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it("records observed family/version/edition separately from a customer-publishable decision", () => {
    const [model] = new KieReferenceCatalogImporter().import([{
      providerModelId: "kling/v3-turbo-image-to-video-pro", displayName: "Kling - V3 Turbo Image To Video Pro", familyId: "family.kie.kling",
      modalities: ["image", "video"], supportedParameters: ["prompt"], documentationUrl: "https://docs.kie.ai/market/kling/kling-v3-turbo", requestExampleSha256: "b".repeat(64),
    }]);
    expect(model?.taxonomyHint).toEqual(expect.objectContaining({
      reviewState: "UNREVIEWED", productFamily: { id: "family.kie.kling", displayName: "Kling" },
      version: { id: "observed.3", displayName: "3" }, edition: { id: "observed.turbo", displayName: "Turbo" }, experienceCategories: ["VIDEO"],
    }));
  });

  it("does not invent a customer experience category for a text-only source observation", () => {
    const [model] = new OpenRouterReferenceCatalogImporter().import({ data: [{
      id: "example/lyrics", name: "Lyrics Writer", architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    }] });
    expect(model?.taxonomyHint?.experienceCategories).toEqual([]);
  });
});
