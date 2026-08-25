# Platform Foundation — Durable Execution Primitives

| Field | Value |
|---|---|
| Status | `TESTED — LOCAL IN-MEMORY ADAPTER` |
| Gate decision | `NOT APPROVED` |
| Persistence | Port-compatible in-memory implementation; no PGMQ or database migration |
| Owner | `MISSING` |

## Implemented contracts

- Idempotency scope is `(actorId, route, key)` and is permanently bound to the request SHA-256.
- One lease holder executes a command; completed responses replay without executing the side effect again.
- Outbox events are appended once, leased to one worker, acknowledged only by that worker, redelivered after explicit crash recovery and dead-lettered after a bounded attempt budget.
- Inbox deliveries are unique by `(provider, deliveryId)`. Concurrent identical deliveries execute one handler; changed payload content for the same delivery ID fails closed.
- A failed inbox handler does not create a false success receipt.

## Canonical implementation and evidence

- `packages/durable-execution/src/idempotency.ts`
- `packages/durable-execution/src/outbox.ts`
- `packages/durable-execution/src/inbox.ts`
- `packages/durable-execution/src/durability.test.ts`

## Production replacement boundary

The public interfaces are independent of PGMQ/PostgreSQL. A future durable adapter must preserve the same uniqueness, lease ownership, replay and conflict semantics inside database transactions. The in-memory adapter is not restart-persistent and cannot satisfy Gate 2 production evidence.

