# Gate 15 — Unlimited Relaxed Pilot

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Status | `IMPLEMENTATION COMPLETE LOCALLY — FORMAL HOLD` |
| Formal dependency | `Gate 14 PASS + two financial cycles or 60 representative days` |
| Runtime authority | `LOCAL CONTRACT ONLY / PILOT NOT ACTIVATED` |
| Active execution route | `Existing Provider For Test route unchanged` |
| Production / migration / deploy | `NONE` |

## Stage breakdown

| Stage | Scope | Status |
|---|---|---|
| `15.1` | Truthful offer, published Fair Use, queue/concurrency and restricted Routes | `COMPLETE LOCALLY` |
| `15.2` | Cohort COGS Budget reservation and settlement | `COMPLETE LOCALLY` |
| `15.3` | P50/P90/P95/P99, price-shock and heavy-user simulation | `COMPLETE LOCALLY` |
| `15.4` | Pilot controls, Sales Stop and Kill Switch | `COMPLETE LOCALLY` |
| `15.5` | Gate 15 evidence and decision | `COMPLETE LOCALLY — LOCAL PASS / FORMAL HOLD` |

## Stage 15.1 evidence

- A dedicated `packages/unlimited-relaxed` domain package keeps the offer contract independent from UI, provider adapters and Dispatch.
- `Unlimited Relaxed Draft` cannot carry a fixed hidden monthly generation cap. If a fixed cap is necessary, the only valid label is `High Monthly Allowance` with the positive cap published explicitly.
- The immutable Offer Version publishes eligible subscription plans, exact certified Family/Model/Route tuples, shared queue, maximum concurrency, maximum wait, Draft resolution and duration.
- Fair Use and Terms Versions are visible and pinned. Hidden caps, API automation, batch automation and hidden Model substitution are structurally prohibited.
- Premium/Final outputs always require Credits; only bounded Relaxed Draft output is included.
- Pilot authorization requires active eligible subscription, explicit cohort membership, explicit opt-in and acceptance of the current Fair Use and Terms.
- Raw user identity is hashed. Authorization replay is idempotent and changed intent fails closed.
- Usage decisions reject undisclosed Routes and output dimensions above the published contract, and disclose the actual Route/Family/Model tuple.
- No decision reserves customer Credits, executes provider work or mutates Dispatch. Production activation is structurally false.
- Full local verification passed: TypeScript, targeted ESLint, `283/283` Vitest tests across `45` files, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Stage 15.2 evidence

- Immutable Cohort Budget Policy computes `allowed COGS = floor(net cohort subscription economic value × approved COGS ratio)` using BigInt microusd.
- The Policy pins its Offer Version, Cohort, financial period and per-operation maximum, while fixing authority to local simulation and Pilot activation to false.
- Maximum COGS is reserved before any provider Dispatch and only for an `INCLUDED_RELAXED` decision whose authorization, Cohort, Offer and disclosed Route tuple all match.
- Premium/Final, non-included usage, mismatched Cohorts, expired periods and any decision carrying Credit reservation or Dispatch mutation fail closed.
- Operation retries are idempotent. Changed intent under the same Operation ID is rejected.
- Settlement accepts only verified Actual COGS at or below the reserved maximum and releases the exact unused difference.
- A verified no-charge failure releases the complete reserve. Aggregate and per-operation bounds prevent overcommit.
- `RESERVE`, `SETTLE` and `RELEASE` entries are append-only and SHA-256 chained. The public projection is independently reconstructed from that ledger.
- Customer Credits and external Dispatch remain structurally zero/false.
- Full local verification passed: TypeScript, targeted ESLint, `291/291` Vitest tests across `46` files, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Stage 15.3 evidence

