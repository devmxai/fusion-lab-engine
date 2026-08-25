# Gate 8 — Admin Control Plane V2

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Status | `LOCALLY IMPLEMENTED REFERENCE` |
| Gate decision | `NOT EVALUATED / NOT PASSED` |
| Runtime | `LOCAL / IN-MEMORY ONLY` |
| Database / production change | `NONE` |
| Legacy Admin | `HOLD — direct Supabase mutation paths remain` |
| Owner / reviewers | `MISSING — Security, Finance, Support and Engineering required` |

## Artifacts

- [ADMIN-001 — versioned command workflow and local cockpit](./ADMIN-001_CONTROL_PLANE.md)
- [SEC-ADMIN-001 — AAL2, RBAC, maker-checker and write-only credentials](./SEC-ADMIN-001_SECURITY_MODEL.md)
- [APU-G2 — signed local Admin session boundary](./APU-G2_LOCAL_ADMIN_SESSION_BOUNDARY.md)
- [APU-G3 — local provider catalog inventory](./APU-G3_LOCAL_CATALOG_INVENTORY.md)
- Executable domain package: `packages/admin-control-plane/src/`
- Engine integration: `apps/engine-api/src/admin-v2/`
- Local UI: `src/pages/AdminV2Page.tsx` at `/admin/v2`
- Local API namespace: `/v1/dev/admin-v2/*`

## Proven locally

- Every Admin read or command requires an AAL2 identity and a scoped role.
- Sensitive changes follow `DRAFT → VALIDATED → SIMULATED → APPROVED → PUBLISHED`.
- The maker cannot approve the same change; publication requires an independent approval and Publisher role.
- Published/rejected versions are immutable. Rollback creates a new compensating draft rather than editing history.
- Admin command IDs are idempotent and conflicting reuse fails closed.
- Audit records form a verifiable SHA-256 hash chain and contain no credential value.
- Provider credentials are write-only: API responses expose fingerprint metadata only; there is no reveal endpoint.
- Published Route controls run inside dispatch. A kill switch releases the customer hold and does not spend provider credit.
- Published financial adjustments use the same append-only whole-credit ledger and preserve maker/approver evidence.
- The local UI uses Engine Admin V2 APIs only and contains no direct Supabase write.
- Browser verification completed the full five-stage route workflow without Console errors, then published a second version restoring dispatch.

## Gate blockers

1. Gate 0 remains `HOLD`; production deployment and database changes are not authorized.
2. Local Admin identity is a signed, read-only development session, not production JWT/AAL2 verification or workload identity.
3. Changes, audit chain, runtime controls and credential vault are in memory and are lost on restart.
4. The legacy `/admin` implementation still contains direct Supabase table/RPC mutations and must remain `HOLD` for production-sensitive commands.
5. There is no managed KMS/secret manager integration, real provider credential test, rotation rehearsal or access audit.
6. Pricing and Treasury version publication is stored by the local runtime but is not yet wired to replace every live quote/dispatch policy input.
7. User anonymization has only a versioned control record; retention enforcement and evidence-preserving data execution require an approved data design.
8. Named human owners, role grants, break-glass policy, support runbooks and production adversarial tests are missing.

No local passing test changes the Gate decision. Production use requires persistence, real identity enforcement, removal of legacy direct mutations, signed evidence and formal Gate approval.
