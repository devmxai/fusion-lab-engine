// @vitest-environment node

import { describe, expect, it } from "vitest";
import { normalizeKiePricingVariant, pinnedReviewedPresentation, releasedAdapterVersion, resolveKiePricingModel } from "./production-pricing-command.ts";

describe("provider pricing SKU normalization", () => {
  it("separates an image resolution from the model identity", () => {
    expect(normalizeKiePricingVariant("gpt image 2, image-to-image, 4k", "gpt-image-2-image-to-image", "per image")).toEqual({
      label: "4k",
      dimensions: { generationType: "image-to-image", resolution: "4K", billingBasis: "per_image" },
    });
  });

  it("captures video duration, resolution, quality and audio as one SKU", () => {
    expect(normalizeKiePricingVariant("kling 3, image-to-video, pro, 1080p, 10s, with audio", "kling/image-to-video", "per second")).toEqual({
      label: "pro · 1080p · 10s · with audio",
      dimensions: { generationType: "image-to-video", quality: "pro", resolution: "1080p", durationSeconds: 10, audio: true, billingBasis: "per_second" },
    });
  });

  it("parses KIE's compound Kling duration SKU labels", () => {
    expect(normalizeKiePricingVariant("kling 2.5 turbo, image-to-video, Turbo Pro-10.0s", "kling/v2-5-turbo-image-to-video-pro", "per video"))
      .toMatchObject({ dimensions: { generationType: "image-to-video", quality: "pro", durationSeconds: 10, billingBasis: "per_video" } });
  });

  it("keeps quality tiers independent for the same image model", () => {
    expect(normalizeKiePricingVariant("gpt image 1.5, image-to-image, high", "gpt-image/1.5-image-to-image", "per image")).toEqual({
      label: "high",
      dimensions: { generationType: "image-to-image", quality: "high", billingBasis: "per_image" },
    });
  });

  it("matches an unanchored KIE price row to the exact documented operation", () => {
    const models = [
      { referenceModelId: "reference.kie.text", value: { providerModelId: "grok-imagine-image-2-0-text-to-image" } },
      { referenceModelId: "reference.kie.edit", value: { providerModelId: "grok-imagine-image-2-0-image-edit" } },
    ];
    expect(resolveKiePricingModel(models, {
      modelDescription: "grok-imagine-image-2-0, Image Edit", interfaceType: "image", provider: "Grok", creditPrice: "4", creditUnit: "per image", usdPrice: "0.02", anchor: "",
    })).toMatchObject({ referenceModelId: "reference.kie.edit" });
  });

  it("matches KIE's Kling 3.0 pricing name to the documented V3 Turbo I2V request ID", () => {
    const models = [
      { referenceModelId: "reference.kie.kling-v3-image", value: { providerModelId: "kling/v3-turbo-image-to-video" } },
      { referenceModelId: "reference.kie.kling-v3-text", value: { providerModelId: "kling/v3-turbo-text-to-video" } },
    ];
    expect(resolveKiePricingModel(models, {
      modelDescription: "kling 3.0 turbo, image-to-video, 1080P", interfaceType: "video", provider: "Kling", creditPrice: "22.5", creditUnit: "per second", usdPrice: "0.1125", anchor: "",
    })).toMatchObject({ referenceModelId: "reference.kie.kling-v3-image" });
  });

  it("matches Kling 3.0's documented video request ID to the public pricing family", () => {
    const models = [{ referenceModelId: "reference.kie.kling3", value: { providerModelId: "kling-3.0/video" } }];
    expect(resolveKiePricingModel(models, {
      modelDescription: "Kling 3.0, video, without audio-1080P", interfaceType: "video", provider: "Kling", creditPrice: "18", creditUnit: "per second", usdPrice: "0.09", anchor: "https://kie.ai/kling-3-0",
    })).toMatchObject({ referenceModelId: "reference.kie.kling3" });
  });

  it("refuses an unanchored KIE price row when the operation is ambiguous", () => {
    const models = [
      { referenceModelId: "reference.kie.text", value: { providerModelId: "grok-imagine-image-2-0-text-to-image" } },
      { referenceModelId: "reference.kie.edit", value: { providerModelId: "grok-imagine-image-2-0-image-edit" } },
    ];
    expect(resolveKiePricingModel(models, {
      modelDescription: "grok-imagine-image-2-0", interfaceType: "image", provider: "Grok", creditPrice: "4", creditUnit: "per image", usdPrice: "0.02", anchor: "",
    })).toBeNull();
  });
});

