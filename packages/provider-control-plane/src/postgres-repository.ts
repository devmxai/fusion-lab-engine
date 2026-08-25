import { createHash } from "node:crypto";
import type { SqlExecutor, TransactionalSqlClient } from "../../durable-execution/src/postgres-atomic.js";
import { assertCommercialReleaseBinding, PostgresCommercialRegistryRepository } from "../../commercial-engine/src/durable-registry-repository.js";
import type { PublishedRuntimeRoute, ReferenceCatalogSnapshot, ReferenceModel, ReleaseBundle, ReleaseBundleOffer } from "./types.js";
import {
  assertRouteCandidate,
  assertSha256,
  type ImmutableVersion,
  type PublishedOffer,
  type RouteCandidate,
  ProviderControlPlaneError,
} from "./types.js";

export type ProviderControlEntityType = "PROVIDER" | "PROVIDER_ACCOUNT" | "CATALOG_SNAPSHOT" | "REFERENCE_MODEL" | "ROUTE_CANDIDATE" | "RELEASE_BUNDLE" | "PUBLISHED_OFFER";
export type CustomerPublishedOffer = Readonly<{
  contractVersion: 2;
  offerId: string;
  displayName: string;
  modelFamilyId: string;
  providerId: string;
  providerModelId: string;
  modalities: readonly ("image" | "video" | "audio" | "text" | "embedding")[];
  identity: Readonly<{
    familyId: string;
    officialModelId: string;
    providerId: string;
  }>;
  /** Reviewed product hierarchy, deliberately free of provider-route data. */
  presentation?: Readonly<{
    schemaVersion: 1;
    productFamily: Readonly<{ id: string; displayName: string }>;
    version?: Readonly<{ id: string; displayName: string }>;
    edition?: Readonly<{ id: string; displayName: string }>;
    experienceCategories: readonly ("IMAGE" | "VIDEO" | "AVATAR" | "AUDIO")[];
  }>;
  /** Browser-safe capability contract pinned by this exact Release Bundle.
   * It carries no price, route, account, credential, or provider endpoint. */
  capability: Readonly<{
    schemaVersion: 2;
    id: string;
    version: number;
    mediaType: "image" | "video" | "audio";
    inputModes: readonly ("text" | "image" | "audio")[];
    semanticSlots: readonly string[];
    maxReferences: number;
    resolutions: readonly string[];
    durationSeconds: Readonly<{ min: number; max: number }> | null;
    characterCount: Readonly<{ min: number; max: number }> | null;
    supportsAudio: boolean;
    outputHasAudio: boolean;
    controlSchema: Readonly<{
      version: string;
      recipes: readonly Readonly<{
        recipeId: string;
        prompt: Readonly<{ required: boolean; maxLength: number; visible: boolean }>;
        bindings: Readonly<{
          min: number; max: number; roles: readonly string[];
          slots?: readonly Readonly<{ role: string; kind: "IMAGE" | "VIDEO" | "AUDIO"; required: boolean }>[];
        }>;
        controls: readonly Readonly<{
          id: string;
          kind: "enum" | "number" | "boolean";
          defaultValue: string | number | boolean;
          values?: readonly (string | number | boolean)[];
          min?: number;
          max?: number;
          step?: number;
          ui?: Readonly<{ labelKey: string; group: "BASIC" | "ADVANCED"; order: number }>;
          visibleWhen?: Readonly<{
            controlId: string;
            operator: "EQUALS" | "NOT_EQUALS" | "IN";
            value: string | number | boolean | readonly (string | number | boolean)[];
          }>;
        }>[];
      }>[];
    }>;
  }>;
  customerPriceVersionId: string;
  commercialRecipeVersionId: string;
  releaseBundleId: string;
  releaseBundleVersion: number;
  evidence: Readonly<{
    level: "SERVER_VERIFIED";
    capabilityVersionId: string;
    capabilityVersion: number;
    controlSchemaVersion: string;
    catalogSnapshotId: string;
    catalogSnapshotVersion: number;
    commercialRegistryEvidenceSha256: string;
    contractSha256: string;
  }>;
}>;
type VersionInput<T> = { entityType: ProviderControlEntityType; entityId: string; commandId: string; payload: T; evidenceSha256: string; effectiveAt: string };

type Row = {
  entity_type: ProviderControlEntityType;
  entity_id: string;
  version: string | number | bigint;
  intent_hash: string;
  evidence_sha256: string;
  effective_at: string | Date;
  payload: Record<string, unknown> | string;
  created_at: string | Date;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function payload(value: Record<string, unknown> | string): Record<string, unknown> { return typeof value === "string" ? JSON.parse(value) : value; }
function view<T>(row: Row): ImmutableVersion<T> {
  return { id: `${row.entity_type}:${row.entity_id}:v${row.version}`, entityId: row.entity_id, version: Number(row.version), effectiveAt: iso(row.effective_at), createdAt: iso(row.created_at), evidenceSha256: row.evidence_sha256, payload: structuredClone(payload(row.payload)) as T };
}
function rejectSecret(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(rejectSecret);
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/(secret|password|api.?key|access.?token|private.?key)/i.test(key)) throw new ProviderControlPlaneError("INVALID_REFERENCE", "Control-plane payload cannot contain a secret-like field.");
    rejectSecret(item);
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProviderControlPlaneError("INVALID_REFERENCE", "Control-plane payload must be an object.");
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 500) throw new ProviderControlPlaneError("INVALID_REFERENCE", `${field} is required.`);
  return value;
}
function enumValue(value: unknown, field: string, choices: readonly string[]): string {
  if (typeof value !== "string" || !choices.includes(value)) throw new ProviderControlPlaneError("INVALID_REFERENCE", `${field} is invalid.`);
  return value;
}
function positiveVersion(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ProviderControlPlaneError("INVALID_REFERENCE", `${field} must be a positive immutable version.`);
  return Number(value);
}
function validateReviewedTaxonomy(value: unknown, snapshotId: string): void {
  const taxonomy = record(value);
  if (taxonomy.schemaVersion !== 1 || taxonomy.reviewState !== "REVIEWED") {
    throw new ProviderControlPlaneError("INVALID_REFERENCE", "reviewedTaxonomy must be an approved schema version.");
  }
  if (text(taxonomy.sourceCatalogSnapshotId, "reviewedTaxonomy.sourceCatalogSnapshotId") !== snapshotId) {
    throw new ProviderControlPlaneError("INVALID_REFERENCE", "reviewedTaxonomy must be pinned to the model catalog snapshot.");
  }
  const productFamily = record(taxonomy.productFamily);
  text(productFamily.id, "reviewedTaxonomy.productFamily.id");
  text(productFamily.displayName, "reviewedTaxonomy.productFamily.displayName");
  for (const key of ["version", "edition"] as const) {
    if (taxonomy[key] === undefined) continue;
    const item = record(taxonomy[key]);
    text(item.id, `reviewedTaxonomy.${key}.id`);
    text(item.displayName, `reviewedTaxonomy.${key}.displayName`);
  }
  if (!Array.isArray(taxonomy.experienceCategories) || taxonomy.experienceCategories.some((item) => !["IMAGE", "VIDEO", "AVATAR", "AUDIO"].includes(String(item)))) {
    throw new ProviderControlPlaneError("INVALID_REFERENCE", "reviewedTaxonomy experience categories are invalid.");
  }
}
function validateEntityPayload(entityType: ProviderControlEntityType, entityId: string, value: unknown): void {
  const item = record(value);
  if (text(item.id, "payload.id") !== entityId) throw new ProviderControlPlaneError("INVALID_REFERENCE", "Payload id must match entity id.");
  if (entityType === "PROVIDER") {
    text(item.displayName, "displayName");
    enumValue(item.lifecycle, "lifecycle", ["REFERENCE_ONLY", "ACTIVE", "SUSPENDED", "RETIRED"]);
    try { new URL(text(item.documentationUrl, "documentationUrl")); } catch { throw new ProviderControlPlaneError("INVALID_REFERENCE", "documentationUrl is invalid."); }
  } else if (entityType === "PROVIDER_ACCOUNT") {
    text(item.providerId, "providerId"); text(item.displayName, "displayName");
    enumValue(item.environment, "environment", ["LOCAL", "STAGING", "PRODUCTION"]);
    enumValue(item.state, "state", ["DISCONNECTED", "PENDING_VERIFICATION", "CONNECTED", "DEGRADED", "SUSPENDED", "REVOKED"]);
    if (item.credentialReferenceId !== null && typeof item.credentialReferenceId !== "string") throw new ProviderControlPlaneError("INVALID_REFERENCE", "credentialReferenceId must be a reference or null.");
  } else if (entityType === "CATALOG_SNAPSHOT") {
    text(item.providerId, "providerId"); text(item.observedAt, "observedAt"); text(item.parserVersion, "parserVersion");
    if (item.sourceScope !== "PUBLIC_REFERENCE") throw new ProviderControlPlaneError("INVALID_REFERENCE", "Catalog snapshots must be explicitly public reference evidence.");
    if (!Array.isArray(item.sourceUrls) || item.sourceUrls.length === 0 || item.sourceUrls.some((url) => {
      try { new URL(String(url)); return false; } catch { return true; }
    })) throw new ProviderControlPlaneError("INVALID_REFERENCE", "Catalog snapshots require official source URLs.");
    assertSha256(String(item.rawPayloadSha256), "rawPayloadSha256"); assertSha256(String(item.manifestSha256), "manifestSha256");
  } else if (entityType === "REFERENCE_MODEL") {
    for (const key of ["providerId", "providerModelId", "familyId", "displayName", "catalogSnapshotId"] as const) text(item[key], key);
    if (!Array.isArray(item.modalities) || item.modalities.length === 0 || item.modalities.some((modality) => !["image", "video", "audio", "text", "embedding"].includes(String(modality)))) throw new ProviderControlPlaneError("INVALID_REFERENCE", "modalities must contain supported values.");
    enumValue(item.state, "state", ["DISCOVERED", "NORMALIZED", "REVIEWED", "REFERENCE_ACTIVE", "DEPRECATED", "REMOVED_FROM_SOURCE"]);
    if (item.reviewedTaxonomy !== undefined) validateReviewedTaxonomy(item.reviewedTaxonomy, text(item.catalogSnapshotId, "catalogSnapshotId"));
  } else if (entityType === "ROUTE_CANDIDATE") {
    assertRouteCandidate(item as unknown as RouteCandidate);
  } else if (entityType === "RELEASE_BUNDLE") {
    validateReleaseBundle(item as unknown as ReleaseBundle);
  } else {
    for (const key of ["routeCandidateVersionId", "releaseBundleId", "customerPriceVersionId", "publishedAt"] as const) text(item[key], key);
    positiveVersion(item.releaseBundleVersion, "releaseBundleVersion");
  }
}

