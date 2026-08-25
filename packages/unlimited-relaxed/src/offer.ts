import { evidenceHash } from "./canonical.ts";
import type {
  UnlimitedRelaxedOfferPolicyVersion,
  UnlimitedRelaxedPilotAuthorization,
  UnlimitedRelaxedUsageDecision,
} from "./types.ts";
import { UnlimitedRelaxedError } from "./types.ts";

function validDimension(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function validatePolicy(policy: UnlimitedRelaxedOfferPolicyVersion): void {
  const planIds = new Set(policy.eligibleSubscriptionPlanVersionIds);
  const routeIds = new Set(policy.restrictedRoutes.map(({ routeVersionId }) => routeVersionId));
  const tupleIds = new Set(policy.restrictedRoutes.map(({ familyVersionId, modelVersionId, routeVersionId }) =>
    `${familyVersionId}:${modelVersionId}:${routeVersionId}`));
  const offeringValid = policy.offering.kind === "UNLIMITED_RELAXED_DRAFT"
    ? policy.offering.displayName === "Unlimited Relaxed Draft" && policy.offering.publishedMonthlyGenerationCap === null
    : policy.offering.displayName === "High Monthly Allowance"
      && Number.isInteger(policy.offering.publishedMonthlyGenerationCap)
      && policy.offering.publishedMonthlyGenerationCap > 0;
  if (!policy.id
    || !policy.offerKey.trim()
    || !Number.isInteger(policy.version)
    || policy.version <= 0
    || policy.lifecycle !== "PUBLISHED"
    || !offeringValid
    || policy.eligibleSubscriptionPlanVersionIds.length === 0
    || planIds.size !== policy.eligibleSubscriptionPlanVersionIds.length
    || policy.eligibleSubscriptionPlanVersionIds.some((id) => !id.trim())
    || policy.restrictedRoutes.length === 0
    || routeIds.size !== policy.restrictedRoutes.length
    || tupleIds.size !== policy.restrictedRoutes.length
    || policy.restrictedRoutes.some((route) => !route.routeVersionId
      || !route.familyVersionId
      || !route.modelVersionId
      || route.economicCertified !== true
      || !validDimension(route.maximumResolution.width)
      || !validDimension(route.maximumResolution.height)
      || !validDimension(route.maximumDurationSeconds))
    || policy.queue.mode !== "SHARED_RELAXED"
    || !validDimension(policy.queue.maximumConcurrency)
    || policy.queue.maximumConcurrency > 10
    || !validDimension(policy.queue.maximumPublishedWaitSeconds)
    || policy.queue.progressMode !== "STAGE_ONLY_NO_PERCENTAGE"
    || policy.includedOutput.purpose !== "DRAFT_ONLY"
    || !validDimension(policy.includedOutput.maximumResolution.width)
    || !validDimension(policy.includedOutput.maximumResolution.height)
    || !validDimension(policy.includedOutput.maximumDurationSeconds)
    || !policy.fairUse.versionId
    || !policy.fairUse.termsVersionId
    || !policy.fairUse.disclosureText.trim()
    || !policy.fairUse.enforcementDisclosure.trim()
    || policy.fairUse.userVisible !== true
    || policy.fairUse.hiddenCapAllowed !== false
    || policy.fairUse.apiAutomationAllowed !== false
    || policy.fairUse.batchAutomationAllowed !== false
    || policy.premiumOrFinalRequiresCredits !== true
    || policy.hiddenModelSubstitutionAllowed !== false
    || policy.productionActivationAllowed !== false
    || Number.isNaN(Date.parse(policy.publishedAt))) {
    throw new UnlimitedRelaxedError("INVALID_OFFER_POLICY", "Unlimited Relaxed requires a truthful published Fair-use contract, restricted certified Routes and no hidden cap or activation authority.");
  }
}

export class InMemoryUnlimitedRelaxedOfferRegistry {
  private readonly byId = new Map<string, UnlimitedRelaxedOfferPolicyVersion>();
  private readonly bySequence = new Map<string, string>();

  publish(policy: UnlimitedRelaxedOfferPolicyVersion): UnlimitedRelaxedOfferPolicyVersion {
    validatePolicy(policy);
    const existing = this.byId.get(policy.id);
    if (existing) {
      if (evidenceHash(existing) === evidenceHash(policy)) return structuredClone(existing);
      throw new UnlimitedRelaxedError("IMMUTABLE_OFFER_POLICY", "A published Unlimited Relaxed Offer Version cannot be changed.");
    }
    const sequence = `${policy.offerKey}:${policy.version}`;
    if (this.bySequence.has(sequence)) {
      throw new UnlimitedRelaxedError("DUPLICATE_OFFER_POLICY_SEQUENCE", "Offer key and Version must be unique.");
    }
    const stored = structuredClone(policy);
    this.byId.set(policy.id, stored);
    this.bySequence.set(sequence, policy.id);
    return structuredClone(stored);
  }

  require(policyVersionId: string): UnlimitedRelaxedOfferPolicyVersion {
    const policy = this.byId.get(policyVersionId);
    if (!policy) throw new UnlimitedRelaxedError("OFFER_POLICY_NOT_FOUND", "Unlimited Relaxed Offer Version was not found.");
    return structuredClone(policy);
  }
}

export class InMemoryUnlimitedRelaxedAuthorizer {
  private readonly authorizations = new Map<string, { intentHash: string; authorization: UnlimitedRelaxedPilotAuthorization }>();

  constructor(
    private readonly policy: UnlimitedRelaxedOfferPolicyVersion,
    private readonly now: () => Date = () => new Date(),
  ) {
    validatePolicy(policy);
  }

  authorize(input: {
    authorizationId: string;
    userKey: string;
    subscriptionPlanVersionId: string;
    subscriptionActive: boolean;
    pilotCohortId: string;
    pilotCohortMembershipId: string;
    explicitPilotOptInId: string;
    acceptedFairUseVersionId: string;
    acceptedTermsVersionId: string;
    expiresAt: string;
  }): UnlimitedRelaxedPilotAuthorization {
    const intentHash = evidenceHash(input);
    const prior = this.authorizations.get(input.authorizationId);
    if (prior) {
      if (prior.intentHash === intentHash) return structuredClone(prior.authorization);
      throw new UnlimitedRelaxedError("PILOT_AUTHORIZATION_CONFLICT", "Pilot Authorization ID was reused with different intent.");
    }
    const authorizedAt = this.now();
    const expiresAt = Date.parse(input.expiresAt);
    if (!input.authorizationId
      || !input.userKey
      || !input.pilotCohortId
      || !input.pilotCohortMembershipId
      || !input.explicitPilotOptInId
      || !input.subscriptionActive
      || !this.policy.eligibleSubscriptionPlanVersionIds.includes(input.subscriptionPlanVersionId)
      || input.acceptedFairUseVersionId !== this.policy.fairUse.versionId
      || input.acceptedTermsVersionId !== this.policy.fairUse.termsVersionId
      || Number.isNaN(authorizedAt.getTime())
      || Number.isNaN(expiresAt)
      || expiresAt <= authorizedAt.getTime()) {
      throw new UnlimitedRelaxedError("PILOT_NOT_ELIGIBLE", "Pilot authorization requires active eligible subscription, explicit cohort opt-in and current published Fair-use/Terms acceptance.");
    }
    const authorization: UnlimitedRelaxedPilotAuthorization = {
      authorizationId: input.authorizationId,
      userKeyHash: evidenceHash(input.userKey),
      policyVersionId: this.policy.id,
      subscriptionPlanVersionId: input.subscriptionPlanVersionId,
      fairUseVersionId: this.policy.fairUse.versionId,
      termsVersionId: this.policy.fairUse.termsVersionId,
      pilotCohortId: input.pilotCohortId,
      pilotCohortMembershipId: input.pilotCohortMembershipId,
      explicitPilotOptInId: input.explicitPilotOptInId,
      authorizedAt: authorizedAt.toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      hiddenCapAccepted: false,
      externalDispatchPerformed: false,
    };
    this.authorizations.set(input.authorizationId, { intentHash, authorization });
    return structuredClone(authorization);
  }
}

export class UnlimitedRelaxedUsagePolicy {
  constructor(
    private readonly policy: UnlimitedRelaxedOfferPolicyVersion,
    private readonly now: () => Date = () => new Date(),
  ) {
    validatePolicy(policy);
  }

  decide(input: {
    requestId: string;
    authorization: UnlimitedRelaxedPilotAuthorization;
    requestKind: "RELAXED_DRAFT" | "PREMIUM_FINAL" | "API_AUTOMATION" | "BATCH_AUTOMATION";
    routeVersionId?: string;
    requestedResolution?: Readonly<{ width: number; height: number }>;
    requestedDurationSeconds?: number;
  }): UnlimitedRelaxedUsageDecision {
    if (!input.requestId
      || input.authorization.policyVersionId !== this.policy.id
      || Number.isNaN(this.now().getTime())) {
      throw new UnlimitedRelaxedError("INVALID_USAGE_REQUEST", "Usage decision requires a valid server-owned request and pinned Pilot Authorization.");
    }
    if (Date.parse(input.authorization.expiresAt) <= this.now().getTime()) return this.decision(input, "NOT_ELIGIBLE", "AUTHORIZATION_EXPIRED", null);
    if (input.requestKind === "PREMIUM_FINAL") {
      return this.decision(input, "REQUIRES_CREDITS", "PREMIUM_OR_FINAL_REQUIRES_CREDITS", null);
    }
    if (input.requestKind === "API_AUTOMATION") return this.decision(input, "NOT_ELIGIBLE", "API_AUTOMATION_PROHIBITED", null);
    if (input.requestKind === "BATCH_AUTOMATION") return this.decision(input, "NOT_ELIGIBLE", "BATCH_AUTOMATION_PROHIBITED", null);
    const route = this.policy.restrictedRoutes.find(({ routeVersionId }) => routeVersionId === input.routeVersionId) ?? null;
    if (!route) return this.decision(input, "NOT_ELIGIBLE", "ROUTE_NOT_INCLUDED", null);
    const resolution = input.requestedResolution;
    const duration = input.requestedDurationSeconds;
    if (!resolution
      || !validDimension(resolution.width)
      || !validDimension(resolution.height)
      || !validDimension(duration ?? 0)
      || resolution.width > this.policy.includedOutput.maximumResolution.width
      || resolution.height > this.policy.includedOutput.maximumResolution.height
      || resolution.width > route.maximumResolution.width
      || resolution.height > route.maximumResolution.height
      || duration! > this.policy.includedOutput.maximumDurationSeconds
      || duration! > route.maximumDurationSeconds) {
      return this.decision(input, "NOT_ELIGIBLE", "OUTPUT_LIMIT_EXCEEDED", route);
    }
    return this.decision(input, "INCLUDED_RELAXED", "RELAXED_DRAFT_INCLUDED", route);
  }

  private decision(
    input: { requestId: string; authorization: UnlimitedRelaxedPilotAuthorization },
    decision: UnlimitedRelaxedUsageDecision["decision"],
    reason: UnlimitedRelaxedUsageDecision["reason"],
    route: UnlimitedRelaxedOfferPolicyVersion["restrictedRoutes"][number] | null,
  ): UnlimitedRelaxedUsageDecision {
    return {
      requestId: input.requestId,
      policyVersionId: this.policy.id,
      authorizationId: input.authorization.authorizationId,
      decision,
      reason,
      actualRouteVersionId: route?.routeVersionId ?? null,
      actualFamilyVersionId: route?.familyVersionId ?? null,
      actualModelVersionId: route?.modelVersionId ?? null,
      modelDisclosureRequired: true,
      queueMode: "SHARED_RELAXED",
      maximumConcurrency: this.policy.queue.maximumConcurrency,
      maximumPublishedWaitSeconds: this.policy.queue.maximumPublishedWaitSeconds,
      progressMode: "STAGE_ONLY_NO_PERCENTAGE",
      hiddenCapApplied: false,
      customerCreditsReserved: false,
      dispatchMutationPerformed: false,
    };
  }
}
