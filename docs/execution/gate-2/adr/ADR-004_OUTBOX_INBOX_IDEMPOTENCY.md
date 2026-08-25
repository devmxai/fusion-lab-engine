# ADR-004 — Outbox, Inbox and Idempotency

- Status: `PROPOSED — LOCAL DRAFT`
- Owner: `MISSING`
- Review trigger: queue technology, retry policy or consistency-model change

## Context

Database commits and external provider calls cannot form one transaction. Retries, crashes and ambiguous responses must not duplicate billing or generation.

## Decision

Commit operation, reservation and outbox atomically. Relay events at least once. Consumers persist an inbox receipt by event ID before side effects. API mutations bind `Idempotency-Key` to actor, route and request hash. Provider submission uses an adapter idempotency key and lookup-before-resubmit recovery.

## Alternatives

Synchronous fire-and-forget dispatch and retrying every timeout as a new submission were rejected.

## Consequences and controls

Handlers must be replay-safe, use bounded exponential backoff and move poison messages to a review queue. Ordering is guaranteed per operation, not globally.

## Security / financial impact

Duplicate commands cannot double-reserve, double-submit or double-settle. Idempotency conflicts fail closed.

## Safe fallback

Pause relay/consumers while retaining durable outbox entries and protected holds.

