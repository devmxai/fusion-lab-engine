import type {
  SmartResultDisclosure,
  SmartSelectionAuthorization,
} from "./types.ts";
import { SmartBetaError } from "./types.ts";
import type { InMemorySmartConsentStore } from "./consent.ts";
import type { InMemorySmartProfileRegistry } from "./profiles.ts";

export class SmartSelectionAuthorizer {
  constructor(
    private readonly profiles: InMemorySmartProfileRegistry,
    private readonly consents: InMemorySmartConsentStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  authorize(input: {
    authorizationId: string;
    mode: "EXACT" | "SMART";
    userId: string;
    profileVersionId: string;
    consentId: string | null;
    eligibleProfileKeys: readonly string[];
  }): SmartSelectionAuthorization {
    if (input.mode !== "SMART") {
      throw new SmartBetaError("HIDDEN_SUBSTITUTION_DENIED", "Exact Mode cannot silently authorize Smart selection.");
    }
    if (!input.authorizationId || !input.userId || !input.consentId) {
      throw new SmartBetaError("SMART_OPT_IN_REQUIRED", "Smart authorization requires an ID, user and explicit consent.");
    }
    const profile = this.profiles.require(input.profileVersionId);
    if (!input.eligibleProfileKeys.includes(profile.profileKey)) {
      throw new SmartBetaError("SMART_PROFILE_NOT_ELIGIBLE", "The user's pinned Plan does not include this Smart Profile.");
    }
    const consent = this.consents.requireActive({
      consentId: input.consentId,
      userId: input.userId,
      profileVersionId: profile.id,
      disclosureVersionId: profile.disclosureVersionId,
    });
    const authorizedAt = this.now();
    if (Number.isNaN(authorizedAt.getTime())) {
      throw new SmartBetaError("INVALID_SMART_CONSENT", "Smart authorization time must be valid.");
    }
    return Object.freeze({
      authorizationId: input.authorizationId,
      userId: input.userId,
      profileVersionId: profile.id,
      profileKey: profile.profileKey,
      consentId: consent.consentId,
      disclosureVersionId: profile.disclosureVersionId,
      automaticSelection: true,
      preSelectionDisclosure: profile.automaticSelectionDisclosure,
      candidateVersions: Object.freeze(profile.candidates.map((candidate) => Object.freeze({ ...candidate }))),
      selectionAuthorityGranted: true,
      hiddenSubstitutionAllowed: false,
      externalDispatchPerformed: false,
      authorizedAt: authorizedAt.toISOString(),
    });
  }

  discloseResult(input: {
    authorization: SmartSelectionAuthorization;
    actualFamilyVersionId: string;
    actualModelVersionId: string;
    actualRouteVersionId: string;
    marketingLabel?: string | null;
  }): SmartResultDisclosure {
    const profile = this.profiles.require(input.authorization.profileVersionId);
    const candidate = input.authorization.candidateVersions.find(({ routeVersionId }) =>
      routeVersionId === input.actualRouteVersionId);
    if (!candidate
      || candidate.familyVersionId !== input.actualFamilyVersionId
      || candidate.modelVersionId !== input.actualModelVersionId
      || !input.actualFamilyVersionId
      || !input.actualModelVersionId
      || !input.actualRouteVersionId) {
      throw new SmartBetaError("INVALID_RESULT_DISCLOSURE", "Result must disclose the exact certified Family, Model and Route that produced it.");
    }
    if (input.marketingLabel?.trim().toUpperCase() === "PREMIUM") {
      throw new SmartBetaError("INVALID_RESULT_DISCLOSURE", "Smart economic output cannot be relabeled as Premium.");
    }
    return {
      authorizationId: input.authorization.authorizationId,
      profileVersionId: profile.id,
      profileDisplayName: profile.displayName,
      automaticSelectionWasUsed: true,
      actualFamilyVersionId: candidate.familyVersionId,
      actualModelVersionId: candidate.modelVersionId,
      actualRouteVersionId: candidate.routeVersionId,
      disclosureText: profile.resultModelDisclosure,
      economicOutputCalledPremium: false,
      dispatchMutationPerformed: false,
    };
  }
}
