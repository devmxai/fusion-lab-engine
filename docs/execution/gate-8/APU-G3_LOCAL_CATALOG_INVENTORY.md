# APU-G3 — Local Provider Catalog Inventory

| Field | Value |
|---|---|
| Program | `FL-APU-001` |
| Status | `LOCAL FOUNDATION COMPLETE — OFFLINE FIXTURES ONLY` |
| Runtime | `ProviderRegistry in memory; read-only Admin projection` |
| Prohibited | KIE/OpenRouter import, API call, secret entry, publication, migration, deploy |

## Delivered

- The engine now registers three explicit `Provider For Test` route manifests for image, video and audio. Every one is `VALIDATED` and `LOCAL_TEST_ONLY`.
- The manifests use the canonical relation: Publisher → Family → Canonical Model, plus Provider → Account → Provider Model → Hosting Endpoint → Route.
- `/v1/dev/admin-v2/catalog/routes` is a read-only BFF projection. It removes credential references, snapshot URLs and other internal catalog fields before rendering `/admin/v2`.
- The Admin inventory reads from the engine `ProviderRegistry`, not from UI constants. It shows the provider model, protocol, guarded maximum and certification scope so a local test route cannot be confused with a published commercial model.
- A local Snapshot Store now calculates a deterministic manifest hash and a reviewable added/removed/changed diff. Staging a snapshot creates an immutable `CATALOG_SNAPSHOT` Draft under the existing Route Maker → Route Approver workflow.
- The local publish handler rejects `CATALOG_SNAPSHOT` explicitly, so evidence review cannot accidentally activate or publish a local fixture.

## Explicit non-claims

These are synthetic fixtures. They do not represent KIE, OpenRouter, OpenAI, xAI or any published price. They cannot be selected as `PUBLISHED`, cannot be used to enter a real secret and do not authorize a provider request.

The next APU-G3 slice is a durable catalog snapshot/diff/approval repository and a server-verified privileged command identity. Both remain blocked from production by the no-migration boundary and formal Gate holds.
