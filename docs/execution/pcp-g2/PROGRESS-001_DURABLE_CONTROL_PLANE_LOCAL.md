# PCP-G2 — Durable Provider Control Plane: Local Evidence

> **Evidence ID:** `PCP-G2-PROGRESS-001`  
> **Date:** 22 August 2026  
> **Decision scope:** local implementation and verification only. No credential, KIE/OpenRouter request, generation, migration, deployment, or production change occurred.

## Delivered contracts

- `packages/provider-control-plane` supplies typed, provider-neutral entities for Provider, Provider Account, Reference Model, Route Candidate, and Published Offer.
- `fusion_engine.provider_control_entities` holds current pointers; `provider_control_versions` holds immutable, effective-dated versions with idempotent command binding and intent hashes.
- Payload validation rejects missing mandatory references, mismatched entity IDs, secret-like fields, and direct `PUBLISHED_OFFER` writes that would bypass the atomic visible pointer.
- `publishOffer` writes the immutable offer version and `provider_published_offer_pointers` inside one database transaction.
- `diff()` exposes a deterministic immutable version diff for reviewer UI; `adminOverview()` is a redacted control-plane read model.
- `provider_control_audit_head` serializes append-only audit records across concurrent writers, including the empty-chain case. The hash-chain verifier checks both contiguous sequence and the durable head.
- `ProviderControlPlaneChangePublisher` accepts only a completed, independently approved Admin Change Set with complete validation, simulation, and approval evidence. It strips duplicated evidence metadata from payload before persisting the immutable entity version.

## Requirement closure

| Task | Evidence |
|---|---|
| `PCP-0201` contracts | `packages/provider-control-plane/src/types.ts` |
| `PCP-0202` durable repository/concurrency | `postgres-repository.ts`, entity row lock, command idempotency |
| `PCP-0203` immutable/effective versioning | `provider_control_versions`, immutable audit trigger |
| `PCP-0204` reference/account/credential separation | distinct typed entities; no credential value field |
| `PCP-0205` candidate/offer separation | direct offer write rejected; atomic `publishOffer` only |
| `PCP-0206` Change Set and diff | `admin-change-publisher.ts`, `repository.diff()` |
| `PCP-0207` safe Admin read model | `repository.adminOverview()` returns metadata/pointers only |
| `PCP-0208` audit integrity/restart | local filesystem close/reopen test validates chain and head |

## Verification executed

```powershell
$node='C:\Users\hp\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node node_modules\.ignored\vitest\vitest.mjs run packages/provider-control-plane/src/postgres-repository.test.ts packages/admin-control-plane/src/admin-control-plane.test.ts
& $node node_modules\.ignored\typescript\bin\tsc --noEmit -p packages/provider-control-plane/tsconfig.json
& $node node_modules\.ignored\typescript\bin\tsc --noEmit -p packages/admin-control-plane/tsconfig.json
```

Result: **2 test files, 10 tests passed; both TypeScript project checks passed.**

The provider-control tests cover multi-provider versions, command replay/conflict, deterministic version diff, atomic offer pointer, direct-offer bypass rejection, maker/checker materialization gate, audit head, and a real local PGlite close/reopen recovery.

## Carried-forward constraints

- This gate stores credential **references only**. A production Secret Manager, write-only input flow, rotation, and real read-only connection verification belong exclusively to `PCP-G3`.
- The new Admin bridge is a backend contract; the visual Admin setup wizard must not claim completion until its durable command routes exist in later gates.
- No Reference Catalog, account availability, real route, real price, Published Offer release bundle, or user-visible KIE/OpenRouter model is certified by this gate.

