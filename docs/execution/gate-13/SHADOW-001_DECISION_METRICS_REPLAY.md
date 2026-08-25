# SHADOW-001 — Decision Evidence, Metrics and Replay

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Stage | `13.3` |
| Status | `COMPLETE LOCALLY / FORMAL GATE NOT EVALUATED` |
| Authority | `SHADOW ONLY / NO DISPATCH MUTATION` |
| Production impact | `NONE` |

## Outcome metrics

An outcome is immutable server evidence keyed by Observation ID and Operation ID. An identical retry is idempotent; reuse with different content is rejected. Aggregation is isolated by the full Route metric signature and pinned Metric Policy Version.

- Reliability is usable successes divided by all terminal observations.
- Quality is averaged only across usable successes carrying a valid server rating.
- Latency uses deterministic nearest-rank p95 across terminal observations.
- A window below the immutable minimum sample count is explicitly `INSUFFICIENT_SAMPLES`.
- Aggregate evidence includes hashes of the signature and ordered observations.

## Explainable decision record

Each append-only record contains the immutable Score Policy, candidate/foundation snapshot, sanitized prior sticky assignment, exact Shadow result, sequence and SHA-256 chain link. The raw sticky key is never stored.

Before append, the scorer is run again from the captured inputs. A mismatch is rejected. Later replay verifies the entire hash chain, reconstructs the original score including historical sticky state and requires exact equality with the recorded decision.

## Shadow comparison report

The local report provides decision count, agreement with the still-active pinned Route, projected reliability and quality deltas, selected Hard-Gate violation count and Dispatch mutation count. This is comparison evidence only; it has no execution authority.

## Acceptance evidence

- Outcome replay is idempotent and conflicting operation evidence fails closed.
- Four signature-matched fixtures produce exact `750000 ppm` reliability, `850000 ppm` rated quality and `400 ms` nearest-rank p95.
- Cross-signature observations are excluded.
- Insufficient samples remain explicitly unready.
- Highest-score and sticky decisions both replay exactly from stored context.
- The record hash chain validates and raw sticky keys are absent.
- Altered decision evidence is rejected before append.
- Shadow-vs-actual reporting proves projected deltas with `dispatchMutationCount: 0`.
- Full local verification: TypeScript, `217/217` Vitest tests across `36` files, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Boundary

The store is an in-memory reference adapter because Database Migration is currently prohibited. All observations and actual-Route comparisons are deterministic local fixtures. No production metrics, external provider, canary traffic, migration or deploy exists. Stage 13.4 may build only a locally tested exact canary controller with explicit stop/rollback gates.