describe("provider runtime release gate", () => {
  it("maps only certified media/protocol combinations", () => {
    expect(releasedAdapterVersion("kie", { dimensions: { generationType: "text-to-image" } })).toBe("kie-market.v1");
    expect(releasedAdapterVersion("kie", { dimensions: { generationType: "image-to-image", billingBasis: "per_image", resolution: "1K" } }, "gpt-image-2-image-to-image"))
      .toBe("kie-market.image-to-image.gpt-image-2.v1");
    expect(releasedAdapterVersion("kie", { dimensions: { generationType: "image-to-video", billingBasis: "per_video", durationSeconds: 5 } }, "kling/v2-5-turbo-image-to-video-pro"))
      .toBe("kie-market.image-to-video.v1");
    expect(releasedAdapterVersion("kie", { dimensions: { generationType: "image-to-video", billingBasis: "per_video", durationSeconds: 5, resolution: "1080p" } }, "kling/v3-turbo-image-to-video"))
      .toBe("kie-market.image-to-video.v3");
    expect(releasedAdapterVersion("kie", { dimensions: { generationType: "image-to-video", billingBasis: "per_video", durationSeconds: 7, quality: "pro", resolution: "1080p", audio: false, supportedAspectRatios: ["16:9", "9:16", "1:1"] } }, "kling-3.0/video"))
      .toBe("kie-market.kling-3.v1");
    expect(releasedAdapterVersion("openrouter", { runtimeReleasable: true, dimensions: { generationType: "text-to-image", billingBasis: "per_image" } })).toBe("openrouter-image.v1");
    expect(releasedAdapterVersion("openrouter", { dimensions: { generationType: "text-to-video", billingBasis: "per_video" } })).toBe("openrouter-video.v1");
  });

  it("does not publish OpenRouter token meters or unsupported media through an image adapter", () => {
    expect(releasedAdapterVersion("openrouter", { dimensions: { generationType: "text-to-image", billingBasis: "per_token" } })).toBeNull();
    expect(releasedAdapterVersion("openrouter", { runtimeReleasable: false, dimensions: { generationType: "text-to-image", billingBasis: "per_image" } })).toBeNull();
    expect(releasedAdapterVersion("openrouter", { meter: "prompt" })).toBeNull();
    expect(releasedAdapterVersion("kie", { dimensions: { generationType: "text-to-video" } })).toBeNull();
    expect(releasedAdapterVersion("kie", { dimensions: { generationType: "image-to-image", billingBasis: "per_image", resolution: "2K" } }, "gpt-image-2-image-to-image")).toBeNull();
    expect(releasedAdapterVersion("kie", { dimensions: { generationType: "image-to-video", billingBasis: "per_video", durationSeconds: 5 } }, "another-provider-model")).toBeNull();
    expect(releasedAdapterVersion("kie", { dimensions: { generationType: "image-edit" } })).toBeNull();
  });
});

describe("customer presentation release pin", () => {
  it("copies only a reviewed taxonomy bound to the selected catalog snapshot", () => {
    const payload = {
      catalogSnapshotId: "snapshot.kling.3",
      reviewedTaxonomy: {
        schemaVersion: 1,
        reviewState: "REVIEWED",
        sourceCatalogSnapshotId: "snapshot.kling.3",
        productFamily: { id: "kling", displayName: "Kling" },
        version: { id: "3", displayName: "3.0" },
        edition: { id: "standard", displayName: "Standard" },
        experienceCategories: ["VIDEO"],
      },
    };
    expect(pinnedReviewedPresentation(payload, "snapshot.kling.3")).toMatchObject({ productFamily: { displayName: "Kling" }, version: { displayName: "3.0" } });
    expect(pinnedReviewedPresentation(payload, "snapshot.other")).toBeNull();
  });
});