- Immutable Risk Model Policy pins nearest-rank `P50/P90/P95/P99`, ordered bounded price shocks, minimum user samples and the two-cycle/60-day representative-data rule.
- Input accepts only unique hashed per-user aggregates marked sanitized, with no raw user identity, prompt or asset.
- Analysis requires a matching reconciled Cohort Budget and refuses any budget that can activate the Pilot or indicates external Dispatch.
- BigInt calculations publish total and mean COGS, every required percentile, P99/P50 ratio, heavy-user threshold/count/share and evidence hash.
- Scenarios cover Current COGS, every configured price shock and the full Cohort operating at P99 usage.
- Each scenario reports projected COGS, approved budget, exact projected loss and breach status.
- Data is `REPRESENTATIVE` only after sufficient samples plus either 60 days or two completed financial cycles. Otherwise the outcome is `INSUFFICIENT_DATA`.
- Equal arithmetic means with different P99 tails produce different risk outcomes; `decisionUsesAverageOnly` is structurally false.
- Reports are idempotent by Report ID and evidence. The analyzer is simulation-only and cannot activate a Pilot or Dispatch.
- Full local verification passed: TypeScript, targeted ESLint, `299/299` Vitest tests across `47` files, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Stage 15.4 evidence

- An immutable Pilot Control Policy pins the Offer, Cohort Budget and Risk Model Policy Versions, published maximum Cohort membership, Sales Stop thresholds and immediate Kill behavior.
- Every policy starts `CLOSED`, with Sales Stop enabled by default and Production activation structurally prohibited.
- Local simulation can open only from a representative `WITHIN_APPROVED_BUDGET` Risk Report and an exactly reconciled Cohort Budget. Both evidence hashes and their semantic outcomes are revalidated.
- Opening requires a distinct Maker followed by distinct Legal and Finance approvals. Replayed commands are idempotent, while changed intent under the same ID fails closed.
- The published maximum Cohort size bounds Pilot admission and is never treated as a hidden per-user usage cap.
- Manual or automatic Sales Stop blocks new Cohort admission when remaining budget or queue-age thresholds fail, while already admitted authorized members may continue new operations under the existing budget controls.
- Manual Kill, projected Risk budget breach or Budget reconciliation failure immediately blocks new admissions and new operations. Existing in-flight work may only settle or release without redispatch.
- A killed Policy Version cannot reopen. Control events are append-only and SHA-256 chained, and raw actor identity is replaced by a hash.
- The controller has no Dispatch, Credit mutation or Production activation authority.
- Full local verification passed: TypeScript, targeted ESLint, `307/307` Vitest tests across `48` files, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Stage 15.5 evidence

- An executable Gate 15 evaluator rejects malformed evidence and returns separate Local Implementation and Formal Gate decisions.
- Local `PASS` requires all four domain suites, a fully disclosed truthful offer, zero hidden cap/substitution or restricted-Route breach, exact Cohort Budget reconstruction and zero customer Credit charge.
- Risk acceptance requires representative fixture reports containing P50/P90/P95/P99, price-shock and heavy-user scenarios, no average-only decision and maximum projected Cohort loss within its approved budget.
- Control acceptance requires Legal and Finance approval evidence, successful Sales Stop and terminal Kill drills, zero killed-policy reopen, zero external Dispatch and zero Production activation.
- Formal `PASS` additionally requires formal Gate 14, real 60-day/two-cycle representative data, approved published Fair Use, Finance-approved Cohort Budget, real loss evidence within budget, a real control drill and named Legal/Finance approvals.
- Those external prerequisites are absent. The recorded decision is Local `PASS`, Formal `HOLD`, Production authorization `DENIED` and Pilot activation `DENIED`.
- Evidence and decision payloads are independently SHA-256 hashed.
- Full local verification passed: TypeScript, targeted ESLint, `315/315` Vitest tests across `49` files, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Boundary

This is a deterministic local contract reference. No customer sees this offer; no Pilot cohort exists; no real subscription, Fair Use acceptance, operation, provider request, Migration or deploy is created. Formal Gate 14 remains `HOLD`, and representative 60-day/two-cycle evidence does not exist.

- [OFFER-001 Truthful Unlimited Relaxed contract](./OFFER-001_TRUTHFUL_RELAXED_CONTRACT.md)
- [BUDGET-001 Cohort COGS budget](./BUDGET-001_COHORT_COGS_BUDGET.md)
- [RISK-001 Percentile and shock model](./RISK-001_PERCENTILE_SHOCK_MODEL.md)
- [CONTROL-001 Sales Stop and Kill Switch](./CONTROL-001_SALES_STOP_KILL_SWITCH.md)
- [Gate 15 evidence and decision](./GATE-15-EVIDENCE_DECISION.md)
