export type Rational = { numerator: bigint; denominator: bigint };

export type BillingFormula =
  | { kind: "per_generation"; units: Rational }
  | { kind: "per_image"; unitsPerImage: Rational }
  | {
      kind: "per_output_second";
      unitsPerSecond: Rational;
      resolutionMultipliers: Record<string, Rational>;
      audioAddonPerGeneration: Rational;
    }
  | { kind: "per_character_block"; blockSize: bigint; unitsPerBlock: Rational };

export type VersionLifecycle =
  | "DRAFT"
  | "VALIDATED"
  | "CANARY"
  | "CERTIFIED"
  | "PUBLISHED"
  | "SUSPENDED"
  | "RETIRED";

export type ModelFamilyVersion = {
  id: string;
  familyId: string;
  version: number;
  displayName: string;
  mediaType: "image" | "video" | "audio";
  lifecycle: VersionLifecycle;
};

export type RecipeVersion = {
  id: string;
  recipeId: string;
  version: number;
  product: string;
  familyVersionIds: string[];
  lifecycle: VersionLifecycle;
};

/**
 * Customer-safe, immutable UI/input profile released alongside a route
 * capability.  It is a protocol-neutral contract: the Admin may map a KIE,
 * OpenRouter, or future provider model to it, but the browser cannot invent
 * a control absent from this version.
 */
export type PublishedCapabilityControl = {
  id: string;
  kind: "enum" | "number" | "boolean";
  defaultValue: string | number | boolean;
  values?: Array<string | number | boolean>;
  min?: number;
  max?: number;
  step?: number;
  /** Protocol-neutral UI metadata. The browser renders this contract and
   * never branches on a provider model ID. */
  ui?: {
    labelKey: string;
    group: "BASIC" | "ADVANCED";
    order: number;
  };
  /** Conditions may reference only an earlier control in the same recipe,
   * which makes evaluation deterministic and cycle-free. */
  visibleWhen?: {
    controlId: string;
    operator: "EQUALS" | "NOT_EQUALS" | "IN";
    value: string | number | boolean | Array<string | number | boolean>;
  };
};

export type PublishedRecipeCapability = {
  recipeId: string;
  prompt: { required: boolean; maxLength: number; visible: boolean };
  /** Exact customer input contract. A single slot may be repeatable up to max
   * (for example REFERENCE), while distinct slots retain their media types. */
  bindings: {
    min: number;
    max: number;
    roles: string[];
    slots?: Array<{ role: string; kind: "IMAGE" | "VIDEO" | "AUDIO"; required: boolean }>;
  };
  controls: PublishedCapabilityControl[];
};

export type PublishedCapabilityControlSchema = {
  version: string;
  recipes: PublishedRecipeCapability[];
};

export type RouteCapabilityVersion = {
  id: string;
  version: number;
  mediaType: "image" | "video" | "audio";
  inputModes: Array<"text" | "image" | "audio">;
  semanticSlots: string[];
  maxReferences: number;
  resolutions: string[];
  durationSeconds: { min: number; max: number } | null;
  characterCount: { min: number; max: number } | null;
  supportsAudio: boolean;
  outputHasAudio: boolean;
  /** Required before a route can be made customer-visible. */
  controlSchema?: PublishedCapabilityControlSchema;
  lifecycle: VersionLifecycle;
};

export type RouteBillingManifestVersion = {
  id: string;
  version: number;
  nativeUnit: string;
  nativeScale: bigint;
  formula: BillingFormula;
  actualUsageExtractor: string;
  failureChargePolicy: "NO_CHARGE_CONFIRMED_ONLY" | "MAY_CHARGE";
  lifecycle: VersionLifecycle;
};

export type ProviderCostVersion = {
  id: string;
  version: number;
  status: "DRAFT" | "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN" | "PROMOTIONAL";
  nativeUnitReplacementCostMicrousd: bigint;
  riskBufferBps: bigint;
  maximumCostMultiplierBps: bigint;
  source: {
    url: string;
    snapshotHash: string;
    capturedAt: string;
    validUntil: string;
  };
};

export type CustomerPriceVersion = {
  id: string;
  version: number;
  policy: "manual_credits" | "target_margin" | "higher_of_manual_and_target";
  manualCredits: bigint | null;
  targetContributionMarginBps: bigint;
  hardFloorMarginBps: bigint;
  creditValueFloorMicrousd: bigint;
  allowedCreditStep: bigint;
  minimumChargeCredits: bigint;
  variablePlatformCostMicrousd: bigint;
  lifecycle: "DRAFT" | "PUBLISHED" | "RETIRED";
};

export type RoutingPolicyVersion = {
  id: string;
  version: number;
  mode: "exact" | "smart";
  allowStaleCost: boolean;
  staleRiskBufferBps: bigint;
  lifecycle: "DRAFT" | "PUBLISHED" | "RETIRED";
};

