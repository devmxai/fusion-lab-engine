# ORCH-001 — Durable Orchestration Contract

| Field | Value |
|---|---|
| Status | `PROPOSED — LOCALLY TESTED` |
| Scope | Provider-neutral execution control plane |
| Current adapter | `provider-test-http.v1` |
| Review trigger | Queue, provider, state, retry, callback or settlement change |

## Transaction boundary

```text
validated immutable Quote
→ whole-credit reservation
→ Operation(RESERVED)
→ scoped idempotency binding
→ operation.queued.v1 Outbox append
→ commit
```

If any write fails, none of the four artifacts may become visible. A replay with the same actor, route, key and request hash returns the original operation. Different content under the same scoped key fails with `409`.

## Execution boundary

```text
Outbox PENDING
→ relay lease
→ QUEUED
→ Attempt READY
→ worker lease
→ DISPATCHING
→ ProviderAdapter.submit(idempotencyKey)
```

Only the attempt lease owner records the submission outcome. The Outbox event is acknowledged after a classified outcome. Worker crash recovery requeues the same event/attempt; it does not clone either identity.

## Submission outcomes

| Evidence | Operation | Attempt | Financial action |
|---|---|---|---|
| provider accepted with task ID | `SUBMITTED` | `SUBMITTED` | protect hold |
| transport outcome ambiguous | `SUBMISSION_UNKNOWN` | `SUBMISSION_UNKNOWN` | protect hold; lookup only |
| definitive rejection/no provider charge | `PROVIDER_FAILED` | `FAILED` | release hold |
| lookup/poll budget exhausted | `RECONCILIATION_REQUIRED` | `MANUAL_REVIEW` | protect hold; no automatic refund |

An ambiguous submission must never be redispatched blindly. Reconciliation uses the original provider idempotency key. A time threshold alone cannot release customer credits.

## Completion outcomes

- Poll or verified callback updates only the matching provider task.
- `actualProviderCredits` is recorded from the terminal provider response, independently of the quote estimate.
- A successful provider task is not billable delivery: result media must pass the private media pipeline first.
- `DELIVERED → SETTLED` captures no more than the immutable customer quote.
- Provider terminal failure releases the hold.
- Media/delivery failure releases the customer hold and records the actual provider loss.

## Callback Inbox

- Identity: provider + delivery ID.
- Integrity: SHA-256 of the canonical callback task payload.
- Same delivery and payload replays the recorded result without side effects.
- Same delivery ID with different payload is a conflict requiring investigation.
- Task ID must match the operation before any state or financial effect.

## Local observability

- `GET /v1/dev/mock/orchestration` exposes sanitized local journals, reservations, operations, Outbox, attempts and Inbox receipts.
- `GET /v1/dev/mock/reconciliation` exposes total/reconciled counts, rate, 99% target and issue codes.
- These development endpoints contain no provider credential and are not production Admin APIs.