function validateReleaseBundle(bundle: ReleaseBundle): void {
  if (!bundle.id || !["LOCAL_TEST_ONLY", "PRODUCTION"].includes(bundle.scope)
    || !bundle.makerId || !bundle.checkerId || bundle.makerId === bundle.checkerId || !Array.isArray(bundle.offers) || bundle.offers.length === 0) {
    throw new ProviderControlPlaneError("RELEASE_BUNDLE_INVALID", "Release bundle requires distinct maker/checker identities and at least one offer.");
  }
  try { new Date(bundle.effectiveAt).toISOString(); } catch { throw new ProviderControlPlaneError("RELEASE_BUNDLE_INVALID", "Release bundle effectiveAt is invalid."); }
  for (const hashValue of [bundle.financeSimulationEvidenceSha256, bundle.securityEvidenceSha256, bundle.canaryEvidenceSha256]) assertSha256(hashValue, "release evidence");
  const offerIds = new Set<string>();
  for (const offer of bundle.offers) {
    if (!offer.offerId || offerIds.has(offer.offerId) || !offer.credentialReferenceId || !offer.adapterVersion || !offer.customerPriceVersionId || !offer.commercialRegistrySnapshotId
      || !offer.commercialRouteVersionId || !offer.familyVersionId || !offer.recipeVersionId) {
      throw new ProviderControlPlaneError("RELEASE_BUNDLE_INVALID", "Release bundle contains an incomplete or duplicate offer.");
    }
    offerIds.add(offer.offerId);
    positiveVersion(offer.routeCandidate.version, "routeCandidate.version");
    positiveVersion(offer.catalogSnapshot.version, "catalogSnapshot.version");
    if (offer.referenceModel !== undefined) positiveVersion(offer.referenceModel.version, "referenceModel.version");
    positiveVersion(offer.credentialVersion, "credentialVersion");
    positiveVersion(offer.commercialRegistrySnapshotVersion, "commercialRegistrySnapshotVersion");
    assertSha256(offer.commercialRegistryEvidenceSha256, "commercialRegistryEvidenceSha256");
  }
}
export type ControlPlaneDiff = Readonly<{ path: string; before: unknown; after: unknown }>;
function diffValue(before: unknown, after: unknown, path = "$"): ControlPlaneDiff[] {
  if (JSON.stringify(canonical(before)) === JSON.stringify(canonical(after))) return [];
  if (!before || !after || typeof before !== "object" || typeof after !== "object" || Array.isArray(before) || Array.isArray(after)) {
    return [{ path, before: structuredClone(before), after: structuredClone(after) }];
  }
  const left = before as Record<string, unknown>; const right = after as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    .flatMap((key) => diffValue(left[key], right[key], `${path}.${key}`));
}

export class PostgresProviderControlPlaneRepository {
  constructor(private readonly database: TransactionalSqlClient, private readonly now: () => Date = () => new Date()) {}

  async appendVersion<T>(input: VersionInput<T>): Promise<ImmutableVersion<T>> {
    if (input.entityType === "PUBLISHED_OFFER") {
      throw new ProviderControlPlaneError("PUBLISHED_OFFER_INVALID", "Published offers must be written by an atomic release bundle.");
    }
    return this.database.transaction(async (transaction) => this.appendInTransaction(transaction, input));
  }

  async publishOffer(input: { commandId: string; offer: PublishedOffer; evidenceSha256: string }): Promise<ImmutableVersion<PublishedOffer>> {
    void input;
    throw new ProviderControlPlaneError(
      "PUBLISHED_OFFER_INVALID",
      "Offers cannot be published individually; publish an independently approved atomic release bundle.",
    );
  }

