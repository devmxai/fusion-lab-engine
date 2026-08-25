# EXPLORE-001 — Platform-funded Exploration Budget

| Field | Value |
|---|---|
| Stage | `14.3` |
| Status | `COMPLETE LOCALLY / NO EXPERIMENT ACTIVATED` |
| Allocation | `1–5% only` |
| Customer surcharge | `ZERO` |
| Production impact | `NONE` |

## Immutable Policy

Every Exploration Policy Version pins allocation basis points, total microusd budget, per-operation incremental exposure, per-user selection cap, eligible Profile Versions, exact active window and SHA-256 assignment. It must declare `platformFunded: true` and `customerSurchargeAllowed: false`.

Values below `1%` or above `5%`, invalid windows, duplicate Profiles, non-integer money or any customer surcharge capability fail validation.

## Selection gates

Before a deterministic selected bucket may reserve budget, the server requires:

1. active explicit Smart consent;
2. Evaluation report readiness;
3. eligible pinned Profile and active Policy window;
4. remaining per-user selection capacity;
5. projected Margin at maximum Exploration cost at or above the hard floor;
6. available platform budget covering the entire incremental maximum exposure.

The raw assignment/user keys are hashed and never returned. A Control bucket reserves zero. Request ID replay is idempotent; changed reuse is rejected.

## Financial lifecycle

The platform reserves only the positive incremental risk over baseline. Entries are append-only and SHA-256 chained:

```text
RESERVE maximum incremental exposure
→ SETTLE verified actual incremental cost
→ RELEASE unused difference
```

A confirmed no-charge failure releases the full reservation. Actual cost cannot exceed reserved maximum. Projections reconcile available, reserved and settled budget using BigInt microusd. Released amount is retained as cumulative audit evidence.

## Kill Switch

Activation is immediate and idempotent for new planning: selected buckets become Control with no reservation. Existing reservations are not deleted and may still settle or release from verified terminal evidence.

## Acceptance evidence

- Policy boundaries and zero-surcharge invariant are tested.
- Deterministic Control assignment reserves nothing.
- Missing consent or Evaluation readiness fails closed.
- Incremental exposure reservation, idempotency and Margin Floor are tested.
- Exact Settlement/Release and hash-chain reconciliation are tested.
- Full failure release restores available platform budget.
- Per-user caps and aggregate budget prevent overcommit.
- Kill Switch stops new selection while preserving prior settlement.
- Focused test suite: `8/8` passed.
- Full repository suite: `252/252` Vitest tests across `41` files and `6/6` Chromium E2E tests.

## Boundary

This is an in-memory deterministic accounting/control reference. No real user cohort, Production budget, payment, provider request, model selection, experiment, Migration or deploy is included. Every plan returns `dispatchMutationPerformed: false` and every snapshot returns `externalDispatchPerformed: false`.
