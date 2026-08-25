import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decimalToAtomic } from "./decimal.ts";
import { ExactEquivalenceRegistry } from "./equivalence.ts";
import { ProviderFundingBook } from "./funding.ts";
import { ProviderTreasury } from "./treasury.ts";
import { ProviderTreasuryError, type TreasuryPolicy } from "./types.ts";

const evidence = (value: string) => createHash("sha256").update(value).digest("hex");
const account = "openrouter:workspace-local";
const now = new Date("2026-08-12T12:00:00.000Z");

function policy(overrides: Partial<TreasuryPolicy> = {}): TreasuryPolicy {
  return {
    safetyReserveAtomic: 10_000_000n,
    largestAllowedJobAtomic: 20_000_000n,
    fundingLeadTimeDays: 2,
    spendLimits: {
      perJobAtomic: 25_000_000n,
      dailyAtomic: 100_000_000n,
      monthlyAtomic: 1_000_000_000n,
    },
    ...overrides,
  };
}

describe("exact provider money", () => {
  it("parses decimal and scientific usage.cost into integer microcredits", () => {
    expect(decimalToAtomic("0.25", 1_000_000n)).toBe(250_000n);
    expect(decimalToAtomic(0.000001, 1_000_000n)).toBe(1n);
    expect(decimalToAtomic("1.2345671", 1_000_000n, "ceil")).toBe(1_234_568n);
    expect(() => decimalToAtomic("1.2345671", 1_000_000n)).toThrow("cannot be represented exactly");
  });
});

describe("provider funding lots and actual cash COGS", () => {
  it("allocates usage.cost FIFO and includes the funding fee effect without floating point", () => {
    const book = new ProviderFundingBook(() => now);
    book.addLot({
      id: "funding-lot-1",
      providerAccountId: account,
      nativeReceivedAtomic: 95_000_000n,
      cashPaidMicrousd: 100_000_000n,
      nativeFaceValueMicrousdPerAtomic: 1n,
      fundedAt: "2026-08-01T00:00:00.000Z",
      sourceEvidenceHash: evidence("invoice-1"),
    });
    const actual = book.recordActualCost({
      usageId: "usage-1",
      operationId: "operation-1",
      providerAccountId: account,
      source: "usage.cost",
      sourceEvidenceHash: evidence("openrouter-usage-1"),
      usageNativeAtomic: 950_000n,
    });
    expect(actual).toMatchObject({
      usageNativeAtomic: 950_000n,
      cashCostMicrousd: 1_000_000n,
      fundingFeeEffectMicrousd: 50_000n,
    });
    expect(book.lotsSnapshot()[0]).toMatchObject({
      nativeRemainingAtomic: 94_050_000n,
      cashAllocatedMicrousd: 1_000_000n,
    });
  });

  it("replays the same usage once and rejects unknown/conflicting cost", () => {
    const book = new ProviderFundingBook(() => now);
    book.addLot({
      id: "funding-lot-2",
      providerAccountId: account,
      nativeReceivedAtomic: 10_000_000n,
      cashPaidMicrousd: 10_000_000n,
      nativeFaceValueMicrousdPerAtomic: 1n,
      fundedAt: "2026-08-01T00:00:00.000Z",
      sourceEvidenceHash: evidence("invoice-2"),
    });
    const input = {
      usageId: "usage-2",
      operationId: "operation-2",
      providerAccountId: account,
      source: "usage.cost" as const,
      sourceEvidenceHash: evidence("usage-2"),
      usageNativeAtomic: 1_000_000n,
    };
    expect(book.recordActualCost(input)).toEqual(book.recordActualCost(input));
    expect(book.lotsSnapshot()[0]?.nativeRemainingAtomic).toBe(9_000_000n);
    expect(() => book.recordActualCost({ ...input, usageNativeAtomic: 2_000_000n }))
      .toThrowError(expect.objectContaining<Partial<ProviderTreasuryError>>({ code: "ACTUAL_COST_CONFLICT" }));
    expect(() => book.recordActualCost({ ...input, usageId: "usage-unknown", usageNativeAtomic: null }))
      .toThrowError(expect.objectContaining<Partial<ProviderTreasuryError>>({ code: "UNKNOWN_ACTUAL_COST" }));
  });
});

