// @vitest-environment node

import { describe, expect, it } from "vitest";
import { evidenceHash } from "./canonical.ts";
import { InMemoryExplorationBudget } from "./exploration.ts";
import type { ExplorationBudgetPolicyVersion } from "./types.ts";

const baseTime = new Date("2026-08-13T12:00:00.000Z");
const policy: ExplorationBudgetPolicyVersion = {
  id: "smart-exploration-budget:v1",
  version: 1,
  lifecycle: "PUBLISHED",
  allocationBps: 500,
  totalBudgetMicrousd: "1000000",
  maximumIncrementalCostPerOperationMicrousd: "300000",
  maximumSelectionsPerUser: 2,
  eligibleProfileVersionIds: ["smart-profile:best_value:v1"],
  windowStartsAt: "2026-08-13T00:00:00.000Z",
  windowEndsAt: "2026-08-14T00:00:00.000Z",
  platformFunded: true,
  customerSurchargeAllowed: false,
  assignmentHash: "SHA256_MOD_10000",
  publishedAt: "2026-08-13T00:00:00.000Z",
};

function keyForBucket(selected: boolean): string {
  for (let index = 0; index < 100_000; index += 1) {
    const key = `assignment-key-${selected ? "selected" : "control"}-${index}`;
    const bucket = Number(BigInt(`0x${evidenceHash(key).slice(0, 16)}`) % 10_000n);
    if ((bucket < policy.allocationBps) === selected) return key;
  }
  throw new Error("Unable to find deterministic fixture bucket.");
}

const selectedKey = keyForBucket(true);
const controlKey = keyForBucket(false);

function request(input: {
  requestId: string;
  assignmentKey?: string;
  userKey?: string;
  baseline?: string;
  exploration?: string;
  customerValue?: string;
  floorBps?: number;
  optIn?: boolean;
  readiness?: "READY" | "INSUFFICIENT_SAMPLES";
}) {
  return {
    requestId: input.requestId,
    userKey: input.userKey ?? "private-user-1",
    assignmentKey: input.assignmentKey ?? selectedKey,
    profileVersionId: "smart-profile:best_value:v1",
    smartOptInActive: input.optIn ?? true,
    evaluationReadiness: input.readiness ?? "READY" as const,
    baselineExpectedCostMicrousd: input.baseline ?? "200000",
    explorationMaximumCostMicrousd: input.exploration ?? "300000",
    customerEconomicValueMicrousd: input.customerValue ?? "500000",
    hardFloorMarginBps: input.floorBps ?? 3000,
  };
}

