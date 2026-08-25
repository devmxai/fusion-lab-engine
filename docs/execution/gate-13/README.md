# Gate 13 — Profit Router Shadow then Exact

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Status | `LOCAL IMPLEMENTATION COMPLETE — FORMAL GATE HOLD` |
| Gate decision | `LOCAL PASS / FORMAL HOLD` |
| Runtime authority | `SHADOW ONLY / NO DISPATCH AUTHORITY` |
| Active execution route | `Existing pinned Provider For Test route` |
| Production / migration / deploy | `NONE` |
| Dependency note | `Representative production data and formal Gates 6–12 are not available` |

## Stage breakdown

| Stage | Scope | Status |
|---|---|---|
| `13.1` | Hard Gates and Expected Cost per Usable Success | `COMPLETE LOCALLY` |
| `13.2` | Versioned score, deterministic tie-break, hysteresis and stickiness | `COMPLETE LOCALLY` |
| `13.3` | Shadow decisions, quality/reliability metrics and replay | `COMPLETE LOCALLY` |
| `13.4` | Exact canary controller `1→5→10→25→50→100` | `COMPLETE LOCALLY` |
| `13.5` | Gate 13 evidence and decision | `COMPLETE LOCALLY / FORMAL HOLD` |

## Stage 13.1 evidence

- A dedicated `packages/profit-router` domain package owns routing gates and economics rather than embedding route choice inside the Provider adapter or UI.
- Router Policy is immutable/versioned and explicitly `SHADOW`; this slice cannot change the Route used by Quote or Dispatch.
- Every candidate pins the complete metric signature: Route and Model Versions, input mode, resolution, duration bucket, audio/reference modes, Adapter Version and Retry Policy Version.
- Hard Gates check published/unexpired Route, full capability match, approved Exact equivalence when required, usable Cost Version, active Credential, sufficient Shadow Balance, closed Circuit, available capacity, privacy compatibility, known Actual-Cost extractor, margin floor, fresh metrics and Quote-pinned candidacy.
- A failed Gate excludes the Route and returns stable reasons. It receives no economics and cannot proceed to later score stages.
- Expected policy cost and usable-success probability follow the Master Plan retry formula using exact BigInt rational arithmetic; no binary floating point or early monetary rounding is used.
- `usable success` is supplied as a signature-specific metric covering terminal Provider success through ingest, media validation, delivery and policy acceptance.
- Golden fixture: two attempts with expected policy cost `240,000 microusd` and usable-success probability `24/25` produce exact Expected Cost per Usable Success `250,000 microusd`.
- Reliability fixture proves a nominal `$0.28` Route at 90% usable success (`311,112 microusd` ceiling per usable success) can be economically better than a nominal `$0.20` Route at 50% (`400,000 microusd`).
- Full verification passed: TypeScript including the new package, Engine build, Provider Test build and Vite build.

## Stage 13.2 evidence

- Scoring is pinned to immutable published policy `profit-score:shadow:v1`; the manual weights are Expected Cost per Usable Success `4500`, Reliability `2500`, Quality `2000` and p95 Latency `1000` basis points.
- Policy validation rejects unpublished versions, invalid 10,000-bps totals, invalid thresholds and any auto-learning flag. Runtime weights cannot drift silently.
- Only candidates that passed Stage 13.1 Hard Gates receive score components; an excluded Route has a null weighted score and cannot be resurrected by incumbent or sticky state.
- Cost and latency normalization, component weighting, ranking advantages and thresholds use reduced BigInt rational arithmetic without binary floating point or early rounding.
- Equal exact scores use one deterministic rule: ascending Route Version ID.
- Hysteresis retains an eligible incumbent below the pinned switch threshold. Sticky routing stores only a SHA-256 key, expires by TTL and yields only when exact advantage reaches the larger override threshold.
- Every result includes component evidence, exact numerator/denominator, raw winner, selected Route, selection reason and `dispatchMutationPerformed: false`.
- The slice remains manual and Shadow-only. It cannot mutate Dispatch, change the live Route or call an external provider.
- Full local verification passed: TypeScript, Engine build, Provider Test build and Vite build.

## Stage 13.3 evidence