export type ProviderRouteVersion = {
  id: string;
  routeId: string;
  version: number;
  providerId: string;
  providerAccountId: string;
  providerModelId: string;
  familyVersionId: string;
  capabilityVersionId: string;
  billingManifestVersionId: string;
  costVersionId: string;
  adapterVersion: string;
  privacy: {
    retention: "NONE" | "LIMITED";
    dataRegion: string;
    allowsTraining: false;
  };
  certification: {
    scope: "LOCAL_TEST_ONLY" | "PRODUCTION";
    owner: string;
    canaryEvidenceId: string;
    capabilityContract: boolean;
    goldenBilling: boolean;
    actualCostExtraction: boolean;
    resultIngest: boolean;
    failureRefund: boolean;
    privacyReview: boolean;
    marginShock: boolean;
  };
  killSwitch: { enabled: boolean; reasonCode: string | null };
  lifecycle: VersionLifecycle;
};

export type CommercialRegistrySnapshot = {
  id: string;
  version: number;
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
  createdAt: string;
  families: ModelFamilyVersion[];
  recipes: RecipeVersion[];
  capabilities: RouteCapabilityVersion[];
  billingManifests: RouteBillingManifestVersion[];
  costVersions: ProviderCostVersion[];
  customerPriceVersions: CustomerPriceVersion[];
  routingPolicyVersions: RoutingPolicyVersion[];
  routes: ProviderRouteVersion[];
};

export type CommercialQuoteInput = {
  projectId: string;
  product: string;
  mode: "exact" | "smart";
  familyVersionId: string;
  quantity: number;
  durationSeconds?: number;
  characterCount?: number;
  resolution: string;
  audio: boolean;
  referenceCount: number;
};

export type CommercialQuote = {
  id: string;
  registrySnapshotId: string;
  requestHash: string;
  createdAt: string;
  expiresAt: string;
  customerCredits: bigint;
  discountCredits: bigint;
  replacementCostMicrousd: bigint;
  conservativeCostMicrousd: bigint;
  providerAtomicUnits: bigint;
  quotedGrossMarginBps: bigint;
  mode: "exact" | "smart";
  pins: {
    recipeVersionId: string;
    familyVersionId: string;
    routeVersionId: string;
    capabilityVersionId: string;
    billingManifestVersionId: string;
    costVersionId: string;
    customerPriceVersionId: string;
    routingPolicyVersionId: string;
    adapterVersion: string;
  };
  internalRoute: {
    providerId: string;
    providerAccountId: string;
    providerModelId: string;
  };
};

/**
 * An approval-time input, deliberately separate from a customer request.  It
 * lets Finance prove the consequences of a candidate commercial snapshot
 * before the snapshot is made active for customers.
 */
export type PricingSimulationScenario = {
  id: string;
  label: string;
  required: boolean;
  input: CommercialQuoteInput;
};

export type PricingSimulationResult = {
  scenarioId: string;
  label: string;
  required: boolean;
  outcome: "QUOTED" | "REJECTED";
  rejectionCode: CommercialEngineError["code"] | "UNEXPECTED_ERROR" | null;
  quote: Pick<CommercialQuote,
    "customerCredits"
    | "replacementCostMicrousd"
    | "conservativeCostMicrousd"
    | "providerAtomicUnits"
    | "quotedGrossMarginBps"
    | "mode"
    | "pins"
  > | null;
};

export type PricingSimulationReport = {
  id: string;
  candidateSnapshotId: string;
  candidateSnapshotVersion: number;
  generatedAt: string;
  evidenceHash: string;
  eligibleForApproval: boolean;
  summary: {
    totalScenarios: number;
    requiredScenarios: number;
    quotedScenarios: number;
    rejectedScenarios: number;
    minimumQuotedMarginBps: bigint | null;
    maximumCustomerCredits: bigint | null;
  };
  results: PricingSimulationResult[];
};

export class CommercialEngineError extends Error {
  constructor(
    public readonly code:
      | "DUPLICATE_REGISTRY_SNAPSHOT"
      | "INVALID_REGISTRY_REFERENCE"
      | "UNCERTIFIED_PUBLISHED_ROUTE"
      | "REGISTRY_NOT_PUBLISHED"
      | "NO_ACTIVE_REGISTRY"
      | "FAMILY_NOT_AVAILABLE"
      | "RECIPE_NOT_AVAILABLE"
      | "CAPABILITY_MISMATCH"
      | "NO_CERTIFIED_ROUTE"
      | "ROUTE_SELECTION_REQUIRED"
      | "COST_NOT_USABLE"
      | "UNKNOWN_BILLING_FORMULA"
      | "INVALID_RATIONAL"
      | "INVALID_PRICE_POLICY"
      | "MARGIN_FLOOR_VIOLATION"
      | "INVALID_PRICING_SIMULATION",
    message: string,
  ) {
    super(message);
    this.name = "CommercialEngineError";
  }
}
