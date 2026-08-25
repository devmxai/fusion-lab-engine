# APU-G2 — Local Admin Identity Boundary

| Field | Value |
|---|---|
| Program | `FL-APU-001` |
| Status | `LOCAL PARTIAL IMPLEMENTATION — READ-ONLY SHELL ONLY` |
| Runtime | `Local engine, signed HttpOnly session, in-memory` |
| Prohibited | Production identity claim, migration, deploy, provider call, secret entry |

## Closed local defect

`/v1/dev/admin-v2/*` no longer reads `x-admin-actor`, `x-admin-roles` or `x-admin-aal`. The engine derives the identity only from an HMAC-signed, short-lived `HttpOnly; SameSite=Strict` cookie. A forged set of those headers without a valid session is rejected.

The local bootstrap endpoint deliberately issues only an `ADMIN_VIEWER` session. Therefore `/admin/v2` is read-only in this stage: it cannot create a change, alter a financial balance, publish a route, write an API key or activate a credential. This is more truthful than simulating multiple privileged humans in browser code.

## Verification

`apps/engine-api/src/admin-v2/routes.test.ts` proves all of the following locally:

- bootstrap issues a signed viewer cookie and permits read-only overview access;
- the viewer cookie is denied for a write command;
- missing session is denied;
- spoofed `x-admin-*` headers are denied;
- server-issued signed test identities retain the existing maker/checker, credential, ledger and route-kill-switch contract coverage.

## Remaining APU-G2 work and hard limits

- A signed local session is **not** a production IdP/JWT/MFA/AAL2 integration.
- approvals, audit records, sessions, runtime controls and credentials are still in-memory, hence not durable across restart.
- a production admin must use server-verified identity, least-privilege grants, MFA/AAL2 claims, BFF projections, field masking and durable repositories before privileged commands are enabled.
- legacy `/admin` direct Supabase mutation routes remain `HOLD` and are not converted or authorized by this work.
