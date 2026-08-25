import { describe, expect, it } from "vitest";
import { imageTerminalStateCopy } from "./image-operation-state-copy";

const operation = (state: "PROVIDER_FAILED" | "DELIVERY_FAILED" | "RECONCILIATION_REQUIRED", customerChargedCredits: number | null) => ({ state, customerChargedCredits });

describe("imageTerminalStateCopy", () => {
  it("reports provider failure without claiming a refund", () => {
    const copy = imageTerminalStateCopy(operation("PROVIDER_FAILED", 0), "en");
    expect(copy.title).toBe("Provider generation failed");
    expect(copy.detail).toContain("Recorded final customer charge: 0 credits.");
    expect(copy.detail).not.toMatch(/refund/i);
  });
  it("keeps delivery failure distinct from provider failure", () => {
    const copy = imageTerminalStateCopy(operation("DELIVERY_FAILED", 6), "en");
    expect(copy.title).toBe("Result delivery needs review");
    expect(copy.detail).toContain("A new generation was not created.");
  });
  it("blocks retry/refund inference when reconciliation is required", () => {
    const copy = imageTerminalStateCopy(operation("RECONCILIATION_REQUIRED", null), "ar");
    expect(copy.title).toBe("مطلوبة تسوية مالية");
    expect(copy.detail).toContain("لا تعِد المحاولة");
    expect(copy.detail).toContain("لم يتم إثباته بعد");
  });
});
