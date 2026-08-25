# Gate 6 — Durable Orchestration and Exact Provider Execution

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Status | `LOCALLY IMPLEMENTED REFERENCE` |
| Gate decision | `NOT EVALUATED / NOT PASSED` |
| Provider certified | `Provider For Test — LOCAL TEST ONLY` |
| KIE offline certification | `VALIDATED + LOCAL_TEST_ONLY / NO KIE CREDIT CONSUMED` |
| Database / production change | `NONE` |
| Owner / reviewers | `MISSING — Engine, Finance, SRE and Security required` |

## Artifacts

- [ORCH-001 — Durable orchestration contract](./ORCH-001_DURABLE_ORCHESTRATION.md)
- [RUN-001 — Recovery and reconciliation runbook](./RUN-001_RECOVERY_RECONCILIATION.md)
- [APU-G5 — KIE offline readiness and closure evidence](./APU-G5_KIE_OFFLINE_READINESS.md)
- Executable primitives: `packages/durable-execution/src/`
- Integrated local path: `apps/engine-api/src/local-provider/service.ts`

## Proven locally

- The user request commits reservation, operation, scoped idempotency binding and Outbox event as one in-memory reference transaction.
- Provider dispatch happens only after an Outbox relay lease; it does not happen in the operation-creation request.
- One active attempt per operation, worker lease ownership, crash recovery and bounded dead-letter primitives.
- Accepted-but-timeout remains `SUBMISSION_UNKNOWN`; lookup resolves by provider idempotency without a second debit.
- Unknown lookup and polling budgets end in `RECONCILIATION_REQUIRED` / `MANUAL_REVIEW` while the customer hold stays protected.
- Provider callback Inbox deduplicates identical deliveries and rejects a reused delivery ID with different content.
- Provider success records actual native credits, ingests private media, delivers, then settles the immutable customer quote.
- Provider failure releases; delivery failure releases and records provider loss.
- 100 repeated operation requests yield one operation, one reservation, one Outbox event, one attempt and one provider task.
- Local reconciliation reports a target of `9900 bps` and explains mismatches by operation.

## Gate blockers

1. Gates 3–5 are not approved and Gate 0 remains `HOLD`.
2. Stores are in memory; no PostgreSQL transaction, `FOR UPDATE SKIP LOCKED`, lease expiry or restart persistence evidence exists.
3. No real queue, scheduler, multi-worker chaos test, dead-letter operator UI or alert integration exists.
4. KIE is validated by local fixtures only; a real account, catalog evidence, callback inbox durability, sandbox/canary, external reconciliation and formal certification remain prohibited/pending.
5. The 99% reconciliation result is a deterministic local reference, not a production observation window.
6. No staging/production runbook rehearsal, SLO, pager ownership or signed Finance/SRE approval exists.

This package must not be described as a KIE-certified path. Adding KIE later means implementing its adapter and evidence pack against this orchestration contract, not redesigning the Engine.
