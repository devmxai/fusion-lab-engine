# Gate 2 — Platform Foundation Contract Pack

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Status | `PROPOSED — LOCAL DRAFT` |
| Gate decision | `NOT EVALUATED / NOT PASSED` |
| Execution boundary | Contracts, tests and documentation only; no migration or production change |
| Owner / approvers | `MISSING — required before approval` |

This pack prepares the machine-readable foundation required by Phase 2. It does not authorize phase advancement while Gate 0 remains on HOLD.

## Contract artifacts

- [API-001 — Public API v2](./API-001_OPENAPI.md)
- [EVT-001 — Canonical event catalog](./EVT-001_EVENT_CATALOG.md)
- [STM-001 — Operation transition matrix](./STM-001_TRANSITION_MATRIX.md)
- [APU-G1 — Provider catalog and route contract](./APU-G1_PROVIDER_CATALOG_CONTRACT.md)
- [Durable execution primitives](./FOUNDATION_DURABILITY.md)
- Executable schemas: `packages/contracts/src/`
- Local contract endpoint: `GET http://127.0.0.1:8787/openapi/v2.json`

## Architecture decisions

- [ADR-001 — Deployment topology and trust boundaries](./adr/ADR-001_DEPLOYMENT_TOPOLOGY.md)
- [ADR-002 — Modular boundaries and dependency direction](./adr/ADR-002_MODULE_BOUNDARIES.md)
- [ADR-003 — Whole-credit ledger and transactional reservation](./adr/ADR-003_LEDGER_AND_TRANSACTIONS.md)
- [ADR-004 — Outbox, inbox and idempotency](./adr/ADR-004_OUTBOX_INBOX_IDEMPOTENCY.md)
- [ADR-005 — Internal identity, secrets and webhooks](./adr/ADR-005_IDENTITY_SECRETS_WEBHOOKS.md)
- [ADR-006 — Private media ingestion and retention](./adr/ADR-006_PRIVATE_MEDIA.md)
- [ADR-007 — Provider adapter certification and versioning](./adr/ADR-007_PROVIDER_ADAPTERS.md)
- [ADR-008 — Migration, canary and safe rollback](./adr/ADR-008_MIGRATION_AND_ROLLBACK.md)

## Exit evidence still required

1. Named Engineering, Security, Finance and Product owners.
2. Formal review and approval of all eight ADRs.
3. CI-generated OpenAPI compatibility report and signed artifact.
4. Contract-to-implementation coverage for the real v2 handlers.
5. Gate 0 and Gate 1 exit evidence; this local draft cannot bypass them.

The current in-memory durability adapter is test evidence only. PGMQ/PostgreSQL persistence and crash-across-process proof remain pending and require an approved migration window.
