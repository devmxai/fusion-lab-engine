export type AdminRole =
  | "ADMIN_VIEWER"
  | "SUPPORT_OPERATOR"
  | "FINANCE_MAKER"
  | "FINANCE_APPROVER"
  | "PRICING_MAKER"
  | "PRICING_APPROVER"
  | "ROUTE_MAKER"
  | "ROUTE_APPROVER"
  | "TREASURY_OPERATOR"
  | "SECURITY_OPERATOR"
  | "PUBLISHER"
  | "AUDITOR"
  | "SUPER_ADMIN";

export type AdminIdentity = {
  actorId: string;
  roles: readonly AdminRole[];
  assuranceLevel: 1 | 2;
};

export type AdminResourceType =
  | "PRICING_POLICY"
  | "ROUTE_CONTROL"
  | "TREASURY_POLICY"
  | "PROVIDER_CREDENTIAL"
  | "FINANCIAL_ADJUSTMENT"
  | "USER_ANONYMIZATION"
  | "CATALOG_SNAPSHOT"
  | "REFERENCE_CATALOG_SNAPSHOT"
  | "PROVIDER"
  | "PROVIDER_ACCOUNT"
  | "REFERENCE_MODEL"
  | "ROUTE_CANDIDATE"
  | "RELEASE_BUNDLE"
  | "PUBLISHED_OFFER";

export type AdminChangeState =
  | "DRAFT"
  | "VALIDATED"
  | "SIMULATED"
  | "APPROVED"
  | "PUBLISHED"
  | "REJECTED";

export type AdminChangeVersion = {
  id: string;
  resourceType: AdminResourceType;
  resourceId: string;
  version: number;
  state: AdminChangeState;
  payload: Record<string, unknown>;
  payloadHash: string;
  makerId: string;
  validatorId: string | null;
  simulatorId: string | null;
  approverId: string | null;
  publisherId: string | null;
  validationEvidenceHash: string | null;
  simulationEvidenceHash: string | null;
  approvalEvidenceHash: string | null;
  supersedesVersionId: string | null;
  rollbackOfVersionId: string | null;
  reasonCode: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type AuditRecord = {
  sequence: number;
  id: string;
  actorId: string;
  action: string;
  resourceType: AdminResourceType;
  resourceId: string;
  versionId: string;
  commandHash: string;
  previousHash: string;
  recordHash: string;
  occurredAt: string;
};

export type CredentialMetadata = {
  id: string;
  providerId: string;
  accountId: string;
  environment: "LOCAL" | "STAGING" | "PRODUCTION";
  purpose: "PROVIDER_GENERATION_KEY" | "PROVIDER_WEBHOOK_HMAC" | "PROVIDER_MANAGEMENT_KEY";
  fingerprint: string;
  version: number;
  status: "PENDING_TEST" | "TESTED" | "ACTIVE" | "REVOKED";
  createdAt: string;
  testedAt: string | null;
  activatedAt: string | null;
  revokedAt: string | null;
};

export class AdminControlPlaneError extends Error {
  constructor(
    public readonly code:
      | "AAL2_REQUIRED"
      | "ADMIN_PERMISSION_DENIED"
      | "ADMIN_COMMAND_CONFLICT"
      | "CHANGE_NOT_FOUND"
      | "ILLEGAL_CHANGE_TRANSITION"
      | "MAKER_CHECKER_REQUIRED"
      | "VALIDATION_FAILED"
      | "SIMULATION_FAILED"
      | "IMMUTABLE_VERSION"
      | "SECRET_REVEAL_PROHIBITED"
      | "CREDENTIAL_NOT_FOUND"
      | "CREDENTIAL_ILLEGAL_TRANSITION",
    message: string,
  ) {
    super(message);
    this.name = "AdminControlPlaneError";
  }
}
