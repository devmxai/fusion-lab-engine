// @vitest-environment node

import { describe, expect, it } from "vitest";
import { InMemoryUnlimitedCohortBudget } from "./budget.ts";
import {
  InMemoryUnlimitedRelaxedAuthorizer,
  UnlimitedRelaxedUsagePolicy,
} from "./offer.ts";
import type {
  UnlimitedCohortBudgetPolicyVersion,
  UnlimitedRelaxedOfferPolicyVersion,
} from "./types.ts";

const now = new Date("2026-08-13T12:00:00.000Z");
const offerPolicy: UnlimitedRelaxedOfferPolicyVersion = {
  id: "unlimited-relaxed-offer:v1",
  offerKey: "unlimited-relaxed-draft",
  version: 1,
  lifecycle: "PUBLISHED",
  offering: {
    kind: "UNLIMITED_RELAXED_DRAFT",
    displayName: "Unlimited Relaxed Draft",
    publishedMonthlyGenerationCap: null,
  },
  eligibleSubscriptionPlanVersionIds: ["plan:creator:v3"],
  restrictedRoutes: [{
    routeVersionId: "route:test-economy:v2",
    familyVersionId: "family:test-image:v1",
    modelVersionId: "model:test-draft:v4",
    economicCertified: true,
    maximumResolution: { width: 1024, height: 1024 },
    maximumDurationSeconds: 10,
  }],
  queue: {
    mode: "SHARED_RELAXED",
    maximumConcurrency: 2,
    maximumPublishedWaitSeconds: 1800,
    progressMode: "STAGE_ONLY_NO_PERCENTAGE",
  },
  includedOutput: {
    purpose: "DRAFT_ONLY",
    maximumResolution: { width: 1024, height: 1024 },
    maximumDurationSeconds: 10,
  },
  fairUse: {
    versionId: "fair-use:v1",
    termsVersionId: "terms:v1",
    disclosureText: "Relaxed Draft uses a shared queue and restricted Routes.",
    userVisible: true,
    enforcementDisclosure: "API and batch automation are excluded.",
    hiddenCapAllowed: false,
    apiAutomationAllowed: false,
    batchAutomationAllowed: false,
  },
  premiumOrFinalRequiresCredits: true,
  hiddenModelSubstitutionAllowed: false,
  productionActivationAllowed: false,
  publishedAt: "2026-08-13T00:00:00.000Z",
};

const budgetPolicy: UnlimitedCohortBudgetPolicyVersion = {
  id: "unlimited-cohort-budget:v1",
  cohortId: "cohort:relaxed-pilot:1",
  version: 1,
  lifecycle: "PUBLISHED",
  offerPolicyVersionId: offerPolicy.id,
  netCohortSubscriptionEconomicValueMicrousd: "10000000",
  approvedCogsRatioBps: 4000,
  maximumCogsPerOperationMicrousd: "500000",
  periodStartsAt: "2026-08-13T00:00:00.000Z",
  periodEndsAt: "2026-09-13T00:00:00.000Z",
  calculation: "NET_COHORT_VALUE_TIMES_APPROVED_COGS_RATIO_FLOOR",
  budgetAuthority: "LOCAL_SIMULATION_ONLY",
  pilotActivationAllowed: false,
  publishedAt: "2026-08-13T00:00:00.000Z",
};

function authorization() {
  return new InMemoryUnlimitedRelaxedAuthorizer(offerPolicy, () => now).authorize({
    authorizationId: "pilot-auth:1",
    userKey: "private-user-key",
    subscriptionPlanVersionId: "plan:creator:v3",
    subscriptionActive: true,
    pilotCohortId: budgetPolicy.cohortId,
    pilotCohortMembershipId: "membership:1",
    explicitPilotOptInId: "pilot-opt-in:1",
    acceptedFairUseVersionId: offerPolicy.fairUse.versionId,
    acceptedTermsVersionId: offerPolicy.fairUse.termsVersionId,
    expiresAt: "2026-08-14T00:00:00.000Z",
  });
}

