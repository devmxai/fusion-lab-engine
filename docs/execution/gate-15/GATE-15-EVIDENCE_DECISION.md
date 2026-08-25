# Gate 15 Evidence and Decision

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Gate | `15 — Unlimited Relaxed Pilot` |
| Local implementation | `PASS` |
| Formal Gate | `HOLD` |
| Production authorization | `DENIED` |
| Unlimited Relaxed Pilot activation | `DENIED` |
| Evaluated scope | `Deterministic local fixtures only` |

## Local acceptance matrix

| Requirement | Local evidence | Result |
|---|---|---|
| Offer is truthful | immutable Unlimited Relaxed Draft contract with published Fair Use and no fixed hidden cap | `PASS LOCAL` |
| No hidden Model substitution | actual restricted Family/Model/Route tuple is disclosed | `PASS LOCAL` |
| Premium/Final remains Credit-funded | included contract is bounded Relaxed Draft only | `PASS LOCAL` |
| Cohort COGS is bounded | exact BigInt allowed/available/reserved/settled reconstruction | `PASS LOCAL` |
| Customer is not double charged | included usage carries zero customer Credit charge | `PASS LOCAL` |
| Risk is distribution-based | P50/P90/P95/P99, price shocks and all-users-at-P99 fixtures | `PASS LOCAL FIXTURE` |
| Heavy-user risk is explicit | P99 threshold/count/share and tail-sensitive tests | `PASS LOCAL FIXTURE` |
| Cohort loss is within approved budget | zero breach scenarios and maximum projected fixture loss within limit | `PASS LOCAL FIXTURE` |
| Legal/Finance separation exists | distinct local approval actors under an immutable Control Policy | `PASS LOCAL` |
| Sales Stop works | manual, remaining-budget and queue-age drills | `PASS LOCAL DRILL` |
| Kill Switch is terminal | manual, risk and reconciliation drills; no reopen or redispatch | `PASS LOCAL DRILL` |
| No unauthorized execution | zero external Dispatch and zero Production activation | `PASS LOCAL` |

The executable evaluator returns Local `PASS` only when every row passes together. Malformed counts, timestamps or money are rejected. Hidden caps, undisclosed substitution, budget drift, customer Credit charging, incomplete percentile evidence, average-only decisions, loss-budget breach, missing approvals, failed controls, killed-policy reopen, external Dispatch or Production activation produces Local `HOLD`.

## Formal blockers

| Required formal evidence | Current status |
|---|---|
| Formal Gate 14 passed | `MISSING — GATE 14 FORMAL HOLD` |
| Representative 60-day or two-financial-cycle data | `MISSING — LOCAL FIXTURES ONLY` |
| Published Fair Use and Terms approved by Legal | `MISSING` |
| Cohort COGS Budget approved by Finance | `MISSING` |
| Real Cohort loss verified within approved budget | `NOT AVAILABLE` |
| Real Sales Stop and Kill Switch drill | `NOT RUN` |
| Named Legal and Finance approvals | `MISSING` |

Local simulation cannot replace these external approvals and real operational evidence. Formal Gate 15 therefore remains `HOLD`.

## Verification

- Unlimited Relaxed focused suite: `40/40` tests.
- Full repository suite: `315/315` Vitest tests across `49` files.
- TypeScript passed for the app, Engine, Provider Test and all domain packages.
- Engine, Provider Test and Vite builds passed.
- Chromium E2E: `6/6` passed across desktop and mobile Creative Space scenarios.
- Touched Unlimited Relaxed files passed ESLint.
- Diff whitespace validation passed.

## Final decision

```text
Local implementation: PASS
Formal Gate 15: HOLD
Production authorization: DENIED
Unlimited Relaxed Pilot activation: DENIED
Active execution route: existing Provider For Test route
Real cohort / paid provider / Migration / deploy: NONE
```

This completes Gate 15's local engineering scope without claiming Production certification or creating a real Pilot.
