// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SmartSelectionAuthorizer } from "./authorization.ts";
import { InMemorySmartConsentStore } from "./consent.ts";
import { InMemorySmartProfileRegistry } from "./profiles.ts";
import type {
  SmartOptInConsent,
  SmartProfileKey,
  SmartProfileVersion,
} from "./types.ts";

const baseTime = new Date("2026-08-13T12:00:00.000Z");
const profileNames: Readonly<Record<SmartProfileKey, string>> = {
  BEST_VALUE: "Best Value",
  CINEMATIC: "Cinematic",
  FAST_DRAFT: "Fast Draft",
  HIGH_CONSISTENCY: "High Consistency",
};

function profile(profileKey: SmartProfileKey = "BEST_VALUE"): SmartProfileVersion {
  return {
    id: `smart-profile:${profileKey.toLowerCase()}:v1`,
    profileKey,
    version: 1,
    lifecycle: "PUBLISHED",
    displayName: profileNames[profileKey],
    disclosureVersionId: "smart-disclosure:v1",
    automaticSelectionDisclosure: "FusionLab will automatically select one certified model from this disclosed Smart Profile.",
    resultModelDisclosure: "This result shows the actual Family, Model and Route selected automatically.",
    candidates: [
      {
        familyVersionId: "family:test-image:v1",
        modelVersionId: "local/test-image-v1",
        routeVersionId: "route:provider-test-image:v1",
        exactCertified: true,
        smartProfileCertified: true,
      },
      {
        familyVersionId: "family:test-image-alt:v1",
        modelVersionId: "local/test-image-alt-v1",
        routeVersionId: "route:provider-test-image-alt:v1",
        exactCertified: true,
        smartProfileCertified: true,
      },
    ],
    economicOutputMayBeCalledPremium: false,
    publishedAt: "2026-08-13T00:00:00.000Z",
  };
}

function consent(profileVersion = profile()): SmartOptInConsent {
  return {
    consentId: "smart-consent-001",
    userId: "user-001",
    profileVersionId: profileVersion.id,
    disclosureVersionId: profileVersion.disclosureVersionId,
    action: "SMART_OPT_IN",
    acceptedAt: baseTime.toISOString(),
  };
}

function setup() {
  const profiles = new InMemorySmartProfileRegistry();
  const registered = profiles.register(profile());
  const consents = new InMemorySmartConsentStore();
  consents.optIn(consent(registered));
  const authorizer = new SmartSelectionAuthorizer(profiles, consents, () => baseTime);
  return { profiles, registered, consents, authorizer };
}

