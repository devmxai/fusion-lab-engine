# Phase 6 — Image reliability and advanced image

Status: complete locally for the currently certified published image routes.

## Delivered increments

### 6.1 — Honest Engine errors — complete locally

- The image client preserves typed Engine error codes and maps them to customer-safe Arabic and English messages.
- Quote expiry, insufficient credit, stale/incompatible offers, and invalid published price now have distinct UI outcomes.
- The client does not imply a retry, a charge, a refund, or a generated result when the Engine has not confirmed one.

### 6.2 — Project gallery trash/restore — complete locally

- Moving a generated result to trash changes only the Standard presentation projection; canonical asset bytes, operation lineage, delivery reference, and financial history remain untouched.
- Restore returns the same canonical item to the gallery. Permanent purge is deliberately not exposed from the client.
- The projection stores retention metadata, while server-governed purge remains a later controlled operation.

### 6.3 — Server-pinned quote configuration — complete locally

- A published-offer quote now returns a customer-safe configuration snapshot after server-side contract validation.
- The Standard quote review shows the exact priced recipe and settings (for example resolution, aspect ratio, duration, quality, or count) returned by the Engine.
- It intentionally excludes provider cost, margin, provider route, private asset identifiers, and all secret metadata.

### 6.4 — Terminal state recovery and browser proof — complete locally

- Provider failure, private-delivery failure, and reconciliation-required states have distinct customer copy based solely on recorded operation facts.
- A persisted review state remains visible after project refresh, but is never retried or dispatched by the browser.
- Browser tests now prove: successful single dispatch across refresh, insufficient credits without operation creation, and reconciliation visible without a false success or refund claim.

### 6.5 — Private delivery-access expiry — complete locally

- Private-result access and expired grant failures have separate Arabic and English messages.
- Download/view failure is surfaced in the gallery and is never described as a new generation, provider-generation failure, or a new charge.

### 6.6 — Durable private-preview boundary — complete locally

- A settled private result is persisted by its Engine delivery-asset identity, never by a browser Blob preview URL.
- Gallery view always reacquires a short-lived private access grant when a delivery asset exists; a stale saved URL cannot bypass that path.
- Browser coverage proves an expired delivery grant is reported as access expiry, without creating another generation or falsely showing a result.

### Route-capability finding

The currently published image offers do not certify multiple reference bindings. Multi-reference, edit/remix, mask, and upscale controls therefore remain absent until a published provider route declares compatible bindings and controls. Showing them earlier would be a fake, non-executable UI.

## Objective

Close every customer-visible Image state before exposing advanced routes. The UI must never describe an uncertain financial or provider outcome as success, failure-refund, or an active result.

## Ordered work

1. Map typed Engine errors to clear quote, price-change, insufficient-credit, and reconciliation states.
2. Add published-route-only recipe and binding expansion: multi-reference, edit/remix, then mask/upscale routes only when certified.
3. Render all published billing dimensions (count, quality, resolution, aspect ratio) into the quote snapshot; never estimate client-side.
4. Add gallery sessions, lineage, trash/restore, private-download expiry behaviour, and conflict recovery.
5. Extend browser tests with expired quote, insufficient credits, provider failure, reconciliation, refresh, and accessibility cases.

## Local verification

- Targeted projection and persistence suites: 16 tests passed.
- Standard Image browser suite: 6 scenarios passed: durable success/refresh, insufficient credit, reconciliation, expired confirmation, provider failure, and expired private delivery access.
- Full TypeScript workspace check passed.
- Production client build passed.

## Gate 6

- Every terminal/financial status has a distinct, honest UI state.
- No unsupported route/control/reference is selectable.
- Browser and Engine-contract tests prove price/credit/failure behaviour.
- No result, charge, or refund is inferred in the client.
