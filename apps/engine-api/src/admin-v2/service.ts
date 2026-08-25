import { createHash } from "node:crypto";
import {
  AdminControlPlaneError,
  ImmutableAdminAuditLog,
  hasAdminPermission,
  requireAdminPermission,
  VersionedAdminChangeService,
  SecretBackedCredentialVault,
  type SecretBackedCredentialVaultState,
  type SecretStore,
  type AdminChangeVersion,
  type AdminIdentity,
  type AdminResourceType,
  type AuditRecord,
  type CredentialMetadata,
  type VersionedAdminChangeState,
} from "../../../../packages/admin-control-plane/src/index.ts";
import { adminWorkflowRequirement } from "../../../../packages/admin-control-plane/src/authorization.ts";
import type { LocalMockProviderService } from "../local-provider/service.ts";
import { LocalAdminRuntimeControls } from "./runtime.ts";
import type { ProviderRegistry } from "../../../../packages/providers/src/registry.ts";
import { InMemoryCatalogSnapshotStore, type CatalogSnapshotInput, type CatalogSnapshotRecord } from "../../../../packages/providers/src/catalog-snapshot.ts";
import { InMemoryReferenceCatalogStore, type ReferenceCatalogSnapshotRecord } from "../../../../packages/providers/src/reference-catalog-store.ts";
import type { PublicReferenceCatalogSnapshot } from "../../../../packages/providers/src/reference-catalog-importers.ts";
import type { LocalDurableRuntime } from "../durable-worker/runtime.ts";
import { providerOnboardingProfiles } from "../../../../packages/providers/src/provider-onboarding.ts";
import type { LocalCommerceService } from "../commerce/service.ts";
import type { AccountBalanceSnapshot, ProviderConnectionVerification } from "../provider-accounts/verification.ts";
import { ProviderControlPlaneChangePublisher } from "../../../../packages/provider-control-plane/src/admin-change-publisher.ts";

type CredentialCommandResult = CredentialMetadata;
export type ProviderAccountVerificationSnapshot = Readonly<{
  credentialId: string;
  providerId: string;
  accountId: string;
  credentialPurpose: CredentialMetadata["purpose"];
  observedAt: string;
  accountLabel: string | null;
  balance: AccountBalanceSnapshot | null;
  keyLimit: ProviderConnectionVerification["keyLimit"];
}>;

export type AdminCatalogRouteProjection = {
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

export type AdminProviderReadinessProjection = {
  providerId: string;
  displayName: string;
  status: "CATALOG_NOT_IMPORTED" | "REFERENCE_STAGED";
  routeCount: number;
  capabilities: string[];
  snapshotCount: number;
  referenceSnapshotCount: number;
  credentialMetadataCount: number;
  credentialStatuses: string[];
  documentationUrl: string;
  catalogUrl: string;
  pricingUrl: string;
};

/**
 * A non-sensitive, server-owned projection of the current Admin session.
 * It lets the browser decide which command entry points may be shown without
 * trusting roles from the browser or exposing secret material.
 */
export type AdminCapabilitiesProjection = Readonly<{
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
  };
  safeguards: {
    secretValuesReadableInBrowser: false;
    providerCallsTriggeredByPageLoad: false;
    makerCheckerRequiredForCredentialActivation: true;
  };
}>;

export type AdminReferenceCatalogSnapshotProjection = {
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
  change: { id: string; state: VersionedAdminChangeState["changes"][number]["state"] } | null;
};

export type AdminReferenceCatalogModelProjection = {
  providerId: string;
  snapshotId: string;
  observedAt: string;
  snapshotChangeState: VersionedAdminChangeState["changes"][number]["state"] | null;
  id: string;
  providerModelId: string;
  displayName: string;
  familyId: string;
  modalities: string[];
  supportedParameters: string[];
  sourceUrls: string[];
  state: "REFERENCE_ACTIVE";
};

export type AdminApprovalInboxItem = {
  changeId: string;
  resourceType: string;
  resourceId: string;
  version: number;
  state: string;
  makerId: string;
  reasonCode: string;
  updatedAt: string;
  nextAction: "VALIDATE" | "SIMULATE" | "APPROVE" | "PUBLISH";
  requiredRoles: string[];
  makerCheckerRequired: boolean;
};

export type AdminWorkflowPolicyProjection = {
  resourceType: AdminResourceType;
  makerRoles: string[];
  validatorRoles: string[];
  simulatorRoles: string[];
  approverRoles: string[];
  publisherRoles: string[];
};

