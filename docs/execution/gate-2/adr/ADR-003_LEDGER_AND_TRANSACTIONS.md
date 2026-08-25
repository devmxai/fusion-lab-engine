# ADR-003 — Whole-Credit Ledger and Transactional Reservation

- Status: `PROPOSED — LOCAL DRAFT`
- Owner: `MISSING — Finance approval required`
- Review trigger: currency, pricing, refund or accounting-policy change

## Context

Customer prices are whole credits while provider cost and margin must remain auditable. Balance mutation cannot rely on editable counters.

## Decision

Use an append-only double-entry ledger. A quote pins customer price and route/pricing versions. Operation confirmation atomically validates quote/hash/idempotency, creates the operation, moves whole customer credits from available to held, and emits an outbox record. Delivery captures held credits; evidence-safe failure releases them. Provider cost is recorded separately from customer price.

## Alternatives

A mutable wallet balance and time-only refunds were rejected because they cannot prove conservation or distinguish ambiguous provider acceptance.

## Consequences and controls

Journal groups must balance, reservation state is explicit, and unique business keys prevent duplicate posting. The current local in-memory wallets are test doubles only; no database migration is authorized by this ADR draft.

## Security / financial impact

Site price and provider cost are never conflated. Reconciliation quarantines uncertainty instead of crediting or charging speculatively.

## Safe fallback

Stop new reservations, preserve existing holds, and export journals for reviewed reconciliation.

