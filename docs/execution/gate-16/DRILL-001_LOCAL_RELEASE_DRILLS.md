# DRILL-001 — Local Release Drill Evidence Contract

| Field | Value |
|---|---|
| Stage | `16.2` |
| Status | `COMPLETE LOCALLY / FIXTURES ONLY` |
| Required types | `Load / Soak / Chaos / Security / Restore` |
| Sensitive data | `PROHIBITED` |
| Production readiness | `NOT GRANTED` |

## Required scenarios

The immutable Drill Policy requires all of the following scenario families:

- Load: Quote burst and 100+ concurrent reserves.
- Soak: long-running reconciliation across the full published window.
- Chaos: post-acceptance worker crash, queue redelivery, provider timeout/outage and callback duplication.
- Security: identity escalation, RLS/RPC bypass, hostile media, secret/log leakage, browser security controls and Admin AAL2/maker-checker.
- Restore: database/storage metadata, projections, outbox/inbox, in-flight reconciliation, Vault recovery and object inventory.

Scenario names and order are pinned to the Policy Version. Missing, duplicated or invented scenarios are rejected.

## Acceptance rules

Load enforces request/concurrency minimums, Quote p95 ≤500ms and the configured failure-rate ceiling. Soak enforces the entire minimum duration. Restore enforces RPO ≤300 seconds and RTO ≤3600 seconds plus projection and in-flight reconciliation verification.

All drill types require zero financial invariant failure, duplicate debit/provider task, unexplained Ledger drift and Critical/High security findings. Every scenario must pass.

Evidence is sanitized local data only. Secrets, raw provider payloads, Production user media and external traffic are structurally prohibited.

## Readiness and audit

The registry reports `READY_LOCAL_FIXTURES` only after one clean result for all five types. A missing or failed type returns `HOLD`. This outcome never grants Production readiness.

- Identical Drill replay is idempotent; changed intent conflicts.
- Every record and the aggregate report carry deterministic SHA-256 evidence hashes.
- Focused Stage 16 suite: `16/16` tests.
- Full repository suite: `331/331` Vitest tests across `51` files and `6/6` Chromium E2E tests.

## Boundary

These records prove the validation contract and failure behavior only. They are not real load, soak, penetration or disaster-recovery reports from Production-like infrastructure. Formal Gate 16 still requires those external drills and signed evidence.
