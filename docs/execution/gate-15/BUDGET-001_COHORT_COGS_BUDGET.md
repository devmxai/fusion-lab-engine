# BUDGET-001 — Cohort COGS Budget

| Field | Value |
|---|---|
| Stage | `15.2` |
| Status | `COMPLETE LOCALLY / NO PILOT SPEND` |
| Budget formula | `floor(net cohort subscription economic value × approved COGS ratio)` |
| Customer Credits | `ZERO` |
| Production impact | `NONE` |

## Immutable budget policy

Each Policy Version pins the Cohort, Offer Version, net subscription economic value, approved COGS ratio, per-operation maximum and exact budget period. All money uses unsigned BigInt microusd.

The allowed aggregate budget is derived rather than entered independently:

```text
allowed cohort COGS = floor(net cohort subscription economic value × approved COGS ratio / 10000)
```

The ratio must remain below 100%, the per-operation maximum cannot exceed the derived aggregate budget, and the local Policy cannot activate a Pilot.

## Pre-spend reservation gate

A reservation is valid only when:

1. usage is an included Relaxed Draft;
2. Authorization, Cohort and Offer Version match the budget;
3. actual disclosed Family/Model/Route identifiers are present;
4. the financial period is active;
5. neither customer Credits nor external Dispatch were touched;
6. the maximum exposure fits both per-operation and remaining aggregate budget.

Operation ID replay with identical intent is idempotent. Changed reuse fails closed.

## Financial lifecycle

```text
RESERVE maximum COGS before Dispatch
→ SETTLE verified Actual COGS
→ RELEASE exact unused difference
```

A no-charge failure releases the full maximum. Actual COGS above reserve is rejected. Available, reserved, settled and released projections are BigInt values.

Every lifecycle entry is SHA-256 chained. Reconciliation reconstructs active reserve, settled cost, released cost and available balance from the append-only ledger rather than trusting mutable counters alone.

## Acceptance evidence

- Exact derived-budget formula and invalid ratios are tested.
- Included decision/Authorization/Cohort/Route gates are tested.
- Premium and mismatched Cohort rejection are tested.
- Reservation idempotency and conflict handling are tested.
- Exact Settlement and unused Release are tested.
- Complete no-charge failure release is tested.
- Over-settlement is rejected.
- Per-operation and aggregate overcommit are rejected.
- Focused Gate 15 suite: `16/16` passed.
- Full repository suite: `291/291` Vitest tests across `46` files and `6/6` Chromium E2E tests.

## Boundary

The budget and entries are local in-memory fixtures. There is no approved Production Cohort budget, real subscription value, provider cost, Credit mutation, Dispatch, Migration or deploy.
