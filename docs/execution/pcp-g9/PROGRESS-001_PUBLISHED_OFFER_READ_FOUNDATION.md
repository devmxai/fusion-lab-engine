# PCP-G9 — Published Offer Read Foundation

**Status:** `IN PROGRESS — LOCAL PUBLISHED-OFFER QUOTE PASS`

## Added

- `GET /v2/catalog/offers` is authenticated and returns only the redacted customer projection of the active Release Bundle.
- It returns an empty list when no Bundle is active; it never exposes Provider For Test fixtures as selectable customer models.
- The projection contains the offer, display model, provider/model identity, modalities, price-version ID, commercial recipe-version ID, Release Bundle version, and the customer-safe immutable capability contract. The latter carries only allowed inputs/roles/limits; it carries no provider price or routing data.
- Credential references, provider account identity, adapter configuration, provider costs and secret-derived data are intentionally excluded.
- Creative Space fetches this catalog when it opens. A new image, video, or advanced recipe requires a compatible published offer; no catalog means the recipe cannot start.
- The browser sends `offerId` with the recipe inputs. The API discards any browser `modelId`, resolves the active offer server-side, calculates the exact immutable commercial quote, then stores the frozen release/route evidence with the durable quote.
- Published-offer execution without a configured certified runtime fails as `PROVIDER_RUNTIME_NOT_CONFIGURED` before any outbound request and releases the customer hold. This is intentional until an authorized key/canary stage.
- Customer quote/operation projections no longer expose provider estimated/actual cost, margin, pricing policy, route pins, or provider task identifiers. Those values remain in durable audit/finance records only.
- The server validates the released capability before it issues a quote. A browser cannot exceed the published reference count, semantic roles, resolution, duration, text length, or generated-audio allowance by altering its payload.
- Every customer-visible offer now also requires a versioned `controlSchema`: recipe IDs, prompt contract, binding count/roles, and every allowed setting with its option/range/default. A missing schema fails closed; it cannot become a customer offer merely because it has a generic capability.
- The Release Bundle validator enforces this invariant before publication, including unique recipes/controls, valid binding ranges, and valid enum/number/boolean defaults. It is therefore impossible to repair a malformed customer control contract only after customer traffic has started.
- Image Composer consumes this schema after offer selection: it resets settings to published defaults, renders only published controls, and validates the published prompt/input contract. Static recipe copy is retained only as UX text; it is no longer the source of authority for a selected published offer.
- Creative Space no longer displays provider estimate/actual cost in customer toast messages, operation timeline, or persisted activity. Local fixture coverage may retain internal evidence in test-only state, but published customer envelopes do not contain it.

## Verified

- `apps/engine-api/src/generation-v2/routes.test.ts` proves fixture models are absent from the customer catalog.
- `packages/provider-control-plane/src/postgres-repository.test.ts` proves the projection derives from the active Bundle and uses immutable model/catalog pins.
- `apps/engine-api/src/generation-v2/routes.test.ts` proves a published quote is offer-bound, external-runtime absence creates a no-charge failure, and the customer response excludes internal price/cost evidence.
- `apps/engine-api/src/generation-v2/routes.test.ts` proves an otherwise valid browser request is rejected before wallet reservation when it uses a reference role absent from the immutable published capability.
- `packages/provider-control-plane/src/release-commercial-bridge.test.ts` and `packages/commercial-engine/src/durable-registry-repository.test.ts` prove exact durable commercial snapshot binding and BigInt reconstruction.

## Still required before this gate closes

- Complete the same `controlSchema` renderer/validation conversion for Video and Advanced Composer. Image Composer is now capability-driven; static recipe manifests remain as display copy and as legacy fixture compatibility only.
- Complete provider-specific executable contracts on top of the durable dispatch already wired through `FrozenPublishedOfferRuntimeResolver` and the versioned credential lease path. Existing reserved operations use their exact pinned Release Bundle rather than a newer active pointer.
- Add golden tests for offer pause/rollback between quote and enqueue, plus externally shaped KIE/OpenRouter response/webhook/reconciliation contracts.
- The local fixture execution path remains test-only compatibility coverage until the released offer-to-dispatch path has equivalent golden tests.
