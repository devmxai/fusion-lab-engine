# PCP-G1 Gate Decision — Local Engine P0

> **Decision:** `PASS — LOCAL`  
> **Date:** 22 August 2026  
> **Scope:** engine invariants only; no external provider credentials, account verification, provider network call, migration, deployment, or production claim.

## Accepted evidence

- Durable quote, reservation, outbox, provider attempt, asset delivery and double-entry ledger tests.
- Restart, duplicate, submission-unknown, failure-no-charge, failure-with-charge/platform-loss, kill-switch and deadline-to-reconciliation scenarios.
- Durable provider webhook inbox and post-verification processor tests.
- KIE and OpenRouter adapter contract tests run only with offline fixture transports.
- TypeScript checks completed for app, Engine API, provider-test API, durable execution, media pipeline and commercial engine scopes.

## Gate constraints carried forward

- No actual provider model, account availability, credential, price, or customer offer is certified by this gate.
- The future HTTP webhook endpoints are blocked on the server-only Secret Manager in `PCP-G3`; they must invoke the existing post-verification processor and cannot bypass it.
- `PCP-G2` may now build durable control-plane records, but cannot activate a real route.
