// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { deliveredAssetFilename, ImageEngineRequestError, imageRequestErrorMessage } from "./image-quote-client";

describe("delivered asset download naming", () => {
  it("adds the extension proven by the private response content type", () => {
    expect(deliveredAssetFilename("GPT Image 2 · 1K", "image/png")).toBe("GPT Image 2 · 1K.png");
    expect(deliveredAssetFilename("FusionLab video", "video/mp4; charset=binary")).toBe("FusionLab video.mp4");
  });

  it("sanitizes filesystem control characters without replacing an existing extension", () => {
    expect(deliveredAssetFilename("result:<final>?*.webp", "image/png")).toBe("result--final---.webp");
  });

  it("uses a safe fallback name and extension for unknown media", () => {
    expect(deliveredAssetFilename("   ", "application/octet-stream")).toBe("FusionLab-result.bin");
  });

  it("maps typed financial and price errors without claiming a refund or success", () => {
    expect(imageRequestErrorMessage(new ImageEngineRequestError(409, "INSUFFICIENT_CREDITS", "raw"), "en")).toContain("No generation was started");
    expect(imageRequestErrorMessage(new ImageEngineRequestError(409, "PUBLISHED_OFFER_STALE", "raw"), "en")).toContain("review a new price");
    expect(imageRequestErrorMessage(new ImageEngineRequestError(409, "QUOTE_EXPIRED", "raw"), "ar")).toContain("لم تُنشأ عملية جديدة");
    expect(imageRequestErrorMessage(new ImageEngineRequestError(403, "ASSET_GRANT_EXPIRED", "raw"), "en")).toContain("secure download link expired");
  });
});
