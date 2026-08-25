# Gate 3 — Whole-Credit Ledger V2 Local Preparation

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Status | `DESIGN-VALIDATED LOCAL DRAFT` |
| Gate decision | `NOT EVALUATED / NOT PASSED` |
| Dependency | Gate 2 approval — currently absent |
| Execution boundary | Domain code, tests and specifications only |
| Database migration | `NOT CREATED / NOT APPLIED` |
| Owners / approvers | `MISSING — Finance, Security, Data and Engineering required` |

## Artifacts

- [DATA-001 — Logical data contract](./DATA-001_LOGICAL_DATA_CONTRACT.md)
- [FIN-001 — Whole-credit ledger specification](./FIN-001_WHOLE_CREDIT_LEDGER.md)
- [MIG-001 — Deferred migration workbook](./MIG-001_DEFERRED_MIGRATION.md)
- Executable local domain: `packages/ledger/src/`

The local Engine test flow now uses this ledger for the site wallet. Provider treasury remains a separate provider-side ledger, proving that customer price and provider cost are never the same balance or journal.

