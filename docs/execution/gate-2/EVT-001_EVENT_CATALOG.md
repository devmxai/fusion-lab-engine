# EVT-001 — Canonical Event Catalog

| Field | Value |
|---|---|
| Status | `PROPOSED — LOCAL DRAFT` |
| Envelope schema | `CanonicalEventSchema` |
| Schema version | `1` |
| Compatibility | Backward-compatible optional additions only |
| Owner | `MISSING` |

Every event requires an immutable event ID, timestamp, producer, correlation and causation IDs, aggregate identity/version, privacy class and a typed strict payload. Secrets, raw prompts, long-lived signed URLs and raw provider payloads are prohibited.

| Event | Producer / authority | Purpose |
|---|---|---|
| `quote.issued.v1` | Engine API | Records the immutable commercial quote and request hash |
| `operation.reserved.v1` | Engine transaction | Confirms atomic credit reservation |
| `operation.queued.v1` | Outbox relay | Proves durable hand-off to execution |
| `attempt.dispatching.v1` | Worker | Pins route version before provider submission |
| `provider.submitted.v1` | Adapter or reconciler | Records hashed provider acceptance evidence |
| `provider.submission_unknown.v1` | Provider adapter | Protects held funds after ambiguous submission |
| `provider.running.v1` | Provider poller | Records provider progress evidence |
| `provider.succeeded.v1` | Provider poller | Records success, actual provider credits and result reference hash |
| `provider.failed.v1` | Provider poller | Records classified failure and no-charge evidence |
| `asset.stored.v1` | Media worker | Proves verified private ingestion and checksum |
| `asset.delivery_failed.v1` | Media worker | Records post-provider delivery failure and provider loss |
| `operation.delivered.v1` | Delivery worker | Confirms the result is available to the authorized user |
| `operation.cancelled.v1` | Authorized lifecycle actor | Records evidence-safe cancellation |
| `operation.reconciliation_required.v1` | Reconciler | Quarantines conflicts without guessing financial outcome |
| `ledger.settled.v1` | Finance worker | Captures held customer credits after delivery |
| `ledger.released.v1` | Finance worker | Releases a hold with reason and evidence |

## Evolution rule

Existing required fields cannot be removed or reinterpreted in v1. A semantic or required-field break requires a new event name suffix. Consumers must be idempotent by `eventId` and reject unsupported schema versions.