describe("Smart Beta opt-in profiles and disclosure", () => {
  it("publishes only immutable disclosed certified versions of the four named Profiles", () => {
    const registry = new InMemorySmartProfileRegistry();
    const registered = (Object.keys(profileNames) as SmartProfileKey[]).map((key) => registry.register(profile(key)));
    expect(registered.map(({ displayName }) => displayName)).toEqual([
      "Best Value",
      "Cinematic",
      "Fast Draft",
      "High Consistency",
    ]);
    expect(Object.isFrozen(registered[0])).toBe(true);
    expect(Object.isFrozen(registered[0]?.candidates)).toBe(true);
    expect(() => registry.register(profile("BEST_VALUE")))
      .toThrowError(expect.objectContaining({ code: "IMMUTABLE_SMART_PROFILE" }));
  });

  it("rejects an uncertified candidate and any Profile that permits a Premium economic claim", () => {
    const registry = new InMemorySmartProfileRegistry();
    const invalidCandidate = profile();
    expect(() => registry.register({
      ...invalidCandidate,
      candidates: [{ ...invalidCandidate.candidates[0]!, smartProfileCertified: false }],
    })).toThrowError(expect.objectContaining({ code: "INVALID_SMART_PROFILE" }));
    expect(() => registry.register({
      ...profile(),
      economicOutputMayBeCalledPremium: true,
    } as unknown as SmartProfileVersion)).toThrowError(expect.objectContaining({ code: "INVALID_SMART_PROFILE" }));
  });

  it("records explicit version-pinned opt-in idempotently and rejects conflicting consent reuse", () => {
    const store = new InMemorySmartConsentStore();
    const optIn = consent();
    expect(store.optIn(optIn)).toEqual(optIn);
    expect(store.optIn(optIn)).toEqual(optIn);
    expect(() => store.optIn({ ...optIn, userId: "user-002" }))
      .toThrowError(expect.objectContaining({ code: "SMART_CONSENT_CONFLICT" }));
  });

  it("denies Exact Mode, missing consent, cross-user consent and Plan-ineligible Profiles", () => {
    const { registered, authorizer } = setup();
    const common = {
      authorizationId: "smart-authorization-001",
      userId: "user-001",
      profileVersionId: registered.id,
      consentId: "smart-consent-001",
      eligibleProfileKeys: ["BEST_VALUE"],
    } as const;
    expect(() => authorizer.authorize({ ...common, mode: "EXACT" }))
      .toThrowError(expect.objectContaining({ code: "HIDDEN_SUBSTITUTION_DENIED" }));
    expect(() => authorizer.authorize({ ...common, mode: "SMART", consentId: null }))
      .toThrowError(expect.objectContaining({ code: "SMART_OPT_IN_REQUIRED" }));
    expect(() => authorizer.authorize({ ...common, mode: "SMART", userId: "user-002" }))
      .toThrowError(expect.objectContaining({ code: "SMART_OPT_IN_REQUIRED" }));
    expect(() => authorizer.authorize({ ...common, mode: "SMART", eligibleProfileKeys: [] }))
      .toThrowError(expect.objectContaining({ code: "SMART_PROFILE_NOT_ELIGIBLE" }));
  });

  it("revokes Smart permission immediately without deleting the original opt-in evidence", () => {
    const { registered, consents, authorizer } = setup();
    const event = {
      revocationId: "smart-revocation-001",
      consentId: "smart-consent-001",
      userId: "user-001",
      action: "SMART_OPT_OUT" as const,
      revokedAt: new Date(baseTime.getTime() + 1000).toISOString(),
    };
    expect(consents.optOut(event)).toEqual(event);
    expect(consents.optOut(event)).toEqual(event);
    expect(() => authorizer.authorize({
      authorizationId: "smart-authorization-after-revoke",
      mode: "SMART",
      userId: "user-001",
      profileVersionId: registered.id,
      consentId: "smart-consent-001",
      eligibleProfileKeys: ["BEST_VALUE"],
    })).toThrowError(expect.objectContaining({ code: "SMART_CONSENT_REVOKED" }));
  });

  it("authorizes only the disclosed candidate set without dispatching or permitting hidden substitution", () => {
    const { registered, authorizer } = setup();
    const authorization = authorizer.authorize({
      authorizationId: "smart-authorization-001",
      mode: "SMART",
      userId: "user-001",
      profileVersionId: registered.id,
      consentId: "smart-consent-001",
      eligibleProfileKeys: ["BEST_VALUE"],
    });
    expect(authorization).toMatchObject({
      profileKey: "BEST_VALUE",
      disclosureVersionId: "smart-disclosure:v1",
      automaticSelection: true,
      selectionAuthorityGranted: true,
      hiddenSubstitutionAllowed: false,
      externalDispatchPerformed: false,
    });
    expect(authorization.preSelectionDisclosure).toContain("automatically select");
    expect(authorization.candidateVersions).toEqual(registered.candidates);
  });

  it("discloses the exact actual Family/Model/Route and rejects undisclosed or Premium relabeling", () => {
    const { registered, authorizer } = setup();
    const authorization = authorizer.authorize({
      authorizationId: "smart-authorization-result",
      mode: "SMART",
      userId: "user-001",
      profileVersionId: registered.id,
      consentId: "smart-consent-001",
      eligibleProfileKeys: ["BEST_VALUE"],
    });
    const candidate = registered.candidates[1]!;
    expect(authorizer.discloseResult({
      authorization,
      actualFamilyVersionId: candidate.familyVersionId,
      actualModelVersionId: candidate.modelVersionId,
      actualRouteVersionId: candidate.routeVersionId,
      marketingLabel: "Best Value",
    })).toMatchObject({
      profileDisplayName: "Best Value",
      automaticSelectionWasUsed: true,
      actualFamilyVersionId: "family:test-image-alt:v1",
      actualModelVersionId: "local/test-image-alt-v1",
      actualRouteVersionId: "route:provider-test-image-alt:v1",
      economicOutputCalledPremium: false,
      dispatchMutationPerformed: false,
    });
    expect(() => authorizer.discloseResult({
      authorization,
      actualFamilyVersionId: candidate.familyVersionId,
      actualModelVersionId: "undisclosed-model",
      actualRouteVersionId: candidate.routeVersionId,
    })).toThrowError(expect.objectContaining({ code: "INVALID_RESULT_DISCLOSURE" }));
    expect(() => authorizer.discloseResult({
      authorization,
      actualFamilyVersionId: candidate.familyVersionId,
      actualModelVersionId: candidate.modelVersionId,
      actualRouteVersionId: candidate.routeVersionId,
      marketingLabel: "Premium",
    })).toThrowError(expect.objectContaining({ code: "INVALID_RESULT_DISCLOSURE" }));
  });
});
