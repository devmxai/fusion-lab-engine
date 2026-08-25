// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  InMemoryUnlimitedRelaxedAuthorizer,
  InMemoryUnlimitedRelaxedOfferRegistry,
  UnlimitedRelaxedUsagePolicy,
} from "./offer.ts";
import type { UnlimitedRelaxedOfferPolicyVersion } from "./types.ts";

const now = new Date("2026-08-13T12:00:00.000Z");
const policy: UnlimitedRelaxedOfferPolicyVersion = {
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
    versionId: "fair-use:unlimited-relaxed:v1",
    termsVersionId: "terms:unlimited-relaxed:v1",
    disclosureText: "Relaxed Draft uses the disclosed shared queue, concurrency and restricted economic routes.",
    userVisible: true,
    enforcementDisclosure: "API and batch automation are excluded; Premium and Final outputs require Credits.",
    hiddenCapAllowed: false,
    apiAutomationAllowed: false,
    batchAutomationAllowed: false,
  },
  premiumOrFinalRequiresCredits: true,
  hiddenModelSubstitutionAllowed: false,
  productionActivationAllowed: false,
  publishedAt: "2026-08-13T00:00:00.000Z",
};

function authorize(selectedPolicy = policy) {
  const authorizer = new InMemoryUnlimitedRelaxedAuthorizer(selectedPolicy, () => now);
  return authorizer.authorize({
    authorizationId: "pilot-auth:1",
    userKey: "private-user-key",
    subscriptionPlanVersionId: "plan:creator:v3",
    subscriptionActive: true,
    pilotCohortId: "cohort:relaxed-pilot:1",
    pilotCohortMembershipId: "pilot-cohort-member:1",
    explicitPilotOptInId: "pilot-opt-in:1",
    acceptedFairUseVersionId: selectedPolicy.fairUse.versionId,
    acceptedTermsVersionId: selectedPolicy.fairUse.termsVersionId,
    expiresAt: "2026-08-14T00:00:00.000Z",
  });
}

