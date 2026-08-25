import { z } from "zod";

/**
 * Server-controlled provider catalog contract.
 *
 * A route is deliberately a composition, rather than a model record with a
 * provider name attached: one canonical model can have several provider
 * models and one provider model can expose several billable endpoints.
 * Nothing in this contract contains a credential or authorizes a network call.
 */

const IdentifierSchema = z.string().min(1).max(200).regex(
  /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
  "catalog identifiers must be stable machine identifiers",
);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "expected SHA-256 hex");
const AtomicAmountSchema = z.string().regex(/^(0|[1-9][0-9]*)$/, "expected unsigned atomic amount");

export const CatalogScopeSchema = z.enum(["LOCAL_TEST_ONLY", "PRODUCTION"]);
export const ProviderProtocolSchema = z.enum(["CHAT", "IMAGE", "VIDEO", "TTS", "STT", "MARKET_JOB"]);
export const CatalogMediaTypeSchema = z.enum(["image", "video", "audio", "text"]);
export const RouteLifecycleSchema = z.enum([
  "DRAFT",
  "VALIDATED",
  "CANARY",
  "CERTIFIED",
  "PUBLISHED",
  "SUSPENDED",
  "RETIRED",
]);

export const PublisherSchema = z.object({
  id: IdentifierSchema,
  displayName: z.string().min(1).max(160),
}).strict();

export const ModelFamilySchema = z.object({
  id: IdentifierSchema,
  publisherId: IdentifierSchema,
  displayName: z.string().min(1).max(160),
  mediaType: CatalogMediaTypeSchema,
}).strict();

export const CanonicalModelSchema = z.object({
  id: IdentifierSchema,
  familyId: IdentifierSchema,
  displayName: z.string().min(1).max(160),
}).strict();

export const ProviderAccountSchema = z.object({
  id: IdentifierSchema,
  providerId: IdentifierSchema,
  scope: CatalogScopeSchema,
  displayName: z.string().min(1).max(160),
  credentialReference: IdentifierSchema,
}).strict();

export const ProviderModelBindingSchema = z.object({
  id: IdentifierSchema,
  providerId: IdentifierSchema,
  canonicalModelId: IdentifierSchema,
  providerModelId: z.string().min(1).max(300),
  metadataVersion: z.string().min(1).max(80),
}).strict();

export const HostingProviderEndpointSchema = z.object({
  id: IdentifierSchema,
  providerId: IdentifierSchema,
  providerModelBindingId: IdentifierSchema,
  hostingProviderId: IdentifierSchema,
  endpointReference: IdentifierSchema,
  region: z.string().min(1).max(80).optional(),
}).strict();

export const RouteCapabilitySchema = z.object({
  mediaType: CatalogMediaTypeSchema,
  capabilityVersion: z.string().min(1).max(80),
  inputSchemaVersion: z.string().min(1).max(80),
  outputSchemaVersion: z.string().min(1).max(80),
  supportsAsync: z.boolean(),
  supportsWebhook: z.boolean(),
}).strict();

export const ProviderCostGuardSchema = z.object({
  kind: z.enum([
    "PROVIDER_MAX_PRICE",
    "PINNED_ENDPOINT_MAX",
    "INTERNAL_CERTIFIED_MAX",
    "UNSUPPORTED",
  ]),
  maximumNativeAtomic: AtomicAmountSchema.optional(),
  reason: z.string().min(1).max(500),
}).strict().superRefine((value, context) => {
  const requiresMaximum = value.kind !== "UNSUPPORTED";
  if (requiresMaximum && !value.maximumNativeAtomic) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["maximumNativeAtomic"], message: "cost guard maximum is required" });
  }
  if (!requiresMaximum && value.maximumNativeAtomic) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["maximumNativeAtomic"], message: "unsupported routes cannot declare a maximum" });
  }
});

export const CatalogSourceSnapshotSchema = z.object({
  id: IdentifierSchema,
  sourceUrl: z.string().url(),
  observedAt: z.string().datetime({ offset: true }),
  rawPayloadSha256: Sha256Schema,
  parserVersion: z.string().min(1).max(80),
}).strict();

export const ProviderCostVersionSchema = z.object({
  id: IdentifierSchema,
  version: z.string().min(1).max(80),
  pricingKind: z.enum(["STATIC", "DIMENSIONAL", "METERED", "UNKNOWN"]),
  nativeUnit: z.string().min(1).max(80),
  nativeScale: AtomicAmountSchema,
  sourceSnapshotId: IdentifierSchema,
  effectiveAt: z.string().datetime({ offset: true }),
}).strict();

