import { supabase } from "@/integrations/supabase/client";

export type AdminChangeState = "DRAFT" | "VALIDATED" | "SIMULATED" | "APPROVED" | "PUBLISHED" | "REJECTED";

export type AdminChange = {
  id: string;
  resourceType: string;
  resourceId: string;
  version: number;
  state: AdminChangeState;
  payload: Record<string, unknown>;
  makerId: string;
  validatorId: string | null;
  simulatorId: string | null;
  approverId: string | null;
  publisherId: string | null;
  reasonCode: string;
  createdAt: string;
  updatedAt: string;
  validationEvidenceHash: string | null;
  simulationEvidenceHash: string | null;
  approvalEvidenceHash: string | null;
};

export type AdminAuditRecord = {
  sequence: number;
  id: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  versionId: string;
  commandHash: string;
  previousHash: string;
  recordHash: string;
  occurredAt: string;
};

export type AdminApprovalInboxItem = {
  changeId: string;
  resourceType: string;
  resourceId: string;
  version: number;
  state: AdminChangeState;
  makerId: string;
  reasonCode: string;
  updatedAt: string;
  nextAction: "VALIDATE" | "SIMULATE" | "APPROVE" | "PUBLISH";
  requiredRoles: string[];
  makerCheckerRequired: boolean;
};
export type AdminWorkflowPolicy = {
  resourceType: "PRICING_POLICY" | "ROUTE_CONTROL" | "TREASURY_POLICY" | "PROVIDER_CREDENTIAL" | "FINANCIAL_ADJUSTMENT" | "USER_ANONYMIZATION" | "CATALOG_SNAPSHOT" | "REFERENCE_CATALOG_SNAPSHOT";
  makerRoles: string[];
  validatorRoles: string[];
  simulatorRoles: string[];
  approverRoles: string[];
  publisherRoles: string[];
};

export type AdminCapabilities = {
  session: {
    actorId: string | null;
    roles: string[];
    assuranceLevel: 1 | 2;
    mode: "LOCAL_VIEWER" | "AUTHORIZED_ADMIN" | "UNAUTHENTICATED";
  };
  permissions: {
    read: boolean;
    providerCredentials: {
      write: boolean;
      test: boolean;
      activate: boolean;
      revoke: boolean;
    };
    catalog: { import: boolean; select: boolean };
    pricing: { sync: boolean; configure: boolean };
  };
  safeguards: {
    secretValuesReadableInBrowser: false;
    providerCallsTriggeredByPageLoad: false;
    makerCheckerRequiredForCredentialActivation: boolean;
    superAdminSelfActivationAllowed: boolean;
  };
};

export type CatalogSnapshot = {
  snapshotId: string;
  providerId: string;
  scope: string;
  sourceLabel: string;
  observedAt: string;
  rawPayloadSha256: string;
  manifestSha256: string;
  diffSha256: string;
  parserVersion: string;
  routeCount: number;
  diff: { added: number; changed: number; removed: number };
  change: { id: string; state: AdminChangeState } | null;
};
export type ReferenceCatalogSnapshot = {
  snapshotId: string;
  providerId: string;
  observedAt: string;
  parserVersion: string;
  sourceUrls: string[];
  rawPayloadSha256: string;
  manifestSha256: string;
  diffSha256: string;
  modelCount: number;
  diff: { added: number; changed: number; removed: number };
  change: { id: string; state: AdminChangeState } | null;
};
export type ReferenceCatalogModel = {
  providerId: string;
  snapshotId: string;
  observedAt: string;
  snapshotChangeState: AdminChangeState | null;
  id: string;
  providerModelId: string;
  displayName: string;
  familyId: string;
  modalities: string[];
  supportedParameters: string[];
  sourceUrls: string[];
  taxonomyHint?: unknown | null;
  reviewedTaxonomy?: {
    schemaVersion: 1;
    reviewState: "REVIEWED";
    sourceCatalogSnapshotId: string;
    productFamily: { id: string; displayName: string };
    version?: { id: string; displayName: string };
    edition?: { id: string; displayName: string };
    experienceCategories: Array<"IMAGE" | "VIDEO" | "AVATAR" | "AUDIO">;
  } | null;
  state: "REFERENCE_ACTIVE";
  selectionState: "SELECTED" | "UNSELECTED";
  selectionVersion: number;
};