describe("Unlimited Relaxed published customer contract", () => {
  it("publishes an immutable Version with restricted Routes and no Production activation", () => {
    const registry = new InMemoryUnlimitedRelaxedOfferRegistry();
    const published = registry.publish(policy);
    expect(registry.publish(policy)).toEqual(published);
    expect(published).toMatchObject({
      offering: { kind: "UNLIMITED_RELAXED_DRAFT", publishedMonthlyGenerationCap: null },
      premiumOrFinalRequiresCredits: true,
      hiddenModelSubstitutionAllowed: false,
      productionActivationAllowed: false,
    });
    expect(() => registry.publish({ ...policy, queue: { ...policy.queue, maximumConcurrency: 3 } }))
      .toThrowError(expect.objectContaining({ code: "IMMUTABLE_OFFER_POLICY" }));
  });

  it("rejects a dishonest Unlimited label with a hidden cap or missing Fair-use disclosure", () => {
    expect(() => new InMemoryUnlimitedRelaxedAuthorizer({
      ...policy,
      fairUse: { ...policy.fairUse, hiddenCapAllowed: true },
    } as unknown as UnlimitedRelaxedOfferPolicyVersion, () => now))
      .toThrowError(expect.objectContaining({ code: "INVALID_OFFER_POLICY" }));
    expect(() => new InMemoryUnlimitedRelaxedAuthorizer({
      ...policy,
      fairUse: { ...policy.fairUse, disclosureText: "" },
    }, () => now)).toThrowError(expect.objectContaining({ code: "INVALID_OFFER_POLICY" }));
  });

  it("supports the honest High Monthly Allowance fallback only with a visible positive cap", () => {
    const fallback: UnlimitedRelaxedOfferPolicyVersion = {
      ...policy,
      id: "high-allowance:v1",
      offerKey: "high-allowance",
      offering: {
        kind: "HIGH_MONTHLY_ALLOWANCE",
        displayName: "High Monthly Allowance",
        publishedMonthlyGenerationCap: 1000,
      },
    };
    expect(new InMemoryUnlimitedRelaxedOfferRegistry().publish(fallback).offering)
      .toMatchObject({ kind: "HIGH_MONTHLY_ALLOWANCE", publishedMonthlyGenerationCap: 1000 });
    expect(() => new InMemoryUnlimitedRelaxedOfferRegistry().publish({
      ...fallback,
      offering: {
        kind: "HIGH_MONTHLY_ALLOWANCE",
        displayName: "High Monthly Allowance",
        publishedMonthlyGenerationCap: 0,
      },
    })).toThrowError(expect.objectContaining({ code: "INVALID_OFFER_POLICY" }));
  });

  it("requires active eligible subscription, explicit cohort opt-in and current Terms/Fair-use acceptance", () => {
    const authorizer = new InMemoryUnlimitedRelaxedAuthorizer(policy, () => now);
    const base = {
      authorizationId: "pilot-auth:denied",
      userKey: "private-user-key",
      subscriptionPlanVersionId: "plan:creator:v3",
      subscriptionActive: true,
      pilotCohortId: "cohort:relaxed-pilot:1",
      pilotCohortMembershipId: "pilot-cohort-member:1",
      explicitPilotOptInId: "pilot-opt-in:1",
      acceptedFairUseVersionId: policy.fairUse.versionId,
      acceptedTermsVersionId: policy.fairUse.termsVersionId,
      expiresAt: "2026-08-14T00:00:00.000Z",
    };
    expect(() => authorizer.authorize({ ...base, subscriptionActive: false }))
      .toThrowError(expect.objectContaining({ code: "PILOT_NOT_ELIGIBLE" }));
    expect(() => authorizer.authorize({ ...base, authorizationId: "stale", acceptedFairUseVersionId: "fair-use:old" }))
      .toThrowError(expect.objectContaining({ code: "PILOT_NOT_ELIGIBLE" }));
  });

  it("hashes private identity and makes authorization retries idempotent", () => {
    const authorizer = new InMemoryUnlimitedRelaxedAuthorizer(policy, () => now);
    const input = {
      authorizationId: "pilot-auth:idempotent",
      userKey: "private-user-key",
      subscriptionPlanVersionId: "plan:creator:v3",
      subscriptionActive: true,
      pilotCohortId: "cohort:relaxed-pilot:1",
      pilotCohortMembershipId: "pilot-cohort-member:1",
      explicitPilotOptInId: "pilot-opt-in:1",
      acceptedFairUseVersionId: policy.fairUse.versionId,
      acceptedTermsVersionId: policy.fairUse.termsVersionId,
      expiresAt: "2026-08-14T00:00:00.000Z",
    };
    const first = authorizer.authorize(input);
    expect(authorizer.authorize(input)).toEqual(first);
    expect(first).toMatchObject({ hiddenCapAccepted: false, externalDispatchPerformed: false });
    expect(JSON.stringify(first)).not.toContain("private-user-key");
    expect(() => authorizer.authorize({ ...input, expiresAt: "2026-08-15T00:00:00.000Z" }))
      .toThrowError(expect.objectContaining({ code: "PILOT_AUTHORIZATION_CONFLICT" }));
  });

  it("includes only bounded Relaxed Draft output on an explicitly restricted Route", () => {
    const usage = new UnlimitedRelaxedUsagePolicy(policy, () => now);
    const decision = usage.decide({
      requestId: "usage:included",
      authorization: authorize(),
      requestKind: "RELAXED_DRAFT",
      routeVersionId: "route:test-economy:v2",
      requestedResolution: { width: 1024, height: 1024 },
      requestedDurationSeconds: 10,
    });
    expect(decision).toMatchObject({
      decision: "INCLUDED_RELAXED",
      reason: "RELAXED_DRAFT_INCLUDED",
      actualRouteVersionId: "route:test-economy:v2",
      actualModelVersionId: "model:test-draft:v4",
      modelDisclosureRequired: true,
      queueMode: "SHARED_RELAXED",
      maximumConcurrency: 2,
      maximumPublishedWaitSeconds: 1800,
      progressMode: "STAGE_ONLY_NO_PERCENTAGE",
      hiddenCapApplied: false,
      customerCreditsReserved: false,
      dispatchMutationPerformed: false,
    });
  });

  it("denies undisclosed Routes and outputs beyond published resolution or duration", () => {
    const usage = new UnlimitedRelaxedUsagePolicy(policy, () => now);
    const authorization = authorize();
    expect(usage.decide({
      requestId: "usage:route",
      authorization,
      requestKind: "RELAXED_DRAFT",
      routeVersionId: "route:premium:v9",
      requestedResolution: { width: 512, height: 512 },
      requestedDurationSeconds: 5,
    })).toMatchObject({ decision: "NOT_ELIGIBLE", reason: "ROUTE_NOT_INCLUDED" });
    expect(usage.decide({
      requestId: "usage:limit",
      authorization,
      requestKind: "RELAXED_DRAFT",
      routeVersionId: "route:test-economy:v2",
      requestedResolution: { width: 2048, height: 2048 },
      requestedDurationSeconds: 11,
    })).toMatchObject({ decision: "NOT_ELIGIBLE", reason: "OUTPUT_LIMIT_EXCEEDED" });
  });

  it("requires Credits for Premium/Final and prohibits API or batch automation", () => {
    const usage = new UnlimitedRelaxedUsagePolicy(policy, () => now);
    const authorization = authorize();
    expect(usage.decide({ requestId: "usage:premium", authorization, requestKind: "PREMIUM_FINAL" }))
      .toMatchObject({ decision: "REQUIRES_CREDITS", reason: "PREMIUM_OR_FINAL_REQUIRES_CREDITS" });
    expect(usage.decide({ requestId: "usage:api", authorization, requestKind: "API_AUTOMATION" }))
      .toMatchObject({ decision: "NOT_ELIGIBLE", reason: "API_AUTOMATION_PROHIBITED" });
    expect(usage.decide({ requestId: "usage:batch", authorization, requestKind: "BATCH_AUTOMATION" }))
      .toMatchObject({ decision: "NOT_ELIGIBLE", reason: "BATCH_AUTOMATION_PROHIBITED" });
  });
});
