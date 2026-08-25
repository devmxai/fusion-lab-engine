import { createHash, randomUUID } from "node:crypto";
import { AdminControlPlaneError, type AdminIdentity, type CredentialMetadata } from "./types.ts";
import { requireAdminPermission } from "./authorization.ts";
import type { SecretPurpose, SecretStore } from "./secret-store.ts";

type StoredCredential = { metadata: CredentialMetadata; secret: string };

export class WriteOnlyCredentialVault {
  private readonly credentials = new Map<string, StoredCredential>();

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
  ) {}

  write(identity: AdminIdentity, input: {
    providerId: string;
    accountId: string;
    environment: CredentialMetadata["environment"];
    secret: string;
    purpose?: CredentialMetadata["purpose"];
  }): CredentialMetadata {
    requireAdminPermission(identity, "WRITE_SECRET", "PROVIDER_CREDENTIAL");
    if (input.secret.length < 12 || !input.providerId || !input.accountId) {
      throw new TypeError("Credential identity and a non-empty secret are required.");
    }
    const existing = [...this.credentials.values()]
      .filter(({ metadata }) => metadata.providerId === input.providerId
        && metadata.accountId === input.accountId
        && metadata.environment === input.environment)
      .sort((left, right) => right.metadata.version - left.metadata.version)[0];
    const timestamp = this.now().toISOString();
    const metadata: CredentialMetadata = {
      id: this.id(),
      providerId: input.providerId,
      accountId: input.accountId,
      environment: input.environment,
      purpose: input.purpose ?? "PROVIDER_GENERATION_KEY",
      fingerprint: createHash("sha256").update(input.secret).digest("hex").slice(0, 16),
      version: (existing?.metadata.version ?? 0) + 1,
      status: "PENDING_TEST",
      createdAt: timestamp,
      testedAt: null,
      activatedAt: null,
      revokedAt: null,
    };
    this.credentials.set(metadata.id, { metadata, secret: input.secret });
    return structuredClone(metadata);
  }

  test(identity: AdminIdentity, credentialId: string, tester: (secret: string) => boolean): CredentialMetadata {
    requireAdminPermission(identity, "TEST_SECRET", "PROVIDER_CREDENTIAL");
    const stored = this.require(credentialId);
    if (stored.metadata.status !== "PENDING_TEST" || !tester(stored.secret)) {
      throw new AdminControlPlaneError("CREDENTIAL_ILLEGAL_TRANSITION", "Credential test failed or is not allowed.");
    }
    stored.metadata.status = "TESTED";
    stored.metadata.testedAt = this.now().toISOString();
    return structuredClone(stored.metadata);
  }

  activate(identity: AdminIdentity, credentialId: string, makerId: string): CredentialMetadata {
    requireAdminPermission(identity, "ACTIVATE_SECRET", "PROVIDER_CREDENTIAL");
    if (identity.actorId === makerId) {
      throw new AdminControlPlaneError("MAKER_CHECKER_REQUIRED", "Credential activation requires a distinct maker and approver.");
    }
    const stored = this.require(credentialId);
    if (stored.metadata.status !== "TESTED") {
      throw new AdminControlPlaneError("CREDENTIAL_ILLEGAL_TRANSITION", "Only a tested credential can become active.");
    }
    for (const candidate of this.credentials.values()) {
      if (
        candidate.metadata.id !== credentialId
        && candidate.metadata.providerId === stored.metadata.providerId
        && candidate.metadata.accountId === stored.metadata.accountId
        && candidate.metadata.environment === stored.metadata.environment
        && candidate.metadata.status === "ACTIVE"
      ) {
        candidate.metadata.status = "REVOKED";
        candidate.metadata.revokedAt = this.now().toISOString();
      }
    }
    stored.metadata.status = "ACTIVE";
    stored.metadata.activatedAt = this.now().toISOString();
    return structuredClone(stored.metadata);
  }

  revoke(identity: AdminIdentity, credentialId: string): CredentialMetadata {
    requireAdminPermission(identity, "REVOKE_SECRET", "PROVIDER_CREDENTIAL");
    const stored = this.require(credentialId);
    if (stored.metadata.status === "REVOKED") return structuredClone(stored.metadata);
    stored.metadata.status = "REVOKED";
    stored.metadata.revokedAt = this.now().toISOString();
    stored.secret = "";
    return structuredClone(stored.metadata);
  }

  metadata(identity: AdminIdentity): ReadonlyArray<Readonly<CredentialMetadata>> {
    requireAdminPermission(identity, "READ");
    return structuredClone([...this.credentials.values()].map(({ metadata }) => metadata));
  }

  reveal(): never {
    throw new AdminControlPlaneError("SECRET_REVEAL_PROHIBITED", "Admin APIs never reveal stored credential values.");
  }

  private require(credentialId: string): StoredCredential {
    const stored = this.credentials.get(credentialId);
    if (!stored) throw new AdminControlPlaneError("CREDENTIAL_NOT_FOUND", "Credential does not exist.");
    return stored;
  }
}

