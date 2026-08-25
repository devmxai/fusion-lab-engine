import { describe, expect, it } from "vitest";
import {
  ActivePublishedOfferRuntimeResolver,
  FrozenPublishedOfferRuntimeResolver,
  ProviderRuntimeResolver,
  VersionedProviderAdapterFactoryRegistry,
  type ReleasedProviderRuntimeRoute,
} from "./provider-runtime-resolver.ts";

const route: ReleasedProviderRuntimeRoute & { offerId: string } = {
  offerId: "offer.openrouter.image.gpt-image-1",
  providerId: "openrouter", providerAccountId: "account.openrouter.a", routeId: "route.openrouter.image.gpt-image-1",
  providerModelId: "openai/gpt-image-1", adapterKey: "openrouter-image", adapterVersion: "openrouter-image.v1",
  credentialReferenceId: "credential.openrouter.a.v1", credentialVersion: 1,
  providerCostVersionId: "cost.openrouter.image.v1", customerPriceVersionId: "price.image.v1",
  releaseBundleId: "bundle.openrouter.1", releaseBundleVersion: 4, lifecycle: "PUBLISHED",
};

describe("ActivePublishedOfferRuntimeResolver", () => {
  it("resolves only an offer in the current published bundle and retains all frozen pins", async () => {
    const factories = new VersionedProviderAdapterFactoryRegistry();
    factories.register({ providerId: "openrouter", adapterKey: "openrouter-image", adapterVersion: "openrouter-image.v1", factory: () => ({ kind: "image" }) });
    const runtime = new ProviderRuntimeResolver(factories, { use: async (_lease, work) => work(new Uint8Array([1])) });
    const resolver = new ActivePublishedOfferRuntimeResolver({ activePublishedRuntimeRoutes: async () => [route] }, runtime);
    await expect(resolver.withAdapter(route.offerId, async (adapter, resolution) => ({ adapter, resolution }))).resolves.toMatchObject({
      adapter: { kind: "image" }, resolution: { offerId: route.offerId, providerModelId: "openai/gpt-image-1", releaseBundleVersion: 4 },
    });
  });

  it("fails closed for unpublished or duplicated customer offers", async () => {
    const runtime = new ProviderRuntimeResolver(new VersionedProviderAdapterFactoryRegistry(), { use: async (_lease, work) => work(new Uint8Array([1])) });
    const none = new ActivePublishedOfferRuntimeResolver({ activePublishedRuntimeRoutes: async () => [] }, runtime);
    await expect(none.resolve(route.offerId)).rejects.toMatchObject({ code: "OFFER_NOT_PUBLISHED" });
    const duplicate = new ActivePublishedOfferRuntimeResolver({ activePublishedRuntimeRoutes: async () => [route, route] }, runtime);
    await expect(duplicate.resolve(route.offerId)).rejects.toMatchObject({ code: "OFFER_AMBIGUOUS" });
  });

  it("resolves a reserved operation from its immutable release pin, not a later active pointer", async () => {
    const factories = new VersionedProviderAdapterFactoryRegistry();
    factories.register({ providerId: "openrouter", adapterKey: "openrouter-image", adapterVersion: "openrouter-image.v1", factory: () => ({ kind: "image" }) });
    const runtime = new ProviderRuntimeResolver(factories, { use: async (_lease, work) => work(new Uint8Array([1])) });
    const frozen = new FrozenPublishedOfferRuntimeResolver({ publishedRuntimeRouteForRelease: async () => route }, runtime);
    await expect(frozen.withAdapter({
      offerId: route.offerId, releaseBundleId: route.releaseBundleId, releaseBundleVersion: route.releaseBundleVersion,
      providerId: route.providerId, providerAccountId: route.providerAccountId, routeId: route.routeId,
      providerModelId: route.providerModelId, adapterVersion: route.adapterVersion,
    }, async (_adapter, resolution) => resolution.releaseBundleVersion)).resolves.toBe(4);
    const mismatched = new FrozenPublishedOfferRuntimeResolver({ publishedRuntimeRouteForRelease: async () => ({ ...route, providerModelId: "openai/gpt-image-2" }) }, runtime);
    await expect(mismatched.withAdapter({
      offerId: route.offerId, releaseBundleId: route.releaseBundleId, releaseBundleVersion: route.releaseBundleVersion,
      providerId: route.providerId, providerAccountId: route.providerAccountId, routeId: route.routeId,
      providerModelId: route.providerModelId, adapterVersion: route.adapterVersion,
    }, async () => undefined)).rejects.toMatchObject({ code: "ROUTE_NOT_RELEASED" });
  });
});
