# DATA-001 — Logical Data Contract

| Field | Value |
|---|---|
| Status | `PROPOSED — LOCAL DRAFT` |
| DDL | `NONE — migration prohibited by current execution boundary` |
| Data owner | `MISSING` |
| Approvers | `Finance + Security — MISSING` |
| Review trigger | Financial schema, lifecycle authority, retention or tenant-isolation change |

## Aggregate ownership

| Aggregate | Writes owned by | Browser access | Retention |
|---|---|---|---|
| Credit accounts and journals | Finance service transaction | Projection read only | Financial/legal policy; no destructive history edit |
| Credit lots and allocations | Finance service transaction | Own summarized projection | Source/expiry retained with journal evidence |
| Reservations | Finance service transaction | Own operation projection | At least operation and reconciliation lifetime |
| Operations and attempts | Engine/worker state machine | Own sanitized projection | Product/support policy |
| Outbox | Command transaction + relay lease | None | Until acknowledged plus audit window |
| Inbox/provider events | Verified event processor | None | Narrow raw retention; normalized evidence retained |

## Logical entities and mandatory keys

```text
credit_accounts(id, owner_id?, kind, unit)
credit_journals(id, command_id, kind, operation_id?, reason_code, created_at)
credit_ledger_entries(journal_id, account_id, signed_credits)
credit_lots(id, owner_id, source, granted, available, held, consumed, expired, withdrawn, expires_at?)
credit_lot_allocations(reservation_id, lot_id, allocated_credits)
credit_reservations(id, operation_id, owner_id, quoted, held, captured, released, state, version)
wallet_projections(owner_id, available, held, source_version)
outbox_events(event_id, aggregate_id, aggregate_version, payload, status, attempts)
inbox_events(provider, delivery_id, payload_hash, processed_at)
```

## Required uniqueness and checks

- `UNIQUE(command_id)` for financial commands.
- `UNIQUE(operation_id)` for the operation reservation.
- `UNIQUE(event_id)` for outbox events.
- `UNIQUE(provider, delivery_id)` for inbox receipts.
- Every credit amount is an integer database type mapped to TypeScript `bigint`; no floating point.
- Every journal sum is zero and has at least two non-zero entries.
- Protected available/held projections cannot become negative.
- Lot buckets sum exactly to granted credits.
- Captured credits never exceed quoted credits.
- Financial journals and entries reject `UPDATE/DELETE`; corrections are compensating journals.

## Isolation and access model

End users may read only their sanitized wallet/operation projections. They cannot insert or update journals, lots, reservations, outbox, inbox or terminal lifecycle state. Service roles are separated by command purpose; provider adapters cannot call ledger mutation directly. Exact RLS, grants, triggers and retention DDL require a future reviewed migration and adversarial database tests.

## Local evidence and limitation

`packages/ledger` enforces these invariants in an in-memory reference adapter and rebuilds projections from append-only journals. It proves domain semantics, not database locking, RLS, grants, backup or concurrent transaction behavior.

