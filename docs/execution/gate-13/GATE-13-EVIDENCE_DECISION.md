# Gate 13 Evidence and Decision

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Gate | `13 — Profit Router Shadow then Exact` |
| Local implementation | `PASS` |
| Formal Gate | `HOLD` |
| Production authorization | `DENIED` |
| Evaluated scope | `Deterministic local fixtures only` |

## Local acceptance matrix

| Requirement | Local evidence | Result |
|---|---|---|
| Hard Gates precede economics/scoring | `ProfitRouterFoundation` and excluded-Route fixtures | `PASS LOCAL` |
| Expected Cost per Usable Success is exact | BigInt rational retry/cost fixtures | `PASS LOCAL` |
| Score is immutable and explainable | versioned `45/25/20/10` score and exact component evidence | `PASS LOCAL` |
| Hysteresis/stickiness cannot bypass gates | incumbent, TTL sticky and circuit-open fixtures | `PASS LOCAL` |
| Quality/reliability metrics are signature scoped | append-only terminal outcome aggregation | `PASS LOCAL` |
| Every Shadow decision is replayable | immutable inputs, prior sticky context and SHA-256 chain | `PASS LOCAL` |
| No Margin Floor breach | Stage Gate fixture requires count `0` | `PASS LOCAL FIXTURE` |
| No quality/reliability/p95 regression | immutable thresholds and automatic rollback fixtures | `PASS LOCAL FIXTURE` |
| Actual Cost reconciliation | stage fixture requires `10000 bps` against `9900 bps` minimum | `PASS LOCAL FIXTURE` |
| Exact canary ladder | `1→5→10→25→50→100`, no jump API | `PASS LOCAL SIMULATION` |
| Rollback | Margin breach and manual Kill Switch return new assignments to safe Route | `PASS LOCAL DRILL` |
| No unauthorized local execution | zero external Dispatch; Provider For Test path unchanged | `PASS LOCAL` |

The executable evaluator returns Local `PASS` only when all rows are satisfied together. Invalid bounds, incomplete replay, a changed ladder, a breach, a missing drill or external local Dispatch changes the local decision to `HOLD` or rejects malformed evidence.

## Formal blockers

| Required formal evidence | Current status |
|---|---|
| Formal Gates 6–12 passed | `MISSING` |
| Representative Production route data | `MISSING` |
| Certified Production Exact Equivalence Group | `MISSING` |
| Real Exact-provider canary | `NOT RUN` |
| Production rollback drill | `NOT RUN` |
| Named Product, Finance and Reliability approvals | `MISSING` |

Local fixtures cannot substitute for these dependencies. Therefore the formal Gate cannot pass.

## Verification

- Profit Router focused suite: `28/28` tests.
- Full repository suite: `230/230` Vitest tests across `38` files.
- TypeScript: passed for app, Engine, Provider Test and every domain package.
- Builds: Engine, Provider Test and Vite passed.
- Chromium E2E: `6/6` passed, including desktop/mobile and Axe WCAG A/AA coverage.
- Touched Profit Router files: ESLint passed.
- Diff whitespace validation: passed.

## Final decision

```text
Local implementation: PASS
Formal Gate 13: HOLD
Production authorization: DENIED
Active execution route: existing Provider For Test route
Migration / deploy / real canary / paid provider request: NONE
```

This closes the local implementation of Stage 13 without claiming certification or activating Exact auto-routing. Stage 14 depends on formal Gate 13 and is not authorized for Production by this decision.
