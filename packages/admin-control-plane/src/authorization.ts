import { AdminControlPlaneError, type AdminIdentity, type AdminResourceType, type AdminRole } from "./types.js";

export type AdminAction =
  | "READ"
  | "DRAFT"
  | "VALIDATE"
  | "SIMULATE"
  | "APPROVE"
  | "PUBLISH"
  | "WRITE_SECRET"
  | "TEST_SECRET"
  | "ACTIVATE_SECRET"
  | "REVOKE_SECRET";

const permissionRoles: Record<AdminAction, readonly AdminRole[]> = {
  READ: ["ADMIN_VIEWER", "AUDITOR", "SUPER_ADMIN"],
  DRAFT: ["FINANCE_MAKER", "PRICING_MAKER", "ROUTE_MAKER", "TREASURY_OPERATOR", "SECURITY_OPERATOR", "SUPER_ADMIN"],
  VALIDATE: ["FINANCE_APPROVER", "PRICING_APPROVER", "ROUTE_APPROVER", "TREASURY_OPERATOR", "SECURITY_OPERATOR", "SUPER_ADMIN"],
  SIMULATE: ["FINANCE_APPROVER", "PRICING_APPROVER", "ROUTE_APPROVER", "TREASURY_OPERATOR", "SUPER_ADMIN"],
  APPROVE: ["FINANCE_APPROVER", "PRICING_APPROVER", "ROUTE_APPROVER", "SECURITY_OPERATOR", "SUPER_ADMIN"],
  PUBLISH: ["PUBLISHER", "SUPER_ADMIN"],
  WRITE_SECRET: ["SECURITY_OPERATOR", "SUPER_ADMIN"],
  TEST_SECRET: ["SECURITY_OPERATOR", "SUPER_ADMIN"],
  ACTIVATE_SECRET: ["SECURITY_OPERATOR", "SUPER_ADMIN"],
  REVOKE_SECRET: ["SECURITY_OPERATOR", "SUPER_ADMIN"],
};

const makerByResource: Partial<Record<AdminResourceType, readonly AdminRole[]>> = {
  PRICING_POLICY: ["PRICING_MAKER", "SUPER_ADMIN"],
  ROUTE_CONTROL: ["ROUTE_MAKER", "SUPER_ADMIN"],
  TREASURY_POLICY: ["TREASURY_OPERATOR", "SUPER_ADMIN"],
  PROVIDER_CREDENTIAL: ["SECURITY_OPERATOR", "SUPER_ADMIN"],
  FINANCIAL_ADJUSTMENT: ["FINANCE_MAKER", "SUPER_ADMIN"],
  USER_ANONYMIZATION: ["SUPPORT_OPERATOR", "SECURITY_OPERATOR", "SUPER_ADMIN"],
  CATALOG_SNAPSHOT: ["ROUTE_MAKER", "SUPER_ADMIN"],
  REFERENCE_CATALOG_SNAPSHOT: ["ROUTE_MAKER", "SUPER_ADMIN"],
  PROVIDER: ["SECURITY_OPERATOR", "SUPER_ADMIN"],
  PROVIDER_ACCOUNT: ["SECURITY_OPERATOR", "SUPER_ADMIN"],
  REFERENCE_MODEL: ["ROUTE_MAKER", "SUPER_ADMIN"],
  ROUTE_CANDIDATE: ["ROUTE_MAKER", "SUPER_ADMIN"],
  RELEASE_BUNDLE: ["ROUTE_MAKER", "PRICING_MAKER", "SUPER_ADMIN"],
  PUBLISHED_OFFER: ["ROUTE_MAKER", "PRICING_MAKER", "SUPER_ADMIN"],
};