export const RouteCertificationSchema = z.object({
  lifecycle: RouteLifecycleSchema,
  scope: CatalogScopeSchema,
  evidenceSha256: Sha256Schema.optional(),
  certifiedAt: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((value, context) => {
  if (value.lifecycle === "PUBLISHED" && value.scope !== "PRODUCTION") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scope"], message: "published routes require production scope" });
  }
  if (["CANARY", "CERTIFIED", "PUBLISHED"].includes(value.lifecycle) && !value.evidenceSha256) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["evidenceSha256"], message: "route evidence is required" });
  }
  if (["CERTIFIED", "PUBLISHED"].includes(value.lifecycle) && !value.certifiedAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["certifiedAt"], message: "certification timestamp is required" });
  }
});

export const ProviderRouteManifestSchema = z.object({
  routeId: IdentifierSchema,
  providerId: IdentifierSchema,
  protocol: ProviderProtocolSchema,
  publisher: PublisherSchema,
  modelFamily: ModelFamilySchema,
  canonicalModel: CanonicalModelSchema,
  providerAccount: ProviderAccountSchema,
  providerModel: ProviderModelBindingSchema,
  hostingEndpoint: HostingProviderEndpointSchema,
  capability: RouteCapabilitySchema,
  sourceSnapshot: CatalogSourceSnapshotSchema,
  providerCostVersion: ProviderCostVersionSchema,
  costGuard: ProviderCostGuardSchema,
  usageExtractorVersion: z.string().min(1).max(80),
  certification: RouteCertificationSchema,
}).strict().superRefine((value, context) => {
  const mismatch = (path: string[], message: string) => context.addIssue({ code: z.ZodIssueCode.custom, path, message });
  if (value.modelFamily.publisherId !== value.publisher.id) mismatch(["modelFamily", "publisherId"], "family must belong to the route publisher");
  if (value.canonicalModel.familyId !== value.modelFamily.id) mismatch(["canonicalModel", "familyId"], "canonical model must belong to the route family");
  if (value.providerAccount.providerId !== value.providerId) mismatch(["providerAccount", "providerId"], "account must belong to the route provider");
  if (value.providerModel.providerId !== value.providerId) mismatch(["providerModel", "providerId"], "provider model must belong to the route provider");
  if (value.providerModel.canonicalModelId !== value.canonicalModel.id) mismatch(["providerModel", "canonicalModelId"], "provider model must bind the canonical model");
  if (value.hostingEndpoint.providerId !== value.providerId) mismatch(["hostingEndpoint", "providerId"], "endpoint must belong to the route provider");
  if (value.hostingEndpoint.providerModelBindingId !== value.providerModel.id) mismatch(["hostingEndpoint", "providerModelBindingId"], "endpoint must bind the route provider model");
  if (value.sourceSnapshot.id !== value.providerCostVersion.sourceSnapshotId) mismatch(["providerCostVersion", "sourceSnapshotId"], "cost version must reference the route source snapshot");
  if (value.capability.mediaType !== value.modelFamily.mediaType) mismatch(["capability", "mediaType"], "capability must match the model family media type");
});

export type ProviderRouteManifest = z.infer<typeof ProviderRouteManifestSchema>;
export type RouteLifecycle = z.infer<typeof RouteLifecycleSchema>;
export type CatalogScope = z.infer<typeof CatalogScopeSchema>;

/** In-memory reference registry. Durable catalog storage is deliberately a later gate. */
export class ProviderRouteCatalog {
  private readonly routes = new Map<string, ProviderRouteManifest>();

  register(input: ProviderRouteManifest): ProviderRouteManifest {
    const route = ProviderRouteManifestSchema.parse(input);
    if (this.routes.has(route.routeId)) throw new Error(`provider_route_already_registered:${route.routeId}`);
    this.routes.set(route.routeId, route);
    return route;
  }

  require(routeId: string): ProviderRouteManifest {
    const route = this.routes.get(routeId);
    if (!route) throw new Error(`provider_route_not_registered:${routeId}`);
    return route;
  }

  list(filter: { providerId?: string; scope?: CatalogScope; publishedOnly?: boolean } = {}): ProviderRouteManifest[] {
    return [...this.routes.values()].filter((route) => (
      (!filter.providerId || route.providerId === filter.providerId)
      && (!filter.scope || route.certification.scope === filter.scope)
      && (!filter.publishedOnly || route.certification.lifecycle === "PUBLISHED")
    ));
  }

  requirePublished(routeId: string): ProviderRouteManifest {
    const route = this.require(routeId);
    if (route.certification.lifecycle !== "PUBLISHED" || route.certification.scope !== "PRODUCTION") {
      throw new Error(`provider_route_not_published:${routeId}`);
    }
    return route;
  }
}
