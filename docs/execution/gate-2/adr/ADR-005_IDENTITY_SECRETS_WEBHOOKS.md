# ADR-005 — Internal Identity, Secrets and Webhooks

- Status: `PROPOSED — LOCAL DRAFT`
- Owner: `MISSING — Security approval required`
- Review trigger: identity provider, secret store or webhook provider change

## Context

Internal calls and provider callbacks cross trust boundaries. Previously exposed personal tokens cannot be treated as safe credentials.

## Decision

Use short-lived workload identity for internal services where available. Store provider credentials as managed secret references, never database plaintext or browser variables. Verify webhook signature, timestamp, replay window and provider/task binding before accepting an event. Log secret access metadata, never secret value.

## Alternatives

Shared long-lived tokens in `.env` for production and unsigned webhook callbacks were rejected.

## Consequences and controls

Rotation, revocation, least privilege, audit and environment separation are mandatory. The local test API key is development-only and production mode rejects it.

## Security / financial impact

Unverified callbacks cannot change operation or ledger state. Exposed credentials must be revoked outside the repository before Gate 0 can pass.

## Safe fallback

Disable the affected provider and webhook route, poll through an authenticated adapter, and hold unresolved operations for reconciliation.