export type SecretBackedCredentialVaultState = Readonly<{ credentials: CredentialMetadata[] }>;

/**
 * Credential metadata lives in the Admin control plane; secret bytes live
 * exclusively in SecretStore.  This is the vault used by the Engine Admin
 * service.  The legacy in-memory class above remains for isolated old tests
 * only and must never be selected by a real provider setup path.
 */
export class SecretBackedCredentialVault {
  private readonly credentials = new Map<string, CredentialMetadata>();

  constructor(
    private readonly secrets: SecretStore,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
  ) {}

  async write(identity: AdminIdentity, input: {
    providerId: string;
    accountId: string;
    environment: CredentialMetadata["environment"];
    purpose: SecretPurpose;
    secret: string;
  }): Promise<CredentialMetadata> {
    requireAdminPermission(identity, "WRITE_SECRET", "PROVIDER_CREDENTIAL");
    if (!input.providerId || !input.accountId || input.secret.length < 12) throw new TypeError("Credential identity and a non-empty secret are required.");
    const existing = [...this.credentials.values()]
      .filter((metadata) => metadata.providerId === input.providerId && metadata.accountId === input.accountId
        && metadata.environment === input.environment && metadata.purpose === input.purpose)
      .sort((left, right) => right.version - left.version)[0];
    const reference = await this.secrets.put({
      id: this.id(), purpose: input.purpose, version: (existing?.version ?? 0) + 1,
      secret: new TextEncoder().encode(input.secret),
    });
    const metadata: CredentialMetadata = {
      id: reference.id, providerId: input.providerId, accountId: input.accountId, environment: input.environment,
      purpose: reference.purpose, fingerprint: reference.fingerprint, version: reference.version,
      status: "PENDING_TEST", createdAt: reference.createdAt, testedAt: null, activatedAt: null, revokedAt: null,
    };
    this.credentials.set(metadata.id, metadata);
    return structuredClone(metadata);
  }

  async test(identity: AdminIdentity, credentialId: string, tester: (secret: Uint8Array, metadata: CredentialMetadata) => Promise<boolean> | boolean): Promise<CredentialMetadata> {
    requireAdminPermission(identity, "TEST_SECRET", "PROVIDER_CREDENTIAL");
    const metadata = this.require(credentialId);
    if (metadata.status !== "PENDING_TEST") throw new AdminControlPlaneError("CREDENTIAL_ILLEGAL_TRANSITION", "Only pending credentials can be tested.");
    const tested = await this.secrets.use(credentialId, (secret) => tester(secret, structuredClone(metadata)));
    if (!tested) throw new AdminControlPlaneError("CREDENTIAL_ILLEGAL_TRANSITION", "Credential verification failed.");
    const next = { ...metadata, status: "TESTED" as const, testedAt: this.now().toISOString() };
    this.credentials.set(credentialId, next);
    return structuredClone(next);
  }

  /** Same transition as test(), while retaining server-only verification evidence for the caller. */
  async testWithEvidence<T>(identity: AdminIdentity, credentialId: string, tester: (secret: Uint8Array, metadata: CredentialMetadata) => Promise<T> | T, accepted: (result: T) => boolean): Promise<{ metadata: CredentialMetadata; result: T }> {
    requireAdminPermission(identity, "TEST_SECRET", "PROVIDER_CREDENTIAL");
    const metadata = this.require(credentialId);
    if (metadata.status !== "PENDING_TEST") throw new AdminControlPlaneError("CREDENTIAL_ILLEGAL_TRANSITION", "Only pending credentials can be tested.");
    const result = await this.secrets.use(credentialId, (secret) => tester(secret, structuredClone(metadata)));
    if (!accepted(result)) throw new AdminControlPlaneError("CREDENTIAL_ILLEGAL_TRANSITION", "Credential verification failed.");
    const next = { ...metadata, status: "TESTED" as const, testedAt: this.now().toISOString() };
    this.credentials.set(credentialId, next);
    return { metadata: structuredClone(next), result };
  }

