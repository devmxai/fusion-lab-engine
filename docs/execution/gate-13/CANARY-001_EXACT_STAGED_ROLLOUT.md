# CANARY-001 — Exact Staged Rollout and Rollback

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Stage | `13.4` |
| Status | `COMPLETE LOCALLY / NO TRAFFIC ACTIVATED` |
| Controller | `LocalExactCanaryController` |
| Production impact | `NONE` |

## Immutable policy

The controller accepts only a published Policy Version with the exact ladder `1→5→10→25→50→100`, one approved Exact Equivalence Group, distinct safe/candidate Route Versions, fixed observation gates, `ADMIN_INTERNAL_FIRST` cohort order and deterministic `SHA256_MOD_10000` assignment.

Arming requires:

- distinct Finance and Reliability human approvals tied to the Policy Version;
- the configured minimum Shadow decisions;
- exact replay count equal to Shadow decision count;
- zero selected Hard-Gate violations and zero Dispatch mutations;
- a passed rollback drill.

## Stage gate

Every stage consumes one immutable, idempotent observation for its current basis-point allocation. A clean stage needs both the minimum sample count and minimum observation duration. Promotion checks:

- zero Margin Floor breaches;
- zero Hard-Gate violations;
- one financial authority per cohort;
- Actual Cost reconciliation at or above policy minimum;
- Reliability, Quality and p95 Latency regressions within immutable bounds.

No API exists to jump directly to a later percentage. An identical observation replay returns the same snapshot; conflicting reuse of its ID fails closed.

## Assignment and rollback

The plan hashes the raw cohort key and never returns it. At one percent, only Admin/Internal cohorts may enter the candidate bucket. Each result names either `EXACT_CANARY_ENGINE` or `SAFE_ENGINE`, never both, and is always non-mutating in this local implementation.

A manual Kill Switch or automatic breach sends all new assignments to the safe Route. In-flight work completes using pinned Route/Engine versions without redispatch. Accepted Quotes are honored until expiry. No Ledger history is reversed or deleted.

## Acceptance evidence

- Invalid or reordered ladders fail policy validation.
- Same-person dual approval and incomplete replay evidence are rejected.
- Cohort assignment is deterministic, hashed, Admin-first and single-authority.
- All six stages advance sequentially only after clean windows.
- Insufficient samples hold the current stage.
- Margin breach triggers immediate safe rollback.
- Quality/SLO and financial-authority regressions fail closed.
- Gate observation replay is idempotent and conflicting replay is rejected.
- Kill Switch works during rollout and after 100 percent.
- Full local verification: TypeScript, `224/224` Vitest tests across `37` files, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Boundary

No Production/real canary has run. The controller uses deterministic local fixtures and emits assignment plans only, with `dispatchMutationPerformed: false` and `externalDispatchPerformed: false`. No KIE/OpenRouter call, database migration, Production credential, deploy or paid request is included. Formal Gate 13 therefore remains unevaluated pending Stage 13.5 and real dependencies from Gates 6–12.
