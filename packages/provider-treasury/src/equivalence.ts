import { ProviderTreasuryError } from "./types.ts";

export type ExactEquivalenceMember = {
  routeVersionId: string;
  semanticContractHash: string;
  capabilityEvidenceHash: string;
  qualityEvidenceHash: string;
};

export type ExactEquivalenceGroup = {
  id: string;
  familyVersionId: string;
  approvedAt: string;
  approver: string;
  members: ExactEquivalenceMember[];
};

export class ExactEquivalenceRegistry {
  private readonly groups = new Map<string, ExactEquivalenceGroup>();

  register(group: ExactEquivalenceGroup): void {
    if (this.groups.has(group.id)) {
      throw new ProviderTreasuryError("EQUIVALENCE_CONFLICT", "Exact equivalence groups are immutable.");
    }
    if (group.members.length < 2 || !group.approver || Number.isNaN(Date.parse(group.approvedAt))) {
      throw new ProviderTreasuryError("EQUIVALENCE_CONFLICT", "Equivalence needs two routes, evidence, approver and date.");
    }
    const routeIds = new Set(group.members.map(({ routeVersionId }) => routeVersionId));
    const semanticHashes = new Set(group.members.map(({ semanticContractHash }) => semanticContractHash));
    if (
      routeIds.size !== group.members.length
      || semanticHashes.size !== 1
      || group.members.some((member) =>
        !/^[a-f0-9]{64}$/.test(member.semanticContractHash)
        || !/^[a-f0-9]{64}$/.test(member.capabilityEvidenceHash)
        || !/^[a-f0-9]{64}$/.test(member.qualityEvidenceHash))
    ) {
      throw new ProviderTreasuryError("EQUIVALENCE_CONFLICT", "Exact equivalence evidence or semantic contract does not match.");
    }
    this.groups.set(group.id, structuredClone(group));
  }

  requireExactFallback(fromRouteVersionId: string, toRouteVersionId: string): ExactEquivalenceGroup {
    const group = [...this.groups.values()].find(({ members }) => {
      const routes = new Set(members.map(({ routeVersionId }) => routeVersionId));
      return routes.has(fromRouteVersionId) && routes.has(toRouteVersionId);
    });
    if (!group) {
      throw new ProviderTreasuryError(
        "EXACT_EQUIVALENCE_REQUIRED",
        "Cross-provider Exact fallback requires an approved equivalence group.",
      );
    }
    return structuredClone(group);
  }

  snapshot(): ReadonlyArray<Readonly<ExactEquivalenceGroup>> {
    return structuredClone([...this.groups.values()]);
  }
}
