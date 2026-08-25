// @vitest-environment node

import { describe, expect, it } from "vitest";
import { localPromotionVersions } from "./local-promotion-fixture.ts";
import { InMemoryPromotionEngine, PromotionDomainError } from "./promotion-engine.ts";
import type { PromotionEvaluationInput, PromotionVersion } from "./types.ts";

const now = () => new Date("2026-08-13T10:00:00.000Z");

function input(overrides: Partial<PromotionEvaluationInput> = {}): PromotionEvaluationInput {
  return {
    quoteId: "quote-001",
    quoteExpiresAt: "2026-08-13T10:15:00.000Z",
    promotionCode: "local50",
    userId: "user-001",
    product: "video.generate",
    routeId: "route:local/test-video-v1:v1",
    cohort: "local-development",
    activeCampaignKeys: [],
    baseCustomerCredits: 40,
    conservativeCostMicrousd: "200000",
    creditValueFloorMicrousd: "10000",
    hardFloorMarginBps: 2500,
    ...overrides,
  };
}

describe("promotion budget engine", () => {
  it("reserves the exact hard-floor subsidy and moves it once to redeemed budget", () => {
    const engine = new InMemoryPromotionEngine(localPromotionVersions, now);
    const reservation = engine.reserve(input());
    expect(reservation).toMatchObject({
      discountCredits: 20,
      finalCustomerCredits: 20,
      subsidyMicrousd: "66667",
      status: "RESERVED",
    });
    expect(engine.budget("promotion:local-video-launch:v1")).toMatchObject({
      reservedCredits: 20,
      reservedMicrousd: "66667",
      redeemedCredits: 0,
    });
    expect(engine.attach(reservation.id, "operation-001")).toMatchObject({ status: "RESERVED", operationId: "operation-001" });
    expect(engine.redeem(reservation.id, "operation-001").status).toBe("REDEEMED");
    expect(engine.redeem(reservation.id, "operation-001").status).toBe("REDEEMED");
    expect(engine.budget("promotion:local-video-launch:v1")).toMatchObject({
      reservedCredits: 0,
      reservedMicrousd: "0",
      redeemedCredits: 20,
      redeemedMicrousd: "66667",
    });
    expect(engine.subsidyEntriesSnapshot()).toMatchObject([
      { kind: "RESERVE", reservedCreditsDelta: 20, reservedMicrousdDelta: "66667" },
      { kind: "REDEEM", reservedCreditsDelta: -20, redeemedCreditsDelta: 20, redeemedMicrousdDelta: "66667" },
    ]);
    expect(engine.reconciliationIssues()).toEqual([]);
  });

  it("fails closed for eligibility, stacking, fraud, caps, and exhausted dual budgets", () => {
    const cases: Array<[Partial<PromotionEvaluationInput>, PromotionDomainError["code"]]> = [
      [{ product: "image.generate" }, "PROMOTION_NOT_ELIGIBLE"],
      [{ activeCampaignKeys: ["another-campaign"] }, "PROMOTION_STACKING_FORBIDDEN"],
      [{ userId: "local-fraud-blocked" }, "PROMOTION_FRAUD_BLOCKED"],
    ];
    for (const [override, code] of cases) {
      const engine = new InMemoryPromotionEngine(localPromotionVersions, now);
      expect(() => engine.reserve(input(override))).toThrowError(expect.objectContaining({ code }));
    }

    const capEngine = new InMemoryPromotionEngine(localPromotionVersions, now);
    capEngine.reserve(input({ quoteId: "q1", userId: "u1" }));
    expect(() => capEngine.reserve(input({ quoteId: "q2", userId: "u1" }))).toThrowError(expect.objectContaining({ code: "PROMOTION_CAP_REACHED" }));
    capEngine.reserve(input({ quoteId: "q2", userId: "u2" }));
    expect(() => capEngine.reserve(input({ quoteId: "q3", userId: "u3" }))).toThrowError(expect.objectContaining({ code: "PROMOTION_CAP_REACHED" }));

    const lowBudget = structuredClone(localPromotionVersions[0]) as PromotionVersion;
    (lowBudget as { id: string }).id = "promotion:low-budget:v1";
    (lowBudget as { code: string }).code = "LOWBUDGET";
    (lowBudget as { budget: { credits: number; microusd: string } }).budget = { credits: 20, microusd: "66666" };
    const budgetEngine = new InMemoryPromotionEngine([lowBudget], now);
    expect(() => budgetEngine.reserve(input({ promotionCode: "LOWBUDGET" }))).toThrowError(expect.objectContaining({ code: "PROMOTION_BUDGET_EXHAUSTED" }));
  });

  it("releases expired quote reservations back to both budgets", () => {
    let clock = new Date("2026-08-13T10:00:00.000Z");
    const engine = new InMemoryPromotionEngine(localPromotionVersions, () => clock);
    const reservation = engine.reserve(input());
    clock = new Date("2026-08-13T10:16:00.000Z");
    expect(engine.releaseExpired()).toEqual([expect.objectContaining({ id: reservation.id, status: "RELEASED", releaseReason: "QUOTE_EXPIRED" })]);
    expect(engine.budget(reservation.campaignVersionId)).toMatchObject({ reservedCredits: 0, reservedMicrousd: "0" });
    expect(engine.subsidyEntriesSnapshot().at(-1)).toMatchObject({ kind: "RELEASE", reservedCreditsDelta: -20, reasonCode: "QUOTE_EXPIRED" });
    expect(engine.reconciliationIssues()).toEqual([]);
  });

  it("requires immutable unique versions and maker-checker publication", () => {
    const engine = new InMemoryPromotionEngine(localPromotionVersions, now);
    expect(Object.isFrozen(engine.list()[0]?.eligibility.products)).toBe(true);
    expect(() => engine.register(localPromotionVersions[0]!)).toThrowError(expect.objectContaining({ code: "DUPLICATE_PROMOTION_VERSION" }));
    const invalid = structuredClone(localPromotionVersions[0]) as PromotionVersion;
    (invalid as { id: string }).id = "promotion:bad-approval:v1";
    (invalid as { code: string }).code = "BADAPPROVAL";
    (invalid as { approvals: PromotionVersion["approvals"] }).approvals = {
      createdBy: "same-person",
      approvedBy: ["same-person", "other-person"],
      publishedAt: "2026-08-01T00:00:00.000Z",
    };
    expect(() => engine.register(invalid)).toThrowError(expect.objectContaining({ code: "INVALID_PROMOTION_VERSION" }));
  });
});