export type AdminRouteReleaseGateProjection = {
  routeId: string;
  providerId: string;
  model: string;
  lifecycle: string;
  scope: string;
  releaseDecision: "BLOCKED_LOCAL";
  blockers: Array<"LOCAL_TEST_SCOPE" | "NOT_PUBLISHED" | "NO_ACTIVE_CREDENTIAL" | "EXTERNAL_VALIDATION_NOT_AUTHORIZED">;
};

export type AdminCatalogSnapshotProjection = {
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
  change: { id: string; state: VersionedAdminChangeState["changes"][number]["state"] } | null;
};

type LocalPersistedAdminState = {
  schemaVersion: 1 | 2 | 3 | 4;
  audit: AuditRecord[];
  changes: VersionedAdminChangeState;
  catalogSnapshots: CatalogSnapshotRecord[];
  credentialVault: SecretBackedCredentialVaultState;
  credentialMakers: Array<[string, string]>;
  credentialCommands: Array<{ commandId: string; intentHash: string; result: CredentialCommandResult }>;
  providerAccountVerifications: ProviderAccountVerificationSnapshot[];
  referenceCatalogSnapshots: ReferenceCatalogSnapshotRecord[];
};

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, Object.keys(value as object).sort())).digest("hex");
}

export class LocalAdminV2Service {
  readonly audit = new ImmutableAdminAuditLog();
  readonly vault: SecretBackedCredentialVault;
  readonly changes: VersionedAdminChangeService;
  readonly catalogSnapshots = new InMemoryCatalogSnapshotStore();
  readonly referenceCatalogSnapshots = new InMemoryReferenceCatalogStore();
  private readonly providerAccountVerifications = new Map<string, ProviderAccountVerificationSnapshot>();
  private readonly credentialMakers = new Map<string, string>();
  private readonly credentialCommands = new Map<string, { intentHash: string; result: CredentialCommandResult }>();
  private hydrated = false;
  private hydration: Promise<void> | null = null;
  private persistenceVersion: number | null = null;

  constructor(
    readonly runtime: LocalAdminRuntimeControls,
    private readonly localProvider: LocalMockProviderService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly durableRuntime?: LocalDurableRuntime,
    private readonly commerce?: LocalCommerceService,
    secretStore?: SecretStore,
    private readonly verifyCredential: (input: { providerId: string; accountId: string; environment: CredentialMetadata["environment"]; purpose: CredentialMetadata["purpose"]; secret: Uint8Array }) => Promise<ProviderConnectionVerification | null> = async () => null,
    private readonly providerControlPublisher?: ProviderControlPlaneChangePublisher,
  ) {
    if (!secretStore) throw new TypeError("admin_secret_store_required");
    this.vault = new SecretBackedCredentialVault(secretStore);
    this.changes = new VersionedAdminChangeService(
      this.audit,
      () => new Date(),
      undefined,
      (change) => this.applyPublishedChange(change),
    );
  }

  catalogRoutes(identity: AdminIdentity): AdminCatalogRouteProjection[] {
    // Uses the same read authorization as every other Admin projection.
    this.changes.list(identity);
    return this.providerRegistry.listRoutes().map((route) => ({
      routeId: route.routeId,
      providerId: route.providerId,
      publisherName: route.publisher.displayName,
      modelFamilyName: route.modelFamily.displayName,
      canonicalModelName: route.canonicalModel.displayName,
      providerAccount: { id: route.providerAccount.id, displayName: route.providerAccount.displayName, scope: route.providerAccount.scope },
      providerModelId: route.providerModel.providerModelId,
      providerModelMetadataVersion: route.providerModel.metadataVersion,
      endpoint: { hostingProviderId: route.hostingEndpoint.hostingProviderId, reference: route.hostingEndpoint.endpointReference, region: route.hostingEndpoint.region ?? null },
      protocol: route.protocol,
      capability: {
        mediaType: route.capability.mediaType, version: route.capability.capabilityVersion,
        inputSchemaVersion: route.capability.inputSchemaVersion, outputSchemaVersion: route.capability.outputSchemaVersion,
        supportsAsync: route.capability.supportsAsync, supportsWebhook: route.capability.supportsWebhook,
      },
      sourceSnapshot: { id: route.sourceSnapshot.id, observedAt: route.sourceSnapshot.observedAt, parserVersion: route.sourceSnapshot.parserVersion },
      providerCost: { pricingKind: route.providerCostVersion.pricingKind, nativeUnit: route.providerCostVersion.nativeUnit, nativeScale: route.providerCostVersion.nativeScale, version: route.providerCostVersion.version, effectiveAt: route.providerCostVersion.effectiveAt },
      costGuard: { kind: route.costGuard.kind, maximumNativeAtomic: route.costGuard.maximumNativeAtomic ?? null, reason: route.costGuard.reason },
      usageExtractorVersion: route.usageExtractorVersion,
      certification: { lifecycle: route.certification.lifecycle, scope: route.certification.scope },
    }));
  }

