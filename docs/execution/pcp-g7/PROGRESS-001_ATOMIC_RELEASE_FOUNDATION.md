# PCP-G7 — Atomic Release Bundle Foundation

**Status:** `LOCAL FOUNDATION PASS`  
**Scope:** durable Provider Control Plane only; no provider call, credential value, migration, production state, or user-visible activation.

## Implemented invariant

`RELEASE_BUNDLE` is now the only permitted writer of a customer-visible `PUBLISHED_OFFER`.

Within one SQL transaction it:

1. validates exact immutable Route Candidate and Catalog Snapshot versions;
2. verifies the current Provider Account is `CONNECTED` and uses the released credential reference;
3. verifies the route is `CANARY_VALIDATED`, has the frozen adapter and the frozen customer price;
4. verifies the exact credential reference/version is currently an active Generation credential without decrypting it;
4. appends the immutable Bundle and all Offer versions;
5. updates per-offer pointers and the single active Bundle pointer;
6. appends an immutable audit-chain event.

If dependency validation fails, no Bundle, Offer, or active pointer is written. Retrying the same command id is idempotent. The active pointer includes both Bundle ID and Bundle version, so offers removed by a later Bundle revision cannot leak into the visible catalog.

Rollback is implemented locally as an audited pointer reactivation to one exact historical Bundle version. It re-checks route, account, and active credential readiness and never changes old versions or in-flight operations.

## Evidence

- `packages/provider-control-plane/src/postgres-repository.ts`
- `packages/provider-control-plane/src/postgres-repository.test.ts`
- `packages/durable-execution/sql/001_generation_v2_durability.sql`

## Explicitly not closed

- Commercial Registry / Pricing Simulation evidence is pinned by hash but is not yet durably loaded by the release compiler.
- `activePublishedOfferCatalog()` and `activePublishedRuntimeRoutes()` provide the single read model. `ActivePublishedOfferRuntimeResolver` now accepts only a published Offer ID and resolves its exact route/adapter/credential pins on every call. Creative Space and the durable quote/dispatch path are not yet switched to it.
- `activePublishedCommercialOffers()` feeds `PublishedOfferQuoteEngine`; a cross-package durable test proves Bundle → Offer → constrained Quote with the same pinned Route and Customer Price.
- Post-publish read-model hash checks remain pending. Bundle/offer pointers, rollback state, and the audit chain have restart proof in the local durable database test.
