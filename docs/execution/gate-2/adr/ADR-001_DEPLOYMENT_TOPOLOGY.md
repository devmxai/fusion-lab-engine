# ADR-001 — Deployment Topology and Trust Boundaries

- Status: `PROPOSED — LOCAL DRAFT`
- Owner: `MISSING`
- Review trigger: topology, hosting, network or trust-boundary change

## Context

Browser code must not possess provider credentials or financial authority. The platform needs independently controlled API, execution, provider and media boundaries.

## Decision

Use Browser → Engine API → durable execution worker → provider adapter as the command path. Media ingestion and finance settlement are separate authorities. Provider credentials remain server-side. The current test provider is an independent loopback HTTP service, not an in-process shortcut.

## Alternatives

A browser-to-provider path and a monolithic web process were rejected because they expose secrets and couple UI availability to financial execution.

## Consequences and controls

Service identity, timeouts, least-privilege networking, health/readiness and correlation IDs are mandatory. Production hosting and network policy remain undecided, so this ADR cannot yet be approved.

## Security / financial impact

Compromise of the web UI cannot directly submit paid provider jobs or settle balances. Every cross-boundary command is authenticated and attributable.

## Safe fallback

Disable provider routes and retain read-only project access; never fall back to browser-side provider calls.

