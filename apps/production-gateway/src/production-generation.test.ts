import { describe, expect, it } from "vitest";
import { ProductionGenerationError, customerOfferPresentation, resolveCertifiedPublishedSettings, sourceAssetIdFromQuoteInput } from "./production-generation";

describe("sourceAssetIdFromQuoteInput", () => {
  const assetId = "d065c35b-294e-4a25-9ee0-163e6ca71368";

  it("accepts the current client FIRST_FRAME slot contract", () => {
    expect(sourceAssetIdFromQuoteInput({
      bindings: [{ assetId, kind: "IMAGE", slot: "FIRST_FRAME", ordinal: 0 }],
    })).toBe(assetId);
  });

  it("retains role support for existing persisted drafts", () => {
    expect(sourceAssetIdFromQuoteInput({
      bindings: [{ assetId, kind: "IMAGE", role: "FIRST_FRAME", ordinal: 0 }],
    })).toBe(assetId);
  });
});

describe("customerOfferPresentation", () => {
  it("reads only a valid, immutable presentation pinned in an offer variant", () => {
    expect(customerOfferPresentation({ variant: {
      dimensions: { generationType: "image-to-video" },
      presentation: {
        schemaVersion: 1,
        productFamily: { id: "kling", displayName: "Kling" },
        version: { id: "3", displayName: "3.0" },
        experienceCategories: ["VIDEO"],
      },
    } })).toMatchObject({ productFamily: { displayName: "Kling" }, version: { displayName: "3.0" } });
    expect(customerOfferPresentation({ variant: { presentation: { schemaVersion: 1, productFamily: { id: "", displayName: "Kling" }, experienceCategories: ["VIDEO"] } } })).toBeNull();
  });
});

describe("resolveCertifiedPublishedSettings", () => {
  const kling3 = (settings: Record<string, unknown> = {}) => resolveCertifiedPublishedSettings({
    dimensions: {
      generationType: "image-to-video",
      durationSeconds: 10,
      quality: "pro",
      resolution: "1080p",
      audio: false,
      supportedAspectRatios: ["16:9", "9:16", "1:1"],
    },
    providerId: "kie",
    providerModelId: "kling-3.0/video",
    video: true,
    imageToVideo: true,
    settings,
  });

  it("pins the exact published SKU configuration", () => {
    expect(kling3({ durationSeconds: 10, quality: "pro", resolution: "1080p", audio: false, aspectRatio: "9:16" }))
      .toEqual({ durationSeconds: 10, quality: "pro", resolution: "1080p", audio: false, aspectRatio: "9:16" });
  });

  it.each([
    [{ resolution: "4K" }, "resolution"],
    [{ durationSeconds: 8 }, "duration"],
    [{ quality: "4K" }, "quality"],
    [{ audio: true }, "audio"],
    [{ aspectRatio: "3:2" }, "aspect ratio"],
    [{ hiddenPriceOverride: 1 }, "hiddenPriceOverride"],
  ])("rejects an unpriced or unsupported %s selection", (settings, _label) => {
    expect(() => kling3(settings)).toThrow(ProductionGenerationError);
    try { kling3(settings); }
    catch (error) { expect(error).toMatchObject({ code: "PUBLISHED_OFFER_INCOMPATIBLE", status: 409 }); }
  });

  it("keeps documented GPT Image aspect ratio auto instead of accepting an invented ratio", () => {
    expect(resolveCertifiedPublishedSettings({
      dimensions: { generationType: "image-to-image", resolution: "1K" },
      providerId: "kie", providerModelId: "gpt-image-2-image-to-image", video: false, imageToVideo: false,
      settings: { resolution: "1K", aspectRatio: "auto" },
    })).toMatchObject({ resolution: "1K", aspectRatio: "auto" });
    expect(() => resolveCertifiedPublishedSettings({
      dimensions: { generationType: "image-to-image", resolution: "1K" },
      providerId: "kie", providerModelId: "gpt-image-2-image-to-image", video: false, imageToVideo: false,
      settings: { resolution: "1K", aspectRatio: "16:9" },
    })).toThrow(ProductionGenerationError);
  });
});