  /**
   * Compiles the sole customer-visible projection in one database transaction.
   * A failure writes neither the bundle pointer nor any of its offers.  An
   * idempotent replay repairs no state because the original transaction already
   * completed atomically; it only reasserts the same immutable pointers.
   */
  async publishReleaseBundle(input: {
    commandId: string;
    release: ReleaseBundle;
    evidenceSha256: string;
  }): Promise<{ bundle: ImmutableVersion<ReleaseBundle>; offers: ImmutableVersion<PublishedOffer>[] }> {
    if (input.commandId.length > 140) throw new TypeError("release_bundle_command_id_too_long");
    assertSha256(input.evidenceSha256);
    validateReleaseBundle(input.release);
    return this.database.transaction(async (transaction) => {
      await this.validateReleaseDependencies(transaction, input.release);
      const bundle = await this.appendInTransaction(transaction, {
        entityType: "RELEASE_BUNDLE",
        entityId: input.release.id,
        commandId: `${input.commandId}:bundle`,
        payload: input.release,
        evidenceSha256: input.evidenceSha256,
        effectiveAt: input.release.effectiveAt,
      });
      const offers: ImmutableVersion<PublishedOffer>[] = [];
      for (const entry of input.release.offers) {
        const offer: PublishedOffer = {
          id: entry.offerId,
          routeCandidateVersionId: `ROUTE_CANDIDATE:${entry.routeCandidate.entityId}:v${entry.routeCandidate.version}`,
          releaseBundleId: input.release.id,
          releaseBundleVersion: bundle.version,
          customerPriceVersionId: entry.customerPriceVersionId,
          publishedAt: input.release.effectiveAt,
        };
        const version = await this.appendInTransaction(transaction, {
          entityType: "PUBLISHED_OFFER",
          entityId: offer.id,
          commandId: `${input.commandId}:offer:${offer.id}`,
          payload: offer,
          evidenceSha256: input.evidenceSha256,
          effectiveAt: input.release.effectiveAt,
        });
        await transaction.query(
          `INSERT INTO fusion_engine.provider_published_offer_pointers (offer_id, offer_version, release_bundle_id, release_bundle_version, published_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (offer_id) DO UPDATE SET offer_version = EXCLUDED.offer_version, release_bundle_id = EXCLUDED.release_bundle_id,
             release_bundle_version = EXCLUDED.release_bundle_version, published_at = EXCLUDED.published_at`,
          [offer.id, version.version, offer.releaseBundleId, bundle.version, offer.publishedAt],
        );
        offers.push(version);
      }
      await transaction.query(
        `INSERT INTO fusion_engine.provider_active_release_bundle_pointer (singleton, release_bundle_id, release_bundle_version, activated_at)
         VALUES (true, $1, $2, $3)
         ON CONFLICT (singleton) DO UPDATE SET release_bundle_id = EXCLUDED.release_bundle_id,
           release_bundle_version = EXCLUDED.release_bundle_version, activated_at = EXCLUDED.activated_at`,
        [bundle.entityId, bundle.version, input.release.effectiveAt],
      );
      await this.appendAudit(transaction, {
        commandId: `${input.commandId}:activate`,
        action: "RELEASE_BUNDLE_ACTIVATED",
        entityType: "RELEASE_BUNDLE",
        entityId: bundle.entityId,
        version: bundle.version,
        intentHash: hash({ releaseBundleId: bundle.entityId, releaseBundleVersion: bundle.version, offerIds: input.release.offers.map(({ offerId }) => offerId).sort() }),
        occurredAt: this.now().toISOString(),
      });
      return { bundle, offers };
    });
  }

  async activeReleaseBundle(): Promise<ImmutableVersion<ReleaseBundle> | null> {
    const result = await this.database.query<Row>(
      `SELECT v.* FROM fusion_engine.provider_active_release_bundle_pointer p
       JOIN fusion_engine.provider_control_versions v
         ON v.entity_type = p.entity_type AND v.entity_id = p.release_bundle_id AND v.version = p.release_bundle_version
       WHERE p.singleton = true`,
    );
    return result.rows[0] ? view<ReleaseBundle>(result.rows[0]) : null;
  }

  /** Visible offers are selected by the active bundle, never by a stale per-offer pointer. */
  async activePublishedOffers(): Promise<ImmutableVersion<PublishedOffer>[]> {
    const result = await this.database.query<Row>(
      `SELECT v.* FROM fusion_engine.provider_active_release_bundle_pointer active
       JOIN fusion_engine.provider_published_offer_pointers pointer
         ON pointer.release_bundle_id = active.release_bundle_id AND pointer.release_bundle_version = active.release_bundle_version
       JOIN fusion_engine.provider_control_versions v
         ON v.entity_type = pointer.entity_type AND v.entity_id = pointer.offer_id AND v.version = pointer.offer_version
       WHERE active.singleton = true ORDER BY pointer.offer_id`,
    );
    return result.rows.map((row) => view<PublishedOffer>(row));
  }

  /** The sole read model future Runtime and Creative Space code may consume. */
  async activePublishedOfferCatalog(): Promise<ReadonlyArray<{
    offer: ImmutableVersion<PublishedOffer>;
    releaseBundle: ImmutableVersion<ReleaseBundle>;
    releaseEntry: ReleaseBundleOffer;
  }>> {
    const releaseBundle = await this.activeReleaseBundle();
    if (!releaseBundle) return [];
    const offers = await this.activePublishedOffers();
    if (offers.length !== releaseBundle.payload.offers.length) {
      throw new ProviderControlPlaneError("PUBLISHED_OFFER_INVALID", "Active offer pointers do not match the complete active release bundle.");
    }
    return offers.map((offer) => {
      if (offer.payload.releaseBundleId !== releaseBundle.entityId || offer.payload.releaseBundleVersion !== releaseBundle.version) {
        throw new ProviderControlPlaneError("PUBLISHED_OFFER_INVALID", "Active offer does not pin the active release bundle version.");
      }
      const releaseEntry = releaseBundle.payload.offers.find((entry) => entry.offerId === offer.entityId);
      if (!releaseEntry) throw new ProviderControlPlaneError("PUBLISHED_OFFER_INVALID", "Active offer is absent from its release bundle.");
      return { offer, releaseBundle, releaseEntry: structuredClone(releaseEntry) };
    });
  }

  /**
   * Resolves the active customer offer catalog into the exact server-runtime
   * contract expected by the versioned Adapter Resolver. No lookup uses a
   * mutable "latest route" shortcut and no credential value is ever read.
   */
  async activePublishedRuntimeRoutes(): Promise<ReadonlyArray<PublishedRuntimeRoute>> {
    const catalog = await this.activePublishedOfferCatalog();
    return Promise.all(catalog.map(({ offer, releaseBundle, releaseEntry }) => this.runtimeRouteForReleaseEntry(offer.entityId, releaseBundle, releaseEntry)));
  }

  /** Historical execution resolves the exact release pinned in a quote, not
   * the mutable active-offer pointer that may have changed after reservation. */
  async publishedRuntimeRouteForRelease(input: Readonly<{ offerId: string; releaseBundleId: string; releaseBundleVersion: number }>): Promise<PublishedRuntimeRoute> {
    positiveVersion(input.releaseBundleVersion, "releaseBundleVersion");
    const row = await this.database.query<Row>(
      "SELECT * FROM fusion_engine.provider_control_versions WHERE entity_type = 'RELEASE_BUNDLE' AND entity_id = $1 AND version = $2",
      [input.releaseBundleId, input.releaseBundleVersion],
    );
    if (!row.rows[0]) throw new ProviderControlPlaneError("PUBLISHED_OFFER_INVALID", "The release pinned by this operation no longer exists.");
    const releaseBundle = view<ReleaseBundle>(row.rows[0]!);
    validateReleaseBundle(releaseBundle.payload);
    const releaseEntry = releaseBundle.payload.offers.filter((entry) => entry.offerId === input.offerId);
    if (releaseEntry.length !== 1) throw new ProviderControlPlaneError("PUBLISHED_OFFER_INVALID", "The offer is absent from its pinned release bundle.");
    return this.runtimeRouteForReleaseEntry(input.offerId, releaseBundle, releaseEntry[0]!);
  }

  private async runtimeRouteForReleaseEntry(
    offerId: string,
    releaseBundle: ImmutableVersion<ReleaseBundle>,
    releaseEntry: ReleaseBundleOffer,
  ): Promise<PublishedRuntimeRoute> {
      const route = await this.readVersionPayload("ROUTE_CANDIDATE", releaseEntry.routeCandidate.entityId, releaseEntry.routeCandidate.version);
      const routePayload = route as unknown as RouteCandidate;
      assertRouteCandidate(routePayload);
      const { reference: modelPayload } = await this.referenceModelForReleaseEntry(routePayload, releaseEntry);
      if (!routePayload.providerCostVersionId || !routePayload.customerPriceVersionId) {
        throw new ProviderControlPlaneError("PUBLISHED_OFFER_INVALID", `Released route ${routePayload.id} has no immutable price/cost version.`);
      }
      return Object.freeze({
        offerId,
        providerId: routePayload.providerId,
        providerAccountId: routePayload.providerAccountId,
        routeId: routePayload.id,
        providerModelId: modelPayload.providerModelId,
        adapterKey: routePayload.adapterKey,
        adapterVersion: routePayload.adapterVersion,
        credentialReferenceId: releaseEntry.credentialReferenceId,
        credentialVersion: releaseEntry.credentialVersion,
        providerCostVersionId: routePayload.providerCostVersionId,
        customerPriceVersionId: releaseEntry.customerPriceVersionId,
        releaseBundleId: releaseBundle.entityId,
        releaseBundleVersion: releaseBundle.version,
        lifecycle: "PUBLISHED" as const,
      } satisfies PublishedRuntimeRoute);
  }

