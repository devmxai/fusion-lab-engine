# MIG-001 — Deferred Migration Workbook

| Field | Value |
|---|---|
| Status | `DEFERRED / PROHIBITED IN CURRENT EXECUTION BOUNDARY` |
| Migration files created | `NO` |
| Local or production database changed | `NO` |
| Data owner | `MISSING` |
| Approvers | `Finance + Security + Engineering — MISSING` |

This artifact records the safe activation criteria only. It is not an executable migration and does not authorize database writes.

## Preconditions before creating DDL

1. Gate 0 and Gate 1 evidence approved.
2. DATA-001 and FIN-001 approved by named owners.
3. Real schema, grants, RLS, cron, storage and function inventory captured read-only.
4. Backup/PITR and timed restore rehearsal passed.
5. Per-user/global legacy wallet, lot, reservation and job counts/checksums captured.
6. Single financial writer and kill switches proven.
7. Migration/rollback environment isolated from production secrets/providers.

## Future execution sequence

```text
Expand schema
→ validate constraints in shadow
→ create opening lots at the same whole-credit balances (never ×1000)
→ reconcile per-user and global totals
→ shadow-rebuild projections
→ canary one controlled cohort with one financial writer
→ verify journals/holds/provider reconciliation
→ cut over
→ retain old read evidence
→ contract only after the observation window
```

Fractional legacy balances, if any, are rounded in the user's favor with a visible adjustment and reconciliation report. No destructive rollback may delete journals; rollback stops new commands, returns traffic to the last certified writer and preserves evidence for reconciliation.

## Activation record required

Before this status changes, record migration hash, backup identifier, restore report, dry-run timings, row counts/checksums, invariant report, rollback/forward-fix test, owner signatures, scheduled window and GO/HOLD decision.