describe("shadow balance, runway and dispatch controls", () => {
  it("subtracts all commitments and safety stock and calculates conservative burn/runway", () => {
    const treasury = new ProviderTreasury(new Map([[account, policy()]]), () => now);
    treasury.recordBalanceSnapshot({
      id: "balance-1",
      providerAccountId: account,
      confirmedRemainingAtomic: 200_000_000n,
      capturedAt: now.toISOString(),
      sourceEvidenceHash: evidence("credits-api-1"),
    });
    treasury.recordCommitment({
      operationId: "operation-running",
      providerAccountId: account,
      state: "RUNNING",
      maximumExposureAtomic: 20_000_000n,
    });
    treasury.recordCommitment({
      operationId: "operation-unknown",
      providerAccountId: account,
      state: "SUBMISSION_UNKNOWN",
      maximumExposureAtomic: 15_000_000n,
    });
    treasury.recordCommitment({
      operationId: "operation-uncertain",
      providerAccountId: account,
      state: "RECONCILIATION_UNCERTAINTY",
      maximumExposureAtomic: 5_000_000n,
    });
    treasury.recordActualSpend({
      id: "spend-1",
      providerAccountId: account,
      actualAtomic: 2_000_000n,
      occurredAt: new Date(now.getTime() - 30 * 60 * 1_000).toISOString(),
    });
    const dashboard = treasury.dashboard(account);
    expect(dashboard).toMatchObject({
      confirmedRemainingAtomic: 200_000_000n,
      submittedRunningExposureAtomic: 20_000_000n,
      unknownExposureAtomic: 15_000_000n,
      reconciliationUncertaintyAtomic: 5_000_000n,
      shadowAvailableAtomic: 150_000_000n,
      forecastDailyBurnAtomic: 48_000_000n,
      state: "HEALTHY",
    });
    expect(dashboard.runway).toEqual({ numeratorDays: 150_000_000n, denominatorDailyBurn: 48_000_000n });
  });

  it("fails closed on per-job/daily limits, low shadow balance and an open circuit", () => {
    const treasury = new ProviderTreasury(new Map([[account, policy()]]), () => now);
    treasury.recordBalanceSnapshot({
      id: "balance-2",
      providerAccountId: account,
      confirmedRemainingAtomic: 30_000_000n,
      capturedAt: now.toISOString(),
      sourceEvidenceHash: evidence("credits-api-2"),
    });
    expect(() => treasury.authorizeDispatch(account, 26_000_000n))
      .toThrowError(expect.objectContaining<Partial<ProviderTreasuryError>>({ code: "SPEND_LIMIT_EXCEEDED" }));
    expect(() => treasury.authorizeDispatch(account, 21_000_000n))
      .toThrowError(expect.objectContaining<Partial<ProviderTreasuryError>>({ code: "INSUFFICIENT_SHADOW_BALANCE" }));
    treasury.setCircuit(account, true, "ANOMALOUS_SPEND");
    expect(() => treasury.authorizeDispatch(account, 1_000_000n))
      .toThrowError(expect.objectContaining<Partial<ProviderTreasuryError>>({ code: "CIRCUIT_OPEN" }));
    expect(treasury.dashboard(account).state).toBe("DISPATCH_STOP");
  });
});

describe("Exact equivalence gate", () => {
  const semanticHash = evidence("same-semantic-contract");
  const member = (routeVersionId: string, semanticContractHash = semanticHash) => ({
    routeVersionId,
    semanticContractHash,
    capabilityEvidenceHash: evidence(`capability:${routeVersionId}`),
    qualityEvidenceHash: evidence(`quality:${routeVersionId}`),
  });

  it("allows Exact fallback only inside an approved evidence group", () => {
    const registry = new ExactEquivalenceRegistry();
    registry.register({
      id: "equivalence-1",
      familyVersionId: "family-video-v1",
      approvedAt: now.toISOString(),
      approver: "local-reviewer",
      members: [member("route-kie-v1"), member("route-openrouter-v1")],
    });
    expect(registry.requireExactFallback("route-kie-v1", "route-openrouter-v1").id).toBe("equivalence-1");
    expect(() => registry.requireExactFallback("route-kie-v1", "same-name-but-unapproved"))
      .toThrowError(expect.objectContaining<Partial<ProviderTreasuryError>>({ code: "EXACT_EQUIVALENCE_REQUIRED" }));
  });

  it("rejects a group whose semantic contracts differ even when names match", () => {
    const registry = new ExactEquivalenceRegistry();
    expect(() => registry.register({
      id: "equivalence-conflict",
      familyVersionId: "family-video-v1",
      approvedAt: now.toISOString(),
      approver: "local-reviewer",
      members: [member("route-provider-a"), member("route-provider-b", evidence("different-semantics"))],
    })).toThrowError(expect.objectContaining<Partial<ProviderTreasuryError>>({ code: "EQUIVALENCE_CONFLICT" }));
  });
});
