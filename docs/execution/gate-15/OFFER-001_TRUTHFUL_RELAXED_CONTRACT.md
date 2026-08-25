# OFFER-001 — Truthful Unlimited Relaxed Contract

| Field | Value |
|---|---|
| Stage | `15.1` |
| Status | `COMPLETE LOCALLY / PILOT NOT ACTIVATED` |
| Included output | `RELAXED DRAFT ONLY` |
| Premium / Final | `REQUIRES CREDITS` |
| Production impact | `NONE` |

## Naming invariant

There is no comprehensive Unlimited offer. The experimental contract supports exactly two truthful labels:

- `Unlimited Relaxed Draft`: no fixed hidden generation cap is allowed;
- `High Monthly Allowance`: a positive monthly cap must be published explicitly.

An Unlimited label with a hidden fixed cap, missing Fair Use disclosure or Production activation authority fails validation.

## Published contract

Every immutable Offer Version pins:

- eligible Subscription Plan Versions;
- certified economic Route/Family/Model tuples;
- shared Relaxed queue, maximum concurrency and maximum wait;
- Draft-only purpose, maximum resolution and duration;
- visible Fair Use and Terms Versions;
- explicit exclusion of API and batch automation;
- Premium/Final Credit requirement;
- no hidden Model substitution or hidden cap.

Progress is stage-only. The contract has no fabricated percentage field.

## Authorization and usage

Pilot authorization requires an active eligible subscription, explicit cohort membership, explicit Pilot opt-in and exact acceptance of the current Fair Use and Terms. The public authorization stores only a hash of the user key.

Included usage must use one published Route and stay within both Offer and Route dimensions. A permitted result discloses the actual Family, Model and Route. Premium/Final returns `REQUIRES_CREDITS`; API, batch, unknown Routes and oversized output return `NOT_ELIGIBLE`.

All results fix `hiddenCapApplied`, `customerCreditsReserved` and `dispatchMutationPerformed` to false.

## Acceptance evidence

- Immutable Offer publication and conflict rejection are tested.
- Hidden-cap Unlimited and missing Fair Use are rejected.
- Honest High Monthly Allowance fallback is tested.
- Subscription, cohort, opt-in, Terms and Fair Use gates are tested.
- Hashed identity and idempotent authorization are tested.
- Included bounded Relaxed Draft and actual Model disclosure are tested.
- Unknown Route and dimension overflow are rejected.
- Premium/Final Credit requirement and API/batch prohibition are tested.
- Focused suite: `8/8` passed.
- Full repository suite: `283/283` Vitest tests across `45` files and `6/6` Chromium E2E tests.

## Boundary

All policies, users and subscriptions are in-memory fixtures. This stage does not create a Pilot, spend COGS, charge Credits, call a provider, change the UI, migrate data or deploy.
