# Gate 17 — Professional Graph

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Status | `17.1–17.6 COMPLETE LOCALLY / FORMAL HOLD` |
| Runtime authority | `LOCAL VIEW PROJECTION ONLY` |
| Production / migration / deploy | `NONE` |

## 17.1 — Shared Domain Contract

- `STANDARD` and `PROFESSIONAL` are presentation modes of the same `CreativeSpaceProject`; existing saved Standard projects default to `STANDARD` with no data conversion or storage migration.
- `projectToProfessionalGraph` derives operation nodes, semantic input/output ports and persistent binding/lineage edges from canonical assets, operations and bindings.
- The projection deliberately excludes provider route data, quote mutation and all dispatch commands. Professional View cannot bypass the Engine or Quote path.
- Switching back to Standard preserves assets, operations, bindings and canvas positions exactly.
- Focused regression passed: `10/10` Creative Space and Professional Graph tests; TypeScript compilation passed.

## 17.2 — Professional View UI

- A saved, accessible `Standard` / `Professional` switch renders the same project in either view.
- Professional View renders semantic input/output ports on assets and operations, and labels all persistent binding/lineage edges.
- The UI exposes only graph semantics and `Engine-governed` state; it cannot create raw provider nodes, mutate a quote, or dispatch an operation.
- Browser verification passed: the Professional switch persists through refresh, preserves the Standard graph, and renders both persistent input and output edges.

## 17.3 — Groups, Subflows, Templates and Batch Drafts

- Groups persist references to existing canvas items; subflows persist existing operations and generated outputs.
- Templates snapshot a Group's existing topology. They are reference artifacts, not provider/Engine commands.
- Batch branches persist only ready source assets and a recipe as `DRAFT` with `executionAllowed = false`; they cannot spend credits or dispatch work.
- Professional Graph tools are available only in Professional View and display the persisted object counts.
- Focused regression passed: `12/12` Creative Space and Professional Graph tests; Chromium verification passed for creation and persistence of all four artifacts.

## 17.4 — Advanced Shot Plan and Timeline

- Advanced shots reference only a ready image/video asset and validate an explicit 1–60 second duration.
- Every shot is `DRAFT` with `executionAllowed = false`; it cannot execute a provider, create a Quote, or spend Credits.
- The local read-only Shot Timeline creates one plan track and places clips sequentially. It has no playback, edit/render authority, or Engine bypass.
- Focused regression passed: `14/14` Creative Space and Professional Graph tests; Chromium verification passed for Shot creation and Timeline rendering as `DRAFT`.

## 17.5 — Large Graph Budget, Accessibility and Debug View

- Professional Graph has explicit local budgets: 250 nodes, 500 edges, 120 Timeline clips, and a 150ms projection target.
- The accessible Debug View reports only safe graph counts, projection timing, budget state, and `Engine-governed` execution; provider routes, quote IDs and secrets are excluded.
- Standard and Professional view controls are named buttons with persisted state; all Graph actions use keyboard-accessible controls.
- Focused regression passed: `15/15` Creative Space and Professional Graph tests; Chromium verification confirms safe Debug View content and Professional View accessibility.

## 17.6 — Gate Evidence and Decision

- `evaluateGate17` rechecks the source project transition, semantic projection and published budget without accepting free-form pass booleans.
- It emits SHA-256 evidence/decision hashes and is structurally unable to return Formal `PASS` or Production authorization.
- Final local verification passed: `368/368` Vitest tests across `57` files and `7/7` Chromium E2E scenarios.
- [Gate 17 Evidence and Decision](./GATE-17-EVIDENCE_DECISION.md)

## Boundary

No migration, provider call, paid credit, Production change or deploy is performed. Formal Gate 17 remains `HOLD` until the required GA evidence and formal performance/accessibility evidence are available.