  offlineCatalog(identity: AdminIdentity) {
    this.changes.list(identity);
    // KIE/OpenRouter fixtures are test-only and must never appear as models in
    // Admin. The projected rows come exclusively from the newest submitted
    // snapshot per provider; this is a review candidate, not an active route.
    const latestSnapshots = this.latestSnapshotsByProvider();
    return [...latestSnapshots.values()].flatMap((snapshot) => snapshot.routes.map((route) => ({
      providerId: route.providerId, status: "SNAPSHOT_STAGED" as const, routeId: route.routeId,
      snapshotId: snapshot.snapshotId, model: route.canonicalModel.displayName, family: route.modelFamily.displayName,
      mediaType: route.capability.mediaType, protocol: route.protocol,
      providerCost: { unit: route.providerCostVersion.nativeUnit, scale: route.providerCostVersion.nativeScale, version: route.providerCostVersion.version },
      certification: route.certification.scope,
    })));
  }

  providerReadiness(identity: AdminIdentity): AdminProviderReadinessProjection[] {
    this.changes.list(identity);
    const credentials = this.vault.metadata(identity);
    const latestSnapshots = this.latestSnapshotsByProvider();
    return providerOnboardingProfiles.map((provider) => {
      const snapshot = latestSnapshots.get(provider.providerId);
      const referenceSnapshotCount = this.referenceCatalogSnapshots.list().filter((candidate) => candidate.providerId === provider.providerId).length;
      const providerCredentials = credentials.filter((credential) => credential.providerId === provider.providerId);
      return {
        ...provider,
        status: referenceSnapshotCount > 0 ? "REFERENCE_STAGED" : provider.catalogState,
        routeCount: snapshot?.routes.length ?? 0,
        capabilities: provider.documentedCapabilities,
        snapshotCount: this.catalogSnapshots.list().filter((snapshot) => snapshot.providerId === provider.providerId).length,
        referenceSnapshotCount,
        credentialMetadataCount: providerCredentials.length,
        credentialStatuses: [...new Set(providerCredentials.map((credential) => credential.status))].sort(),
      };
    });
  }

  providerAccountHealth(identity: AdminIdentity): ReadonlyArray<ProviderAccountVerificationSnapshot> {
    this.changes.list(identity);
    return structuredClone([...this.providerAccountVerifications.values()].sort((left, right) => right.observedAt.localeCompare(left.observedAt)));
  }

  routeReleaseGates(identity: AdminIdentity): AdminRouteReleaseGateProjection[] {
    this.changes.list(identity);
    const credentials = this.vault.metadata(identity);
    const activeProviders = new Set(credentials.filter((credential) => credential.status === "ACTIVE").map((credential) => credential.providerId));
    const routes = this.providerRegistry.listRoutes();
    return [...new Map(routes.map((route) => [route.routeId, route])).values()].map((route) => {
      const blockers: AdminRouteReleaseGateProjection["blockers"] = [];
      if (route.certification.scope !== "PRODUCTION") blockers.push("LOCAL_TEST_SCOPE");
      if (route.certification.lifecycle !== "PUBLISHED") blockers.push("NOT_PUBLISHED");
      if (!activeProviders.has(route.providerId)) blockers.push("NO_ACTIVE_CREDENTIAL");
      // The local program explicitly forbids live calls and canary validation.
      blockers.push("EXTERNAL_VALIDATION_NOT_AUTHORIZED");
      return {
        routeId: route.routeId, providerId: route.providerId, model: route.canonicalModel.displayName,
        lifecycle: route.certification.lifecycle, scope: route.certification.scope,
        releaseDecision: "BLOCKED_LOCAL" as const, blockers,
      };
    });
  }