export type CredentialMetadata = {
  id: string;
  providerId: string;
  accountId: string;
  environment: string;
  fingerprint: string;
  version: number;
  status: string;
  purpose?: string;
  createdAt?: string;
  testedAt?: string | null;
  activatedAt?: string | null;
  revokedAt?: string | null;
};

export type AdminOverview = {
  mode: string;
  legacyMutationPolicy: string;
  stateCounts: Record<AdminChangeState, number>;
  runtime: { routeControls: Array<{ resourceId: string; versionId: string; payload: Record<string, unknown> }> };
  treasury: { treasury: { state: string; confirmedRemainingAtomic: string; shadowAvailableAtomic: string } };
  reconciliation: { reconciliationRateBps: number; targetMet: boolean; issues: unknown[] };
  audit: { records: number; chainValid: boolean };
};

export type DurableAdminOverview = {
  enabled: boolean;
  runtime?: { database: string; worker: string; lastErrorCode: string | null; operations: Record<string, number>; outbox: Record<string, number> };
  audit?: {
    operationCounts: Record<string, number>;
    holds: Array<{ operationId: string; ownerId: string; state: string; heldCredits: number; quotedCredits: number; updatedAt: string }>;
    reconciliations: Array<{ operationId: string; ownerId: string; stateVersion: number; updatedAt: string }>;
    providerCostOutcomes: Array<{ operationId: string; providerId: string; providerCredits: number; disposition: "DELIVERED" | "LOSS"; recordedAt: string }>;
  };
};
export type CommerceAdminOverview = {
  enabled: boolean;
  sandboxOnly?: boolean;
  paymentProvider?: string;
  products?: Array<{ id: string; version: number; kind: "CREDIT_PACK" | "SUBSCRIPTION"; displayName: string; grantedCredits: number; amountMinor: string; currency: string; planVersionId: string | null }>;
  plans?: Array<{ id: string; planKey: string; version: number; lifecycle: "INTERNAL_TEST" | "PUBLISHED" | "RETIRED"; displayName: string; amountMinor: string; currency: string; interval: "MONTH" | "YEAR"; creditsPerPeriod: number; termsVersion: string }>;
  subscriptions?: Array<{ id: string; ownerId: string; ownerEmail: string | null; ownerDisplayName: string | null; state: "ACTIVE" | "EXPIRED" | "CANCELLED"; planVersionId: string; planKey: string; displayName: string; creditsPerPeriod: number; currentPeriodStart: string; currentPeriodEnd: string; wallet: { availableCredits: number; heldCredits: number; spentCredits: number } | null }>;
  activationKeys?: Array<{ id: string; keyHint: string; planVersionId: string; planKey: string; displayName: string; interval: "MONTH" | "YEAR"; creditsPerPeriod: number; state: "ISSUED" | "REDEEMED" | "REVOKED" | "EXPIRED"; createdAt: string; expiresAt: string; redeemedAt: string | null; revokedAt: string | null; redeemedBy: string | null; redeemedByEmail: string | null }>;
  activity?: { checkoutsByState: Record<string, number>; subscriptionsByState: Record<string, number>; invoicesByState: Record<string, number>; reversalsByKind: Record<string, number> };
  reconciliation?: { issueCount: number; targetMet: boolean; localImplementationDecision: string; formalGateDecision: string };
};

