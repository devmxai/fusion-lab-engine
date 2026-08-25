# APU-G1 — Provider Catalog and Route Contract

| Field | Value |
|---|---|
| Program | `FL-APU-001` |
| Status | `LOCAL IMPLEMENTATION COMPLETE — NOT A PRODUCTION CERTIFICATION` |
| Boundary | Contracts, local tests and in-memory registry only |
| Prohibited | Provider API calls, secret entry, migration, deploy and production changes |

## Delivered local foundation

- A typed, strict `ProviderRouteManifest` separates `Publisher`, `ModelFamily`, `CanonicalModel`, `ProviderAccount`, `ProviderModel`, `HostingProviderEndpoint`, capability, source snapshot, provider cost version and certification.
- A provider route is explicitly composed from account + model + endpoint + capability + cost guard + certification. It is not a provider-specific UI record and does not confuse the publisher with the route provider.
- Every route requires a SHA-256 source snapshot, a versioned usage extractor and a cost guard. A billable route cannot have an unspecified maximum; an unsupported route cannot pretend to have one.
- Lifecycle is limited to `DRAFT`, `VALIDATED`, `CANARY`, `CERTIFIED`, `PUBLISHED`, `SUSPENDED`, `RETIRED`. Publishing requires `PRODUCTION` scope and evidence; a local fixture route cannot be promoted by registry code.
- `ProviderRegistry` now accepts a route only after its provider adapter is registered. The registry is a local reference cache, not a database or an admin write surface.

## Validation evidence

`packages/contracts/src/provider-catalog.test.ts` proves the relation integrity, rejects missing financial bounds and rejects local publication. `packages/providers/src/registry.test.ts` proves a route cannot attach to an unregistered adapter and cannot be selected as published.

## Deliberately not done in APU-G1

- No KIE or OpenRouter API call, catalog import, secret storage, model publication or provider selection.
- No customer price change and no customer credit operation.
- No migration or assertion that the in-memory registry is durable.

The next gate must persist approved catalog snapshots and maker/checker changes behind authenticated server APIs before an administrator can manage real provider models or pricing.
