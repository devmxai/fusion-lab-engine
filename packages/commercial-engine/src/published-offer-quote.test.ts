import { describe, expect, it } from "vitest";
import { createLocalTestRegistrySnapshot, localFamilyVersionId } from "./local-test-fixture.ts";
import { PublishedOfferQuoteEngine, PublishedOfferQuoteError, type PublishedCommercialOffer } from "./published-offer-quote.ts";
import { VersionedCommercialRegistry } from "./registry.ts";

const NOW = new Date("2026-08-22T12:00:00.000Z");

function offer(snapshot = createLocalTestRegistrySnapshot()): PublishedCommercialOffer {
  const route = snapshot.routes.find(({ providerModelId }) => providerModelId === "local/test-image-v1")!;
  return {
    offerId: "offer.local.test-image", releaseBundleId: "bundle.local.1", releaseBundleVersion: 1,
    commercialRegistrySnapshotId: snapshot.id, commercialRegistrySnapshotVersion: snapshot.version, commercialRegistryEvidenceSha256: "a".repeat(64),
    commercialRouteVersionId: route.id, familyVersionId: localFamilyVersionId("local/test-image-v1"), recipeVersionId: "recipe:image.generate:v1",
    customerPriceVersionId: snapshot.customerPriceVersions[0]!.id,
    providerId: route.providerId, providerAccountId: route.providerAccountId, providerModelId: route.providerModelId, adapterVersion: route.adapterVersion,
  };
}

function subject(active: PublishedCommercialOffer[]) {
  const snapshot = createLocalTestRegistrySnapshot();
  const registry = new VersionedCommercialRegistry();
  registry.registerSnapshot(snapshot);
  return new PublishedOfferQuoteEngine({ activePublishedCommercialOffers: async () => active }, registry, () => NOW, () => "published-offer-quote-1");
}

describe("PublishedOfferQuoteEngine", () => {
  it("quotes only the route/family/recipe/price frozen by the active offer", async () => {
    const quote = await subject([offer()]).quote({
      offerId: "offer.local.test-image", projectId: "project-1", mode: "exact", quantity: 1,
      resolution: "720p", audio: false, referenceCount: 0,
    });
    expect(quote).toMatchObject({
      id: "published-offer-quote-1", offerId: "offer.local.test-image", releaseBundleId: "bundle.local.1", releaseBundleVersion: 1,
      customerCredits: 4n, pins: { familyVersionId: localFamilyVersionId("local/test-image-v1"), routeVersionId: "route:local/test-image-v1:v1" },
    });
  });

  it("fails closed for inactive offers and mismatched route binding", async () => {
    const input = { offerId: "offer.local.test-image", projectId: "project-1", mode: "exact" as const, quantity: 1, resolution: "720p", audio: false, referenceCount: 0 };
    await expect(subject([]).quote(input)).rejects.toMatchObject({ code: "OFFER_NOT_PUBLISHED" } satisfies Partial<PublishedOfferQuoteError>);
    await expect(subject([{ ...offer(), providerModelId: "unexpected-model" }]).quote(input)).rejects.toMatchObject({ code: "COMMERCIAL_BINDING_INVALID" } satisfies Partial<PublishedOfferQuoteError>);
  });
});
