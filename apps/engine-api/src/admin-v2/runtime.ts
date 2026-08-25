import type { AdminChangeVersion } from "../../../../packages/admin-control-plane/src/types.ts";

type PublishedControl = {
  versionId: string;
  version: number;
  payload: Record<string, unknown>;
  publishedAt: string;
};

export class LocalAdminRuntimeControls {
  private readonly routeControls = new Map<string, PublishedControl>();
  private readonly pricingPolicies = new Map<string, PublishedControl>();
  private readonly treasuryPolicies = new Map<string, PublishedControl>();
  private readonly anonymizedUsers = new Map<string, PublishedControl>();

  publish(change: Readonly<AdminChangeVersion>): void {
    if (change.state !== "APPROVED") throw new Error("admin_runtime_requires_approved_change");
    const control = {
      versionId: change.id,
      version: change.version,
      payload: structuredClone(change.payload),
      publishedAt: new Date().toISOString(),
    };
    if (change.resourceType === "ROUTE_CONTROL") this.routeControls.set(change.resourceId, control);
    if (change.resourceType === "PRICING_POLICY") this.pricingPolicies.set(change.resourceId, control);
    if (change.resourceType === "TREASURY_POLICY") this.treasuryPolicies.set(change.resourceId, control);
    if (change.resourceType === "USER_ANONYMIZATION") this.anonymizedUsers.set(change.resourceId, control);
  }

  routeDispatch(providerId: string, modelId: string): { allowed: boolean; reasonCode: string | null; versionId: string | null } {
    const control = this.routeControls.get(`${providerId}:${modelId}`);
    if (!control) return { allowed: true, reasonCode: null, versionId: null };
    const stopped = control.payload.enabled === true;
    return {
      allowed: !stopped,
      reasonCode: stopped && typeof control.payload.reasonCode === "string" ? control.payload.reasonCode : null,
      versionId: control.versionId,
    };
  }

  snapshot() {
    const entries = (values: Map<string, PublishedControl>) => [...values].map(([resourceId, control]) => ({
      resourceId,
      ...structuredClone(control),
    }));
    return {
      routeControls: entries(this.routeControls),
      pricingPolicies: entries(this.pricingPolicies),
      treasuryPolicies: entries(this.treasuryPolicies),
      anonymizedUsers: entries(this.anonymizedUsers),
    };
  }
}
