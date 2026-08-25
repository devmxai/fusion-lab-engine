import { describe, expect, it } from "vitest";
import { applyImageOperationResult, createCreativeSpaceProject, placeReservedImageOperation } from "./domain";
import { latestStandardImageReviewOperation, recoverableStandardImageOperation } from "./standard-operation-recovery";

describe("Standard operation recovery", () => {
  it("selects the newest unfinished image operation and ignores terminal work", () => {
    let project = createCreativeSpaceProject("project", new Date("2026-08-24T09:00:00.000Z"));
    project = placeReservedImageOperation(project, { operation: { id: "older", quoteId: "quote-1", provider: "kie", modelId: "model", state: "RESERVED", financials: { customerQuotedCredits: 4 }, createdAt: "2026-08-24T09:01:00.000Z" }, recipeId: "image.create", inputAssetId: null, inputRole: "SOURCE", anchor: { x: 0, y: 0 } });
    project = placeReservedImageOperation(project, { operation: { id: "newer", quoteId: "quote-2", provider: "kie", modelId: "model", state: "RESERVED", financials: { customerQuotedCredits: 4 }, createdAt: "2026-08-24T09:02:00.000Z" }, recipeId: "image.create", inputAssetId: null, inputRole: "SOURCE", anchor: { x: 0, y: 0 } });
    project = { ...project, operations: { ...project.operations, older: { ...project.operations.older, state: "SETTLED" } } };
    expect(recoverableStandardImageOperation(project)?.id).toBe("newer");
  });

  it("keeps a persisted reconciliation state visible without making it recoverable work", () => {
    let project = createCreativeSpaceProject("review", new Date("2026-08-24T09:00:00.000Z"));
    project = placeReservedImageOperation(project, { operation: { id: "review", quoteId: "quote", provider: "kie", modelId: "model", state: "RESERVED", financials: { customerQuotedCredits: 6 }, createdAt: "2026-08-24T09:00:00.000Z" }, recipeId: "image.create", inputAssetId: null, inputRole: "SOURCE", anchor: { x: 0, y: 0 } });
    project = applyImageOperationResult(project, { operationId: "review", state: "RECONCILIATION_REQUIRED", resultUrl: null, checksumSha256: null, customerChargedCredits: 0, updatedAt: "2026-08-24T09:01:00.000Z" });
    expect(recoverableStandardImageOperation(project)).toBeNull();
    expect(latestStandardImageReviewOperation(project)).toMatchObject({ id: "review", state: "RECONCILIATION_REQUIRED", customerChargedCredits: null });
  });

  it("does not show an old failure after a newer image has settled", () => {
    let project = createCreativeSpaceProject("latest-wins", new Date("2026-08-24T09:00:00.000Z"));
    project = placeReservedImageOperation(project, { operation: { id: "failed", quoteId: "quote-1", provider: "kie", modelId: "model", state: "RESERVED", financials: { customerQuotedCredits: 6 }, createdAt: "2026-08-24T09:01:00.000Z" }, recipeId: "image.create", inputAssetId: null, inputRole: "SOURCE", anchor: { x: 0, y: 0 } });
    project = applyImageOperationResult(project, { operationId: "failed", state: "PROVIDER_FAILED", resultUrl: null, checksumSha256: null, customerChargedCredits: 0, updatedAt: "2026-08-24T09:02:00.000Z" });
    project = placeReservedImageOperation(project, { operation: { id: "settled", quoteId: "quote-2", provider: "kie", modelId: "model", state: "RESERVED", financials: { customerQuotedCredits: 6 }, createdAt: "2026-08-24T09:03:00.000Z" }, recipeId: "image.create", inputAssetId: null, inputRole: "SOURCE", anchor: { x: 0, y: 0 } });
    project = applyImageOperationResult(project, { operationId: "settled", state: "SETTLED", resultUrl: "https://example.test/result.png", checksumSha256: "a".repeat(64), customerChargedCredits: 6, updatedAt: "2026-08-24T09:04:00.000Z" });
    expect(latestStandardImageReviewOperation(project)).toBeNull();
  });
});