- Outcome evidence is append-only and idempotent by both Observation ID and Operation ID. Conflicting reuse fails closed.
- Reliability, quality and nearest-rank p95 latency are aggregated only within the complete Route metric signature and immutable Metric Policy Version window.
- Quality is measured only from rated usable successes; failures cannot supply invented quality. Insufficient sample windows are explicit and never promoted to ready data.
- Every Shadow decision stores the complete Score Policy, candidate snapshot, sanitized sticky state, exact result and a SHA-256 record linked to the preceding record.
- Append validates the decision by recomputing it first. Replay reconstructs scoring from the original immutable inputs, Policy and prior sticky context, then requires exact equality.
- The report compares projected Shadow reliability and quality against the actual pinned Route while recording agreement, Hard-Gate violations and Dispatch mutation count.
- All Stage 13.3 paths remain `SHADOW`; Dispatch mutation is structurally fixed to false and the actual Provider For Test Route remains untouched.
- Full local verification passed: TypeScript, Engine build, Provider Test build and Vite build.

## Stage 13.4 evidence

- The canary ladder is immutable and exact: `1→5→10→25→50→100`; a changed or skipped stage is rejected.
- Arming requires distinct Finance and Reliability human approvals plus sufficient Shadow decisions, exact replay parity, zero selected Hard-Gate violations, zero Dispatch mutations and a passed rollback drill.
- Cohorts use deterministic SHA-256 assignment, start with Admin/Internal at one percent and declare exactly one financial authority per cohort.
- Every stage requires a pinned minimum sample count and observation duration. Insufficient evidence holds the current stage.
- Any Margin Floor breach, Hard-Gate violation or dual-financial-authority conflict rolls back immediately. Actual-cost reconciliation, reliability, quality and p95 latency regressions are bounded by the immutable policy.
- Gate observations are idempotent by Observation ID; conflicting replay fails closed.
- Rollback sends new assignments to the safe Route, preserves accepted Quotes until expiry and lets in-flight jobs complete on pinned versions without redispatch.
- The manual Kill Switch remains effective after any stage, including 100 percent.
- This is a local control/reference implementation only; every assignment is a plan with `dispatchMutationPerformed: false` and no external traffic is activated.
- Full local verification passed: TypeScript, Engine build, Provider Test build and Vite build.

## Stage 13.5 evidence and decision

- `evaluateGate13` is a fail-closed decision function with separate local implementation and formal Gate outcomes.
- The local decision requires foundation/scoring tests, nonzero exact Shadow replay parity, zero Hard-Gate selections, zero Margin Floor breaches, bounded quality/reliability/p95 regressions, Actual Cost reconciliation, the exact completed canary ladder, verified decision chain, rollback drill and zero external Dispatch.
- Malformed or contradictory evidence is rejected instead of producing a decision.
- Formal PASS additionally requires formal Gates 6–12, representative Production data, a certified Production Exact Equivalence Group, a completed real Exact canary, a Production rollback drill and named Product/Finance/Reliability approvals.
- Current local deterministic evidence meets all local requirements. Local implementation decision: `PASS`.
- None of the required external evidence is claimed. Formal Gate 13 decision: `HOLD`.
- `productionAuthorizationGranted` is therefore `false`; the existing Provider For Test route remains the only active local execution route.
- Full local verification passed: TypeScript, `230/230` Vitest tests across `38` files, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

### Formal blockers

1. Formal Gates 6–12 have not passed.
2. Representative Production quality/reliability/cost data is unavailable.
3. No Production Exact Equivalence Group is certified.
4. No real Exact-provider canary has run.
5. No Production rollback drill has passed.
6. Named Product, Finance and Reliability approvals are absent.

### Decision

- Local implementation decision: `PASS`.
- Formal Gate 13 decision: `HOLD`.
- Production authorization: `DENIED`.
- This decision authorizes no provider switch, real canary, Migration, deploy or paid external request.

## Boundary

All route metrics are deterministic local fixtures. No KIE/OpenRouter candidate, production credential, real quality sample, provider switch, canary traffic, Migration or deploy exists. The current generation path remains pinned to Provider For Test.

- [ROUTER-001 Hard Gates and expected usable-success cost](./ROUTER-001_HARD_GATES_EXPECTED_USABLE_COST.md)
- [SCORE-001 Versioned score, hysteresis and stickiness](./SCORE-001_VERSIONED_HYSTERESIS_STICKINESS.md)
- [SHADOW-001 Decision evidence, metrics and replay](./SHADOW-001_DECISION_METRICS_REPLAY.md)
- [CANARY-001 Exact staged rollout and rollback](./CANARY-001_EXACT_STAGED_ROLLOUT.md)
- [GATE-13-EVIDENCE Gate decision and blockers](./GATE-13-EVIDENCE_DECISION.md)
