import { describe, expect, it } from "vitest";
import { ProviderRuntimeResolver, ProviderRuntimeResolverError, VersionedProviderAdapterFactoryRegistry, type ReleasedProviderRuntimeRoute } from "./provider-runtime-resolver.ts";

const route: ReleasedProviderRuntimeRoute = {
  providerId: "openrouter", providerAccountId: "openrouter-production-a", routeId: "route.openrouter.image.gpt",
  providerModelId: "openai/gpt-image-1", adapterKey: "openrouter-image", adapterVersion: "2.1.0",
  credentialReferenceId: "credential.openrouter.production-a.v3", credentialVersion: 3,
  providerCostVersionId: "cost.openrouter.gpt-image.v4", customerPriceVersionId: "price.fusion.gpt-image.v2",
  releaseBundleId: "release.2026-08-22.001", releaseBundleVersion: 1, lifecycle: "PUBLISHED",
};

describe("ProviderRuntimeResolver", () => {
  it("binds every execution to a frozen multi-account release route and scoped secret lease", async () => {
    const factories = new VersionedProviderAdapterFactoryRegistry();
    let createdWith: unknown = null;
    factories.register({ providerId: "openrouter", adapterKey: "openrouter-image", adapterVersion: "2.1.0", factory: (input) => { createdWith = input; return { execute: "fixture" }; } });
    const leases: unknown[] = [];
    const resolver = new ProviderRuntimeResolver(factories, { use: async (lease, work) => { leases.push(lease); return work(new TextEncoder().encode("secret-only-in-lease")); } });
    await expect(resolver.withAdapter(route, async (adapter, resolution) => ({ adapter, resolution }))).resolves.toMatchObject({ adapter: { execute: "fixture" }, resolution: { providerAccountId: "openrouter-production-a", credentialVersion: 3, releaseBundleId: "release.2026-08-22.001" } });
    expect(leases).toEqual([{ credentialReferenceId: "credential.openrouter.production-a.v3", credentialVersion: 3, providerId: "openrouter", providerAccountId: "openrouter-production-a" }]);
    expect(createdWith).toMatchObject({ resolution: { routeId: "route.openrouter.image.gpt", providerModelId: "openai/gpt-image-1" } });
    expect((createdWith as { apiKey: Uint8Array }).apiKey.byteLength).toBe("secret-only-in-lease".length);
  });

  it("fails closed for unpublished routes, mismatched adapter versions, and account/credential confusion", async () => {
    const factories = new VersionedProviderAdapterFactoryRegistry();
    factories.register({ providerId: "openrouter", adapterKey: "openrouter-image", adapterVersion: "2.0.0", factory: () => ({}) });
    const resolver = new ProviderRuntimeResolver(factories, { use: async (_lease, work) => work(new Uint8Array([1])) });
    expect(() => resolver.resolve({ ...route, lifecycle: "PUBLISHED" as const, credentialReferenceId: "" })).toThrowError(expect.objectContaining<Partial<ProviderRuntimeResolverError>>({ code: "RUNTIME_REFERENCE_INVALID" }));
    await expect(resolver.withAdapter(route, async () => undefined)).rejects.toMatchObject({ code: "ADAPTER_VERSION_MISMATCH" });
    expect(() => resolver.resolve({ ...route, lifecycle: "DRAFT" as never })).toThrowError(expect.objectContaining<Partial<ProviderRuntimeResolverError>>({ code: "ROUTE_NOT_RELEASED" }));
  });
});
