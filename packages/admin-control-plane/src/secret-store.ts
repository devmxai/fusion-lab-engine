import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type SecretPurpose = "PROVIDER_GENERATION_KEY" | "PROVIDER_WEBHOOK_HMAC" | "PROVIDER_MANAGEMENT_KEY";

export type SecretReference = Readonly<{
  id: string;
  purpose: SecretPurpose;
  version: number;
  fingerprint: string;
  createdAt: string;
  revokedAt: string | null;
}>;

export class SecretStoreError extends Error {
  constructor(readonly code: "SECRET_NOT_FOUND" | "SECRET_REVOKED" | "SECRET_STORE_INTEGRITY", message: string) {
    super(message);
    this.name = "SecretStoreError";
  }
}

/** A secret can only be supplied to a server-owned callback; it is never returned to an API caller. */
export interface SecretStore {
  put(input: { id?: string; purpose: SecretPurpose; version: number; secret: Uint8Array }): Promise<SecretReference>;
  use<T>(referenceId: string, work: (secret: Uint8Array) => Promise<T> | T): Promise<T>;
  revoke(referenceId: string): Promise<SecretReference>;
  metadata(): Promise<ReadonlyArray<SecretReference>>;
}

/** Fail-closed placeholder used when a local master key was not configured. */
export class UnavailableSecretStore implements SecretStore {
  private unavailable(): never { throw new SecretStoreError("SECRET_STORE_INTEGRITY", "Secret storage is not configured for this Engine instance."); }
  async put(_input: { id?: string; purpose: SecretPurpose; version: number; secret: Uint8Array }): Promise<SecretReference> { return this.unavailable(); }
  async use<T>(_referenceId: string, _work: (secret: Uint8Array) => Promise<T> | T): Promise<T> { return this.unavailable(); }
  async revoke(_referenceId: string): Promise<SecretReference> { return this.unavailable(); }
  async metadata(): Promise<ReadonlyArray<SecretReference>> { return []; }
}

type EncryptedRecord = SecretReference & Readonly<{ nonce: string; ciphertext: string; authTag: string }>;
type PersistedFile = Readonly<{ schemaVersion: 1; records: EncryptedRecord[] }>;

function asReference(record: EncryptedRecord): SecretReference {
  const { nonce: _nonce, ciphertext: _ciphertext, authTag: _authTag, ...reference } = record;
  return structuredClone(reference);
}
function assertKey(key: Uint8Array): void {
  if (key.byteLength !== 32) throw new TypeError("local_secret_store_key_must_be_32_bytes");
}
function assertSecret(secret: Uint8Array): void {
  if (secret.byteLength < 12 || secret.byteLength > 16_384) throw new TypeError("secret_length_out_of_range");
}

/**
 * Local-only encrypted store for offline development and tests.  It persists
 * ciphertext but deliberately requires a caller-provided 32-byte master key;
 * it never writes that key next to the encrypted data.  Production must supply
 * a managed SecretStore implementation (KMS/secret manager) behind this same
 * interface rather than reusing this file implementation.
 */
export class LocalEncryptedFileSecretStore implements SecretStore {
  private loaded = false;
  private readonly records = new Map<string, EncryptedRecord>();

  constructor(
    private readonly filePath: string,
    private readonly masterKey: Uint8Array,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
  ) { assertKey(masterKey); }

  async put(input: { id?: string; purpose: SecretPurpose; version: number; secret: Uint8Array }): Promise<SecretReference> {
    await this.load(); assertSecret(input.secret);
    if (!Number.isSafeInteger(input.version) || input.version < 1) throw new TypeError("invalid_secret_version");
    const id = input.id ?? this.id();
    if (!id || this.records.has(id)) throw new SecretStoreError("SECRET_STORE_INTEGRITY", "Secret reference already exists or is invalid.");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey, nonce);
    const ciphertext = Buffer.concat([cipher.update(input.secret), cipher.final()]);
    const timestamp = this.now().toISOString();
    const record: EncryptedRecord = {
      id,
      purpose: input.purpose,
      version: input.version,
      fingerprint: createHash("sha256").update(input.secret).digest("hex").slice(0, 16),
      createdAt: timestamp,
      revokedAt: null,
      nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
    };
    this.records.set(id, record);
    await this.save();
    return asReference(record);
  }

  async use<T>(referenceId: string, work: (secret: Uint8Array) => Promise<T> | T): Promise<T> {
    await this.load();
    const record = this.require(referenceId);
    if (record.revokedAt) throw new SecretStoreError("SECRET_REVOKED", "The referenced credential has been revoked.");
    const plaintext = this.decrypt(record);
    try {
      return await work(plaintext);
    } finally {
      plaintext.fill(0);
    }
  }

  async revoke(referenceId: string): Promise<SecretReference> {
    await this.load();
    const record = this.require(referenceId);
    if (!record.revokedAt) {
      const updated: EncryptedRecord = { ...record, revokedAt: this.now().toISOString() };
      this.records.set(referenceId, updated);
      await this.save();
      return asReference(updated);
    }
    return asReference(record);
  }

  async metadata(): Promise<ReadonlyArray<SecretReference>> {
    await this.load();
    return [...this.records.values()].map(asReference).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private decrypt(record: EncryptedRecord): Uint8Array {
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.masterKey, Buffer.from(record.nonce, "base64"));
      decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final()]);
    } catch {
      throw new SecretStoreError("SECRET_STORE_INTEGRITY", "Encrypted secret cannot be authenticated.");
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const value = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<PersistedFile>;
      if (value.schemaVersion !== 1 || !Array.isArray(value.records)) throw new Error("invalid_secret_store_document");
      for (const record of value.records) {
        if (!record.id || !record.nonce || !record.ciphertext || !record.authTag) throw new Error("invalid_secret_store_record");
        this.records.set(record.id, record);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        if (error instanceof SecretStoreError) throw error;
        throw new SecretStoreError("SECRET_STORE_INTEGRITY", "Encrypted secret store cannot be loaded.");
      }
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    const document: PersistedFile = { schemaVersion: 1, records: [...this.records.values()] };
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomBytes(8).toString("hex")}.tmp`;
    await writeFile(temporary, JSON.stringify(document), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
  }

  private require(referenceId: string): EncryptedRecord {
    const record = this.records.get(referenceId);
    if (!record) throw new SecretStoreError("SECRET_NOT_FOUND", "Secret reference does not exist.");
    return record;
  }
}
