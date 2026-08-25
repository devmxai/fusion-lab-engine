import { CommercialEngineError, type CommercialRegistrySnapshot, type ProviderRouteVersion } from "./types.js";

function requireUniqueIds(values: Array<{ id: string }>, label: string): void {
  if (new Set(values.map(({ id }) => id)).size !== values.length) {
    throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", `${label} contains duplicate immutable version IDs.`);
  }
}

function everyCertificationCheckPasses(route: ProviderRouteVersion): boolean {
  const { scope: _scope, owner, canaryEvidenceId, ...checks } = route.certification;
  return owner.length > 0
    && canaryEvidenceId.length > 0
    && Object.values(checks).every((value) => value === true);
}

export class VersionedCommercialRegistry {
  private readonly snapshots = new Map<string, CommercialRegistrySnapshot>();
  private activeSnapshotId: string | null = null;

  registerSnapshot(snapshot: CommercialRegistrySnapshot): void {
    if (this.snapshots.has(snapshot.id)) {
      throw new CommercialEngineError("DUPLICATE_REGISTRY_SNAPSHOT", "A registry snapshot version is immutable and cannot be overwritten.");
    }
    this.validate(snapshot);
    this.snapshots.set(snapshot.id, structuredClone(snapshot));
  }

  activate(snapshotId: string): void {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot || snapshot.status !== "PUBLISHED") {
      throw new CommercialEngineError("REGISTRY_NOT_PUBLISHED", "Only a published registry snapshot can become active.");
    }
    this.activeSnapshotId = snapshotId;
  }

  active(): CommercialRegistrySnapshot {
    if (!this.activeSnapshotId) {
      throw new CommercialEngineError("NO_ACTIVE_REGISTRY", "No commercial registry snapshot is active.");
    }
    return this.require(this.activeSnapshotId);
  }

  require(snapshotId: string): CommercialRegistrySnapshot {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", "Registry snapshot does not exist.");
    return structuredClone(snapshot);
  }

  private validate(snapshot: CommercialRegistrySnapshot): void {
    requireUniqueIds(snapshot.families, "families");
    requireUniqueIds(snapshot.recipes, "recipes");
    requireUniqueIds(snapshot.capabilities, "capabilities");
    requireUniqueIds(snapshot.billingManifests, "billing manifests");
    requireUniqueIds(snapshot.costVersions, "cost versions");
    requireUniqueIds(snapshot.customerPriceVersions, "customer prices");
    requireUniqueIds(snapshot.routingPolicyVersions, "routing policies");
    requireUniqueIds(snapshot.routes, "routes");

    const familyIds = new Set(snapshot.families.map(({ id }) => id));
    const capabilityIds = new Set(snapshot.capabilities.map(({ id }) => id));
    const billingIds = new Set(snapshot.billingManifests.map(({ id }) => id));
    const costIds = new Set(snapshot.costVersions.map(({ id }) => id));
    for (const recipe of snapshot.recipes) {
      if (recipe.familyVersionIds.some((id) => !familyIds.has(id))) {
        throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", `Recipe ${recipe.id} references an unknown family version.`);
      }
    }
    for (const route of snapshot.routes) {
      if (
        !familyIds.has(route.familyVersionId)
        || !capabilityIds.has(route.capabilityVersionId)
        || !billingIds.has(route.billingManifestVersionId)
        || !costIds.has(route.costVersionId)
      ) {
        throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", `Route ${route.id} has an unresolved immutable version reference.`);
      }
      if (route.lifecycle === "PUBLISHED" && !everyCertificationCheckPasses(route)) {
        throw new CommercialEngineError("UNCERTIFIED_PUBLISHED_ROUTE", `Published route ${route.id} is missing certification evidence.`);
      }
      if (route.privacy.allowsTraining !== false || route.adapterVersion.length === 0) {
        throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", `Route ${route.id} violates privacy or adapter version requirements.`);
      }
    }
    for (const cost of snapshot.costVersions) {
      if (
        cost.nativeUnitReplacementCostMicrousd < 0n
        || cost.riskBufferBps < 0n
        || cost.maximumCostMultiplierBps < 10_000n
        || !/^[a-f0-9]{64}$/.test(cost.source.snapshotHash)
      ) {
        throw new CommercialEngineError("INVALID_REGISTRY_REFERENCE", `Cost version ${cost.id} is not auditable.`);
      }
    }
    for (const price of snapshot.customerPriceVersions) {
      if (
        price.creditValueFloorMicrousd <= 0n
        || price.allowedCreditStep <= 0n
        || price.minimumChargeCredits <= 0n
        || price.targetContributionMarginBps < 0n
        || price.targetContributionMarginBps >= 10_000n
        || price.hardFloorMarginBps < 0n
      ) {
        throw new CommercialEngineError("INVALID_PRICE_POLICY", `Customer price version ${price.id} is invalid.`);
      }
    }
  }
}
