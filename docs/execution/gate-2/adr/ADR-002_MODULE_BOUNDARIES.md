# ADR-002 — Modular Boundaries and Dependency Direction

- Status: `PROPOSED — LOCAL DRAFT`
- Owner: `MISSING`
- Review trigger: new domain, service extraction or cross-module dependency

## Context

Provider-specific behavior, accounting, orchestration and canvas UI must evolve without circular dependencies or repeated engine redesign.

## Decision

Define modules for contracts, domain, application services, ports, adapters and delivery. Dependencies point inward: UI and HTTP adapters depend on application contracts; provider adapters implement provider ports; domain logic never imports Fastify, React, Supabase or provider SDKs.

## Alternatives

Feature folders with direct database/provider imports were rejected because they hide authority boundaries and make testing provider-dependent.

## Consequences and controls

Public contracts are versioned. Adapter registration is explicit. Cross-domain communication uses typed commands/events rather than direct writes.

## Security / financial impact

Only finance application services can authorize ledger commands; only certified adapters can submit provider requests.

## Safe fallback

Disable an adapter or module route without changing core contracts or the domain state machine.

