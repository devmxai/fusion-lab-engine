/** Provider Control Plane contracts. No type in this module may hold a secret value. */

export type ProviderLifecycle = "REFERENCE_ONLY" | "ACTIVE" | "SUSPENDED" | "RETIRED";
export type ProviderAccountState = "DISCONNECTED" | "PENDING_VERIFICATION" | "CONNECTED" | "DEGRADED" | "SUSPENDED" | "REVOKED";
export type ReferenceModelState = "DISCOVERED" | "NORMALIZED" | "REVIEWED" | "REFERENCE_ACTIVE" | "DEPRECATED" | "REMOVED_FROM_SOURCE";
export type RouteCandidateState = "REFERENCE_ONLY" | "DRAFT_SELECTED" | "CONTRACT_VALIDATED" | "PRICED" | "IN_REVIEW" | "APPROVED" | "CANARY_VALIDATED" | "PUBLISHED" | "PAUSED" | "RETIRED";

export type ImmutableVersion<T> = Readonly<{
  id: string;
  entityId: string;
  version: number;
  effectiveAt: string;
  createdAt: string;
  evidenceSha256: string;
  payload: Readonly<T>;
}>;

export type Provider = Readonly<{
  id: string;
  displayName: string;
  lifecycle: ProviderLifecycle;
  documentationUrl: string;
}>;

export type ProviderAccount = Readonly<{
  id: string;
  providerId: string;
  displayName: string;
  environment: "LOCAL" | "STAGING" | "PRODUCTION";
  state: ProviderAccountState;
  credentialReferenceId: string | null;
}>;

/** Immutable public-source observation. Never contains an account, credential, or active route. */
export type ReferenceCatalogSnapshot = Readonly<{
  id: string;
  providerId: string;
  observedAt: string;
  sourceUrls: readonly string[];
  rawPayloadSha256: string;
  manifestSha256: string;
  parserVersion: string;
  sourceScope: "PUBLIC_REFERENCE";
}>;

export type ReferenceModel = Readonly<{
  id: string;
  providerId: string;
  providerModelId: string;
  familyId: string;
  displayName: string;
  modalities: readonly ("image" | "video" | "audio" | "text" | "embedding")[];
  state: ReferenceModelState;
  catalogSnapshotId: string;
  /** Public-source hint only; it has no authority to activate customer UX. */
  taxonomyHint?: Readonly<{
    schemaVersion: 1;
    reviewState: "UNREVIEWED";
    source: "OFFICIAL_DOCUMENTATION" | "OFFICIAL_MODELS_API";
    productFamily: Readonly<{ id: string; displayName: string }>;
    version?: Readonly<{ id: string; displayName: string }>;
    edition?: Readonly<{ id: string; displayName: string }>;
    experienceCategories: readonly ("IMAGE" | "VIDEO" | "AVATAR" | "AUDIO")[];
  }>;
  /**
   * Maker/checker-approved customer presentation. Unlike taxonomyHint this
   * may be included in a release projection, but still cannot publish a
   * route, capability, or price on its own.
   */
  reviewedTaxonomy?: Readonly<{
    schemaVersion: 1;
    reviewState: "REVIEWED";
    sourceCatalogSnapshotId: string;
    productFamily: Readonly<{ id: string; displayName: string }>;
    version?: Readonly<{ id: string; displayName: string }>;
    edition?: Readonly<{ id: string; displayName: string }>;
    experienceCategories: readonly ("IMAGE" | "VIDEO" | "AVATAR" | "AUDIO")[];
  }>;
}>;

export type RouteCandidate = Readonly<{
  id: string;
  providerId: string;
  providerAccountId: string;
  referenceModelId: string;
  providerEndpointReferenceId: string;
  adapterKey: string;
  adapterVersion: string;
  state: RouteCandidateState;
  inputProfileVersionId: string;
  /** Pinned provider-usage parser/extractor used for post-dispatch reconciliation. */
  usageExtractorVersion: string;
  billingFormulaVersionId: string | null;
  providerCostVersionId: string | null;
  customerPriceVersionId: string | null;
}>;

export type PublishedOffer = Readonly<{
  id: string;
  routeCandidateVersionId: string;
  releaseBundleId: string;
  releaseBundleVersion: number;
  customerPriceVersionId: string;
  publishedAt: string;
}>;

/** A version reference is explicit so a release never silently follows a newer route or catalog revision. */
export type ControlPlaneVersionReference = Readonly<{
  entityId: string;
  version: number;
}>;

export type ReleaseBundleOffer = Readonly<{
  offerId: string;
  routeCandidate: ControlPlaneVersionReference;
  catalogSnapshot: ControlPlaneVersionReference;
  /** New bundles pin the exact reviewed model revision used for customer presentation. */
  referenceModel?: ControlPlaneVersionReference;
  credentialReferenceId: string;
  credentialVersion: number;
  adapterVersion: string;
  customerPriceVersionId: string;
  commercialRegistrySnapshotId: string;
  commercialRegistrySnapshotVersion: number;
  commercialRegistryEvidenceSha256: string;
  commercialRouteVersionId: string;
  familyVersionId: string;
  recipeVersionId: string;
}>;

/**
 * The immutable unit released to customer traffic.  Credential material is
 * never stored here: only the exact vault reference/version that the runtime
 * resolver must lease at dispatch time.
 */
export type ReleaseBundle = Readonly<{
  id: string;
  scope: "LOCAL_TEST_ONLY" | "PRODUCTION";
  effectiveAt: string;
  rollbackTargetReleaseBundleId: string | null;
  financeSimulationEvidenceSha256: string;
  securityEvidenceSha256: string;
  canaryEvidenceSha256: string;
  makerId: string;
  checkerId: string;
  offers: readonly ReleaseBundleOffer[];
}>;

/** Redacted, fully pinned runtime projection derived only from an active Bundle. */
export type PublishedRuntimeRoute = Readonly<{
  offerId: string;
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

export class ProviderControlPlaneError extends Error {
  constructor(readonly code: "INVALID_REFERENCE" | "IMMUTABLE_VERSION" | "PUBLISHED_OFFER_INVALID" | "RELEASE_BUNDLE_INVALID", message: string) {
    super(message);
    this.name = "ProviderControlPlaneError";
  }
}

export function assertSha256(value: string, field = "evidenceSha256"): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new ProviderControlPlaneError("INVALID_REFERENCE", `${field} must be a lowercase SHA-256 hash.`);
}

export function assertRouteCandidate(route: RouteCandidate): void {
  if (!route.id || !route.providerId || !route.providerAccountId || !route.referenceModelId
    || !route.providerEndpointReferenceId || !route.adapterKey || !route.adapterVersion || !route.inputProfileVersionId || !route.usageExtractorVersion) {
    throw new ProviderControlPlaneError("INVALID_REFERENCE", "Route candidate contains an unresolved mandatory reference.");
  }
  if (route.state === "PUBLISHED") {
    throw new ProviderControlPlaneError("PUBLISHED_OFFER_INVALID", "A route candidate cannot publish itself; publication requires an atomic release bundle.");
  }
}
