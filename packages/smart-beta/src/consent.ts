import type { SmartOptInConsent, SmartOptOutEvent } from "./types.ts";
import { SmartBetaError } from "./types.ts";

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class InMemorySmartConsentStore {
  private readonly consents = new Map<string, SmartOptInConsent>();
  private readonly revocations = new Map<string, SmartOptOutEvent>();
  private readonly revocationByConsent = new Map<string, SmartOptOutEvent>();

  optIn(consent: SmartOptInConsent): SmartOptInConsent {
    if (!consent.consentId
      || !consent.userId
      || !consent.profileVersionId
      || !consent.disclosureVersionId
      || consent.action !== "SMART_OPT_IN"
      || Number.isNaN(Date.parse(consent.acceptedAt))) {
      throw new SmartBetaError("INVALID_SMART_CONSENT", "Smart opt-in requires an explicit user action tied to Profile and Disclosure Versions.");
    }
    const prior = this.consents.get(consent.consentId);
    if (prior) {
      if (same(prior, consent)) return structuredClone(prior);
      throw new SmartBetaError("SMART_CONSENT_CONFLICT", "Consent ID was reused with different opt-in evidence.");
    }
    const stored = Object.freeze(structuredClone(consent));
    this.consents.set(stored.consentId, stored);
    return structuredClone(stored);
  }

  optOut(event: SmartOptOutEvent): SmartOptOutEvent {
    const consent = this.consents.get(event.consentId);
    if (!event.revocationId
      || !consent
      || event.userId !== consent.userId
      || event.action !== "SMART_OPT_OUT"
      || Number.isNaN(Date.parse(event.revokedAt))
      || Date.parse(event.revokedAt) < Date.parse(consent.acceptedAt)) {
      throw new SmartBetaError("INVALID_SMART_CONSENT", "Smart opt-out must reference the same user and an existing prior consent.");
    }
    const priorById = this.revocations.get(event.revocationId);
    const priorByConsent = this.revocationByConsent.get(event.consentId);
    const prior = priorById ?? priorByConsent;
    if (prior) {
      if (same(prior, event)) return structuredClone(prior);
      throw new SmartBetaError("SMART_CONSENT_CONFLICT", "Consent revocation cannot be overwritten or duplicated with different evidence.");
    }
    const stored = Object.freeze(structuredClone(event));
    this.revocations.set(stored.revocationId, stored);
    this.revocationByConsent.set(stored.consentId, stored);
    return structuredClone(stored);
  }

  requireActive(input: {
    consentId: string;
    userId: string;
    profileVersionId: string;
    disclosureVersionId: string;
  }): SmartOptInConsent {
    const consent = this.consents.get(input.consentId);
    if (!consent
      || consent.userId !== input.userId
      || consent.profileVersionId !== input.profileVersionId
      || consent.disclosureVersionId !== input.disclosureVersionId) {
      throw new SmartBetaError("SMART_OPT_IN_REQUIRED", "A matching explicit Smart opt-in is required.");
    }
    if (this.revocationByConsent.has(consent.consentId)) {
      throw new SmartBetaError("SMART_CONSENT_REVOKED", "Smart consent was revoked and cannot authorize another selection.");
    }
    return structuredClone(consent);
  }
}
