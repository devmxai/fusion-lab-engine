import { describe, expect, it } from "vitest";
import { KieDocumentationCatalogImporter, parseKieDocumentationPage } from "./kie-documentation-catalog.ts";

const pageUrl = "https://docs.kie.ai/market/gpt/gpt-image-2-text-to-image";
const index = `# docs.kie.ai\n- [GPT Image-2 - Text to Image](${pageUrl}.md): official model`; 
const capture = {
  title: "GPT Image-2 - Text to Image", documentationUrl: pageUrl,
  rawMarkdown: `curl --data '{\n  "model": "gpt-image-2-text-to-image",\n  "input": { "prompt": "city", "aspect_ratio": "auto" }\n}'`,
};

describe("KIE documentation catalog", () => {
  it("derives an evidence-backed model descriptor from an official request example", () => {
    expect(parseKieDocumentationPage(capture)).toMatchObject({
      providerModelId: "gpt-image-2-text-to-image", modalities: ["image", "text"], supportedParameters: ["aspect_ratio", "prompt"], requestExampleSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("admits the official Kling 3.0 video page although its index title omits 'to video'", () => {
    expect(parseKieDocumentationPage({
      title: "Kling 3.0", documentationUrl: "https://docs.kie.ai/market/kling/kling-3-0",
      rawMarkdown: `{"model":"kling-3.0/video","input":{"prompt":"scene","image_urls":["https://example.test/first.png"],"sound":false,"duration":"5","aspect_ratio":"16:9","mode":"pro","multi_shots":false}}`,
    })).toMatchObject({
      providerModelId: "kling-3.0/video", modalities: ["text", "image", "video"],
      supportedParameters: ["aspect_ratio", "duration", "image_urls", "mode", "multi_shots", "prompt", "sound"],
    });
  });

  it("uses the official index and rejects a page that has no evidenced model ID", () => {
    const importer = new KieDocumentationCatalogImporter();
    const snapshot = importer.snapshot({ id: "snapshot.kie.public.001", observedAt: "2026-08-22T00:00:00.000Z", indexMarkdown: index, captures: [capture] });
    expect(snapshot).toMatchObject({ providerId: "kie", sourceScope: "PUBLIC_REFERENCE", models: [expect.objectContaining({ providerModelId: "gpt-image-2-text-to-image" })] });
    expect(() => importer.import([{ ...capture, rawMarkdown: "No request example in this document." }])).toThrow(/no model ID/);
  });
});
