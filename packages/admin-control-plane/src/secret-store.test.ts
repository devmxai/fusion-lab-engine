// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalEncryptedFileSecretStore } from "./secret-store.ts";
import { SecretBackedCredentialVault } from "./credential-vault.ts";
import type { AdminIdentity } from "./types.ts";

const directories: string[] = [];
const key = new Uint8Array(32).fill(7);
const secret = new TextEncoder().encode("local-secret-never-in-a-read-model");
const security = (actorId: string): AdminIdentity => ({ actorId, roles: ["ADMIN_VIEWER", "SECURITY_OPERATOR"], assuranceLevel: 2 });

afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("LocalEncryptedFileSecretStore", () => {
  it("persists authenticated ciphertext and never returns secret data through metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-secret-store-")); directories.push(directory);
    const file = join(directory, "secrets.json");
    const first = new LocalEncryptedFileSecretStore(file, key, () => new Date("2026-08-22T00:00:00.000Z"), () => "secret-ref-001");
    const reference = await first.put({ purpose: "PROVIDER_GENERATION_KEY", version: 1, secret });
    expect(reference).toMatchObject({ id: "secret-ref-001", version: 1, revokedAt: null });
    expect(JSON.stringify(reference)).not.toContain("local-secret-never-in-a-read-model");
    const encrypted = await readFile(file, "utf8");
    expect(encrypted).not.toContain("local-secret-never-in-a-read-model");
    expect(encrypted).toContain("ciphertext");

    const restarted = new LocalEncryptedFileSecretStore(file, key);
    await expect(restarted.metadata()).resolves.toEqual([reference]);
    await expect(restarted.use(reference.id, (bytes) => new TextDecoder().decode(bytes))).resolves.toBe("local-secret-never-in-a-read-model");
  });

  it("rejects revoked and unauthenticated secret ciphertext", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-secret-store-")); directories.push(directory);
    const file = join(directory, "secrets.json");
    const store = new LocalEncryptedFileSecretStore(file, key, () => new Date("2026-08-22T00:00:00.000Z"), () => "secret-ref-002");
    const reference = await store.put({ purpose: "PROVIDER_WEBHOOK_HMAC", version: 1, secret });
    const unrevoked = await store.put({ id: "secret-ref-003", purpose: "PROVIDER_MANAGEMENT_KEY", version: 1, secret });
    await store.revoke(reference.id);
    await expect(store.use(reference.id, () => "unreachable")).rejects.toMatchObject({ code: "SECRET_REVOKED" });
    const wrongKeyStore = new LocalEncryptedFileSecretStore(file, new Uint8Array(32).fill(8));
    await expect(wrongKeyStore.use(unrevoked.id, () => "unreachable")).rejects.toMatchObject({ code: "SECRET_STORE_INTEGRITY" });
  });

  it("keeps credential versions durable as metadata while the secret remains only in SecretStore", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-secret-store-")); directories.push(directory);
    const store = new LocalEncryptedFileSecretStore(join(directory, "secrets.json"), key, () => new Date("2026-08-22T00:00:00.000Z"), (() => {
      let sequence = 0; return () => `credential-ref-${++sequence}`;
    })());
    const vault = new SecretBackedCredentialVault(store, () => new Date("2026-08-22T00:00:00.000Z"), (() => {
      let sequence = 0; return () => `credential-ref-${++sequence}`;
    })());
    const maker = security("maker");
    const first = await vault.write(maker, { providerId: "kie", accountId: "main", environment: "LOCAL", purpose: "PROVIDER_GENERATION_KEY", secret: "generation-key-never-returned" });
    const tested = await vault.test(security("checker"), first.id, (bytes) => new TextDecoder().decode(bytes) === "generation-key-never-returned");
    const active = await vault.activate(security("checker"), tested.id, maker.actorId);
    expect(active).toMatchObject({ status: "ACTIVE", purpose: "PROVIDER_GENERATION_KEY", version: 1 });
    expect(vault.assertActiveProviderGenerationCredential({ credentialReferenceId: active.id, credentialVersion: 1 }))
      .toMatchObject({ id: active.id, status: "ACTIVE" });
    expect(() => vault.assertActiveProviderGenerationCredential({ credentialReferenceId: active.id, credentialVersion: 2 }))
      .toThrowError(expect.objectContaining({ code: "CREDENTIAL_ILLEGAL_TRANSITION" }));
    await expect(vault.useActiveProviderGenerationCredential({
      credentialReferenceId: active.id, credentialVersion: active.version, providerId: "kie", providerAccountId: "main",
    }, async (bytes) => new TextDecoder().decode(bytes))).resolves.toBe("generation-key-never-returned");
    await expect(vault.useActiveProviderGenerationCredential({
      credentialReferenceId: active.id, credentialVersion: active.version, providerId: "kie", providerAccountId: "wrong-account",
    }, async () => "unreachable")).rejects.toMatchObject({ code: "CREDENTIAL_ILLEGAL_TRANSITION" });
    expect(JSON.stringify(vault.snapshotState())).not.toContain("generation-key-never-returned");
    const second = await vault.write(maker, { providerId: "kie", accountId: "main", environment: "LOCAL", purpose: "PROVIDER_GENERATION_KEY", secret: "rotated-generation-key-never-returned" });
    const secondTested = await vault.test(security("checker"), second.id, () => true);
    await vault.activate(security("checker"), secondTested.id, maker.actorId);
    expect(vault.metadata(security("auditor")).map(({ status }) => status)).toEqual(["REVOKED", "ACTIVE"]);
    await expect(store.use(first.id, () => "unreachable")).rejects.toMatchObject({ code: "SECRET_REVOKED" });
  });
});
