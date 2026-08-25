# RUN-001 — Local Recovery and Reconciliation Runbook

| Condition | Automated action | Financial rule | Escalation evidence |
|---|---|---|---|
| Relay worker crashes before ACK | recover lease and redeliver same Outbox event | no new reservation | event ID, attempts, worker IDs |
| Provider response times out after possible acceptance | set `SUBMISSION_UNKNOWN`; lookup by original idempotency key | keep hold | request/response hashes, lookup result |
| Unknown lookup budget expires | `RECONCILIATION_REQUIRED` / `MANUAL_REVIEW` | never time-only release | lookup count, provider search evidence |
| Poll budget expires | `RECONCILIATION_REQUIRED` / `MANUAL_REVIEW` | keep hold until evidence | task ID, poll count, last provider status |
| Callback repeats | Inbox replay; no state/ledger side effect | unchanged | delivery ID and payload hash |
| Callback ID conflicts | reject `409`; investigate | unchanged | both payload hashes |
| Provider fails with verified no-charge outcome | terminal failure | release | provider task response hash |
| Provider succeeds but media ingest fails | delivery failure | release customer; record provider loss | provider actual cost + media failure evidence |
| Delivery verified | settle quoted whole credits once | capture quote only | asset checksum + settlement journal |

## Local operator procedure

1. Read the operation, Outbox, attempt and Inbox evidence through the orchestration endpoint.
2. Run reconciliation and identify the issue code; do not mutate balances or terminal state directly.
3. For `SUBMISSION_UNKNOWN`, query the provider using the original idempotency key and task evidence.
4. If accepted, attach the provider task and continue polling/ingest. If definitively absent/no charge, issue an evidence-backed release command.
5. If provider cost exists but delivery failed, record provider loss before closing the incident.
6. Re-run reconciliation; the local target is at least `9900 bps` and every remaining mismatch needs an owner.

## Production rehearsal still required

This runbook has not been rehearsed against PostgreSQL, a real queue, KIE, multiple workers or Production. Named ownership, alerts, privileged manual commands, maker-checker approval and immutable audit storage remain Gate 6 blockers.
