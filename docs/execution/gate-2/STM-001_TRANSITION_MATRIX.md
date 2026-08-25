# STM-001 — Operation Transition Matrix

| Field | Value |
|---|---|
| Status | `PROPOSED — LOCAL DRAFT` |
| Canonical source | `packages/contracts/src/operation.ts` |
| Concurrency rule | Compare-and-set on expected state and state version |
| Evidence rule | Every legal transition requires evidence |
| Owner | `MISSING` |

No caller may write an arbitrary terminal state. `requireLegalTransition` is the only canonical transition validator and increments the state version exactly once.

| From | Event | Authority | To | Financial effect |
|---|---|---|---|---|
| DRAFT | quote.issued.v1 | engine-api | QUOTED | NONE |
| QUOTED | operation.reserved.v1 | engine-transaction | RESERVED | AVAILABLE_TO_HELD |
| RESERVED | operation.queued.v1 | outbox-relay | QUEUED | NONE |
| QUEUED | attempt.dispatching.v1 | worker | DISPATCHING | EXPOSURE_RECORDED |
| DISPATCHING | provider.submitted.v1 | provider-adapter | SUBMITTED | NONE |
| DISPATCHING | provider.submission_unknown.v1 | provider-adapter | SUBMISSION_UNKNOWN | PROTECTED_HOLD |
| SUBMISSION_UNKNOWN | provider.submitted.v1 | reconciler | SUBMITTED | NONE |
| SUBMITTED | provider.running.v1 | provider-poller | RUNNING | NONE |
| SUBMITTED | provider.succeeded.v1 | provider-poller | PROVIDER_SUCCEEDED | NONE |
| RUNNING | provider.succeeded.v1 | provider-poller | PROVIDER_SUCCEEDED | NONE |
| SUBMITTED | provider.failed.v1 | provider-poller | PROVIDER_FAILED | HELD_TO_RELEASED |
| RUNNING | provider.failed.v1 | provider-poller | PROVIDER_FAILED | HELD_TO_RELEASED |
| PROVIDER_SUCCEEDED | asset.stored.v1 | media-worker | ASSET_STORED | NONE |
| PROVIDER_SUCCEEDED | asset.delivery_failed.v1 | media-worker | DELIVERY_FAILED | HELD_TO_RELEASED_AND_PROVIDER_LOSS |
| ASSET_STORED | operation.delivered.v1 | delivery-worker | DELIVERED | NONE |
| DELIVERED | ledger.settled.v1 | finance-worker | SETTLED | HELD_TO_CAPTURED_AND_REMAINDER_RELEASED |
| DRAFT | operation.cancelled.v1 | engine-api | CANCELLED | NONE |
| QUOTED | operation.cancelled.v1 | engine-api | CANCELLED | NONE |
| RESERVED | operation.cancelled.v1 | engine-transaction | CANCELLED | HELD_TO_RELEASED |
| QUEUED | operation.cancelled.v1 | worker | CANCELLED | HELD_TO_RELEASED |
| DISPATCHING | operation.cancelled.v1 | provider-adapter | CANCELLED | HELD_TO_RELEASED |
| Any conflicting state | operation.reconciliation_required.v1 | reconciler | RECONCILIATION_REQUIRED | PROTECTED_HOLD |

## Invariants

- A stale expected version produces a conflict, never a retry-by-overwrite.
- A missing tuple, wrong authority or missing evidence is rejected.
- Customer funds remain held for ambiguous provider acceptance.
- Settlement occurs only after verified asset storage and authorized delivery.
- Reconciliation cannot silently mutate financial outcome; it requires separate reviewed evidence.