export type DurableOperationHistory = {
  operation: { id: string; owner_id: string; state: string; state_version: number | string; customer_credits: number | string; created_at: string; updated_at: string };
  events: Array<{ sequence: number | string; state: string; state_version: number | string; event_name: string; occurred_at: string }>;
  attempts: Array<{ attempt_number: number | string; provider_id: string; state: string; provider_task_id?: string | null; actual_provider_credits?: number | string | null; charge_status?: string | null; last_error_code?: string | null }>;
  reservation: { state: string; held_credits: number | string; captured_credits: number | string; released_credits: number | string } | null;
  providerCostOutcome: { provider_id: string; provider_credits: number | string; disposition: string; recorded_at: string } | null;
  journals: Array<{ id: string; kind: string; reason_code: string; created_at: string; entries: Array<{ accountId: string; amount: number | string }> }>;
};

export type DurableOperationListItem = {
  operationId: string;
  ownerId: string;
  state: string;
  stateVersion: number;
  customerCredits: number;
  providerId: string | null;
  reservation: { state: string; heldCredits: number; capturedCredits: number; releasedCredits: number } | null;
  providerCost: { credits: number; disposition: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type DurableOperationException = {
  operationId: string;
  ownerId: string;
  state: string;
  category: "RECONCILIATION_REQUIRED" | "SUBMISSION_UNKNOWN" | "OUTBOX_DEAD_LETTER" | "PROVIDER_SUCCESS_EVIDENCE_INCOMPLETE" | "PROVIDER_SUCCESS_RESULT_MISSING" | "REFUND_EVIDENCE_REQUIRED" | "DELIVERY_EVIDENCE_REQUIRED";
  severity: "HIGH" | "CRITICAL";
  reason: string;
  updatedAt: string;
};

export type DurableOwnerDirectoryItem = {
  ownerId: string;
  wallet: { availableCredits: number; heldCredits: number; spentCredits: number } | null;
  operationCount: number;
  activeOperationCount: number;
  lastActivityAt: string;
};

export type ProductionCustomerDirectoryItem = {
  ownerId: string;
  email: string | null;
  displayName: string | null;
  authProvider: string | null;
  lifecycle: "ACTIVE" | "PENDING" | "BANNED";
  createdAt: string | null;
  lastSignInAt: string | null;
  wallet: { availableCredits: number; heldCredits: number; spentCredits: number } | null;
  subscription: null | { id: string; state: string; planKey: string; displayName: string; currentPeriodEnd: string };
  operationCount: number;
  activeOperationCount: number;
  lastActivityAt: string | null;
};

export type ProductionCustomerDetail = {
  ownerId: string;
  profile: null | {
    id: string;
    email: string | null;
    displayName: string | null;
    createdAt: string;
    lastSignInAt: string | null;
    confirmedAt: string | null;
    bannedUntil: string | null;
    authProvider: string | null;
  };
  lifecycle: "ACTIVE" | "PENDING" | "BANNED";
  wallet: null | { availableCredits: number; heldCredits: number; spentCredits: number; version: number; updatedAt: string };
  subscriptions: Array<{
    id: string; state: string; planVersionId: string; planKey: string; displayName: string; creditsPerPeriod: number;
    interval: string; amountMinor: string; currency: string; currentPeriodStart: string; currentPeriodEnd: string;
    createdAt: string; cancelledAt: string | null;
  }>;
  operations: Array<{ operationId: string; state: string; customerCredits: number; createdAt: string; updatedAt: string }>;
  ledgerActivity: Array<{ journalId: string; kind: string; reasonCode: string; creditDelta: number; createdAt: string }>;
};

export type DurableOwnerFinance = {
  ownerId: string;
  wallet: { availableCredits: number; heldCredits: number; spentCredits: number; version: number; updatedAt: string } | null;
  operationCounts: Record<string, number>;
  journalCounts: Record<string, number>;
  operations: Array<{ operationId: string; state: string; customerCredits: number; updatedAt: string }>;
};

export type AdminCatalogRoute = {
  routeId: string;
  providerId: string;
  publisherName: string;
  modelFamilyName: string;
  canonicalModelName: string;
  providerAccount: { id: string; displayName: string; scope: string };
  providerModelId: string;
  providerModelMetadataVersion: string;
  endpoint: { hostingProviderId: string; reference: string; region: string | null };
  protocol: string;
  capability: { mediaType: string; version: string; inputSchemaVersion: string; outputSchemaVersion: string; supportsAsync: boolean; supportsWebhook: boolean };
  sourceSnapshot: { id: string; observedAt: string; parserVersion: string };
  providerCost: { pricingKind: string; nativeUnit: string; nativeScale: string; version: string; effectiveAt: string };
  costGuard: { kind: string; maximumNativeAtomic: string | null; reason: string };
  usageExtractorVersion: string;
  certification: { lifecycle: string; scope: string };
};
export type OfflineProviderCatalogRoute = { providerId: string; status: "SNAPSHOT_STAGED"; routeId: string; snapshotId: string; model: string; family: string; mediaType: string; protocol: string; providerCost: { unit: string; scale: string; version: string }; certification: string };
export type AdminPricingRow = {
  referenceModelId: string;
  providerId: "kie" | "openrouter";
  providerModelId: string;
  model: string;
  mediaType: string;
  providerRate: null | {
    rateKey: string;
    version: number;
    label: string;
    billingUnit: string;
    providerCreditMicros: string | null;
    providerUsdPicos: string | null;
    variant: Record<string, unknown>;
    sourceUrl: string;
    effectiveAt: string;
  };
  customerPrice: null | { version: number; customerCredits: number; configuredBy: string; updatedAt: string };
  status: "RATE_SYNC_REQUIRED" | "CUSTOMER_PRICE_REQUIRED" | "CONFIGURED";
};
export type AdminProviderReadiness = {
  providerId: string;
  displayName: string;
  status: "CATALOG_NOT_IMPORTED" | "CATALOG_IMPORTED";
  routeCount: number;
  capabilities: string[];
  snapshotCount: number;
  referenceSnapshotCount: number;
  credentialMetadataCount: number;
  credentialStatuses: string[];
  connectionState?: "DISCONNECTED" | "PENDING_VERIFICATION" | "CONNECTED" | "DEGRADED" | "SUSPENDED" | "REVOKED";
  lastVerifiedAt?: string | null;
  documentationUrl: string;
  catalogUrl: string;
  pricingUrl: string;
};
export type AdminProviderDetail = {
  provider: AdminProviderReadiness;
  credentials: CredentialMetadata[];
};
export type AdminProviderDirectory = {
  providers: AdminProviderReadiness[];
  credentials: CredentialMetadata[];
};
export type AdminRouteReleaseGate = {
  routeId: string;
  providerId: string;
  model: string;
  lifecycle: string;
  scope: string;
  releaseDecision: "BLOCKED_LOCAL";
  blockers: Array<"LOCAL_TEST_SCOPE" | "NOT_PUBLISHED" | "NO_ACTIVE_CREDENTIAL" | "EXTERNAL_VALIDATION_NOT_AUTHORIZED">;
};

let bootstrap: Promise<void> | null = null;

const ADMIN_API_BASE = import.meta.env.DEV
  ? "/api/engine/v1/dev/admin-v2"
  : "/api/engine/v1/admin";

async function ensureLocalReadOnlySession(): Promise<void> {
  if (!import.meta.env.DEV) return;
  if (!bootstrap) {
    bootstrap = fetch("/api/engine/v1/dev/admin-v2/session/bootstrap", {
      method: "POST",
      credentials: "same-origin",
    }).then((response) => {
      if (!response.ok) throw new Error("Could not create the local read-only admin session.");
    }).catch((error) => {
      bootstrap = null;
      throw error;
    });
  }
  return bootstrap;
}

async function adminAuthorizationHeaders(): Promise<Record<string, string>> {
  if (import.meta.env.DEV) return {};

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("An authenticated administrator session is required.");
  }

  return { authorization: `Bearer ${data.session.access_token}` };
}

async function adminReadImmediate<T>(path: string): Promise<T> {
  await ensureLocalReadOnlySession();
  const response = await fetch(`${ADMIN_API_BASE}${path}`, {
    credentials: "same-origin",
    headers: await adminAuthorizationHeaders(),
  });
  const payload = await response.json().catch(() => null) as { error?: { message?: string; code?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message || payload?.error?.code || "Admin V2 request failed");
  return payload as T;
}

type PendingAdminRead = {
  path: string;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

let pendingAdminReads: PendingAdminRead[] = [];
let adminReadFlushScheduled = false;

async function flushAdminReads(): Promise<void> {
  adminReadFlushScheduled = false;
  const pending = pendingAdminReads;
  pendingAdminReads = [];
  const paths = [...new Set(pending.map(({ path }) => path))];
  try {
    const headers = { ...await adminAuthorizationHeaders(), "content-type": "application/json" };
    const batches: string[][] = [];
    for (let index = 0; index < paths.length; index += 2) batches.push(paths.slice(index, index + 2));
    const payloads = await Promise.all(batches.map(async (batch) => {
      const response = await fetch(`${ADMIN_API_BASE}/read-batch`, {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({ paths: batch }),
      });
      const payload = await response.json().catch(() => null) as {
        results?: Record<string, { status: number; body: unknown }>;
        error?: { message?: string; code?: string };
      } | null;
      if (!response.ok || !payload?.results) throw new Error(payload?.error?.message || payload?.error?.code || "Admin read batch failed");
      return payload.results;
    }));
    const results = Object.assign({}, ...payloads) as Record<string, { status: number; body: unknown }>;
    for (const item of pending) {
      const result = results[item.path];
      if (!result || result.status < 200 || result.status >= 300) {
        const error = result?.body as { error?: { message?: string; code?: string } } | undefined;
        item.reject(new Error(error?.error?.message || error?.error?.code || "Admin read failed"));
      } else {
        item.resolve(result.body);
      }
    }
  } catch (error) {
    for (const item of pending) item.reject(error);
  }
}

async function adminRead<T>(path: string): Promise<T> {
  if (import.meta.env.DEV) return adminReadImmediate<T>(path);
  return new Promise<T>((resolve, reject) => {
    pendingAdminReads.push({ path, resolve: resolve as (value: unknown) => void, reject });
    if (!adminReadFlushScheduled) {
      adminReadFlushScheduled = true;
      queueMicrotask(() => { void flushAdminReads(); });
    }
  });
}

type AdminCommandOptions = { commandId?: string };

/**
 * A command ID must remain stable when a UI retries the same user intent.
 * Callers may supply one from their mutation state; this default is only for
 * a new intent, never an automatic retry.
 */
export function createAdminCommandId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("This browser cannot create a cryptographically strong Admin command ID.");
  }
  return globalThis.crypto.randomUUID();
}

async function adminCommand<T>(path: string, body: unknown, options: AdminCommandOptions = {}): Promise<T> {
  await ensureLocalReadOnlySession();
  const response = await fetch(`${ADMIN_API_BASE}${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      ...await adminAuthorizationHeaders(),
      "content-type": "application/json",
      "idempotency-key": options.commandId ?? createAdminCommandId(),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { error?: { message?: string; code?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message || payload?.error?.code || "Admin command failed");
  return payload as T;
}

export type ProviderCredentialInput = {
  providerId: string;
  purpose?: "PROVIDER_GENERATION_KEY" | "PROVIDER_WEBHOOK_HMAC" | "PROVIDER_MANAGEMENT_KEY";
  secret: string;
};

/**
 * Typed command boundary for the future protected credential form. These
 * functions are intentionally not invoked by page load or by read-only UI.
 */
export const writeProviderCredential = (input: ProviderCredentialInput, options?: AdminCommandOptions) => adminCommand<CredentialMetadata>("/credentials", input, options);
export const testProviderCredential = (credentialId: string, options?: AdminCommandOptions) => adminCommand<CredentialMetadata>(`/credentials/${encodeURIComponent(credentialId)}/test`, {}, options);
export const activateProviderCredential = (credentialId: string, options?: AdminCommandOptions) => adminCommand<CredentialMetadata>(`/credentials/${encodeURIComponent(credentialId)}/activate`, {}, options);
export const revokeProviderCredential = (credentialId: string, options?: AdminCommandOptions) => adminCommand<CredentialMetadata>(`/credentials/${encodeURIComponent(credentialId)}/revoke`, {}, options);
export const importProviderReferenceCatalog = (providerId: "kie" | "openrouter", options?: AdminCommandOptions) => adminCommand<{ snapshotId: string; providerId: string; version: number; observedAt: string; modelCount: number; replayed: boolean }>(`/catalog/providers/${providerId}/import`, {}, options);
export const selectReferenceModel = (referenceModelId: string, options?: AdminCommandOptions) => adminCommand<{ referenceModelId: string; state: "SELECTED"; version: number }>(`/catalog/models/${encodeURIComponent(referenceModelId)}/select`, {}, options);
export const unselectReferenceModel = (referenceModelId: string, options?: AdminCommandOptions) => adminCommand<{ referenceModelId: string; state: "UNSELECTED"; version: number }>(`/catalog/models/${encodeURIComponent(referenceModelId)}/unselect`, {}, options);
export const reviewReferenceModelPresentation = (referenceModelId: string, presentation: {
  productFamily: { id: string; displayName: string };
  version?: { id: string; displayName: string };
  edition?: { id: string; displayName: string };
  experienceCategories: Array<"IMAGE" | "VIDEO" | "AVATAR" | "AUDIO">;
}, options?: AdminCommandOptions) => adminCommand<{ referenceModelId: string; version: number; reviewedTaxonomy: unknown }>(`/catalog/models/${encodeURIComponent(referenceModelId)}/presentation`, presentation, options);
export const syncProviderPricing = (providerId: "kie" | "openrouter", options?: AdminCommandOptions) => adminCommand<{
  providerId: string; snapshotId: string; observedAt: string; importedRateCount: number;
  selectedModelCount: number; matchedModelCount: number; unmatchedReferenceModelIds: string[];
}>(`/pricing/providers/${providerId}/sync`, {}, options);
export const configureCustomerPrice = (input: { referenceModelId: string; rateKey: string; customerCredits: number }, options?: AdminCommandOptions) => adminCommand<{
  referenceModelId: string; rateKey: string; customerCredits: number; version: number; status: "CONFIGURED"; publishedOfferId: string | null;
}>("/pricing/customer-price", input, options);
export type PublishSubscriptionPlanInput = {
  planKey: string;
  displayName: string;
  amountMinor: string;
  currency: string;
  interval: "MONTH" | "YEAR";
  creditsPerPeriod: number;
  termsVersion: string;
  features: string[];
};
export const publishSubscriptionPlan = (input: PublishSubscriptionPlanInput, options?: AdminCommandOptions) => adminCommand<{
  planVersionId: string; planKey: string; version: number; lifecycle: "PUBLISHED"; displayName: string;
  amountMinor: string; currency: string; interval: "MONTH" | "YEAR"; creditsPerPeriod: number; pointerVersion: number; replayed: boolean;
}>("/subscriptions/plans/publish", input, options);
export const retireSubscriptionPlan = (planKey: string, options?: AdminCommandOptions) => adminCommand<{
  planKey: string; planVersionId: string; lifecycle: "RETIRED"; pointerVersion: number; replayed: boolean;
}>(`/subscriptions/plans/${encodeURIComponent(planKey)}/retire`, {}, options);
export const generateSubscriptionActivationKey = (input: { planVersionId: string; expiresInDays: number }, options?: AdminCommandOptions) => adminCommand<{
  keyId: string; activationKey: string; keyHint: string; planVersionId: string; planKey: string; displayName: string;
  interval: "MONTH" | "YEAR"; creditsPerPeriod: number; state: "ISSUED"; createdAt: string; expiresAt: string; replayed: boolean;
}>("/subscriptions/activation-keys", input, options);
export const revokeSubscriptionActivationKey = (keyId: string, options?: AdminCommandOptions) => adminCommand<{
  keyId: string; keyHint: string; planVersionId: string; state: "REVOKED"; revokedAt: string; replayed: boolean;
}>(`/subscriptions/activation-keys/${encodeURIComponent(keyId)}/revoke`, {}, options);

export const getAdminOverview = () => adminRead<AdminOverview>("/overview");
export const getAdminChanges = () => adminRead<AdminChange[]>("/changes");
export const getAdminApprovalInbox = () => adminRead<AdminApprovalInboxItem[]>("/approval-inbox");
export const getAdminWorkflowPolicies = () => adminRead<AdminWorkflowPolicy[]>("/workflow-policies");
export const getAdminCapabilities = () => adminRead<AdminCapabilities>("/capabilities");
export const getAdminAudit = () => adminRead<{ chainValid: boolean; records: AdminAuditRecord[] }>("/audit");
export const getCredentialMetadata = () => adminRead<CredentialMetadata[]>("/credentials");
export const getAdminCatalogRoutes = () => adminRead<AdminCatalogRoute[]>("/catalog/routes");
export const getOfflineProviderCatalog = () => adminRead<OfflineProviderCatalogRoute[]>("/catalog/offline");
export const getAdminPricing = () => adminRead<AdminPricingRow[]>("/pricing");
export const getAdminProviderReadiness = () => adminRead<AdminProviderReadiness[]>("/catalog/providers");
export const getAdminProviderDirectory = () => adminRead<AdminProviderDirectory>("/catalog/providers/directory");
export const getAdminProviderDetail = (providerId: string) => adminRead<AdminProviderDetail>(`/catalog/providers/${encodeURIComponent(providerId)}/detail`);
export const getAdminRouteReleaseGates = () => adminRead<AdminRouteReleaseGate[]>("/catalog/release-gates");
export const getCatalogSnapshots = () => adminRead<CatalogSnapshot[]>("/catalog/snapshots");
export const getReferenceCatalogSnapshots = () => adminRead<ReferenceCatalogSnapshot[]>("/catalog/reference-snapshots");
export const getReferenceCatalogModels = () => adminRead<ReferenceCatalogModel[]>("/catalog/reference-models");
export const getDurableAdminOverview = () => adminRead<DurableAdminOverview>("/durable/overview");
export const getCommerceAdminOverview = () => adminRead<CommerceAdminOverview>("/commerce/overview");
export const getProductionCustomers = () => adminRead<ProductionCustomerDirectoryItem[]>("/customers");
export const getProductionCustomerDetail = (ownerId: string) => adminRead<ProductionCustomerDetail>(`/customers/${encodeURIComponent(ownerId)}`);
export const getDurableOperations = (limit = 50) => adminRead<DurableOperationListItem[]>(`/durable/operations?limit=${encodeURIComponent(String(limit))}`);
export const getDurableOwners = (limit = 50) => adminRead<DurableOwnerDirectoryItem[]>(`/durable/owners?limit=${encodeURIComponent(String(limit))}`);
export const getDurableOperationExceptions = (limit = 50) => adminRead<DurableOperationException[]>(`/durable/exceptions?limit=${encodeURIComponent(String(limit))}`);
export const getDurableOwnerFinance = (ownerId: string) => adminRead<DurableOwnerFinance>(`/durable/owners/${encodeURIComponent(ownerId)}`);
export const getDurableOperationHistory = (operationId: string) => adminRead<DurableOperationHistory>(`/durable/operations/${encodeURIComponent(operationId)}`);