  /**
   * Commercial projection of the active Bundle. It deliberately includes no
   * cost amount, secret, or mutable registry pointer; the quote engine uses
   * these immutable IDs to load and constrain the matching snapshot itself.
   */
  async activePublishedCommercialOffers(): Promise<ReadonlyArray<Readonly<{
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
  }>>> {
    const [catalog, runtimeRoutes] = await Promise.all([
      this.activePublishedOfferCatalog(),
      this.activePublishedRuntimeRoutes(),
    ]);
    const runtimeByOffer = new Map(runtimeRoutes.map((route) => [route.offerId, route]));
    return catalog.map(({ offer, releaseBundle, releaseEntry }) => {
      const runtime = runtimeByOffer.get(offer.entityId);
      if (!runtime || runtime.releaseBundleId !== releaseBundle.entityId || runtime.releaseBundleVersion !== releaseBundle.version) {
        throw new ProviderControlPlaneError("PUBLISHED_OFFER_INVALID", "Published commercial offer has no matching frozen runtime route.");
      }
      return Object.freeze({
        offerId: offer.entityId,
        releaseBundleId: releaseBundle.entityId,
        releaseBundleVersion: releaseBundle.version,
        commercialRegistrySnapshotId: releaseEntry.commercialRegistrySnapshotId,
        commercialRegistrySnapshotVersion: releaseEntry.commercialRegistrySnapshotVersion,
        commercialRegistryEvidenceSha256: releaseEntry.commercialRegistryEvidenceSha256,
        commercialRouteVersionId: releaseEntry.commercialRouteVersionId,
        familyVersionId: releaseEntry.familyVersionId,
        recipeVersionId: releaseEntry.recipeVersionId,
        customerPriceVersionId: releaseEntry.customerPriceVersionId,
        providerId: runtime.providerId,
        providerAccountId: runtime.providerAccountId,
        providerModelId: runtime.providerModelId,
        adapterVersion: runtime.adapterVersion,
      });
    });
  }

  /**
   * Browser-safe catalog projection.  It contains only customer-visible model
   * identity and immutable release pins: never provider cost, account ID,
   * adapter internals, credential reference, or a secret-derived field.
   */
  async activeCustomerPublishedOffers(): Promise<ReadonlyArray<CustomerPublishedOffer>> {
    const catalog = await this.activePublishedOfferCatalog();
    return Promise.all(catalog.map(async ({ offer, releaseBundle, releaseEntry }) => {
      const route = await this.readVersionPayload("ROUTE_CANDIDATE", releaseEntry.routeCandidate.entityId, releaseEntry.routeCandidate.version) as unknown as RouteCandidate;
      const { reference, isVersionPinned } = await this.referenceModelForReleaseEntry(route, releaseEntry);
      const commercial = await new PostgresCommercialRegistryRepository(this.database).require({
        id: releaseEntry.commercialRegistrySnapshotId,
        version: releaseEntry.commercialRegistrySnapshotVersion,
        evidenceSha256: releaseEntry.commercialRegistryEvidenceSha256,
        publishedOnly: true,
      });
      assertCommercialReleaseBinding({
        snapshot: commercial.snapshot,
        commercialRouteVersionId: releaseEntry.commercialRouteVersionId,
        familyVersionId: releaseEntry.familyVersionId,
        recipeVersionId: releaseEntry.recipeVersionId,
        customerPriceVersionId: releaseEntry.customerPriceVersionId,
        providerId: route.providerId,
        providerAccountId: route.providerAccountId,
        providerModelId: reference.providerModelId,
        adapterVersion: route.adapterVersion,
      });
      const commercialRoute = commercial.snapshot.routes.find(({ id }) => id === releaseEntry.commercialRouteVersionId)!;
      const capability = commercial.snapshot.capabilities.find(({ id }) => id === commercialRoute.capabilityVersionId);
      if (!capability || capability.lifecycle !== "PUBLISHED" || !capability.controlSchema) {
        throw new ProviderControlPlaneError("PUBLISHED_OFFER_INVALID", `Published offer ${offer.entityId} lacks a published capability contract.`);
      }
      const projection = {
        contractVersion: 2 as const,
        offerId: offer.entityId,
        displayName: reference.displayName,
        modelFamilyId: reference.familyId,
        providerId: route.providerId,
        providerModelId: reference.providerModelId,
        modalities: [...reference.modalities],
        identity: Object.freeze({ familyId: reference.familyId, officialModelId: reference.providerModelId, providerId: route.providerId }),
        ...(isVersionPinned && reference.reviewedTaxonomy ? {
          presentation: Object.freeze({
            schemaVersion: 1 as const,
            productFamily: { ...reference.reviewedTaxonomy.productFamily },
            ...(reference.reviewedTaxonomy.version ? { version: { ...reference.reviewedTaxonomy.version } } : {}),
            ...(reference.reviewedTaxonomy.edition ? { edition: { ...reference.reviewedTaxonomy.edition } } : {}),
            experienceCategories: [...reference.reviewedTaxonomy.experienceCategories],
          }),
        } : {}),
        capability: Object.freeze({
          schemaVersion: 2 as const,
          id: capability.id, version: capability.version, mediaType: capability.mediaType,
          inputModes: [...capability.inputModes], semanticSlots: [...capability.semanticSlots],
          maxReferences: capability.maxReferences, resolutions: [...capability.resolutions],
          durationSeconds: capability.durationSeconds ? { ...capability.durationSeconds } : null,
          characterCount: capability.characterCount ? { ...capability.characterCount } : null,
          supportsAudio: capability.supportsAudio, outputHasAudio: capability.outputHasAudio,
          controlSchema: structuredClone(capability.controlSchema),
        }),
        customerPriceVersionId: releaseEntry.customerPriceVersionId,
        commercialRecipeVersionId: releaseEntry.recipeVersionId,
        releaseBundleId: releaseBundle.entityId,
        releaseBundleVersion: releaseBundle.version,
      };
      const evidence = Object.freeze({
        level: "SERVER_VERIFIED" as const,
        capabilityVersionId: capability.id,
        capabilityVersion: capability.version,
        controlSchemaVersion: capability.controlSchema.version,
        catalogSnapshotId: releaseEntry.catalogSnapshot.entityId,
        catalogSnapshotVersion: releaseEntry.catalogSnapshot.version,
        commercialRegistryEvidenceSha256: releaseEntry.commercialRegistryEvidenceSha256,
        contractSha256: hash({
          projection,
          capabilityVersionId: capability.id,
          capabilityVersion: capability.version,
          catalogSnapshot: releaseEntry.catalogSnapshot,
          commercialRegistryEvidenceSha256: releaseEntry.commercialRegistryEvidenceSha256,
        }),
      });
      return Object.freeze({ ...projection, evidence }) satisfies CustomerPublishedOffer;
    }));
  }

