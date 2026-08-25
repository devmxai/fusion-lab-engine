/**
 * Provider-neutral runtime resolution. It is deliberately separate from the
 * business/ledger layer: the latter receives a frozen route identity, never a
 * provider key or provider-specific configuration object.
 */
export type ReleasedProviderRuntimeRoute = Readonly<{
  providerId: string;
  providerAccountId: string;
  routeId: string;
  providerModelId: string;
  adapterKey: string;
  adapterVersion: string;
  credentialReferenceId: string;
  credentialVersion: number;
  providerCostVersionId: string;
  customerPriceVersionId: string;
  releaseBundleId: string;
  releaseBundleVersion: number;
  lifecycle: "PUBLISHED";
}>;

export type ProviderRuntimeResolution = Readonly<{
  providerId: string;
  providerAccountId: string;
  routeId: string;
  providerModelId: string;
  adapterKey: string;
  adapterVersion: string;
  credentialReferenceId: string;
  credentialVersion: number;
  providerCostVersionId: string;
  customerPriceVersionId: string;
  releaseBundleId: string;
  releaseBundleVersion: number;
}>;

export type ProviderCredentialLease = {
  credentialReferenceId: string;
  credentialVersion: number;
  providerId: string;
  providerAccountId: string;
};

/** The only permitted way a runtime can read an activated provider credential. */
export interface ProviderCredentialLeaseBroker {
  use<T>(lease: ProviderCredentialLease, work: (secret: Uint8Array) => Promise<T>): Promise<T>;
}

export type ProviderAdapterFactoryInput = Readonly<{
  resolution: ProviderRuntimeResolution;
  apiKey: Uint8Array;
}>;
export type ProviderAdapterFactory = (input: ProviderAdapterFactoryInput) => unknown;

type FactoryRegistration = Readonly<{ providerId: string; adapterKey: string; adapterVersion: string; factory: ProviderAdapterFactory }>;

export class ProviderRuntimeResolverError extends Error {
  constructor(readonly code: "ROUTE_NOT_RELEASED" | "RUNTIME_REFERENCE_INVALID" | "ADAPTER_NOT_REGISTERED" | "ADAPTER_VERSION_MISMATCH" | "CREDENTIAL_LEASE_MISMATCH" | "OFFER_NOT_PUBLISHED" | "OFFER_AMBIGUOUS", message: string) {
    super(message);
    this.name = "ProviderRuntimeResolverError";
  }
}

function required(value: string, field: string): string {
  if (!value || value.length > 500) throw new ProviderRuntimeResolverError("RUNTIME_REFERENCE_INVALID", `${field} is required.`);
  return value;
}

function resolutionOf(route: ReleasedProviderRuntimeRoute): ProviderRuntimeResolution {
  if (route.lifecycle !== "PUBLISHED") throw new ProviderRuntimeResolverError("ROUTE_NOT_RELEASED", "Provider runtime resolution requires a published release bundle.");
  for (const [field, value] of Object.entries(route)) if (field !== "credentialVersion" && field !== "lifecycle") required(String(value), field);
  if (!Number.isSafeInteger(route.credentialVersion) || route.credentialVersion < 1 || !Number.isSafeInteger(route.releaseBundleVersion) || route.releaseBundleVersion < 1) {
    throw new ProviderRuntimeResolverError("RUNTIME_REFERENCE_INVALID", "credentialVersion and releaseBundleVersion must be positive integers.");
  }
  const { lifecycle: _lifecycle, ...resolution } = route;
  return Object.freeze({ ...resolution });
}

/** Maps an approved, frozen release route to one versioned adapter factory. */
export class VersionedProviderAdapterFactoryRegistry {
  private readonly registrations = new Map<string, FactoryRegistration>();

  register(input: FactoryRegistration): void {
    for (const [field, value] of Object.entries(input)) if (field !== "factory") required(String(value), field);
    const key = this.key(input.providerId, input.adapterKey, input.adapterVersion);
    if (this.registrations.has(key)) throw new Error(`provider_adapter_factory_already_registered:${key}`);
    this.registrations.set(key, input);
  }

  require(resolution: ProviderRuntimeResolution): ProviderAdapterFactory {
    const exact = this.registrations.get(this.key(resolution.providerId, resolution.adapterKey, resolution.adapterVersion));
    if (exact) return exact.factory;
    const keyAndProvider = [...this.registrations.values()].some((candidate) => candidate.providerId === resolution.providerId && candidate.adapterKey === resolution.adapterKey);
    if (keyAndProvider) throw new ProviderRuntimeResolverError("ADAPTER_VERSION_MISMATCH", "The release requires a different certified adapter version.");
    throw new ProviderRuntimeResolverError("ADAPTER_NOT_REGISTERED", "No certified adapter is registered for this provider route.");
  }

  private key(providerId: string, adapterKey: string, adapterVersion: string): string {
    return JSON.stringify([providerId, adapterKey, adapterVersion]);
  }
}

export class ProviderRuntimeResolver {
  constructor(
    private readonly factories: VersionedProviderAdapterFactoryRegistry,
    private readonly credentials: ProviderCredentialLeaseBroker,
  ) {}

  resolve(route: ReleasedProviderRuntimeRoute): ProviderRuntimeResolution { return resolutionOf(route); }

