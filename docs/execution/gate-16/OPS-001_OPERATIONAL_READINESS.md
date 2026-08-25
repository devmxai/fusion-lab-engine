# OPS-001 — Operational Readiness Contract

| Field | Value |
|---|---|
| Stage | `16.3` |
| Status | `COMPLETE LOCALLY / LIVE OPERATIONS NOT VERIFIED` |
| SLO controls | `8 required` |
| Alerts | `5 P0 + 5 P1` |
| Production readiness | `NOT GRANTED` |

## SLO ownership

The Policy requires controls for Quote p95, Engine availability, accepted-operation durability, Ledger invariants, callback and polling reconciliation, Backup RPO and Restore RTO.

Each SLO is invalid unless it has an SLI query, data source, measurement window, hashed owner, dashboard, linked alert and Runbook, explicit Error Budget, fast/slow burn alerts and documented user impact.

## Alerts and Error Budgets

P0 covers Ledger drift/negative balance, secret exposure/suspicious spend, duplicate settlement/provider task, public-asset regression and provider-balance exposure. P1 covers queue/DLQ, cost shock, webhook verification, ingest and Auth/RLS anomalies.

Every alert has an owner, drilled Runbook and Kill Switch. Consuming 50% of the Error Budget pauses rollout; 100% freezes the affected feature. Ledger drift, public assets, duplicate debit/task and secret exposure are immediate P0 events and are never budgetable.

## Runbooks and On-call

Runbook drills must prove containment, evidence preservation, recovery and traffic-reopen decisions. On-call requires distinct primary and backup responders, an escalation channel, user communication template and a truthful coverage window.

- P0 acknowledgement: ≤300 seconds.
- P1 acknowledgement: ≤900 seconds.
- P2 acknowledgement: ≤1 business day.

## Acceptance evidence

- Exact SLO/Alert/response Policy validation is tested.
- Missing or duplicate SLOs and invented Alert links are rejected.
- SLI, owner, Dashboard, burn and impact requirements are tested.
- Alert severity, Runbook and Kill Switch links are tested.
- Primary/backup separation and response targets are tested.
- Error Budget and unbudgetable-incident actions are tested.
- Evidence idempotency/conflict and zero Production authority are tested.
- Focused Stage 16 suite: `24/24` tests.
- Full repository suite: `339/339` Vitest tests across `52` files and `6/6` Chromium E2E tests.

## Boundary

All operational evidence is sanitized local fixture data. It proves the contract but does not prove live telemetry, Dashboards, paging delivery, human rota coverage or Production Runbook execution. Those remain formal Gate 16 blockers.
