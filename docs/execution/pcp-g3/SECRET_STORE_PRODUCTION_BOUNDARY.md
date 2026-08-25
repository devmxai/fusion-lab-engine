# PCP-G3 — Production SecretStore Boundary

> **Status:** design accepted for a future production adapter; not deployed and no production configuration changed.

## Decision

`SecretStore` is the only application contract for provider credentials. It permits:

- write a new version;
- use its plaintext only inside a server-owned callback;
- revoke a reference;
- read redacted metadata.

It deliberately has no `get`/`reveal` API. Control-plane, Admin, browser, logs, analytics, and error responses hold references and metadata only.

## Local development

`LocalEncryptedFileSecretStore` uses AES-256-GCM and a caller-supplied local 32-byte master key. The key is not stored beside ciphertext. This implementation is strictly for local development and offline tests; the Engine's production mode is already refused by the local configuration loader.

## Intended production topology

1. **Vercel** hosts the web/API boundary. Its sensitive environment variables are reserved for bootstrap credentials only (for example, a database/service identity); they are deployment-scoped and not a per-provider-account secret database. Vercel documents that environment changes apply to new deployments, so they cannot provide runtime rotation for arbitrary Admin-created provider accounts.
2. **Supabase Vault** is the intended encrypted durable backend for provider secret values. Its documented Vault model stores encrypted/authenticated values on disk while an explicitly privileged server-side path can decrypt only at use time.
3. A future `SupabaseVaultSecretStore` must call a narrowly scoped server-side RPC/Edge boundary with a service identity held only in Vercel server runtime. Browser roles and normal application DB roles must have no access to `vault.decrypted_secrets` or equivalent decryption paths.
4. The database's Provider Account/Credential records store only Vault secret UUID, purpose, version, fingerprint, status, timestamps, actor, and audit evidence. Vault UUID and credential reference are never user-provided routing inputs.
5. Rotation creates a new Vault secret and a new credential version; it is read-only verified, independently activated, and only then the old reference is revoked. Existing provider attempts stay pinned to their already recorded credential version.

## Required production controls before deployment

- Grant/deny review proving only the server-owned execution role can invoke the decryption RPC.
- No raw secret in SQL error, API payload, audit record, tracing attribute, request body log, or client bundle.
- KIE generation key, KIE webhook HMAC key, and OpenRouter generation/management keys stored as separate references.
- Backup/restore and key-rotation runbook, including Vault root-key/project migration procedure.
- Secret-reference lookup on dispatch must be server-owned and fail closed if status is not active.
- Formal security review and canary authorization under `PCP-G10`; this document alone authorizes neither deployment nor any provider traffic.

## Sources

- [Supabase Vault documentation](https://supabase.com/docs/guides/database/vault) describes encrypted/authenticated secret storage, controlled decrypted access, and separate project encryption keys.
- [Vercel environment variables](https://vercel.com/docs/environment-variables) documents that variables are encrypted at rest and apply to new deployments, which is why they are bootstrap-only here rather than a dynamic provider credential store.

