# ROLLOUT-001 — Ordered Release Promotion Contract

| Field | Value |
|---|---|
| Stage | `16.1` |
| Status | `COMPLETE LOCALLY / NO REAL TRAFFIC` |
| Ladder | `Internal Alpha → Invite Beta → 1 → 5 → 25 → 50 → 100 → GA Ready` |
| Approval | `Maker + distinct Product/Engineering/Security/Finance` |
| Authority | `LOCAL CONTRACT SIMULATION ONLY` |

## Promotion policy

The immutable Release Rollout Policy pins the release digest, required formal Gate identifiers, exact stage order, sample and observation requirements, Error Budget thresholds and release blockers. It cannot activate Production.

The release cannot be armed until four distinct Product, Engineering, Security and Finance actors approve independently from the Maker. Readiness also requires exact artifact, SBOM and provenance digests, the pinned Gate set, full actual-cost reconciliation, a rollback drill and indexed SLO, DR and runbook contracts.

## Fail-closed stage evaluation

Each stage is evaluated only after its minimum fixture samples and observation duration. A caller cannot skip Alpha, Beta or a rollout percentage.

The controller stops on:

- any Critical or High security finding;
- unexplained Ledger drift or financial invariant failure;
- actual-cost reconciliation below 100%;
- SLO breach or unavailable rollback;
- Error Budget exhaustion;
- any unbudgetable incident.

At 50% Error Budget consumption it pauses the rollout for investigation. Manual stop is also available and terminal for the current controller instance.

## Audit and acceptance evidence

- Exact stage ladder and immutable Policy validation are tested.
- Maker-checker and four-role separation are tested.
- Artifact/Gate/reconciliation/rollback/SLO/DR/runbook readiness is tested.
- Stage skipping, insufficient samples and short observation windows are rejected.
- Every blocker and the 50% Error Budget pause are tested.
- Approval and observation idempotency/conflict are tested.
- Events are SHA-256 chained and actor identities are hashed.
- Focused Stage 16 suite: `8/8` passed.
- Full repository suite: `323/323` Vitest tests across `50` files and `6/6` Chromium E2E tests.

## Boundary

The passing ladder is a contract simulation, not evidence that real formal Gates or operational stages passed. External traffic and Production activation remain structurally false.