  /** Internal execution proof for a single customer offer.  This is never a
   * browser projection and includes the catalog hash needed by the durable
   * quote metadata gate. */
  async activePublishedOfferExecutionEvidence(offerId: string): Promise<Readonly<{
    offerId: string;
    routeId: string;
    providerId: string;
    providerAccountId: string;
    providerAccountScope: "LOCAL_TEST_ONLY" | "PRODUCTION";
    providerModelBindingId: string;
    providerModelId: string;
    catalogSnapshotId: string;
    catalogSnapshotHash: string;
    providerCostVersionId: string;
    providerCostVersion: string;
    adapterVersion: string;
    usageExtractorVersion: string;
    certificationLifecycle: "PUBLISHED";
    releaseBundleId: string;
    releaseBundleVersion: number;
  }>> {
    const entries = (await this.activePublishedOfferCatalog()).filter(({ offer }) => offer.entityId === offerId);
    if (entries.length !== 1) throw new ProviderControlPlaneError("PUBLISHED_OFFER_INVALID", "Customer offer is absent from, or ambiguous in, the active release bundle.");
    const { releaseBundle, releaseEntry } = entries[0]!;
    const route = await this.readVersionPayload("ROUTE_CANDIDATE", releaseEntry.routeCandidate.entityId, releaseEntry.routeCandidate.version) as unknown as RouteCandidate;
    const catalog = await this.readVersionPayload("CATALOG_SNAPSHOT", releaseEntry.catalogSnapshot.entityId, releaseEntry.catalogSnapshot.version) as unknown as ReferenceCatalogSnapshot;
    const { reference } = await this.referenceModelForReleaseEntry(route, releaseEntry);
    if (!route.providerCostVersionId || !route.billingFormulaVersionId || !route.usageExtractorVersion) {
      throw new ProviderControlPlaneError("PUBLISHED_OFFER_INVALID", "Published offer lacks immutable execution evidence.");
    }
    return Object.freeze({
      offerId,
      routeId: route.id,
      providerId: route.providerId,
      providerAccountId: route.providerAccountId,
      providerAccountScope: releaseBundle.payload.scope,
      providerModelBindingId: reference.id,
      providerModelId: reference.providerModelId,
      catalogSnapshotId: catalog.id,
      catalogSnapshotHash: catalog.rawPayloadSha256,
      providerCostVersionId: route.providerCostVersionId,
      providerCostVersion: route.providerCostVersionId,
      adapterVersion: route.adapterVersion,
      usageExtractorVersion: route.usageExtractorVersion,
      certificationLifecycle: "PUBLISHED" as const,
      releaseBundleId: releaseBundle.entityId,
      releaseBundleVersion: releaseBundle.version,
    });
  }

  /**
   * Rollback/re-activation only moves active pointers to an already immutable
   * Bundle version.  It never edits historical offers and re-checks current
   * account and credential readiness, so a revoked credential cannot be
   * accidentally resurrected by a rollback.
   */
  async activateReleaseBundle(input: {
    commandId: string;
    releaseBundleId: string;
    releaseBundleVersion: number;
    reasonCode: string;
  }): Promise<ImmutableVersion<ReleaseBundle>> {
    if (input.commandId.length > 150 || !input.reasonCode || !input.releaseBundleId) throw new TypeError("invalid_release_bundle_activation");
    positiveVersion(input.releaseBundleVersion, "releaseBundleVersion");
    await this.database.transaction(async (transaction) => {
      const row = await transaction.query<Row>(
        "SELECT * FROM fusion_engine.provider_control_versions WHERE entity_type = 'RELEASE_BUNDLE' AND entity_id = $1 AND version = $2 FOR UPDATE",
        [input.releaseBundleId, input.releaseBundleVersion],
      );
      if (!row.rows[0]) throw new ProviderControlPlaneError("RELEASE_BUNDLE_INVALID", "Rollback target release bundle version does not exist.");
      const release = payload(row.rows[0]!.payload) as unknown as ReleaseBundle;
      validateReleaseBundle(release);
      await this.validateReleaseDependencies(transaction, release);
      for (const entry of release.offers) {
        const offer = await transaction.query<Row>(
          `SELECT * FROM fusion_engine.provider_control_versions
           WHERE entity_type = 'PUBLISHED_OFFER' AND entity_id = $1
             AND payload ->> 'releaseBundleId' = $2 AND payload ->> 'releaseBundleVersion' = $3
           ORDER BY version DESC LIMIT 1 FOR UPDATE`,
          [entry.offerId, input.releaseBundleId, String(input.releaseBundleVersion)],
        );
        if (!offer.rows[0]) throw new ProviderControlPlaneError("RELEASE_BUNDLE_INVALID", `Rollback offer ${entry.offerId} is missing from target bundle version.`);
        const version = view<PublishedOffer>(offer.rows[0]!);
        await transaction.query(
          `INSERT INTO fusion_engine.provider_published_offer_pointers (offer_id, offer_version, release_bundle_id, release_bundle_version, published_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (offer_id) DO UPDATE SET offer_version = EXCLUDED.offer_version, release_bundle_id = EXCLUDED.release_bundle_id,
             release_bundle_version = EXCLUDED.release_bundle_version, published_at = EXCLUDED.published_at`,
          [entry.offerId, version.version, input.releaseBundleId, input.releaseBundleVersion, this.now().toISOString()],
        );
      }
      await transaction.query(
        `INSERT INTO fusion_engine.provider_active_release_bundle_pointer (singleton, release_bundle_id, release_bundle_version, activated_at)
         VALUES (true, $1, $2, $3)
         ON CONFLICT (singleton) DO UPDATE SET release_bundle_id = EXCLUDED.release_bundle_id,
           release_bundle_version = EXCLUDED.release_bundle_version, activated_at = EXCLUDED.activated_at`,
        [input.releaseBundleId, input.releaseBundleVersion, this.now().toISOString()],
      );
      await this.appendAudit(transaction, {
        commandId: input.commandId,
        action: "RELEASE_BUNDLE_REACTIVATED",
        entityType: "RELEASE_BUNDLE",
        entityId: input.releaseBundleId,
        version: input.releaseBundleVersion,
        intentHash: hash({ releaseBundleId: input.releaseBundleId, releaseBundleVersion: input.releaseBundleVersion, reasonCode: input.reasonCode }),
        occurredAt: this.now().toISOString(),
      });
    });
    const active = await this.activeReleaseBundle();
    if (!active) throw new ProviderControlPlaneError("RELEASE_BUNDLE_INVALID", "Release bundle activation did not persist an active pointer.");
    return active;
  }

