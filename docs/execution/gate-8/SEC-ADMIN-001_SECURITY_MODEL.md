# SEC-ADMIN-001 — Admin Security Model

| Field | Value |
|---|---|
| Status | `LOCAL REFERENCE — PRODUCTION IDENTITY PENDING` |
| Minimum assurance | AAL2 |
| Authorization | Scoped RBAC |
| Sensitive approval | Maker-checker |
| Credential read | Prohibited |

## Roles

Read, Support, Finance Maker/Approver, Pricing Maker/Approver, Route Maker/Approver, Treasury Operator, Security Operator, Publisher, Auditor and Super Admin are separate roles. Draft and approval permissions are further scoped by resource type.

AAL2 is required before role evaluation. Missing AAL2 returns an authentication failure; an authenticated actor without a required role receives a permission failure.

## Credentials

- Raw values enter only the write operation and are never returned.
- Metadata includes provider/account/environment, version, status and a short SHA-256 fingerprint.
- Test must succeed before activation.
- Activation requires an actor different from the credential maker.
- Activating a new version revokes the previously active matching version.
- Revocation erases the in-memory raw value.
- Audit command hashes use metadata and command identity, not the raw credential.
- No API route can reveal a stored credential.

## Audit

Each accepted change or credential transition appends an immutable record containing actor, action, resource/version identity, command hash, timestamp and the previous record hash. Verification recomputes every hash and link.

This local chain detects mutation in the current process but is not durable evidence. Production requires append-only persistent storage, access controls, retention, external anchoring and monitoring.