describe("platform-funded Smart exploration budget", () => {
  it("accepts only immutable policies bounded to 1–5 percent with zero customer surcharge", () => {
    expect(() => new InMemoryExplorationBudget({ ...policy, allocationBps: 99 }, () => baseTime))
      .toThrowError(expect.objectContaining({ code: "INVALID_EXPLORATION_POLICY" }));
    expect(() => new InMemoryExplorationBudget({ ...policy, allocationBps: 501 }, () => baseTime))
      .toThrowError(expect.objectContaining({ code: "INVALID_EXPLORATION_POLICY" }));
    expect(() => new InMemoryExplorationBudget({
      ...policy,
      customerSurchargeAllowed: true,
    } as unknown as ExplorationBudgetPolicyVersion, () => baseTime))
      .toThrowError(expect.objectContaining({ code: "INVALID_EXPLORATION_POLICY" }));
  });

  it("assigns cohorts deterministically and leaves control requests financially untouched", () => {
    const budget = new InMemoryExplorationBudget(policy, () => baseTime);
    const first = budget.plan(request({ requestId: "control-1", assignmentKey: controlKey }));
    const replay = budget.plan(request({ requestId: "control-1", assignmentKey: controlKey }));
    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      selection: "CONTROL",
      reason: "BUCKET_CONTROL",
      reservationId: null,
      reservedIncrementalCostMicrousd: "0",
      customerQuotedCreditsUnchanged: true,
      customerSurchargeMicrousd: "0",
      platformFunded: true,
      dispatchMutationPerformed: false,
    });
    expect(budget.snapshot()).toMatchObject({ availableBudgetMicrousd: "1000000", ledgerEntryCount: 0 });
  });

  it("requires active Smart opt-in, ready evaluation, eligible window and Profile", () => {
    const budget = new InMemoryExplorationBudget(policy, () => baseTime);
    expect(() => budget.plan(request({ requestId: "no-consent", optIn: false })))
      .toThrowError(expect.objectContaining({ code: "EXPLORATION_NOT_ELIGIBLE" }));
    expect(() => budget.plan(request({ requestId: "not-ready", readiness: "INSUFFICIENT_SAMPLES" })))
      .toThrowError(expect.objectContaining({ code: "EXPLORATION_NOT_ELIGIBLE" }));
  });

  it("reserves only platform incremental maximum exposure and rejects request-ID conflict or Margin breach", () => {
    const budget = new InMemoryExplorationBudget(policy, () => baseTime);
    const input = request({ requestId: "exploration-1" });
    const plan = budget.plan(input);
    expect(plan).toMatchObject({
      selection: "EXPLORATION",
      reason: "EXPLORATION_RESERVED",
      reservedIncrementalCostMicrousd: "100000",
      customerSurchargeMicrousd: "0",
      dispatchMutationPerformed: false,
    });
    expect(JSON.stringify(plan)).not.toContain("private-user-1");
    expect(budget.plan(input)).toEqual(plan);
    expect(() => budget.plan({ ...input, explorationMaximumCostMicrousd: "310000" }))
      .toThrowError(expect.objectContaining({ code: "EXPLORATION_REQUEST_CONFLICT" }));

    const unsafe = new InMemoryExplorationBudget(policy, () => baseTime);
    expect(() => unsafe.plan(request({ requestId: "margin-breach", customerValue: "350000" })))
      .toThrowError(expect.objectContaining({ code: "EXPLORATION_MARGIN_FLOOR_BREACH" }));
  });

  it("settles actual incremental cost, releases unused reserve and reconciles the hash-chained ledger", () => {
    const budget = new InMemoryExplorationBudget(policy, () => baseTime);
    const plan = budget.plan(request({ requestId: "settle-1" }));
    const settled = budget.settle(plan.reservationId!, "60000");
    expect(settled).toMatchObject({
      state: "SETTLED",
      reservedIncrementalCostMicrousd: "100000",
      settledIncrementalCostMicrousd: "60000",
      releasedIncrementalCostMicrousd: "40000",
    });
    expect(budget.settle(plan.reservationId!, "60000")).toEqual(settled);
    expect(() => budget.settle(plan.reservationId!, "60001"))
      .toThrowError(expect.objectContaining({ code: "EXPLORATION_SETTLEMENT_CONFLICT" }));
    expect(budget.entries().map(({ type, amountMicrousd }) => [type, amountMicrousd])).toEqual([
      ["RESERVE", "100000"],
      ["SETTLE", "60000"],
      ["RELEASE", "40000"],
    ]);
    expect(budget.snapshot()).toMatchObject({
      availableBudgetMicrousd: "940000",
      reservedBudgetMicrousd: "0",
      settledBudgetMicrousd: "60000",
      releasedBudgetMicrousd: "40000",
      ledgerChainValid: true,
      customerSurchargeMicrousd: "0",
      externalDispatchPerformed: false,
    });
  });

  it("releases the full reservation after no-charge failure without consuming platform budget", () => {
    const budget = new InMemoryExplorationBudget(policy, () => baseTime);
    const plan = budget.plan(request({ requestId: "release-1" }));
    const released = budget.release(plan.reservationId!);
    expect(released).toMatchObject({ state: "RELEASED", releasedIncrementalCostMicrousd: "100000" });
    expect(budget.release(plan.reservationId!)).toEqual(released);
    expect(budget.snapshot()).toMatchObject({
      availableBudgetMicrousd: "1000000",
      reservedBudgetMicrousd: "0",
      settledBudgetMicrousd: "0",
      releasedBudgetMicrousd: "100000",
      ledgerChainValid: true,
    });
  });

  it("enforces per-user selection caps and never overcommits the remaining platform budget", () => {
    const capped = new InMemoryExplorationBudget({ ...policy, maximumSelectionsPerUser: 1 }, () => baseTime);
    capped.plan(request({ requestId: "cap-first" }));
    expect(() => capped.plan(request({ requestId: "cap-second" })))
      .toThrowError(expect.objectContaining({ code: "EXPLORATION_NOT_ELIGIBLE" }));

    const scarce = new InMemoryExplorationBudget({
      ...policy,
      totalBudgetMicrousd: "150000",
      maximumIncrementalCostPerOperationMicrousd: "150000",
    }, () => baseTime);
    scarce.plan(request({ requestId: "budget-first", userKey: "user-a" }));
    expect(() => scarce.plan(request({ requestId: "budget-second", userKey: "user-b" })))
      .toThrowError(expect.objectContaining({ code: "EXPLORATION_BUDGET_INSUFFICIENT" }));
    expect(scarce.snapshot()).toMatchObject({ availableBudgetMicrousd: "50000", reservedBudgetMicrousd: "100000" });
  });

  it("activates an instant kill switch for new selections while preserving prior reservation settlement", () => {
    const budget = new InMemoryExplorationBudget(policy, () => baseTime);
    const active = budget.plan(request({ requestId: "before-kill" }));
    expect(budget.activateKillSwitch()).toMatchObject({ killSwitchActive: true, reservedBudgetMicrousd: "100000" });
    const blocked = budget.plan(request({ requestId: "after-kill", userKey: "private-user-2" }));
    expect(blocked).toMatchObject({
      selection: "CONTROL",
      reason: "KILL_SWITCH_ACTIVE",
      customerSurchargeMicrousd: "0",
    });
    expect(budget.settle(active.reservationId!, "50000")).toMatchObject({ state: "SETTLED" });
    expect(budget.snapshot()).toMatchObject({ killSwitchActive: true, settledBudgetMicrousd: "50000", ledgerChainValid: true });
  });
});