const approverByResource: Partial<Record<AdminResourceType, readonly AdminRole[]>> = {
  PRICING_POLICY: ["PRICING_APPROVER", "SUPER_ADMIN"],
  ROUTE_CONTROL: ["ROUTE_APPROVER", "SUPER_ADMIN"],
  TREASURY_POLICY: ["FINANCE_APPROVER", "SUPER_ADMIN"],
  PROVIDER_CREDENTIAL: ["SECURITY_OPERATOR", "SUPER_ADMIN"],
  FINANCIAL_ADJUSTMENT: ["FINANCE_APPROVER", "SUPER_ADMIN"],
  USER_ANONYMIZATION: ["SECURITY_OPERATOR", "SUPER_ADMIN"],
  CATALOG_SNAPSHOT: ["ROUTE_APPROVER", "SUPER_ADMIN"],
  REFERENCE_CATALOG_SNAPSHOT: ["ROUTE_APPROVER", "SUPER_ADMIN"],
  PROVIDER: ["SECURITY_OPERATOR", "SUPER_ADMIN"],
  PROVIDER_ACCOUNT: ["SECURITY_OPERATOR", "SUPER_ADMIN"],
  REFERENCE_MODEL: ["ROUTE_APPROVER", "SUPER_ADMIN"],
  ROUTE_CANDIDATE: ["ROUTE_APPROVER", "SUPER_ADMIN"],
  RELEASE_BUNDLE: ["ROUTE_APPROVER", "PRICING_APPROVER", "FINANCE_APPROVER", "SUPER_ADMIN"],
  PUBLISHED_OFFER: ["ROUTE_APPROVER", "PRICING_APPROVER", "SUPER_ADMIN"],
};

/** Server-owned workflow policy projection for read-only Admin guidance. */
export function adminWorkflowRequirement(resourceType: AdminResourceType): {
  makerRoles: readonly AdminRole[];
  validatorRoles: readonly AdminRole[];
  simulatorRoles: readonly AdminRole[];
  approverRoles: readonly AdminRole[];
  publisherRoles: readonly AdminRole[];
} {
  return {
    makerRoles: [...(makerByResource[resourceType] ?? permissionRoles.DRAFT)],
    validatorRoles: [...permissionRoles.VALIDATE],
    simulatorRoles: [...permissionRoles.SIMULATE],
    approverRoles: [...(approverByResource[resourceType] ?? permissionRoles.APPROVE)],
    publisherRoles: [...permissionRoles.PUBLISH],
  };
}

export function requireAdminPermission(
  identity: AdminIdentity,
  action: AdminAction,
  resourceType?: AdminResourceType,
): void {
  const superAdminSetupAtAal1 = identity.roles.includes("SUPER_ADMIN") && (
    resourceType === "PROVIDER_CREDENTIAL"
    || (action === "DRAFT" && (resourceType === "REFERENCE_CATALOG_SNAPSHOT" || resourceType === "ROUTE_CANDIDATE" || resourceType === "PRICING_POLICY"))
  );
  if (!identity.actorId || (action !== "READ" && identity.assuranceLevel !== 2 && !superAdminSetupAtAal1)) {
    throw new AdminControlPlaneError("AAL2_REQUIRED", "Sensitive Admin commands require an AAL2 identity.");
  }
  let allowed = permissionRoles[action];
  if (action === "DRAFT" && resourceType) allowed = makerByResource[resourceType] ?? allowed;
  if (action === "APPROVE" && resourceType) allowed = approverByResource[resourceType] ?? allowed;
  if (!identity.roles.some((role) => allowed.includes(role))) {
    throw new AdminControlPlaneError("ADMIN_PERMISSION_DENIED", "Admin identity lacks the required scoped role.");
  }
}

/**
 * Returns the server policy decision without performing a command.  This is
 * intentionally kept beside `requireAdminPermission` so read models and UI
 * capability projections cannot drift from the command boundary.
 */
export function hasAdminPermission(
  identity: AdminIdentity,
  action: AdminAction,
  resourceType?: AdminResourceType,
): boolean {
  try {
    requireAdminPermission(identity, action, resourceType);
    return true;
  } catch (error) {
    if (error instanceof AdminControlPlaneError) return false;
    throw error;
  }
}