function includedDecision(auth = authorization(), requestId = "usage:1") {
  return new UnlimitedRelaxedUsagePolicy(offerPolicy, () => now).decide({
    requestId,
    authorization: auth,
    requestKind: "RELAXED_DRAFT",
    routeVersionId: "route:test-economy:v2",
    requestedResolution: { width: 1024, height: 1024 },
    requestedDurationSeconds: 10,
  });
}

function reserveInput(operationId: string, maximumCogsMicrousd = "500000") {
  const auth = authorization();
  return {
    operationId,
    authorization: auth,
    usageDecision: includedDecision(auth, `usage:${operationId}`),
    maximumCogsMicrousd,
  };
}

describe("Unlimited Relaxed Cohort COGS Budget", () => {
  it("derives allowed COGS exactly from net cohort value times the approved ratio", () => {
    const budget = new InMemoryUnlimitedCohortBudget(budgetPolicy, () => now);
    expect(budget.snapshot()).toMatchObject({
      netCohortSubscriptionEconomicValueMicrousd: "10000000",
      approvedCogsRatioBps: 4000,
      allowedCohortCogsMicrousd: "4000000",
      availableCohortCogsMicrousd: "4000000",
      customerCreditsCharged: "0",
      externalDispatchPerformed: false,
      pilotActivationAllowed: false,
    });
    expect(() => new InMemoryUnlimitedCohortBudget({ ...budgetPolicy, approvedCogsRatioBps: 10000 }, () => now))
      .toThrowError(expect.objectContaining({ code: "INVALID_COHORT_BUDGET_POLICY" }));
  });

  it("reserves maximum COGS only for a matching included Relaxed decision before Dispatch", () => {
    const budget = new InMemoryUnlimitedCohortBudget(budgetPolicy, () => now);
    const reservation = budget.reserve(reserveInput("operation:included"));
    expect(reservation).toMatchObject({
      cohortId: budgetPolicy.cohortId,
      routeVersionId: "route:test-economy:v2",
      modelVersionId: "model:test-draft:v4",
      reservedMaximumCogsMicrousd: "500000",
      state: "RESERVED",
      customerCreditsCharged: false,
      externalDispatchPerformed: false,
    });
    expect(JSON.stringify(reservation)).not.toContain("private-user-key");
  });

  it("rejects Premium/Credit decisions, mismatched cohorts and any prior Dispatch mutation", () => {
    const budget = new InMemoryUnlimitedCohortBudget(budgetPolicy, () => now);
    const auth = authorization();
    const premium = new UnlimitedRelaxedUsagePolicy(offerPolicy, () => now).decide({
      requestId: "usage:premium",
      authorization: auth,
      requestKind: "PREMIUM_FINAL",
    });
    expect(() => budget.reserve({
      operationId: "operation:premium",
      authorization: auth,
      usageDecision: premium,
      maximumCogsMicrousd: "100000",
    })).toThrowError(expect.objectContaining({ code: "COHORT_BUDGET_NOT_ELIGIBLE" }));
    expect(() => budget.reserve({
      ...reserveInput("operation:wrong-cohort"),
      authorization: { ...auth, pilotCohortId: "cohort:other" },
    })).toThrowError(expect.objectContaining({ code: "COHORT_BUDGET_NOT_ELIGIBLE" }));
  });

  it("makes operation reservation idempotent and rejects conflicting reuse", () => {
    const budget = new InMemoryUnlimitedCohortBudget(budgetPolicy, () => now);
    const input = reserveInput("operation:idempotent", "300000");
    const first = budget.reserve(input);
    expect(budget.reserve(input)).toEqual(first);
    expect(() => budget.reserve({ ...input, maximumCogsMicrousd: "300001" }))
      .toThrowError(expect.objectContaining({ code: "COHORT_BUDGET_REQUEST_CONFLICT" }));
    expect(budget.snapshot()).toMatchObject({ reservationCount: 1, reservedCohortCogsMicrousd: "300000" });
  });

  it("settles verified actual COGS, releases the exact remainder and reconciles the hash ledger", () => {
    const budget = new InMemoryUnlimitedCohortBudget(budgetPolicy, () => now);
    const reservation = budget.reserve(reserveInput("operation:settle"));
    const settled = budget.settle(reservation.reservationId, "320000");
    expect(settled).toMatchObject({
      state: "SETTLED",
      reservedMaximumCogsMicrousd: "500000",
      settledActualCogsMicrousd: "320000",
      releasedCogsMicrousd: "180000",
    });
    expect(budget.settle(reservation.reservationId, "320000")).toEqual(settled);
    expect(() => budget.settle(reservation.reservationId, "320001"))
      .toThrowError(expect.objectContaining({ code: "COHORT_SETTLEMENT_CONFLICT" }));
    expect(budget.entries().map(({ type, amountMicrousd, reason }) => [type, amountMicrousd, reason])).toEqual([
      ["RESERVE", "500000", "MAXIMUM_COGS_RESERVED"],
      ["SETTLE", "320000", "ACTUAL_COGS_VERIFIED"],
      ["RELEASE", "180000", "UNUSED_RESERVE"],
    ]);
    expect(budget.snapshot()).toMatchObject({
      availableCohortCogsMicrousd: "3680000",
      reservedCohortCogsMicrousd: "0",
      settledCohortCogsMicrousd: "320000",
      releasedCohortCogsMicrousd: "180000",
      ledgerChainValid: true,
      projectionReconciled: true,
    });
  });

  it("releases the complete maximum reservation after verified no-charge failure", () => {
    const budget = new InMemoryUnlimitedCohortBudget(budgetPolicy, () => now);
    const reservation = budget.reserve(reserveInput("operation:failure"));
    const released = budget.release(reservation.reservationId);
    expect(released).toMatchObject({ state: "RELEASED", releasedCogsMicrousd: "500000" });
    expect(budget.release(reservation.reservationId)).toEqual(released);
    expect(budget.snapshot()).toMatchObject({
      availableCohortCogsMicrousd: "4000000",
      settledCohortCogsMicrousd: "0",
      releasedCohortCogsMicrousd: "500000",
      projectionReconciled: true,
    });
  });

  it("rejects actual COGS above the reserved maximum", () => {
    const budget = new InMemoryUnlimitedCohortBudget(budgetPolicy, () => now);
    const reservation = budget.reserve(reserveInput("operation:oversettle", "300000"));
    expect(() => budget.settle(reservation.reservationId, "300001"))
      .toThrowError(expect.objectContaining({ code: "COHORT_SETTLEMENT_CONFLICT" }));
    expect(budget.snapshot()).toMatchObject({ reservedCohortCogsMicrousd: "300000", projectionReconciled: true });
  });

  it("enforces per-operation and aggregate maximum exposure without overcommit", () => {
    const budget = new InMemoryUnlimitedCohortBudget({
      ...budgetPolicy,
      netCohortSubscriptionEconomicValueMicrousd: "1000000",
      maximumCogsPerOperationMicrousd: "300000",
    }, () => now);
    expect(() => budget.reserve(reserveInput("operation:too-large", "300001")))
      .toThrowError(expect.objectContaining({ code: "COHORT_BUDGET_INSUFFICIENT" }));
    budget.reserve(reserveInput("operation:first", "300000"));
    expect(() => budget.reserve(reserveInput("operation:second", "100001")))
      .toThrowError(expect.objectContaining({ code: "COHORT_BUDGET_INSUFFICIENT" }));
    expect(budget.snapshot()).toMatchObject({
      allowedCohortCogsMicrousd: "400000",
      availableCohortCogsMicrousd: "100000",
      reservedCohortCogsMicrousd: "300000",
      projectionReconciled: true,
    });
  });
});
