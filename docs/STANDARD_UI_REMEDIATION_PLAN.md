# Standard UI Remediation Plan

**Status:** In progress  
**Scope:** Standard workspace only. Space remains unchanged until Standard is complete and verified.

## Objective

Turn Standard into a compact, premium generation workspace where every project asset is persistent and reusable, every visible setting is certified by the selected model contract, and the generation flow remains financially safe without exposing engine complexity to the customer.

## Non-negotiable rules

- Customer UI never exposes provider identifiers, routes, or internal SKU names.
- A visible setting exists only when the published, executable model contract supports it.
- A setting can be selected only when it resolves to an exact priced offer.
- Generation keeps the existing quote, hold, idempotency, settlement, refund, and audit guarantees.
- Assets are project records, not one-time results; uploads and generated media survive reload and can be reused.
- Space will consume the same asset and operation contracts later; it is not rebuilt now.

## Delivery sequence

### 0. Stabilize the workspace state

- Fix draft hydration so a selected reference asset survives reload.
- Resolve project-write conflicts through version-aware reload/rebase instead of leaving the user in a stale editor.
- Add asset presentation metadata (kind, dimensions, duration, preview/poster state) required by the gallery.
- Gate customer recipes on published **and executable** capability contracts.

**Exit:** Reloading a project preserves its draft, asset bindings, quote invalidation state, and safe recovery path.

### 1. Rebuild the model and setting selection system

- Introduce a customer model-presentation registry: short public model name, local reviewed brand-mark key, capability labels, and no provider disclosure.
- Replace native browser selects with one accessible dark popover/listbox component for models, modes, quality, resolution, ratio, and duration.
- Group commercial variants beneath one model family; settings choose the exact compatible priced offer internally.

**Exit:** The panel shows a short model name and local brand mark; every menu is visually consistent, keyboard accessible, and never offers impossible settings.

### 2. Build the Standard composition flow

- Order the panel as: media type → model → supported mode → required input → essential settings → prompt → fixed Generate CTA.
- Add a first-class asset picker: Upload or choose from this project library.  A media card action can set the correct mode and bind the asset directly.
- Keep bindings explicit; no silent “latest image” selection.

**Exit:** Text-to-image, image-to-image/edit, text-to-video, image-to-video, audio routes, and reference requirements are correctly derived from each certified recipe.

### 3. Simplify the safe generation action

- Replace the exposed two-step wording with a single clear Generate control.
- Perform quote/hold/confirmation internally. The final price is calculated and verified server-side immediately before the provider request; it is never trusted from browser state.
- Add immediate pending tile state, idempotent retry status, final settlement/refund messaging, and accessible errors.

**Progress (2026-08-25):** Completed for Standard image and video. One Generate action performs the durable quote and idempotent confirmation internally, disables a second click once the operation starts, and reports the securely reserved amount. The engine still settles only after the valid final result and records every outcome.

**Exit:** One customer action starts a financially safe generation; the engine reserves and settles only against the final, server-verified price.

### 4. Replace the result area with a Smart Masonry Asset Grid

- Use a responsive masonry layout driven by real media aspect ratio—not fixed 4:3 cards.
- Put the newest pending operation in its final grid position with glow, shimmer, and non-fake operation state.
- Add full-screen preview overlay, download, delete, Use as reference, Edit/Animate, and context menu actions.
- Maintain project asset history for images, videos, audio, uploads, and generated results.

**Progress (2026-08-25):** Completed. The durable gallery reacquires a private preview only when its card is near the viewport; no browser Blob URL is persisted and a failed preview never hides the canonical View/Download actions. Pending tiles are shown in their natural grid position. The result viewer is an overlay, so it does not replace the project grid, and `Use as reference` routes the customer to a compatible image-to-image contract before binding the source. Card actions are compact in an accessible context menu. Image dimensions and video dimensions/duration are decoded from the delivered private file and saved as non-financial asset facts, making the masonry presentation stable after a project is reopened.

**Exit:** Portrait, square, landscape images and video cards compose naturally; generated media is immediately reusable in the same project.

### 5. Verify and harden

- Component tests for picker, compatibility, asset binding, grid state, and price/hold transitions.
- Integration tests for reload, conflict recovery, generation success, provider failure/refund, and asset reuse.
- Responsive, keyboard, focus, reduced-motion, and performance checks.
- Visual review against the approved dark premium reference before Space starts.

**Exit:** Standard is production-ready by evidence, not screenshots alone.

**Progress (2026-08-25):** Unit and contract verification passes in 126 files / 665 tests. The Standard browser suite passes 6/6 scenarios covering durable refresh without a second dispatch, insufficient-credit rejection before an operation, reconciliation, expired confirmation, provider failure, and expired private delivery access. Browser tests now run against a dedicated local PGlite store, so they cannot lock or mutate the developer's workspace database.

## Next implementation

Complete the final manual responsive/keyboard visual review of Standard against the approved reference, then prepare the controlled production release. Space remains deferred until this Standard evidence gate is closed.
