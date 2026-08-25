# PCP-G5 — Published Lease Dispatch

**Status:** `LOCAL FOUNDATION PASS — NO EXTERNAL PROVIDER CALLS`

## Closed in this increment

- `DurableProviderAttemptWorker` and `DurableAssetDeliveryWorker` now obtain an adapter through an operation-scoped access boundary.
- For a `PUBLISHED_OFFER`, `LocalDurableRuntime` reads the durable quote metadata, verifies the frozen provider and offer evidence, and resolves the adapter with `FrozenPublishedOfferRuntimeResolver` from the exact Release Bundle version pinned in the quote.
- The adapter is constructed only inside `ProviderRuntimeResolver`'s active credential lease. It is not cached across operations, credential rotations, route changes, or worker stages.
- Submission, idempotency lookup, polling, and private asset fetch all use that same operation-scoped boundary.
- If the published runtime is missing, the credential cannot be leased, or a factory cannot build before adapter entry, the worker records a definitive `PUBLISHED_RUNTIME_NOT_CONFIGURED` rejection. No provider request occurs and the existing zero-charge release flow applies.
- A failure after adapter entry remains an unknown/provider outcome rather than being incorrectly converted into a zero-charge refund.
- A later Admin publish, pause, or rollback cannot cause an already-reserved operation to silently follow a different active route, account, credential version, model, or adapter version.

## Verified

- `apps/engine-api/src/generation-v2/routes.test.ts`
  - publishes an OpenRouter-shaped offer,
  - dispatches it through a version-matched adapter factory and an exact credential lease,
  - obtains a private delivered asset and settles the customer reservation,
  - proves the no-runtime path releases the hold with zero provider charge.
- `apps/engine-api/src/durable-worker/provider-attempt-worker.test.ts`
- `apps/engine-api/src/durable-worker/asset-delivery-worker.test.ts`

## Still not authorized / not complete

- No KIE/OpenRouter key, request, balance read, catalog fetch, webhook, or generation was made.
- Installing a production provider factory requires a certified callback URL, per-route usage/cost extraction contract, and the user-provided credential through the write-only Admin flow.
- OpenRouter synchronous/inline-output protocols require their own durable inline-result contract before they can be published through the asynchronous asset URL worker. They must not be marked executable merely because a reference model exists.
