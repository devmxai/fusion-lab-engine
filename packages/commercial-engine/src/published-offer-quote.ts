import { randomUUID } from "node:crypto";
import { DeterministicQuoteEngine } from "./quote-engine.ts";
import { VersionedCommercialRegistry } from "./registry.ts";
import type { CommercialQuote, CommercialQuoteInput, CommercialRegistrySnapshot } from "./types.ts";
import { PostgresCommercialRegistryRepository } from "./durable-registry-repository.ts";

export type PublishedCommercialOffer = Readonly<{
  offerId: string;
  releaseBundleId: string;
  releaseBundleVersion: number;
  commercialRegistrySnapshotId: string;
  commercialRegistrySnapshotVersion: number;
  commercialRegistryEvidenceSha256: string;
  commercialRouteVersionId: string;
  familyVersionId: string;
  recipeVersionId: string;
  customerPriceVersionId: string;
  providerId: string;
  providerAccountId: string;
  providerModelId: string;
  adapterVersion: string;
}>;

export interface ActivePublishedCommercialOfferSource {
  activePublishedCommercialOffers(): Promise<ReadonlyArray<PublishedCommercialOffer>>;
}

export type PublishedOfferQuoteInput = Omit<CommercialQuoteInput, "product" | "familyVersionId"> & {
  offerId: string;
};

export type PublishedOfferQuote = CommercialQuote & Readonly<{
  offerId: string;
  releaseBundleId: string;
  releaseBundleVersion: number;
}>;

export class PublishedOfferQuoteError extends Error {
  constructor(readonly code: "OFFER_NOT_PUBLISHED" | "COMMERCIAL_BINDING_INVALID", message: string) {
    super(message);
    this.name = "PublishedOfferQuoteError";
  }
}

/**
 * Quotes one active customer offer against the exact commercial components
 * frozen by its Release Bundle. It never activates a shared registry and can
 * therefore be used as the final quote gate before a wallet reservation.
 */
export class PublishedOfferQuoteEngine {
  constructor(
    private readonly source: ActivePublishedCommercialOfferSource,
    private readonly registry: VersionedCommercialRegistry,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
  ) {}

  async quote(input: PublishedOfferQuoteInput): Promise<PublishedOfferQuote> {
    if (!input.offerId) throw new PublishedOfferQuoteError("OFFER_NOT_PUBLISHED", "A published offer ID is required.");
    const offers = (await this.source.activePublishedCommercialOffers()).filter((offer) => offer.offerId === input.offerId);
    if (offers.length !== 1) throw new PublishedOfferQuoteError("OFFER_NOT_PUBLISHED", "Offer is absent from, or ambiguous in, the active release bundle.");
    const offer = offers[0]!;
    const snapshot = this.registry.require(offer.commercialRegistrySnapshotId);
    const constrained = this.bind(snapshot, offer);
    const isolated = new VersionedCommercialRegistry();
    isolated.registerSnapshot(constrained);
    isolated.activate(constrained.id);
    const quote = new DeterministicQuoteEngine(isolated, this.now, this.id).quote({
      ...input,
      product: constrained.recipes[0]!.product,
      familyVersionId: offer.familyVersionId,
    });
    return Object.freeze({
      ...quote,
      offerId: offer.offerId,
      releaseBundleId: offer.releaseBundleId,
      releaseBundleVersion: offer.releaseBundleVersion,
    });
  }

  private bind(snapshot: CommercialRegistrySnapshot, offer: PublishedCommercialOffer): CommercialRegistrySnapshot {
    if (snapshot.status !== "PUBLISHED" || snapshot.version !== offer.commercialRegistrySnapshotVersion) {
      throw new PublishedOfferQuoteError("COMMERCIAL_BINDING_INVALID", "Release bundle does not match a published commercial snapshot version.");
    }
    const route = snapshot.routes.find(({ id }) => id === offer.commercialRouteVersionId);
    const family = snapshot.families.find(({ id }) => id === offer.familyVersionId);
    const recipe = snapshot.recipes.find(({ id }) => id === offer.recipeVersionId);
    const price = snapshot.customerPriceVersions.find(({ id }) => id === offer.customerPriceVersionId);
    if (!route || !family || !recipe || !price || route.familyVersionId !== family.id || !recipe.familyVersionIds.includes(family.id)) {
      throw new PublishedOfferQuoteError("COMMERCIAL_BINDING_INVALID", "Release bundle commercial route/family/recipe/price pins are unresolved.");
    }
    if (route.providerId !== offer.providerId || route.providerAccountId !== offer.providerAccountId
      || route.providerModelId !== offer.providerModelId || route.adapterVersion !== offer.adapterVersion) {
      throw new PublishedOfferQuoteError("COMMERCIAL_BINDING_INVALID", "Commercial route does not match the released runtime route.");
    }
    const capability = snapshot.capabilities.find(({ id }) => id === route.capabilityVersionId);
    const billing = snapshot.billingManifests.find(({ id }) => id === route.billingManifestVersionId);
    const cost = snapshot.costVersions.find(({ id }) => id === route.costVersionId);
    if (!capability || !billing || !cost) {
      throw new PublishedOfferQuoteError("COMMERCIAL_BINDING_INVALID", "Released commercial route lacks capability, billing, or provider cost evidence.");
    }
    return structuredClone({
      ...snapshot,
      families: [family], recipes: [recipe], capabilities: [capability], billingManifests: [billing], costVersions: [cost],
      customerPriceVersions: [price], routes: [route],
      routingPolicyVersions: snapshot.routingPolicyVersions.filter(({ lifecycle }) => lifecycle === "PUBLISHED"),
    });
  }
}

/**
 * Production-facing quote gate.  Unlike the in-memory helper above, it reads
 * the exact commercial snapshot stored durably and pinned by the active
 * Release Bundle.  The temporary registry is isolated per quote: no mutable
 * global "active price" pointer can leak into a customer charge.
 */
export class DurablePublishedOfferQuoteEngine {
  constructor(
    private readonly source: ActivePublishedCommercialOfferSource,
    private readonly snapshots: PostgresCommercialRegistryRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
  ) {}

  async quote(input: PublishedOfferQuoteInput): Promise<PublishedOfferQuote> {
    if (!input.offerId) throw new PublishedOfferQuoteError("OFFER_NOT_PUBLISHED", "A published offer ID is required.");
    const offers = (await this.source.activePublishedCommercialOffers()).filter((offer) => offer.offerId === input.offerId);
    if (offers.length !== 1) throw new PublishedOfferQuoteError("OFFER_NOT_PUBLISHED", "Offer is absent from, or ambiguous in, the active release bundle.");
    const offer = offers[0]!;
    const stored = await this.snapshots.require({
      id: offer.commercialRegistrySnapshotId,
      version: offer.commercialRegistrySnapshotVersion,
      evidenceSha256: offer.commercialRegistryEvidenceSha256,
      publishedOnly: true,
    });
    const registry = new VersionedCommercialRegistry();
    registry.registerSnapshot(stored.snapshot);
    return new PublishedOfferQuoteEngine({ activePublishedCommercialOffers: async () => [offer] }, registry, this.now, this.id).quote(input);
  }
}
