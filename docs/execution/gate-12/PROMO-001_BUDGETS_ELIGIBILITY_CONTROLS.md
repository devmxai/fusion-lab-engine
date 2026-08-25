# PROMO-001 — Promotion Budgets, Eligibility and Controls

## Status and boundary

`COMPLETE LOCALLY / FORMAL GATE HOLD`. This contract uses only the in-memory local Engine and Provider For Test. It creates no production Campaign, database migration, real subsidy, payment, deployment or public commercial offer.

## Immutable Campaign contract

A published Campaign Version pins its code, Credit discount, Whole-Credit and microusd budgets, active window, eligible Products/Routes/Cohorts, per-user/global caps, stacking policy, fraud rules, attribution, stop conditions, two independent approvers and kill-switch state. Published nested policy values are deep-frozen and a Version ID or code cannot be overwritten.

The public local Campaign view exposes the offer contract but not blocked-user fraud-rule data. Fraud and Cohort inputs remain server-side decisions.

## Exact subsidy rule

For an eligible Quote:

```text
minimum hard-floor revenue = ceil(conservative_cost_microusd × 10000 / (10000 − hard_floor_bps))
post-discount value         = final_customer_credits × credit_value_floor_microusd
required subsidy           = max(0, minimum hard-floor revenue − post-discount value)
```

The Promotion engine reserves the exact discount Credits and required subsidy microusd. Both budget dimensions and configured remaining-reserve stop conditions must pass. No floating point or optimistic rounding is used.

## Lifecycle

```text
eligible Quote → RESERVE budget
operation created → attach reservation to one operation
verified settlement → REDEEM budget
Quote expiry / no-charge failure → RELEASE budget
```

Attaching at operation creation prevents Quote reuse while avoiding subsidy burn before delivery. Redemption and release are idempotent. A reservation cannot move to another operation.

## Audit and reconciliation

Every budget change appends a Subsidy Entry containing Campaign Version, reservation, optional operation, signed Credit/microusd deltas, reason code and timestamp. `RESERVE`, `REDEEM` and `RELEASE` entries reconstruct the reserved and redeemed projections without rewriting history.

## Controls proven locally

- Product, Route and Cohort eligibility;
- exclusive and allowlisted stacking;
- per-user and global redemption caps;
- server-side blocked-user and UTC-day velocity rules;
- Campaign active window, kill switch and budget stop conditions;
- exact request-hash pinning and Quote expiry release;
- successful settlement redemption and confirmed failure release;
- no customer charge and no subsidy burn on the failure path.

The local `LOCAL50` fixture changes an eligible 40-Credit Video Quote to 20 Credits and reserves `20 Credits + 66,667 microusd`. Successful settlement moves those amounts from reserved to redeemed. Confirmed Provider failure releases the reservation and leaves customer charge and redeemed subsidy at zero.