  snapshotHistory(identity: AdminIdentity): AdminCatalogSnapshotProjection[] {
    const changes = this.changes.list(identity);
    return this.catalogSnapshots.list().map((snapshot) => {
      const change = changes.find((candidate) => candidate.resourceType === "CATALOG_SNAPSHOT" && candidate.resourceId === snapshot.snapshotId) ?? null;
      return {
        snapshotId: snapshot.snapshotId, providerId: snapshot.providerId, scope: snapshot.scope, sourceLabel: snapshot.sourceLabel,
        observedAt: snapshot.observedAt, rawPayloadSha256: snapshot.rawPayloadSha256, manifestSha256: snapshot.manifestSha256,
        diffSha256: snapshot.diffSha256, parserVersion: snapshot.parserVersion, routeCount: snapshot.routes.length,
        diff: {
          added: snapshot.diff.filter((item) => item.kind === "ADDED").length,
          changed: snapshot.diff.filter((item) => item.kind === "CHANGED").length,
          removed: snapshot.diff.filter((item) => item.kind === "REMOVED").length,
        },
        change: change ? { id: change.id, state: change.state } : null,
      };
    });
  }

  referenceSnapshotHistory(identity: AdminIdentity): AdminReferenceCatalogSnapshotProjection[] {
    const changes = this.changes.list(identity);
    return this.referenceCatalogSnapshots.list().map((snapshot) => {
      const change = changes.find((candidate) => candidate.resourceType === "REFERENCE_CATALOG_SNAPSHOT" && candidate.resourceId === snapshot.id) ?? null;
      return {
        snapshotId: snapshot.id, providerId: snapshot.providerId, observedAt: snapshot.observedAt, parserVersion: snapshot.parserVersion,
        sourceUrls: [...snapshot.sourceUrls], rawPayloadSha256: snapshot.rawPayloadSha256, manifestSha256: snapshot.manifestSha256,
        diffSha256: snapshot.diffSha256, modelCount: snapshot.models.length,
        diff: {
          added: snapshot.diff.filter((item) => item.kind === "ADDED").length,
          changed: snapshot.diff.filter((item) => item.kind === "CHANGED").length,
          removed: snapshot.diff.filter((item) => item.kind === "REMOVED").length,
        },
        change: change ? { id: change.id, state: change.state } : null,
      };
    });
  }

  referenceCatalogModels(identity: AdminIdentity): AdminReferenceCatalogModelProjection[] {
    const changes = this.changes.list(identity);
    return this.referenceCatalogSnapshots.list().flatMap((snapshot) => {
      const change = changes.find((candidate) => candidate.resourceType === "REFERENCE_CATALOG_SNAPSHOT" && candidate.resourceId === snapshot.id) ?? null;
      return snapshot.models.map((model) => ({
        providerId: snapshot.providerId, snapshotId: snapshot.id, observedAt: snapshot.observedAt,
        snapshotChangeState: change?.state ?? null, id: model.id, providerModelId: model.providerModelId,
        displayName: model.displayName, familyId: model.familyId, modalities: [...model.modalities],
        supportedParameters: [...model.supportedParameters], sourceUrls: [...model.sourceUrls], state: model.state,
      }));
    }).sort((left, right) => left.providerId.localeCompare(right.providerId) || left.displayName.localeCompare(right.displayName));
  }

  private latestSnapshotsByProvider(): Map<string, CatalogSnapshotRecord> {
    const latest = new Map<string, CatalogSnapshotRecord>();
    for (const snapshot of this.catalogSnapshots.list()) latest.set(snapshot.providerId, snapshot);
    return latest;
  }

  approvalInbox(identity: AdminIdentity): AdminApprovalInboxItem[] {
    return this.changes.list(identity).flatMap((change) => {
      const workflow = adminWorkflowRequirement(change.resourceType);
      const current = change.state === "DRAFT" ? { nextAction: "VALIDATE" as const, requiredRoles: workflow.validatorRoles }
        : change.state === "VALIDATED" ? { nextAction: "SIMULATE" as const, requiredRoles: workflow.simulatorRoles }
          : change.state === "SIMULATED" ? { nextAction: "APPROVE" as const, requiredRoles: workflow.approverRoles }
            : change.state === "APPROVED" ? { nextAction: "PUBLISH" as const, requiredRoles: workflow.publisherRoles }
              : null;
      if (!current) return [];
      return [{
        changeId: change.id, resourceType: change.resourceType, resourceId: change.resourceId, version: change.version,
        state: change.state, makerId: change.makerId, reasonCode: change.reasonCode, updatedAt: change.updatedAt,
        nextAction: current.nextAction, requiredRoles: [...current.requiredRoles],
        makerCheckerRequired: current.nextAction === "APPROVE" || current.nextAction === "PUBLISH",
      }];
    });
  }

