# Gate 10 — Standard Image-first

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Status | `LOCAL DELIVERABLE COMPLETE — STAGES 10.1–10.5` |
| Gate decision | `HOLD — LOCAL CRITERIA PASS; DEPENDENCY GATES 6/8/9 NOT PASSED` |
| Provider | `Provider For Test only` |
| Billing / generation | `LOCAL QUOTE → CONFIRM → GENERATE → SETTLE CONNECTED` |
| Database / production change | `NONE` |

## Stage breakdown

| Stage | Scope | Status |
|---|---|---|
| `10.1` | Image Recipe manifests and dynamic Inspector UI | `COMPLETE LOCALLY` |
| `10.2` | Binding validation and model/recipe Compatibility Diff | `COMPLETE LOCALLY` |
| `10.3` | Quote and explicit Confirm through local Engine | `COMPLETE LOCALLY` |
| `10.4` | Operation, placeholder, output and lineage placement | `COMPLETE LOCALLY` |
| `10.5` | Refresh recovery, E2E, accessibility and performance evidence | `COMPLETE LOCALLY` |

## Stage 10.1 evidence

- Five explicit image recipes: Create, Edit, Remix, Inpaint and Upscale.
- Each recipe publishes its input rule, prompt contract, curated model list and setting manifest.
- Only the real locally certified test model is shown: `local/test-image-v1`; no fake Fast/Premium models appear.
- Inspector fields are rendered from the selected Recipe manifest.
- An image-selected workflow pins the input and displays its semantic role (`SOURCE` or `REFERENCE`).
- Composer drafts persist separately per project and recover after page refresh.
- Create Image opens from Quick Add; asset-first actions open from the selected image.
- Pricing and Generate remain disabled until Stages 10.2 and 10.3, preventing incomplete or accidental billing.
- Browser checks covered Create UI, prompt, aspect ratio, refresh recovery and Edit input UI without Console errors.

## Stage 10.2 evidence

- Composer validation fails closed for missing input, missing/deleted/non-image/not-ready Asset, required Prompt, uncertified model and invalid/missing/extra settings.
- The only selectable model is checked against an explicit certified capability registry before Quote can become available.
- Required input binding can be removed or replaced with the selected image; every change reruns validation immediately.
- Recipe changes produce a deterministic Compatibility Diff before changing the draft.
- A change that needs an unavailable input is blocked.
- Prompt removal, semantic input-role changes, dropped settings and reset values require explicit user confirmation.
- New settings are listed and initialized from the target manifest; nothing is silently discarded.
- Browser checks proved invalid→valid state, blocked Create→Edit without an image, and confirmed Edit→Upscale with the exact warning list and no Console errors.

## Stage 10.3 evidence

- Creative Space requests an immutable final Quote from a dedicated Engine route; it does not call the Provider directly.
- The Engine independently revalidates recipe, input readiness/type, prompt, certified model and the exact allowed settings before pricing.
- Quote creation has no ledger mutation: customer and provider balances remain unchanged.
- The UI shows the exact site price (`4` credits) and Provider For Test estimate (`2` provider credits) before confirmation.
- A separate confirmation dialog states the financial effect and does not dispatch or generate an output.
- Confirm binds the immutable request hash, uses an idempotency key and creates exactly one `RESERVED` Operation.
- Confirmation atomically moves `4` site credits from available to held; customer spent remains `0` and provider charged remains `0` until execution.
- A stale request hash is rejected and repeated confirmation with the same key returns the same Operation without a second reservation.
- Browser verification covered Quote → explicit Confirm → `RESERVED`, showed `held: 4`, `available: 996` and provider charge for this Operation `0`.
- Full local verification passed: TypeScript, `140/140` tests, Engine build, Provider For Test build and Vite production build.

## Stage 10.4 evidence

- A confirmed Quote is projected as an independent `RESERVED` Operation and an honest `Preparing` placeholder at the draft anchor.
- The Space-specific Engine endpoint owns bounded execution through the existing durable Provider For Test lifecycle; the browser never calls the Provider directly.
- Placeholder labels are derived from real states (`Preparing`, `Queued`, `Generating`, `Saving result`, `Ready`, `Needs attention`) with no invented percentage.
- Successful execution reaches `SETTLED`, captures the site charge (`4`) and Provider charge (`2`) and returns the privately ingested result with SHA-256 evidence.
- The generated TEST SVG is rendered through the Engine's short-lived asset grant, not from a Provider URL exposed directly to the browser.
- The original input Asset is preserved. Domain entities store the Operation, its input binding, generated Output and source Operation identity independently of React Flow.
- The xyflow adapter reconstructs `Input → Operation → Output` edges from the Domain Graph; generated results are placed to the right of their Operation.
- Output is selectable and immediately exposes Edit, Remix, Inpaint and Upscale for a new branch.
- The generated-card UI says `Generated` rather than inventing an unknown byte size.
- Browser verification proved Placeholder → Ready → visible TEST Output, `SETTLED`, `4/2` accounting, checksum display and branch actions with no Console errors.
- Full local verification passed: TypeScript, `141/141` tests, Engine build, Provider For Test build and Vite production build.

## Stage 10.5 evidence

- A Space recovery endpoint rehydrates a confirmed Operation after browser refresh and returns the immutable Quote, current financial state and wallet snapshot.
- `RESERVED` recovery was exercised by refreshing before dispatch and then continuing the same Operation; no second reservation or Provider submission was created.
- A settled Output survives browser refresh from the project Domain Graph. Recovery rotates a new short-lived private media grant instead of persisting a stale access token.
- Playwright E2E executes Quick Add → Recipe → Quote → Confirm → refresh recovery → Generate → Output → second refresh and verifies the `4/2` accounting and Lineage.
- Keyboard `A` opens Quick Add and the recipe Prompt receives focus. All visible interactive controls have a discernible accessible name.
- Axe reports zero violations for WCAG 2.0/2.1 A/AA on the completed Image-first journey.
- A 100-card project renders all 100 xyflow nodes under the `3,000 ms` ready budget with DOMContentLoaded under `2,000 ms`; pure domain projection remains under `100 ms`.
- The project exposes one repeatable command: `npm run verify:gate10`.
- Final verification passed: TypeScript, `141/141` Vitest tests, Engine build, Provider For Test build, Vite build and `2/2` Chromium E2E tests.

## Gate 10 decision

The Image-first local deliverable meets its local functional, accounting, recovery, accessibility and performance criteria. The formal Gate remains `HOLD`, not `PASS`, because its declared dependencies are not approved:

1. Gate 6 is a local in-memory orchestration reference and is `NOT PASSED`; process-restart durability is therefore not certified.
2. Gate 8 is a local Admin reference and is `NOT PASSED`; production identity, persistence and legacy mutation containment remain open.
3. Gate 9 is a local-storage Space foundation and is `NOT PASSED`; server project persistence and production media ingestion remain open.
4. Gate 0 remains `HOLD`; no production deployment, database migration or paid Provider use is authorized.
5. Production dependency audit reports two moderate React Router advisories (zero high/critical); the available Router 7 migration is a separate breaking-change workstream.

No local passing test is represented as production approval. Gate 10 can move from `HOLD` only after dependency evidence and named approvals are complete.