  async activate(identity: AdminIdentity, credentialId: string, makerId: string): Promise<CredentialMetadata> {
    requireAdminPermission(identity, "ACTIVATE_SECRET", "PROVIDER_CREDENTIAL");
    if (identity.actorId === makerId) throw new AdminControlPlaneError("MAKER_CHECKER_REQUIRED", "Credential activation requires a distinct maker and approver.");
    const metadata = this.require(credentialId);
    if (metadata.status !== "TESTED") throw new AdminControlPlaneError("CREDENTIAL_ILLEGAL_TRANSITION", "Only a tested credential can become active.");
    const timestamp = this.now().toISOString();
    for (const candidate of this.credentials.values()) {
      if (candidate.id !== credentialId && candidate.providerId === metadata.providerId && candidate.accountId === metadata.accountId
        && candidate.environment === metadata.environment && candidate.purpose === metadata.purpose && candidate.status === "ACTIVE") {
        await this.secrets.revoke(candidate.id);
        this.credentials.set(candidate.id, { ...candidate, status: "REVOKED", revokedAt: timestamp });
      }
    }
    const next = { ...metadata, status: "ACTIVE" as const, activatedAt: timestamp };
    this.credentials.set(credentialId, next);
    return structuredClone(next);
  }

  async revoke(identity: AdminIdentity, credentialId: string): Promise<CredentialMetadata> {
    requireAdminPermission(identity, "REVOKE_SECRET", "PROVIDER_CREDENTIAL");
    const metadata = this.require(credentialId);
    if (metadata.status === "REVOKED") return structuredClone(metadata);
    const reference = await this.secrets.revoke(credentialId);
    const next = { ...metadata, status: "REVOKED" as const, revokedAt: reference.revokedAt ?? this.now().toISOString() };
    this.credentials.set(credentialId, next);
    return structuredClone(next);
  }

  /**
   * Server-runtime-only credential lease. It verifies the exact provider,
   * account, purpose, and version before delegating to the write-only store.
   * Neither Admin projections nor callers receive the secret outside `work`.
   */
  async useActiveProviderGenerationCredential<T>(input: {
    credentialReferenceId: string;
    credentialVersion: number;
    providerId: string;
    providerAccountId: string;
  }, work: (secret: Uint8Array) => Promise<T>): Promise<T> {
    const metadata = this.require(input.credentialReferenceId);
    if (metadata.status !== "ACTIVE" || metadata.purpose !== "PROVIDER_GENERATION_KEY"
      || metadata.version !== input.credentialVersion || metadata.providerId !== input.providerId
      || metadata.accountId !== input.providerAccountId) {
      throw new AdminControlPlaneError("CREDENTIAL_ILLEGAL_TRANSITION", "Runtime credential lease does not match one active provider generation credential.");
    }
    return this.secrets.use(metadata.id, work);
  }

  /**
   * Release-time gate: verifies metadata only and deliberately does not lease
   * or decrypt the key.  It is safe for the control plane to call before it
   * commits an immutable Release Bundle.
   */
  assertActiveProviderGenerationCredential(input: { credentialReferenceId: string; credentialVersion: number }): CredentialMetadata {
    const metadata = this.require(input.credentialReferenceId);
    if (metadata.status !== "ACTIVE" || metadata.purpose !== "PROVIDER_GENERATION_KEY" || metadata.version !== input.credentialVersion) {
      throw new AdminControlPlaneError("CREDENTIAL_ILLEGAL_TRANSITION", "Release bundle requires an exact active provider generation credential.");
    }
    return structuredClone(metadata);
  }

  metadata(identity: AdminIdentity): ReadonlyArray<Readonly<CredentialMetadata>> {
    requireAdminPermission(identity, "READ");
    return structuredClone([...this.credentials.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
  }

  snapshotState(): SecretBackedCredentialVaultState { return { credentials: structuredClone([...this.credentials.values()]) }; }

  restoreState(state: SecretBackedCredentialVaultState): void {
    if (!Array.isArray(state.credentials) || new Set(state.credentials.map((metadata) => metadata.id)).size !== state.credentials.length) throw new TypeError("credential_vault_restore_invalid");
    this.credentials.clear();
    for (const metadata of state.credentials) this.credentials.set(metadata.id, structuredClone(metadata));
  }

  private require(credentialId: string): CredentialMetadata {
    const metadata = this.credentials.get(credentialId);
    if (!metadata) throw new AdminControlPlaneError("CREDENTIAL_NOT_FOUND", "Credential does not exist.");
    return metadata;
  }
}