  workflowPolicies(identity: AdminIdentity): AdminWorkflowPolicyProjection[] {
    this.changes.list(identity);
    const resourceTypes: AdminResourceType[] = [
      "CATALOG_SNAPSHOT", "PRICING_POLICY", "ROUTE_CONTROL", "TREASURY_POLICY",
      "REFERENCE_CATALOG_SNAPSHOT",
      "PROVIDER_CREDENTIAL", "FINANCIAL_ADJUSTMENT", "USER_ANONYMIZATION",
    ];
    return resourceTypes.map((resourceType) => {
      const workflow = adminWorkflowRequirement(resourceType);
      return {
        resourceType,
        makerRoles: [...workflow.makerRoles], validatorRoles: [...workflow.validatorRoles], simulatorRoles: [...workflow.simulatorRoles],
        approverRoles: [...workflow.approverRoles], publisherRoles: [...workflow.publisherRoles],
      };
    });
  }

  capabilities(identity: AdminIdentity): AdminCapabilitiesProjection {
    const mode = !identity.actorId
      ? "UNAUTHENTICATED"
      : identity.actorId === "local-admin-viewer"
        ? "LOCAL_VIEWER"
        : "AUTHORIZED_ADMIN";
    return {
      session: {
        actorId: identity.actorId || null,
        roles: [...identity.roles],
        assuranceLevel: identity.assuranceLevel,
        mode,
      },
      permissions: {
        read: hasAdminPermission(identity, "READ"),
        providerCredentials: {
          write: hasAdminPermission(identity, "WRITE_SECRET", "PROVIDER_CREDENTIAL"),
          test: hasAdminPermission(identity, "TEST_SECRET", "PROVIDER_CREDENTIAL"),
          activate: hasAdminPermission(identity, "ACTIVATE_SECRET", "PROVIDER_CREDENTIAL"),
          revoke: hasAdminPermission(identity, "REVOKE_SECRET", "PROVIDER_CREDENTIAL"),
        },
      },
      safeguards: {
        secretValuesReadableInBrowser: false,
        providerCallsTriggeredByPageLoad: false,
        makerCheckerRequiredForCredentialActivation: true,
      },
    };
  }

  async hydrate(): Promise<void> {
    if (this.hydrated || !this.durableRuntime) return;
    if (!this.hydration) this.hydration = this.hydrateOnce();
    await this.hydration;
  }

  async persist(): Promise<void> {
    if (!this.durableRuntime) return;
    await this.hydrate();
    const saved = await this.durableRuntime.saveAdminControlPlaneState({
      document: this.persistenceDocument(), expectedVersion: this.persistenceVersion,
    });
    this.persistenceVersion = saved.version;
  }

  stageCatalogSnapshot(identity: AdminIdentity, commandId: string, input: CatalogSnapshotInput, reasonCode: string) {
    // No catalog record may be created until authorization, idempotency and the
    // immutable Change Set have all succeeded. `prepare` has no side effect.
    requireAdminPermission(identity, "DRAFT", "CATALOG_SNAPSHOT");
    const staged = this.catalogSnapshots.prepare(input);
    const change = this.changes.createDraft(identity, commandId, {
      resourceType: "CATALOG_SNAPSHOT",
      resourceId: staged.snapshotId,
      payload: { providerId: staged.providerId, scope: staged.scope, snapshotHash: staged.manifestSha256, diffHash: staged.diffSha256 },
      reasonCode,
    });
    return { snapshot: this.catalogSnapshots.commit(staged), change };
  }

  stageReferenceCatalogSnapshot(identity: AdminIdentity, commandId: string, input: PublicReferenceCatalogSnapshot, reasonCode: string) {
    requireAdminPermission(identity, "DRAFT", "REFERENCE_CATALOG_SNAPSHOT");
    const staged = this.referenceCatalogSnapshots.prepare(input);
    const change = this.changes.createDraft(identity, commandId, {
      resourceType: "REFERENCE_CATALOG_SNAPSHOT",
      resourceId: staged.id,
      payload: {
        id: staged.id, providerId: staged.providerId, observedAt: staged.observedAt, parserVersion: staged.parserVersion,
        sourceUrls: [...staged.sourceUrls], rawPayloadSha256: staged.rawPayloadSha256, manifestSha256: staged.manifestSha256,
        sourceScope: staged.sourceScope, evidenceSha256: staged.rawPayloadSha256,
      },
      reasonCode,
    });
    return { snapshot: this.referenceCatalogSnapshots.commit(staged), change };
  }

