# Phase 5 — Image vertical slice worklog

Status: PASS locally; human and Production acceptance remain separate.

## Verification evidence

- `npm run test:e2e:ui-fux-phase5` passes against the Standard route with a contract-level Engine mock. It proves one explicit Quote → Reserve → Settlement journey, private-result access, project refresh, and no second operation dispatch after refresh.
- Targeted unit tests cover quote confirmation, canonical reservation/result persistence, provider-failure settlement, recovery selection, and the project-result gallery.
- `npm run typecheck` and `npm run build` pass locally.

## Completed first increment

- Added `PublishedModelPicker`, which accepts only `PublishedOffer` records already released by the server-side catalog contract.
- It filters to the `image.create` recipe, never derives a route from a model name, and returns the exact selected offer to its caller.
- Added search and a safe empty state; provider identity is text/fallback only until a licensed asset is approved.
- Added a unit test proving a non-image offer cannot enter the picker and that selection returns the original published contract.
- Added a compatibility-selection planner. Changing a model now creates a review plan; it fails closed for an unsupported recipe and requires confirmation before a changed/removed setting or reference can affect the draft.
- Added `StandardQuoteGate`: quote review is separate from confirmation; one UI confirmation generates one idempotency intent and cannot be invoked before a visible quote.
- Added the authenticated `/projects/:projectId/standard` Image workspace. It loads published offers, renders controls from their capability schema, stages compatibility changes for confirmation, and connects the existing Quote/Confirm client calls only to explicit user actions.
- The workspace now persists the confirmed reservation in the canonical project before monitoring it. A refresh discovers unfinished canonical operations and resumes monitoring the same operation; it never submits a second generation.
- Terminal results are written back to the canonical operation and generated asset before the Standard session projection is appended. The durable private-asset identity, not a browser Blob URL, survives the save.
- Added a compact project-results gallery. It is derived from canonical generated assets, loads a private result only through a short-lived asset grant, and exposes Download only when a private delivery asset exists.
- A gallery image can be selected as the next source only when the active published offer declares image input and at least one certified binding slot. That source is passed to Quote and becomes a canonical operation binding at reservation; unsupported offers show no misleading reference action.
- A monitoring transport failure now pauses visibly and offers an explicit status re-check for the same durable operation. A persistence test proves a provider failure creates no output asset and never appears as a successful customer charge.
- Added a versioned Standard workspace persistence boundary for image drafts, reservations, terminal results and sessions. It delegates to the existing Project API, so an expected-version conflict remains explicit rather than permitting silent overwrite.

## Next increment

Close the Image vertical slice with end-to-end coverage for refresh during a reservation, settlement/failure reconciliation, and the source-asset edit/remix journey using only certified published routes. No new provider integration is introduced by this increment.