  /**
   * Builds an adapter only while the lease callback is active. The resolver
   * never caches the adapter because a cache would make credential rotation
   * ambiguous and might retain a secret-derived client beyond its lease.
   */
  async withAdapter<T>(route: ReleasedProviderRuntimeRoute, work: (adapter: unknown, resolution: ProviderRuntimeResolution) => Promise<T>): Promise<T> {
    const resolution = this.resolve(route);
    const factory = this.factories.require(resolution);
    return this.credentials.use({
      credentialReferenceId: resolution.credentialReferenceId,
      credentialVersion: resolution.credentialVersion,
      providerId: resolution.providerId,
      providerAccountId: resolution.providerAccountId,
    }, async (secret) => {
      // `instanceof Uint8Array` is realm-sensitive (browser test runners and
      // workers may provide another realm), while byteLength is the contract
      // of the typed lease boundary.
      if (!Number.isSafeInteger(secret?.byteLength) || secret.byteLength < 1) throw new ProviderRuntimeResolverError("CREDENTIAL_LEASE_MISMATCH", "Credential lease did not supply an active secret.");
      return work(factory({ resolution, apiKey: secret }), resolution);
    });
  }
}

/**
 * Read-only control-plane capability. The implementation is structural so the
 * provider package does not depend on a particular database adapter.
 */
export interface ActivePublishedOfferRuntimeSource {
  activePublishedRuntimeRoutes(): Promise<ReadonlyArray<Readonly<{ offerId: string } & ReleasedProviderRuntimeRoute>>>;
}

/** Read-only historical release lookup used after a quote has been reserved. */
export interface FrozenPublishedOfferRuntimeSource {
  publishedRuntimeRouteForRelease(input: Readonly<{
    offerId: string;
    releaseBundleId: string;
    releaseBundleVersion: number;
  }>): Promise<Readonly<{ offerId: string } & ReleasedProviderRuntimeRoute>>;
}

export type PublishedOfferRuntimePin = Readonly<{
  offerId: string;
  releaseBundleId: string;
  releaseBundleVersion: number;
  providerId: string;
  providerAccountId: string;
  routeId: string;
  providerModelId: string;
  adapterVersion: string;
}>;

/**
 * Customer execution starts from an active published offer ID, never a
 * provider/model pair supplied by a browser or a fixture. The source is read
 * on every call so publish and rollback take effect immediately.
 */
export class ActivePublishedOfferRuntimeResolver {
  constructor(
    private readonly source: ActivePublishedOfferRuntimeSource,
    private readonly runtime: ProviderRuntimeResolver,
  ) {}

  async resolve(offerId: string): Promise<ProviderRuntimeResolution & Readonly<{ offerId: string }>> {
    if (!offerId) throw new ProviderRuntimeResolverError("OFFER_NOT_PUBLISHED", "A published offer ID is required.");
    const matches = (await this.source.activePublishedRuntimeRoutes()).filter((route) => route.offerId === offerId);
    if (matches.length === 0) throw new ProviderRuntimeResolverError("OFFER_NOT_PUBLISHED", "Offer is not in the active release bundle.");
    if (matches.length > 1) throw new ProviderRuntimeResolverError("OFFER_AMBIGUOUS", "Active release bundle contains duplicate offer IDs.");
    const route = matches[0]!;
    return Object.freeze({ offerId, ...this.runtime.resolve(route) });
  }

  async withAdapter<T>(offerId: string, work: (adapter: unknown, resolution: ProviderRuntimeResolution & Readonly<{ offerId: string }>) => Promise<T>): Promise<T> {
    const matches = (await this.source.activePublishedRuntimeRoutes()).filter((route) => route.offerId === offerId);
    if (matches.length === 0) throw new ProviderRuntimeResolverError("OFFER_NOT_PUBLISHED", "Offer is not in the active release bundle.");
    if (matches.length > 1) throw new ProviderRuntimeResolverError("OFFER_AMBIGUOUS", "Active release bundle contains duplicate offer IDs.");
    return this.runtime.withAdapter(matches[0]!, async (adapter, resolution) => work(adapter, Object.freeze({ offerId, ...resolution })));
  }
}

/**
 * Existing reserved operations never follow a new Active pointer. This
 * resolver re-reads the immutable Bundle version pinned in operation metadata
 * and compares its route identity before leasing an adapter.
 */
export class FrozenPublishedOfferRuntimeResolver {
  constructor(
    private readonly source: FrozenPublishedOfferRuntimeSource,
    private readonly runtime: ProviderRuntimeResolver,
  ) {}

  async withAdapter<T>(pin: PublishedOfferRuntimePin, work: (adapter: unknown, resolution: ProviderRuntimeResolution & Readonly<{ offerId: string }>) => Promise<T>): Promise<T> {
    const route = await this.source.publishedRuntimeRouteForRelease({
      offerId: pin.offerId,
      releaseBundleId: pin.releaseBundleId,
      releaseBundleVersion: pin.releaseBundleVersion,
    });
    if (route.offerId !== pin.offerId || route.releaseBundleId !== pin.releaseBundleId || route.releaseBundleVersion !== pin.releaseBundleVersion
      || route.providerId !== pin.providerId || route.providerAccountId !== pin.providerAccountId || route.routeId !== pin.routeId
      || route.providerModelId !== pin.providerModelId || route.adapterVersion !== pin.adapterVersion) {
      throw new ProviderRuntimeResolverError("ROUTE_NOT_RELEASED", "The immutable runtime route does not match the operation pin.");
    }
    return this.runtime.withAdapter(route, async (adapter, resolution) => work(adapter, Object.freeze({ offerId: pin.offerId, ...resolution })));
  }
}
