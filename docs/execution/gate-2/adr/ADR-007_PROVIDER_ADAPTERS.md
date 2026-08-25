# ADR-007 — Provider Adapter Certification and Versioning

- Status: `PROPOSED — LOCAL DRAFT`
- Owner: `MISSING`
- Review trigger: provider API/model change or new adapter capability

## Context

Adding KIE, OpenRouter or another provider must not require redesigning the engine. Each provider still has distinct authentication, models, async lifecycle and errors.

## Decision

Providers implement a canonical port for catalog/capabilities, quote, submit, lookup-by-idempotency, poll, cancel and authenticated asset retrieval. Registry selection uses immutable adapter and route versions. A provider/model is exposed only after contract, failure, timeout, idempotency, pricing and media certification.

## Alternatives

Provider-specific branches in controllers and a universal undocumented request passthrough were rejected.

## Consequences and controls

Adapters own protocol translation; the engine owns lifecycle, accounting and policy. Model discovery is normalized and reviewed before catalog publication. The independent Provider For Test currently exercises this boundary over real HTTP.

## Security / financial impact

Secrets stay within adapters. Provider cost evidence is internal; public APIs receive customer price only.

## Safe fallback

Disable or pin the affected adapter version and reroute only through previously certified compatible routes.

