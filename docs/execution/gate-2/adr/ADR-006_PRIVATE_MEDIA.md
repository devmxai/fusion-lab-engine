# ADR-006 — Private Media Ingestion and Retention

- Status: `PROPOSED — LOCAL DRAFT`
- Owner: `MISSING — Security and Privacy approval required`
- Review trigger: storage provider, media class, retention or delivery policy change

## Context

Provider result URLs are untrusted and temporary. Public buckets or pass-through URLs leak user content and bypass validation.

## Decision

Workers download with SSRF protection, strict redirect/timeout/size/type/signature limits, stream to private object storage, compute SHA-256, scan/validate, persist immutable metadata, and expose only short-lived authorized delivery URLs. Retention and deletion are policy-driven by media class.

## Alternatives

Saving provider URLs as results and public object storage were rejected.

## Consequences and controls

Delivery is not complete until verified storage succeeds. The current engine memory store proves the local ingest contract only and is not production evidence.

## Security / financial impact

Failed ingestion after provider success is recorded as provider loss and requires explicit financial policy; it must not silently claim successful delivery.

## Safe fallback

Quarantine the asset, block delivery and route the operation to reviewed recovery without exposing the provider URL.

