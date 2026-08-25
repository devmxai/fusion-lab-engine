# Gate 16 — Beta, GA and Legacy Retirement

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Status | `COMPLETE LOCALLY / FORMAL HOLD` |
| Formal dependency | `Every Gate required by the selected release scope` |
| Runtime authority | `LOCAL CONTRACT SIMULATION ONLY` |
| Active execution route | `Existing Provider For Test route unchanged` |
| Production / migration / deploy | `NONE` |

## Stage breakdown

| Stage | Scope | Status |
|---|---|---|
| `16.1` | Internal Alpha, Invite Beta and ordered 1→5→25→50→100→GA rollout contract | `COMPLETE LOCALLY` |
| `16.2` | Load, Soak, Chaos, Security and Restore drill evidence | `COMPLETE LOCALLY` |
| `16.3` | SLO, Error Budget, Alerts, Runbooks and On-call readiness | `COMPLETE LOCALLY` |
| `16.4` | V1 read-only window and Legacy grants/code retirement | `COMPLETE LOCALLY` |
| `16.5` | Gate 16 evidence and decision | `COMPLETE LOCALLY` |

## Stage 16.1 evidence

- A dedicated `packages/release-governance` domain package keeps release authority independent from the UI, provider adapters and Production deployment systems.
- The immutable Policy pins one release digest, the required Gate IDs and the exact `Internal Alpha → Invite Beta → 1% → 5% → 25% → 50% → 100% → GA Ready` order.
- Every release begins in `DRAFT` with external traffic and Production activation structurally prohibited.
- Arming requires distinct Product, Engineering, Security and Finance actors independent from the Maker.
- Readiness fixtures must pin artifact, SBOM and provenance digests, exact Gate IDs, 100% actual-cost reconciliation, rollback, SLO, DR and runbook evidence.
- Critical/High findings, unexplained Ledger drift, financial invariant failures, incomplete reconciliation, SLO breach, unavailable rollback or unbudgetable incidents stop the rollout immediately.
- Consuming 50% of the Error Budget pauses rollout; 100% is a release blocker.
- Each stage requires the minimum sample count and observation duration and cannot be skipped.
- Approval and observation replay is idempotent; changed intent fails closed. Events form an append-only SHA-256 chain and actor identity is hashed.
- Full local verification passed: TypeScript, targeted ESLint, `323/323` Vitest tests across `50` files, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Stage 16.2 evidence

- An immutable Drill Policy pins all required Load, Soak, Chaos, Security and Restore scenario sets and their acceptance thresholds.
- Load evidence covers quote bursts and at least 100 concurrent reserves, with a 500ms Quote p95 ceiling, bounded failure rate and zero financial invariant failures.
- Soak evidence requires the complete published duration and long-running reconciliation scenario.
- Chaos evidence covers worker crash after provider acceptance, queue redelivery, provider timeout/outage and duplicate callback handling.
- Security evidence covers JWT/role escalation, RLS/RPC bypass, media SSRF/MIME/malware/oversize, secret/log leakage, browser controls and Admin AAL2/maker-checker.
- Restore evidence covers database/storage metadata, projection rebuild, outbox/inbox replay, in-flight reconciliation, Vault recovery and object inventory, with RPO ≤300 seconds and RTO ≤3600 seconds.
- Any failed scenario, Critical/High finding, duplicate debit/task, unexplained Ledger drift or financial invariant failure holds readiness.
- Evidence must be sanitized and structurally rejects secrets, raw provider payloads, Production user media and external traffic.
- Drill IDs are idempotent and conflicting replay fails closed. The readiness report is SHA-256 hashed and cannot grant Production readiness.
- Full local verification passed: TypeScript, targeted ESLint, `331/331` Vitest tests across `51` files, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Stage 16.3 evidence

- An immutable Operations Policy pins the eight baseline SLOs, five P0 and five P1 alerts, Error Budget actions, unbudgetable incident classes and P0/P1/P2 response targets.
- Every SLO must link an exact SLI query, data source, measurement window, hashed owner, dashboard, real alert reference, Runbook, Error Budget, fast/slow burn alerts and documented user impact.
- Every Alert must use the correct P0/P1 severity and link a hashed owner, drilled Runbook and Kill Switch.
- Runbook drills require containment, evidence preservation, recovery and traffic-reopen steps.
- On-call readiness requires distinct hashed primary and backup actors, escalation channel, user communication template and truthful published coverage.
- Response targets are pinned to P0 ≤5 minutes, P1 ≤15 minutes and P2 ≤1 business day.
- Error Budget drills prove rollout pause at 50%, affected-feature freeze at 100%, immediate P0 for unbudgetable incidents and owner approval before recovery.
- Evidence replay is idempotent, conflict fails closed, and the deterministic SHA-256 report never grants live Production readiness.
- Full local verification passed: TypeScript, targeted ESLint, `339/339` Vitest tests across `52` files, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Stage 16.4 evidence

- An immutable Legacy Retirement Policy pins the 60–90 day Read-Only window, four-role approval separation (Engineering, Security, Finance, Support), single replacement writer, and immutable legal retention of financial evidence.
- Attempted legacy writes during read-only, unrevoked database RPC execution grants, and destructive ledger deletion fail closed.
- Controller domain tests verify full lifecycle progression: `ACTIVE → READ_ONLY → GRANTS_REVOKED → CODE_RETIRED`.
- Grant revocation and code retirement are both constrained to the same 60–90 day window and record their timestamps in the immutable snapshot.
- Final local regression: `9/9` Legacy controller tests passed.

## Stage 16.5 evidence

- Deterministic Gate Evaluator `evaluateGate16` consumes the published Policy and source snapshot/report from every sub-domain; it does not accept free-form pass counters or formal-approval booleans.
- It produces an evidence digest and decision hash, may return only local `PASS` or `HOLD`, and always returns Formal `HOLD` plus Production `DENIED` in this local runtime.
- Future formal evidence is a data-only contract with named Product, Engineering, Security and Finance receipts; no local evaluator consumes it.
- Final local regression: `6/6` Gate evaluator tests and `41/41` focused release-governance/local-guard tests passed; full repository suite passed `356/356` tests in `55` files and Chromium E2E passed `6/6`.

## Boundary

All approval, Gate, artifact and stage observations are deterministic local fixtures. The local browser bridge can simulate V1 `READ_ONLY` and block `start-generation` / `complete-generation` writes without calling Supabase or a paid provider. It does not alter the live legacy functions. No formal Gate is changed, no real Alpha/Beta cohort or Production traffic is created, and no Migration or deploy is performed.

- [ROLLOUT-001 Ordered release promotion contract](./ROLLOUT-001_ORDERED_RELEASE_PROMOTION.md)
- [DRILL-001 Local release drill evidence contract](./DRILL-001_LOCAL_RELEASE_DRILLS.md)
- [OPS-001 SLO, Alert, Runbook and On-call contract](./OPS-001_OPERATIONAL_READINESS.md)
- [LEGACY-001 Legacy retirement and read-only window contract](./LEGACY-001_RETIREMENT_CONTRACT.md)
- [Gate 16 Evidence and Decision](./GATE-16-EVIDENCE_DECISION.md)
