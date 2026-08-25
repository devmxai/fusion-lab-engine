import type { SmartCandidateVersion, SmartProfileKey, SmartProfileVersion } from "./types.ts";
import { SmartBetaError } from "./types.ts";

const PROFILE_KEYS = new Set<SmartProfileKey>([
  "BEST_VALUE",
  "CINEMATIC",
  "FAST_DRAFT",
  "HIGH_CONSISTENCY",
]);

function validCandidate(candidate: SmartCandidateVersion): boolean {
  return Boolean(candidate.familyVersionId
    && candidate.modelVersionId
    && candidate.routeVersionId
    && candidate.exactCertified
    && candidate.smartProfileCertified);
}

function immutableProfile(profile: SmartProfileVersion): SmartProfileVersion {
  return Object.freeze({
    ...structuredClone(profile),
    candidates: Object.freeze(profile.candidates.map((candidate) => Object.freeze({ ...candidate }))),
  });
}

export class InMemorySmartProfileRegistry {
  private readonly profiles = new Map<string, SmartProfileVersion>();
  private readonly sequences = new Map<string, string>();

  register(profile: SmartProfileVersion): SmartProfileVersion {
    const candidateRouteIds = new Set(profile.candidates.map(({ routeVersionId }) => routeVersionId));
    if (!profile.id
      || !PROFILE_KEYS.has(profile.profileKey)
      || !Number.isInteger(profile.version)
      || profile.version <= 0
      || profile.lifecycle !== "PUBLISHED"
      || !profile.displayName.trim()
      || !profile.disclosureVersionId.trim()
      || !profile.automaticSelectionDisclosure.trim()
      || !profile.resultModelDisclosure.trim()
      || profile.candidates.length === 0
      || candidateRouteIds.size !== profile.candidates.length
      || profile.candidates.some((candidate) => !validCandidate(candidate))
      || profile.economicOutputMayBeCalledPremium !== false
      || Number.isNaN(Date.parse(profile.publishedAt))) {
      throw new SmartBetaError("INVALID_SMART_PROFILE", "Smart Profile must be a published disclosed version with unique certified candidates.");
    }
    if (this.profiles.has(profile.id)) {
      throw new SmartBetaError("IMMUTABLE_SMART_PROFILE", "A Smart Profile Version ID cannot be overwritten.");
    }
    const sequence = `${profile.profileKey}:${profile.version}`;
    if (this.sequences.has(sequence)) {
      throw new SmartBetaError("DUPLICATE_SMART_PROFILE_SEQUENCE", "A Smart Profile key/version sequence can be published only once.");
    }
    const stored = immutableProfile(profile);
    this.profiles.set(stored.id, stored);
    this.sequences.set(sequence, stored.id);
    return stored;
  }

  require(profileVersionId: string): SmartProfileVersion {
    const profile = this.profiles.get(profileVersionId);
    if (!profile) throw new SmartBetaError("SMART_PROFILE_NOT_FOUND", "Smart Profile Version was not found.");
    return profile;
  }

  list(): readonly SmartProfileVersion[] {
    return [...this.profiles.values()];
  }
}