  async overview(identity: AdminIdentity) {
    const changes = this.changes.list(identity);
    const stateCounts = Object.fromEntries(
      ["DRAFT", "VALIDATED", "SIMULATED", "APPROVED", "PUBLISHED", "REJECTED"]
        .map((state) => [state, changes.filter((change) => change.state === state).length]),
    );
    return {
      mode: "LOCAL_ADMIN_V2",
      legacyMutationPolicy: "HOLD_DO_NOT_USE_FOR_PRODUCTION",
      workflow: ["DRAFT", "VALIDATED", "SIMULATED", "APPROVED", "PUBLISHED"],
      stateCounts,
      runtime: this.runtime.snapshot(),
      treasury: await this.localProvider.getTreasuryDashboard(),
      reconciliation: this.localProvider.getReconciliationReport(),
      audit: { records: this.audit.snapshot().length, chainValid: this.audit.verify() },
    };
  }

  async durableOverview(identity: AdminIdentity) {
    this.changes.list(identity);
    if (!this.durableRuntime) return { enabled: false };
    return { enabled: true, runtime: await this.durableRuntime.status(), audit: await this.durableRuntime.adminOverview() };
  }

  async publishChange(identity: AdminIdentity, commandId: string, changeId: string): Promise<AdminChangeVersion> {
    const candidate = this.changes.inspectForPublish(identity, changeId);
    const requiresDurableMaterialization = candidate.resourceType === "RELEASE_BUNDLE"
      || (candidate.resourceType === "REFERENCE_CATALOG_SNAPSHOT" && !!this.durableRuntime);
    if (requiresDurableMaterialization && !this.providerControlPublisher) {
      throw new AdminControlPlaneError("VALIDATION_FAILED", "This control-plane promotion requires the durable Provider Control Plane publisher.");
    }
    if (candidate.resourceType === "RELEASE_BUNDLE") {
      const offers = candidate.payload.offers;
      if (!Array.isArray(offers)) throw new AdminControlPlaneError("VALIDATION_FAILED", "Release bundle offers are invalid.");
      for (const offer of offers) {
        if (!offer || typeof offer !== "object") throw new AdminControlPlaneError("VALIDATION_FAILED", "Release bundle offer is invalid.");
        const record = offer as Record<string, unknown>;
        if (typeof record.credentialReferenceId !== "string" || !Number.isSafeInteger(record.credentialVersion)) {
          throw new AdminControlPlaneError("VALIDATION_FAILED", "Release bundle offer requires an exact credential reference and version.");
        }
        this.vault.assertActiveProviderGenerationCredential({
          credentialReferenceId: record.credentialReferenceId,
          credentialVersion: Number(record.credentialVersion),
        });
      }
    }
    // Materialize first with a command bound to the immutable Change Set ID.
    // A retry after a browser/server interruption reaches the same durable
    // command rather than appending a second release.  Only after that write
    // succeeds may the Admin state move to PUBLISHED.
    if (candidate.resourceType === "REFERENCE_CATALOG_SNAPSHOT" && this.providerControlPublisher) {
      await this.providerControlPublisher.materializeReferenceCatalog(
        candidate,
        this.referenceCatalogSnapshots.get(candidate.resourceId),
        `provider-control:change:${candidate.id}`,
      );
    }
    if (candidate.resourceType === "RELEASE_BUNDLE" && this.providerControlPublisher) {
      await this.providerControlPublisher.materialize(candidate, `provider-control:change:${candidate.id}`);
    }
    return this.changes.publish(identity, commandId, changeId);
  }

  commerceOverview(identity: AdminIdentity) {
    this.changes.list(identity);
    return this.commerce ? { enabled: true as const, ...this.commerce.adminReadModel() } : { enabled: false as const };
  }

  async durableOperationHistory(identity: AdminIdentity, operationId: string) {
    this.changes.list(identity);
    if (!this.durableRuntime) return null;
    return this.durableRuntime.adminOperationHistory(operationId);
  }

  async durableOperations(identity: AdminIdentity, limit?: number) {
    this.changes.list(identity);
    if (!this.durableRuntime) return [];
    return this.durableRuntime.adminOperations(limit);
  }