  /** Atomically writes one approved public snapshot and all of its reference models. */
  async appendReferenceCatalog(input: {
    commandId: string;
    snapshot: ReferenceCatalogSnapshot;
    models: ReadonlyArray<ReferenceModel & { sourceEvidenceSha256: string; canonicalSlug?: string; supportedParameters?: readonly string[]; sourceUrls?: readonly string[] }>;
    approvalEvidenceSha256: string;
    effectiveAt: string;
  }): Promise<{ snapshot: ImmutableVersion<ReferenceCatalogSnapshot>; models: ImmutableVersion<Record<string, unknown>>[] }> {
    assertSha256(input.approvalEvidenceSha256, "approvalEvidenceSha256");
    if (!input.models.length || input.models.some((model) => model.catalogSnapshotId !== input.snapshot.id || model.providerId !== input.snapshot.providerId)) {
      throw new ProviderControlPlaneError("INVALID_REFERENCE", "Reference models must belong to the immutable snapshot and provider.");
    }
    return this.database.transaction(async (transaction) => {
      const snapshot = await this.appendInTransaction(transaction, {
        entityType: "CATALOG_SNAPSHOT", entityId: input.snapshot.id, commandId: `${input.commandId}:snapshot`,
        payload: input.snapshot, evidenceSha256: input.approvalEvidenceSha256, effectiveAt: input.effectiveAt,
      });
      const prepared: Array<{
        entityId: string; commandId: string; version: number; intentHash: string; evidenceSha256: string;
        effectiveAt: string; payload: Record<string, unknown>; createdAt: string;
      }> = [];
      for (const model of input.models) {
        assertSha256(model.sourceEvidenceSha256, "sourceEvidenceSha256");
        const commandId = `${input.commandId}:model:${model.id}`;
        const modelPayload = { ...model, snapshotApprovalEvidenceSha256: input.approvalEvidenceSha256 } as Record<string, unknown>;
        if (!model.id || model.id.length > 200 || commandId.length > 200) throw new TypeError("invalid_provider_control_identity");
        rejectSecret(modelPayload); validateEntityPayload("REFERENCE_MODEL", model.id, modelPayload);
        prepared.push({
          entityId: model.id, commandId, version: 0,
          intentHash: hash({ entityType: "REFERENCE_MODEL", entityId: model.id, payload: modelPayload, evidenceSha256: model.sourceEvidenceSha256, effectiveAt: input.effectiveAt }),
          evidenceSha256: model.sourceEvidenceSha256, effectiveAt: input.effectiveAt, payload: modelPayload, createdAt: this.now().toISOString(),
        });
      }

      // Large public catalogs must fit a serverless request. The generic
      // append path remains the authority for individual mutations; catalog
      // intake performs the same immutable writes and hash-chain append in
      // set-based SQL inside this single transaction.
      const entityRows = prepared.map((item) => ({ entity_id: item.entityId, created_at: item.createdAt }));
      const entityValues = entityRows.map((_, index) => {
        const offset = index * 2;
        return `($${offset + 1},$${offset + 2}::timestamptz)`;
      }).join(",");
      await transaction.query(
        `INSERT INTO fusion_engine.provider_control_entities(entity_type,entity_id,created_at)
         SELECT 'REFERENCE_MODEL',x.entity_id,x.created_at
         FROM (VALUES ${entityValues}) AS x(entity_id,created_at)
         ON CONFLICT(entity_type,entity_id) DO NOTHING`,
        entityRows.flatMap((row) => [row.entity_id, row.created_at]),
      );
      const locked = await transaction.query<{ entity_id: string; current_version: string | number | bigint }>(
        `SELECT entity_id,current_version FROM fusion_engine.provider_control_entities
         WHERE entity_type='REFERENCE_MODEL' AND entity_id=ANY($1::text[]) ORDER BY entity_id FOR UPDATE`,
        [prepared.map((item) => item.entityId)],
      );
      const versions = new Map(locked.rows.map((row) => [row.entity_id, Number(row.current_version) + 1]));
      if (versions.size !== prepared.length) throw new ProviderControlPlaneError("INVALID_REFERENCE", "Reference model entity preparation was incomplete.");
      for (const item of prepared) item.version = versions.get(item.entityId)!;
      const versionRows = prepared.map((item) => ({
        entity_id: item.entityId, version: item.version, command_id: item.commandId, intent_hash: item.intentHash,
        evidence_sha256: item.evidenceSha256, effective_at: item.effectiveAt, payload: item.payload, created_at: item.createdAt,
      }));
      const versionValues = versionRows.map((_, index) => {
        const offset = index * 8;
        return `($${offset + 1},$${offset + 2}::bigint,$${offset + 3},$${offset + 4}::char(64),$${offset + 5}::char(64),$${offset + 6}::timestamptz,$${offset + 7}::jsonb,$${offset + 8}::timestamptz)`;
      }).join(",");
      await transaction.query(
        `INSERT INTO fusion_engine.provider_control_versions
         (entity_type,entity_id,version,command_id,intent_hash,evidence_sha256,effective_at,payload,created_at)
         SELECT 'REFERENCE_MODEL',x.entity_id,x.version,x.command_id,x.intent_hash,x.evidence_sha256,x.effective_at,x.payload,x.created_at
         FROM (VALUES ${versionValues}) AS x(entity_id,version,command_id,intent_hash,evidence_sha256,effective_at,payload,created_at)`,
        versionRows.flatMap((row) => [
          row.entity_id, row.version, row.command_id, row.intent_hash, row.evidence_sha256,
          row.effective_at, JSON.stringify(row.payload), row.created_at,
        ]),
      );
      const pointerRows = versionRows.map(({ entity_id, version }) => ({ entity_id, version }));
      const pointerValues = pointerRows.map((_, index) => {
        const offset = index * 2;
        return `($${offset + 1},$${offset + 2}::bigint)`;
      }).join(",");
      await transaction.query(
        `UPDATE fusion_engine.provider_control_entities entity SET current_version=x.version
         FROM (VALUES ${pointerValues}) AS x(entity_id,version)
         WHERE entity.entity_type='REFERENCE_MODEL' AND entity.entity_id=x.entity_id`,
        pointerRows.flatMap((row) => [row.entity_id, row.version]),
      );

      const head = await transaction.query<{ last_sequence: string | number | bigint; last_hash: string }>(
        "SELECT last_sequence,last_hash FROM fusion_engine.provider_control_audit_head WHERE singleton=true FOR UPDATE",
      );
      if (!head.rows[0]) throw new Error("provider_control_audit_head_missing");
      let sequence = Number(head.rows[0].last_sequence);
      let previousHash = head.rows[0].last_hash;
      const auditRows = prepared.map((item) => {
        sequence += 1;
        const row = {
          sequence, command_id: item.commandId, action: "VERSION_APPENDED", entity_type: "REFERENCE_MODEL",
          entity_id: item.entityId, version: item.version, intent_hash: item.intentHash,
          previous_hash: previousHash, record_hash: "", occurred_at: item.createdAt,
        };
        row.record_hash = hash({ sequence, commandId: row.command_id, action: row.action, entityType: row.entity_type, entityId: row.entity_id, version: row.version, intentHash: row.intent_hash, previousHash, occurredAt: row.occurred_at });
        previousHash = row.record_hash;
        return row;
      });
      const auditValues = auditRows.map((_, index) => {
        const offset = index * 10;
        return `($${offset + 1}::bigint,$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6}::bigint,$${offset + 7}::char(64),$${offset + 8}::char(64),$${offset + 9}::char(64),$${offset + 10}::timestamptz)`;
      }).join(",");
      await transaction.query(
        `INSERT INTO fusion_engine.provider_control_audit
         (sequence,command_id,action,entity_type,entity_id,version,intent_hash,previous_hash,record_hash,occurred_at)
         SELECT x.sequence,x.command_id,x.action,x.entity_type,x.entity_id,x.version,x.intent_hash,x.previous_hash,x.record_hash,x.occurred_at
         FROM (VALUES ${auditValues}) AS x(sequence,command_id,action,entity_type,entity_id,version,intent_hash,previous_hash,record_hash,occurred_at)`,
        auditRows.flatMap((row) => [
          row.sequence, row.command_id, row.action, row.entity_type, row.entity_id,
          row.version, row.intent_hash, row.previous_hash, row.record_hash, row.occurred_at,
        ]),
      );
      await transaction.query("UPDATE fusion_engine.provider_control_audit_head SET last_sequence=$1,last_hash=$2 WHERE singleton=true", [sequence, previousHash]);

      const models: ImmutableVersion<Record<string, unknown>>[] = prepared.map((item) => ({
        id: `REFERENCE_MODEL:${item.entityId}:v${item.version}`, entityId: item.entityId, version: item.version,
        effectiveAt: new Date(item.effectiveAt).toISOString(), createdAt: new Date(item.createdAt).toISOString(),
        evidenceSha256: item.evidenceSha256, payload: structuredClone(item.payload),
      }));
      return { snapshot, models };
    });
  }

  async current<T>(entityType: ProviderControlEntityType, entityId: string): Promise<ImmutableVersion<T> | null> {
    const result = await this.database.query<Row>(
      `SELECT v.* FROM fusion_engine.provider_control_entities e
       JOIN fusion_engine.provider_control_versions v
         ON v.entity_type = e.entity_type AND v.entity_id = e.entity_id AND v.version = e.current_version
       WHERE e.entity_type = $1 AND e.entity_id = $2`,
      [entityType, entityId],
    );
    return result.rows[0] ? view<T>(result.rows[0]) : null;
  }

