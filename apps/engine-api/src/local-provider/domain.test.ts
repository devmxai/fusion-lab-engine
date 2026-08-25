// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  MockQuoteInputSchema,
  grossMarginBpsFromMarkup,
} from "./domain.ts";

describe("local provider request boundary", () => {
  it("distinguishes 100% markup from 50% gross margin", () => {
    expect(grossMarginBpsFromMarkup(10_000n)).toBe(5_000n);
    expect(grossMarginBpsFromMarkup(5_000n)).toBe(3_333n);
  });

  it("normalizes defaults and rejects unknown models at the HTTP trust boundary", () => {
    expect(MockQuoteInputSchema.parse({ modelId: "local/test-image-v1" })).toMatchObject({
      userId: "local-user",
      quantity: 1,
      resolution: "720p",
      audio: false,
      promotionCode: null,
    });
    expect(MockQuoteInputSchema.safeParse({ modelId: "unknown/model" }).success).toBe(false);
  });
});