  async durableOwners(identity: AdminIdentity, limit?: number) {
    this.changes.list(identity);
    if (!this.durableRuntime) return [];
    return this.durableRuntime.adminOwnerDirectory(limit);
  }

  async durableExceptionQueue(identity: AdminIdentity, limit?: number) {
    this.changes.list(identity);
    if (!this.durableRuntime) return [];
    return this.durableRuntime.adminExceptionQueue(limit);
  }

  async durableOwnerFinance(identity: AdminIdentity, ownerId: string) {
    this.changes.list(identity);
    if (!this.durableRuntime) return null;
    return this.durableRuntime.adminOwnerFinanceView(ownerId);
  }

  async writeCredential(identity: AdminIdentity, commandId: string, input: {
    providerId: string;
    accountId: string;
    environment: CredentialMetadata["environment"];
    purpose?: CredentialMetadata["purpose"];
    secret: string;
  }): Promise<CredentialMetadata> {
    return this.executeCredentialCommand(commandId, {
      action: "WRITE_CREDENTIAL",
      actorId: identity.actorId,
      providerId: input.providerId,
      accountId: input.accountId,
      environment: input.environment,
      purpose: input.purpose ?? "PROVIDER_GENERATION_KEY",
      secretFingerprint: createHash("sha256").update(input.secret).digest("hex"),
    }, async () => {
      const metadata = await this.vault.write(identity, { ...input, purpose: input.purpose ?? "PROVIDER_GENERATION_KEY" });
      this.credentialMakers.set(metadata.id, identity.actorId);
      this.appendCredentialAudit(identity, "CREDENTIAL_WRITTEN", metadata, commandId);
      return metadata;
    });
  }

  async testCredential(identity: AdminIdentity, commandId: string, credentialId: string): Promise<CredentialMetadata> {
    return this.executeCredentialCommand(commandId, {
      action: "TEST_CREDENTIAL",
      actorId: identity.actorId,
      credentialId,
    }, async () => {
      const verified = await this.vault.testWithEvidence(identity, credentialId, async (secret, credential) => {
        return this.verifyCredential({
          providerId: credential.providerId, accountId: credential.accountId, environment: credential.environment,
          purpose: credential.purpose, secret,
        });
      }, (result) => result?.connected === true);
      const { metadata, result } = verified;
      if (!result) throw new AdminControlPlaneError("CREDENTIAL_ILLEGAL_TRANSITION", "Provider verification returned no connection evidence.");
      this.providerAccountVerifications.set(credentialId, {
        credentialId, providerId: metadata.providerId, accountId: metadata.accountId, credentialPurpose: metadata.purpose,
        observedAt: result.observedAt, accountLabel: result.accountLabel, balance: result.balance, keyLimit: result.keyLimit,
      });
      this.appendCredentialAudit(identity, "CREDENTIAL_TESTED", metadata, commandId);
      return metadata;
    });
  }

  async activateCredential(identity: AdminIdentity, commandId: string, credentialId: string): Promise<CredentialMetadata> {
    return this.executeCredentialCommand(commandId, {
      action: "ACTIVATE_CREDENTIAL",
      actorId: identity.actorId,
      credentialId,
    }, async () => {
      const makerId = this.credentialMakers.get(credentialId);
      if (!makerId) throw new AdminControlPlaneError("CREDENTIAL_NOT_FOUND", "Credential does not exist.");
      const metadata = await this.vault.activate(identity, credentialId, makerId);
      this.appendCredentialAudit(identity, "CREDENTIAL_ACTIVATED", metadata, commandId);
      return metadata;
    });
  }

  async revokeCredential(identity: AdminIdentity, commandId: string, credentialId: string): Promise<CredentialMetadata> {
    return this.executeCredentialCommand(commandId, {
      action: "REVOKE_CREDENTIAL",
      actorId: identity.actorId,
      credentialId,
    }, async () => {
      const metadata = await this.vault.revoke(identity, credentialId);
      this.appendCredentialAudit(identity, "CREDENTIAL_REVOKED", metadata, commandId);
      return metadata;
    });
  }

  private applyPublishedChange(change: Readonly<AdminChangeVersion>): void {
    if (change.resourceType === "CATALOG_SNAPSHOT") {
      throw new AdminControlPlaneError("VALIDATION_FAILED", "Local catalog snapshots are evidence only and cannot be published.");
    }
    // A public reference snapshot may be promoted after review, but it has no
    // runtime side effect: it is not an account, route, price, or user offer.
    if (change.resourceType === "REFERENCE_CATALOG_SNAPSHOT") return;
    if (change.resourceType === "RELEASE_BUNDLE") return;
    if (change.resourceType === "FINANCIAL_ADJUSTMENT") {
      this.localProvider.applyAdminFinancialAdjustment(change);
      return;
    }
    this.runtime.publish(change);
  }