  async diff<T>(input: { entityType: ProviderControlEntityType; entityId: string; fromVersion: number; toVersion: number }): Promise<ControlPlaneDiff[]> {
    if (!Number.isSafeInteger(input.fromVersion) || !Number.isSafeInteger(input.toVersion) || input.fromVersion < 1 || input.toVersion < 1) throw new TypeError("invalid_control_plane_version");
    const result = await this.database.query<Row>(
      `SELECT * FROM fusion_engine.provider_control_versions
       WHERE entity_type = $1 AND entity_id = $2 AND version IN ($3, $4)`,
      [input.entityType, input.entityId, input.fromVersion, input.toVersion],
    );
    const before = result.rows.find((row) => Number(row.version) === input.fromVersion);
    const after = result.rows.find((row) => Number(row.version) === input.toVersion);
    if (!before || !after) throw new ProviderControlPlaneError("INVALID_REFERENCE", "Both immutable versions are required for a control-plane diff.");
    return diffValue(payload(before.payload), payload(after.payload));
  }

  /** Redacted Admin read model: immutable metadata only, no credential values. */
  async adminOverview(): Promise<{
    entities: Array<{ entityType: ProviderControlEntityType; entityId: string; currentVersion: number; updatedAt: string }>;
    publishedOffers: Array<{ offerId: string; offerVersion: number; releaseBundleId: string; publishedAt: string }>;
  }> {
    const [entities, offers] = await Promise.all([
      this.database.query<{ entity_type: ProviderControlEntityType; entity_id: string; current_version: string | number | bigint; created_at: string | Date }>(
        "SELECT entity_type, entity_id, current_version, created_at FROM fusion_engine.provider_control_entities ORDER BY entity_type, entity_id",
      ),
      this.database.query<{ offer_id: string; offer_version: string | number | bigint; release_bundle_id: string; published_at: string | Date }>(
        "SELECT offer_id, offer_version, release_bundle_id, published_at FROM fusion_engine.provider_published_offer_pointers ORDER BY offer_id",
      ),
    ]);
    return {
      entities: entities.rows.map((row) => ({ entityType: row.entity_type, entityId: row.entity_id, currentVersion: Number(row.current_version), updatedAt: iso(row.created_at) })),
      publishedOffers: offers.rows.map((row) => ({ offerId: row.offer_id, offerVersion: Number(row.offer_version), releaseBundleId: row.release_bundle_id, publishedAt: iso(row.published_at) })),
    };
  }

