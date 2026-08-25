# PCP-G6 — Pricing Simulation Foundation

**Status:** `LOCAL FOUNDATION PASS`  
**Scope:** deterministic approval-time finance simulation; no wallet mutation, provider request, secret read, deployment, or production migration.

## What is now enforced

- A candidate commercial snapshot is validated by the same immutable registry checks as an active snapshot, inside an isolated registry instance.
- Each named scenario produces either a pinned quote or an explicit rejection code; it never silently substitutes a price.
- Required rejected scenarios make the report ineligible for approval.
- The report contains an SHA-256 evidence hash over the candidate, scenarios, timestamp, and results.
- Summary exposes worst observed customer charge and minimum observed contribution margin using `bigint`, never floating-point money.
- `PublishedOfferQuoteEngine` accepts only an active published Offer and constrains Family, Recipe, Commercial Route, Provider Cost, and Customer Price to the versions pinned by that Offer's Release Bundle.
- Commercial registry snapshots are now durable immutable rows, with bigint atomic values encoded and restored exactly rather than coerced to JavaScript numbers.
- A Release Bundle is rejected unless its exact commercial snapshot ID, version, evidence hash, route, family, recipe, customer price, provider account/model, and adapter version all match one published durable snapshot.
- `DurablePublishedOfferQuoteEngine` reads that exact durable snapshot for each quote; it does not use an in-memory active-price pointer.

## Evidence

- `packages/commercial-engine/src/pricing-simulation.ts`
- `packages/commercial-engine/src/pricing-simulation.test.ts`
- `packages/commercial-engine/src/commercial-engine.test.ts`
- `packages/commercial-engine/src/published-offer-quote.ts`
- `packages/commercial-engine/src/durable-registry-repository.ts`
- `packages/commercial-engine/src/durable-registry-repository.test.ts`
- `packages/provider-control-plane/src/release-commercial-bridge.test.ts`

## Explicitly not closed

- Risk profiles must be supplied per released offer (P50/P90/P95/P99) and verified by the Release Bundle compiler.
- Treasury balance snapshots, funding lots, actual provider cost and reconciliation are existing separate foundations; they are not yet selected by an end-to-end published offer execution path.
- Admin still needs an authorized Change Set writer/reader for commercial registry snapshots; the durable repository is intentionally not writable from the browser.
- No public provider price or account balance has been collected. Local fixtures are evidence for mechanics only, not a real KIE/OpenRouter price.
