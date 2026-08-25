# RISK-001 — Percentile, Price-Shock and Heavy-User Model

| Field | Value |
|---|---|
| Stage | `15.3` |
| Status | `COMPLETE LOCALLY / SIMULATION ONLY` |
| Quantiles | `P50 / P90 / P95 / P99 — nearest rank` |
| Representative data | `minimum samples + 60 days OR two financial cycles` |
| Production impact | `NONE` |

## Policy and input boundary

The immutable Risk Model Policy pins exact percentile order, nearest-rank method, minimum sample size, representative-data thresholds and ordered price-shock basis points. It also pins the Offer and Cohort Budget Policy Versions and cannot activate a Pilot.

Observations are one sanitized aggregate per hashed user. Duplicate aggregate/user keys, malformed cost, raw identity, prompt/asset presence, an unreconciled budget or a version mismatch fail closed.

## Exact distribution model

All costs use BigInt microusd. The report calculates:

- total and mean per-user COGS;
- nearest-rank P50, P90, P95 and P99;
- P99/P50 ratio;
- P99 heavy-user count and COGS share;
- total operation and user sample counts.

The mean is informational only. `decisionUsesAverageOnly` is fixed to false. Tests prove that cohorts with the same mean but different P99 tails produce materially different projected risk.

## Scenarios

The deterministic scenario set contains:

1. current observed Cohort COGS;
2. every published price shock using conservative ceiling arithmetic;
3. all sampled users operating at observed P99 COGS.

Each scenario compares projected COGS with the approved Cohort COGS budget and exposes exact projected loss and breach status.

## Readiness

Even a clean simulation remains `INSUFFICIENT_DATA` until minimum samples plus either 60 representative days or two completed financial cycles exist. A representative report returns `BUDGET_BREACH_PROJECTED` if any scenario exceeds budget; otherwise it returns `WITHIN_APPROVED_BUDGET`.

No result grants activation authority.

## Acceptance evidence

- Required quantiles and ordered shock Policy validation are tested.
- Duplicate/sensitive observations and drifted budget are rejected.
- Insufficient representative data is tested.
- Exact P50/P90/P95/P99 and heavy-user share are tested.
- Conservative price-shock loss is tested.
- Equal-mean/different-tail cohorts are tested.
- Two financial cycles as the alternate readiness basis are tested.
- Idempotency/conflict and zero activation authority are tested.
- Focused Gate 15 suite: `24/24` passed.
- Full repository suite: `299/299` Vitest tests across `47` files and `6/6` Chromium E2E tests.

## Boundary

Every observation and budget is a local deterministic fixture. No representative Production data, real customer cohort, Pilot activation, provider cost, Dispatch, Migration or deploy is included.