  private async validateReleaseDependencies(transaction: SqlExecutor, release: ReleaseBundle): Promise<void> {
    for (const entry of release.offers) {
      const route = await this.requireVersionPayload(transaction, "ROUTE_CANDIDATE", entry.routeCandidate.entityId, entry.routeCandidate.version);
      const routePayload = route as unknown as RouteCandidate;
      if (routePayload.state !== "CANARY_VALIDATED") {
        throw new ProviderControlPlaneError("RELEASE_BUNDLE_INVALID", `Route ${entry.routeCandidate.entityId} must be CANARY_VALIDATED before a release.`);
      }
      if (routePayload.adapterVersion !== entry.adapterVersion || routePayload.customerPriceVersionId !== entry.customerPriceVersionId) {
        throw new ProviderControlPlaneError("RELEASE_BUNDLE_INVALID", `Route ${entry.routeCandidate.entityId} does not match the frozen adapter or customer price.`);
      }
      const account = await this.requireCurrentPayload(transaction, "PROVIDER_ACCOUNT", routePayload.providerAccountId);
      if (account.state !== "CONNECTED" || account.credentialReferenceId !== entry.credentialReferenceId) {
        throw new ProviderControlPlaneError("RELEASE_BUNDLE_INVALID", `Provider account ${routePayload.providerAccountId} is not connected to the released credential reference.`);
      }
      const snapshot = await this.requireVersionPayload(transaction, "CATALOG_SNAPSHOT", entry.catalogSnapshot.entityId, entry.catalogSnapshot.version);
      if (snapshot.providerId !== routePayload.providerId) {
        throw new ProviderControlPlaneError("RELEASE_BUNDLE_INVALID", `Catalog snapshot ${entry.catalogSnapshot.entityId} belongs to a different provider.`);
      }
      const modelPayload = entry.referenceModel
        ? await this.requireVersionPayload(transaction, "REFERENCE_MODEL", entry.referenceModel.entityId, entry.referenceModel.version) as unknown as ReferenceModel
        : await this.latestReferenceModelForSnapshot(transaction, routePayload.referenceModelId, entry.catalogSnapshot.entityId);
      if (modelPayload.id !== routePayload.referenceModelId || modelPayload.catalogSnapshotId !== entry.catalogSnapshot.entityId) {
        throw new ProviderControlPlaneError("RELEASE_BUNDLE_INVALID", `Route ${entry.routeCandidate.entityId} is not anchored to the released reference model revision.`);
      }
      try {
        const commercialSnapshot = await new PostgresCommercialRegistryRepository(this.database, this.now).existsForRelease(transaction, {
          id: entry.commercialRegistrySnapshotId,
          version: entry.commercialRegistrySnapshotVersion,
          evidenceSha256: entry.commercialRegistryEvidenceSha256,
        });
        assertCommercialReleaseBinding({
          snapshot: commercialSnapshot,
          commercialRouteVersionId: entry.commercialRouteVersionId,
          familyVersionId: entry.familyVersionId,
          recipeVersionId: entry.recipeVersionId,
          customerPriceVersionId: entry.customerPriceVersionId,
          providerId: routePayload.providerId,
          providerAccountId: routePayload.providerAccountId,
          providerModelId: modelPayload.providerModelId,
          adapterVersion: entry.adapterVersion,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Commercial registry validation failed.";
        throw new ProviderControlPlaneError("RELEASE_BUNDLE_INVALID", `Release commercial binding is invalid: ${message}`);
      }
    }
  }

  private async requireVersionPayload(transaction: SqlExecutor, entityType: ProviderControlEntityType, entityId: string, version: number): Promise<Record<string, unknown>> {
    const result = await transaction.query<Row>(
      "SELECT * FROM fusion_engine.provider_control_versions WHERE entity_type = $1 AND entity_id = $2 AND version = $3 FOR UPDATE",
      [entityType, entityId, version],
    );
    if (!result.rows[0]) throw new ProviderControlPlaneError("RELEASE_BUNDLE_INVALID", `Released ${entityType} version ${entityId}@${version} does not exist.`);
    return payload(result.rows[0]!.payload);
  }

  private async readVersionPayload(entityType: ProviderControlEntityType, entityId: string, version: number): Promise<Record<string, unknown>> {
    const result = await this.database.query<Row>(
      "SELECT * FROM fusion_engine.provider_control_versions WHERE entity_type = $1 AND entity_id = $2 AND version = $3",
      [entityType, entityId, version],
    );
    if (!result.rows[0]) throw new ProviderControlPlaneError("PUBLISHED_OFFER_INVALID", `Released ${entityType} version ${entityId}@${version} no longer exists.`);
    return payload(result.rows[0]!.payload);
  }

  private async latestReferenceModelForSnapshot(database: SqlExecutor, referenceModelId: string, snapshotId: string): Promise<ReferenceModel> {
    const result = await database.query<Row>(
      `SELECT * FROM fusion_engine.provider_control_versions
       WHERE entity_type = 'REFERENCE_MODEL' AND entity_id = $1 AND payload ->> 'catalogSnapshotId' = $2
       ORDER BY version DESC LIMIT 1`,
      [referenceModelId, snapshotId],
    );
    if (!result.rows[0]) throw new ProviderControlPlaneError("PUBLISHED_OFFER_INVALID", `Reference model ${referenceModelId} is absent from the released catalog snapshot.`);
    return payload(result.rows[0]!.payload) as unknown as ReferenceModel;
  }

  private async referenceModelForReleaseEntry(route: RouteCandidate, releaseEntry: ReleaseBundleOffer): Promise<{ reference: ReferenceModel; isVersionPinned: boolean }> {
    if (releaseEntry.referenceModel) {
      const reference = await this.readVersionPayload("REFERENCE_MODEL", releaseEntry.referenceModel.entityId, releaseEntry.referenceModel.version) as unknown as ReferenceModel;
      if (reference.id !== route.referenceModelId || reference.catalogSnapshotId !== releaseEntry.catalogSnapshot.entityId) {
        throw new ProviderControlPlaneError("PUBLISHED_OFFER_INVALID", `Released route ${route.id} is not anchored to its pinned reference model revision.`);
      }
      return { reference, isVersionPinned: true };
    }
    return { reference: await this.latestReferenceModelForSnapshot(this.database, route.referenceModelId, releaseEntry.catalogSnapshot.entityId), isVersionPinned: false };
  }

  private async requireCurrentPayload(transaction: SqlExecutor, entityType: ProviderControlEntityType, entityId: string): Promise<Record<string, unknown>> {
    const result = await transaction.query<Row>(
      `SELECT v.* FROM fusion_engine.provider_control_entities e
       JOIN fusion_engine.provider_control_versions v
         ON v.entity_type = e.entity_type AND v.entity_id = e.entity_id AND v.version = e.current_version
       WHERE e.entity_type = $1 AND e.entity_id = $2 FOR UPDATE`,
      [entityType, entityId],
    );
    if (!result.rows[0]) throw new ProviderControlPlaneError("RELEASE_BUNDLE_INVALID", `Released ${entityType} ${entityId} does not exist.`);
    return payload(result.rows[0]!.payload);
  }

  private async appendInTransaction<T>(transaction: SqlExecutor, input: VersionInput<T>): Promise<ImmutableVersion<T>> {
    if (!input.entityId || input.entityId.length > 200 || !input.commandId || input.commandId.length < 8) throw new TypeError("invalid_provider_control_identity");
    assertSha256(input.evidenceSha256); rejectSecret(input.payload); validateEntityPayload(input.entityType, input.entityId, input.payload);
    const intentHash = hash({ entityType: input.entityType, entityId: input.entityId, payload: input.payload, evidenceSha256: input.evidenceSha256, effectiveAt: input.effectiveAt });
      const replay = await transaction.query<Row>("SELECT * FROM fusion_engine.provider_control_versions WHERE command_id = $1 FOR UPDATE", [input.commandId]);
      if (replay.rows[0]) {
        if (replay.rows[0].intent_hash !== intentHash) throw new ProviderControlPlaneError("IMMUTABLE_VERSION", "Command id is bound to a different control-plane intent.");
        return view<T>(replay.rows[0]);
      }
      await transaction.query(
        `INSERT INTO fusion_engine.provider_control_entities (entity_type, entity_id, created_at)
         VALUES ($1, $2, $3) ON CONFLICT (entity_type, entity_id) DO NOTHING`,
        [input.entityType, input.entityId, this.now().toISOString()],
      );
      const entity = await transaction.query<{ current_version: string | number | bigint }>(
        `SELECT current_version FROM fusion_engine.provider_control_entities
         WHERE entity_type = $1 AND entity_id = $2 FOR UPDATE`, [input.entityType, input.entityId],
      );
      const version = Number(entity.rows[0]!.current_version) + 1;
      const createdAt = this.now().toISOString();
      const inserted = await transaction.query<Row>(
        `INSERT INTO fusion_engine.provider_control_versions
         (entity_type, entity_id, version, command_id, intent_hash, evidence_sha256, effective_at, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) RETURNING *`,
        [input.entityType, input.entityId, version, input.commandId, intentHash, input.evidenceSha256, input.effectiveAt, JSON.stringify(input.payload), createdAt],
      );
      await transaction.query(
        `UPDATE fusion_engine.provider_control_entities SET current_version = $3
         WHERE entity_type = $1 AND entity_id = $2`, [input.entityType, input.entityId, version],
      );
      await this.appendAudit(transaction, {
        commandId: input.commandId,
        action: "VERSION_APPENDED",
        entityType: input.entityType,
        entityId: input.entityId,
        version,
        intentHash,
        occurredAt: createdAt,
      });
      return view<T>(inserted.rows[0]!);
  }

  async verifyAuditChain(): Promise<boolean> {
    const result = await this.database.query<{
      sequence: string | number | bigint; command_id: string; action: string; entity_type: string; entity_id: string; version: string | number | bigint;
      intent_hash: string; previous_hash: string; record_hash: string; occurred_at: string | Date;
    }>("SELECT * FROM fusion_engine.provider_control_audit ORDER BY sequence");
    let previous = "0".repeat(64);
    for (const [index, row] of result.rows.entries()) {
      if (Number(row.sequence) !== index + 1) return false;
      if (row.previous_hash !== previous) return false;
      const expected = hash({ sequence: Number(row.sequence), commandId: row.command_id, action: row.action, entityType: row.entity_type, entityId: row.entity_id, version: Number(row.version), intentHash: row.intent_hash, previousHash: previous, occurredAt: iso(row.occurred_at) });
      if (expected !== row.record_hash) return false;
      previous = row.record_hash;
    }
    const head = await this.database.query<{ last_sequence: string | number | bigint; last_hash: string }>(
      "SELECT last_sequence, last_hash FROM fusion_engine.provider_control_audit_head WHERE singleton = true",
    );
    return head.rows.length === 1
      && Number(head.rows[0]!.last_sequence) === result.rows.length
      && head.rows[0]!.last_hash === previous;
  }

  private async appendAudit(transaction: SqlExecutor, input: {
    commandId: string; action: string; entityType: string; entityId: string; version: number; intentHash: string; occurredAt: string;
  }): Promise<void> {
    const existing = await transaction.query<{
      action: string; entity_type: string; entity_id: string; version: string | number | bigint; intent_hash: string;
    }>("SELECT action, entity_type, entity_id, version, intent_hash FROM fusion_engine.provider_control_audit WHERE command_id = $1 FOR UPDATE", [input.commandId]);
    if (existing.rows[0]) {
      const prior = existing.rows[0];
      if (prior.action !== input.action || prior.entity_type !== input.entityType || prior.entity_id !== input.entityId
        || Number(prior.version) !== input.version || prior.intent_hash !== input.intentHash) {
        throw new ProviderControlPlaneError("IMMUTABLE_VERSION", "Audit command id is bound to a different release intent.");
      }
      return;
    }
    const head = await transaction.query<{ last_sequence: string | number | bigint; last_hash: string }>(
      `SELECT last_sequence, last_hash FROM fusion_engine.provider_control_audit_head
       WHERE singleton = true FOR UPDATE`,
    );
    if (!head.rows[0]) throw new Error("provider_control_audit_head_missing");
    const sequence = Number(head.rows[0].last_sequence) + 1;
    const previousHash = head.rows[0].last_hash;
    const recordHash = hash({ sequence, commandId: input.commandId, action: input.action, entityType: input.entityType, entityId: input.entityId, version: input.version, intentHash: input.intentHash, previousHash, occurredAt: input.occurredAt });
    await transaction.query(
      `INSERT INTO fusion_engine.provider_control_audit
       (sequence, command_id, action, entity_type, entity_id, version, intent_hash, previous_hash, record_hash, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [sequence, input.commandId, input.action, input.entityType, input.entityId, input.version, input.intentHash, previousHash, recordHash, input.occurredAt],
    );
    await transaction.query(
      `UPDATE fusion_engine.provider_control_audit_head
       SET last_sequence = $2, last_hash = $3 WHERE singleton = $1`,
      [true, sequence, recordHash],
    );
  }
}
