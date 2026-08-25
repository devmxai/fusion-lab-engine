# FIN-001 — Whole-Credit Ledger Specification

| Field | Value |
|---|---|
| Status | `PROPOSED — LOCALLY TESTED DOMAIN` |
| Finance owner / approver | `MISSING` |
| Security approver | `MISSING` |
| Customer unit | Whole credits as `bigint` |
| Provider replacement-cost unit | Microusd as `bigint` |
| Floating point | Prohibited for credits and money |

## Separation of prices and ledgers

Customer price and provider cost are distinct facts:

```text
Example local image generation
provider estimated/actual charge = 2 provider credits
site immutable customer quote    = 4 whole customer credits
site gross profit                = 2 credits
site gross margin                = 50% (5000 bps)
```

The provider treasury debits 2; the site wallet reserves and captures 4. No provider response can directly select the customer's charge, and no public API exposes internal provider cost/routing fields.

## Balanced commands

| Command | Debit entry | Credit entry | Required evidence |
|---|---|---|---|
| Grant | Platform issued/adjustment `-X` | User available `+X` | Payment/subscription/promotion/admin source |
| Reserve | User available `-X` | User held `+X` | Valid quote/hash/TTL + unique operation/idempotency |
| Settle | User held `-quoted` | Platform earned `+captured`; user available `+remainder` | Verified delivery and reconciliation |
| Release | User held `-X` | User available `+X` | Confirmed no-charge or reviewed failure evidence |
| Expire | User available `-X` | Platform expired `+X` | Eligible lot expiry policy; held credits never expire |
| Adjustment credit/debit | Compensating platform/user entries | Equal opposite entries | Reason + distinct maker/checker |

## Reservation and lot rules

- Reservation allocation consumes available lots by earliest expiry first.
- Allocation moves lot credits from available to held without changing lot total.
- Settlement moves captured allocations to consumed and returns quote remainder to available.
- Release returns all held allocations to their original lots.
- Lot invariant: `granted = available + held + consumed + expired + withdrawn`.
- One operation has at most one reservation.
- A command ID replays only if command type and request hash are identical; changed intent is a conflict.

## Local executable evidence

The local reference implementation proves balanced journals, no negative protected balance, quote cap, idempotent replay, operation-reservation uniqueness, lot conservation, maker-checker, projection rebuild and mixed lifecycle sequences. The current provider-test E2E uses this implementation for the site ledger.

## Unresolved approval items

Legal/accounting treatment of promotional subsidy, tax/payment currency, refunds/chargebacks, subscription expiry ordering and provider-loss recognition requires named Finance approval before Gate 3.

