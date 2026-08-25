import type { AdminChangeVersion, AdminResourceType } from "../../admin-control-plane/src/types.ts";
import { PostgresProviderControlPlaneRepository, type ProviderControlEntityType } from "./postgres-repository.ts";
import { ProviderControlPlaneError, type ImmutableVersion, type ReleaseBundle } from "./types.ts";
import type { PublicReferenceCatalogSnapshot } from "../../providers/src/reference-catalog-importers.ts";

const resourceTypeMap: Partial<Record<AdminResourceType, ProviderControlEntityType>> = {
  PROVIDER: "PROVIDER",
  PROVIDER_ACCOUNT: "PROVIDER_ACCOUNT",
  REFERENCE_CATALOG_SNAPSHOT: "CATALOG_SNAPSHOT",
  REFERENCE_MODEL: "REFERENCE_MODEL",
  ROUTE_CANDIDATE: "ROUTE_CANDIDATE",
  RELEASE_BUNDLE: "RELEASE_BUNDLE",
};

function entityType(resourceType: AdminResourceType): ProviderControlEntityType {
  const resolved = resourceTypeMap[resourceType];
  if (!resolved) {
    throw new ProviderControlPlaneError("INVALID_REFERENCE", "This Admin change is not a Provider Control Plane resource.");
  }
  return resolved;
}

function approvedEvidence(change: AdminChangeVersion): string {
  if ((change.state !== "APPROVED" && change.state !== "PUBLISHED")
    || !change.approverId || change.approverId === change.makerId
    || !change.validationEvidenceHash || !change.simulationEvidenceHash || !change.approvalEvidenceHash) {
    throw new ProviderControlPlaneError(
      "INVALID_REFERENCE",
      "A control-plane version can only be materialized from an independently approved Change Set with complete evidence.",
    );
  }
  return change.approvalEvidenceHash;
}

function materializedPayload(change: AdminChangeVersion): Record<string, unknown> {
  const { evidenceSha256: _evidenceSha256, ...payload } = structuredClone(change.payload);
  if (typeof payload.id !== "string" || payload.id !== change.resourceId) {
    throw new ProviderControlPlaneError("INVALID_REFERENCE", "Control-plane payload id must match the approved Admin resource id.");
  }
  return payload;
}

/**
 * One-way bridge from an independently approved Admin change to the durable control plane.
 * It deliberately accepts a completed Admin change object rather than a raw
 * HTTP payload, so a caller cannot bypass maker/checker by writing a route or
 * model directly to the repository.  Secrets are rejected again by the
 * repository as defense in depth.
 */
export class ProviderControlPlaneChangePublisher {
  constructor(private readonly repository: PostgresProviderControlPlaneRepository) {}

  async materialize(change: Readonly<AdminChangeVersion>, commandId: string): Promise<ImmutableVersion<Record<string, unknown>>> {
    const type = entityType(change.resourceType);
    const evidenceSha256 = approvedEvidence(change);
    const payload = materializedPayload(change);
    if (type === "RELEASE_BUNDLE") {
      const result = await this.repository.publishReleaseBundle({
        commandId,
        evidenceSha256,
        release: payload as ReleaseBundle,
      });
      return result.bundle as ImmutableVersion<Record<string, unknown>>;
    }
    return this.repository.appendVersion({
      entityType: type,
      entityId: change.resourceId,
      commandId,
      payload,
      evidenceSha256,
      effectiveAt: change.publishedAt ?? change.updatedAt,
    });
  }

  async materializeReferenceCatalog(change: Readonly<AdminChangeVersion>, snapshot: PublicReferenceCatalogSnapshot, commandId: string) {
    if (change.resourceType !== "REFERENCE_CATALOG_SNAPSHOT") {
      throw new ProviderControlPlaneError("INVALID_REFERENCE", "Only a reference catalog Change Set may materialize reference models.");
    }
    const approvalEvidenceSha256 = approvedEvidence(change);
    if (change.resourceId !== snapshot.id || snapshot.providerId !== change.payload.providerId
      || snapshot.manifestSha256 !== change.payload.manifestSha256 || snapshot.rawPayloadSha256 !== change.payload.rawPayloadSha256) {
      throw new ProviderControlPlaneError("INVALID_REFERENCE", "Approved Change Set does not match the immutable reference catalog snapshot.");
    }
    return this.repository.appendReferenceCatalog({
      commandId,
      approvalEvidenceSha256,
      effectiveAt: change.publishedAt ?? change.updatedAt,
      snapshot: {
        id: snapshot.id, providerId: snapshot.providerId, observedAt: snapshot.observedAt,
        sourceUrls: snapshot.sourceUrls, rawPayloadSha256: snapshot.rawPayloadSha256,
        manifestSha256: snapshot.manifestSha256, parserVersion: snapshot.parserVersion, sourceScope: snapshot.sourceScope,
      },
      models: snapshot.models.map((model) => ({
        id: model.id, providerId: model.providerId, providerModelId: model.providerModelId, familyId: model.familyId,
        displayName: model.displayName, modalities: model.modalities, state: model.state, catalogSnapshotId: snapshot.id,
        sourceEvidenceSha256: model.sourceEvidenceSha256, canonicalSlug: model.canonicalSlug,
        supportedParameters: model.supportedParameters, sourceUrls: model.sourceUrls,
        taxonomyHint: model.taxonomyHint,
      })),
    });
  }
}
