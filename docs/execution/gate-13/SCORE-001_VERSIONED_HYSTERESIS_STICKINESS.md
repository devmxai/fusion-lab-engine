# SCORE-001 — Versioned Score, Hysteresis and Stickiness

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Stage | `13.2` |
| Status | `COMPLETE LOCALLY / FORMAL GATE NOT EVALUATED` |
| Authority | `SHADOW ONLY / NO DISPATCH MUTATION` |
| Production impact | `NONE` |

## Policy contract

The scorer accepts only one immutable, published manual Policy Version. Version 1 totals exactly 10,000 basis points:

| Component | Weight |
|---|---:|
| Expected Cost per Usable Success | `4500` |
| Reliability | `2500` |
| Quality | `2000` |
| p95 Latency | `1000` |

Auto-learning is explicitly disabled. Changing a weight, threshold, tie-break or TTL requires a new Policy Version and new evidence.

## Decision order

1. Consume the Stage 13.1 candidate foundation from one Shadow Policy Version.
2. Exclude every Route that failed any Hard Gate. Excluded Routes receive no score.
3. Normalize the eligible candidates and compute every weighted component with reduced BigInt rationals.
4. Rank by exact score and break a true tie by ascending Route Version ID.
5. Keep an eligible incumbent when the challenger's advantage is below the versioned hysteresis threshold.
6. Keep a non-expired eligible sticky Route until the exact advantage reaches the larger sticky override threshold.
7. Emit evidence only. Never mutate Quote, Dispatch, Provider selection or the pinned execution Route.

## Privacy and safety

- The scorer returns only a SHA-256 digest for a sticky key; the raw project/user key is not included in decision evidence.
- Sticky state expires by the pinned TTL.
- An expired, missing or Hard-Gate-excluded Route is never restored by sticky or incumbent state.
- Invalid metrics, duplicate candidates, mixed foundation policies, no eligible Routes and invalid Score Policies fail closed with stable errors.

## Local acceptance evidence

- Exact score components and the manual `45/25/20/10` policy are tested.
- Equal scores select deterministically.
- Below-threshold hysteresis holds and above-threshold sticky replacement are tested.
- TTL expiry and raw sticky-key non-disclosure are tested.
- Circuit-open exclusion proves Hard Gates dominate both incumbent and sticky state.
- Full local verification: TypeScript, `211/211` Vitest tests across `35` files, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Boundary

The metrics and Routes are deterministic local fixtures. No production metrics, external provider, credential, traffic switch, canary, migration or deployment is part of this stage. Stage 13.3 must add durable Shadow decision evidence, replay and aggregate metrics before any canary work is considered.
