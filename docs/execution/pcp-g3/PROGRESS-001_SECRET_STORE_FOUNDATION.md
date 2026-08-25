# PCP-G3 — Secret Manager and Provider Accounts: Progress 001

> **Status:** `IN PROGRESS`  
> **Scope:** local secret-store foundation only. No key was supplied, stored by a user, sent to a provider, or used for a network request.

## Implemented

- Added `SecretStore`, a server-side capability with `put`, callback-only `use`, `revoke`, and redacted `metadata` operations. It has no reveal method.
- Added `LocalEncryptedFileSecretStore` for offline/local verification. It uses AES-256-GCM with a caller-supplied 32-byte master key, creates a separate random nonce per secret, persists only authenticated ciphertext, and writes no key beside the encrypted document.
- Defined distinct purposes: provider generation key, webhook HMAC secret, and management key. They cannot be represented by a single ambiguous credential type.
- Added local tests proving ciphertext persistence across a new store instance, metadata redaction, revoked-secret denial, and authentication failure with an incorrect master key.
- Replaced the local Admin V2 credential path with `SecretBackedCredentialVault`. Credential metadata, maker identity, idempotency, and account-health evidence persist durably; secret bytes remain in `SecretStore` only.
- Added purpose-specific credential states and rotation: generation key, webhook HMAC key, and management key are separate records; activation requires an independent actor and revokes a prior active credential of the same scope/purpose.
- Added read-only provider verification clients: KIE uses only `GET /api/v1/chat/credit`; OpenRouter uses only `GET /api/v1/key`. Both have timeout, redirect denial, bounded JSON parsing, and no generation path.
- Added a redacted Provider Account Health projection carrying only account label, limit/balance snapshot, observed time, provider, purpose, and credential reference.

## Verification

```powershell
$node='C:\Users\hp\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node node_modules\.ignored\vitest\vitest.mjs run packages/admin-control-plane/src/secret-store.test.ts packages/admin-control-plane/src/admin-control-plane.test.ts
& $node node_modules\.ignored\typescript\bin\tsc --noEmit -p packages/admin-control-plane/tsconfig.json
```

Result after the Admin integration: **4 test files, 18 tests passed; Engine API and Admin TypeScript checks passed.**

## Still required for Gate 3

1. Implement `SupabaseVaultSecretStore` only with a separately reviewed server-side decryption/RPC boundary during production topology work; [the required boundary](./SECRET_STORE_PRODUCTION_BOUNDARY.md) is now fixed, and the local implementation must not be reused in production.
2. Execute actual KIE/OpenRouter connection checks only after the user supplies a key via the write-only UI and authorizes `PCP-G10`; no key or external request has occurred in this gate.