  private async hydrateOnce(): Promise<void> {
    const stored = await this.durableRuntime!.adminControlPlaneState();
    if (stored) {
      const parsed = stored.document as Partial<LocalPersistedAdminState>;
      if ((parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2 && parsed.schemaVersion !== 3 && parsed.schemaVersion !== 4) || !Array.isArray(parsed.audit) || !parsed.changes || !Array.isArray(parsed.catalogSnapshots)) {
        throw new TypeError("admin_control_plane_state_invalid");
      }
      this.audit.restore(parsed.audit);
      this.changes.restoreState(parsed.changes);
      this.catalogSnapshots.restore(parsed.catalogSnapshots);
      if (parsed.schemaVersion === 4) {
        if (!Array.isArray(parsed.referenceCatalogSnapshots)) throw new TypeError("reference_catalog_state_invalid");
        this.referenceCatalogSnapshots.restore(parsed.referenceCatalogSnapshots);
      }
      if (parsed.schemaVersion === 2 || parsed.schemaVersion === 3 || parsed.schemaVersion === 4) {
        if (!parsed.credentialVault || !Array.isArray(parsed.credentialMakers) || !Array.isArray(parsed.credentialCommands)) throw new TypeError("admin_credential_state_invalid");
        this.vault.restoreState(parsed.credentialVault);
        this.credentialMakers.clear(); this.credentialCommands.clear();
        for (const [credentialId, makerId] of parsed.credentialMakers) this.credentialMakers.set(credentialId, makerId);
        for (const command of parsed.credentialCommands) this.credentialCommands.set(command.commandId, { intentHash: command.intentHash, result: command.result });
        if (parsed.schemaVersion === 3 || parsed.schemaVersion === 4) {
          if (!Array.isArray(parsed.providerAccountVerifications)) throw new TypeError("provider_account_verification_state_invalid");
          this.providerAccountVerifications.clear();
          for (const snapshot of parsed.providerAccountVerifications) this.providerAccountVerifications.set(snapshot.credentialId, snapshot);
        }
      }
      this.persistenceVersion = stored.version;
    } else {
      this.persistenceVersion = 0;
    }
    this.hydrated = true;
  }

  private persistenceDocument(): LocalPersistedAdminState {
    return {
      schemaVersion: 4,
      audit: [...this.audit.snapshot()] as AuditRecord[],
      changes: this.changes.snapshotState(),
      catalogSnapshots: this.catalogSnapshots.list(),
      credentialVault: this.vault.snapshotState(),
      credentialMakers: [...this.credentialMakers.entries()],
      credentialCommands: [...this.credentialCommands.entries()].map(([commandId, value]) => ({ commandId, ...value })),
      providerAccountVerifications: [...this.providerAccountVerifications.values()],
      referenceCatalogSnapshots: this.referenceCatalogSnapshots.list(),
    };
  }

  private executeCredentialCommand(
    commandId: string,
    intent: Record<string, unknown>,
    work: () => Promise<CredentialMetadata>,
  ): Promise<CredentialMetadata> {
    if (commandId.length < 8 || commandId.length > 200) {
      throw new TypeError("Admin command ID must contain 8 to 200 characters.");
    }
    const intentHash = stableHash(intent);
    const existing = this.credentialCommands.get(commandId);
    if (existing) {
      if (existing.intentHash !== intentHash) {
        throw new AdminControlPlaneError("ADMIN_COMMAND_CONFLICT", "Admin command ID was reused with different intent.");
      }
      return Promise.resolve(structuredClone(existing.result));
    }
    return work().then((value) => {
      const result = structuredClone(value);
    this.credentialCommands.set(commandId, { intentHash, result });
    return structuredClone(result);
    });
  }

  private appendCredentialAudit(
    identity: AdminIdentity,
    action: string,
    metadata: CredentialMetadata,
    commandId: string,
  ): void {
    this.audit.append({
      identity,
      action,
      resourceType: "PROVIDER_CREDENTIAL",
      resourceId: `${metadata.providerId}:${metadata.accountId}:${metadata.environment}`,
      versionId: metadata.id,
      commandHash: stableHash({ commandId, credentialId: metadata.id, action }),
    });
  }
}
