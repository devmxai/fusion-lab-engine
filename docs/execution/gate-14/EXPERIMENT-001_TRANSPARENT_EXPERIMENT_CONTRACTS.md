# EXPERIMENT-001 — Transparent Smart Experiment Contracts

| Field | Value |
|---|---|
| Stage | `14.4` |
| Status | `COMPLETE LOCALLY / NO EXPERIMENT ACTIVATED` |
| Experiments | `Draft-to-Final / Smart Variations / Relaxed Queue` |
| Customer surcharge | `ZERO` |
| Production impact | `NONE` |

## Versioned policy boundary

Every experiment uses an immutable published Policy Version. It pins the experiment kind, eligible Smart Profile Versions, Exploration Policy Version, disclosure version/text, active window, satisfaction threshold, hard Margin Floor and its complete customer contract. Duplicate key/version sequences, mutated IDs, invalid windows and hidden customer-contract mutation all fail closed.

## Enrollment gates

New enrollment requires all of the following:

1. an eligible, pinned Smart Selection Authorization;
2. no hidden substitution and no prior external Dispatch;
3. a selected platform-funded Exploration Plan with a real reservation;
4. unchanged customer quoted Credits and exactly zero surcharge;
5. a live experiment window and no active Kill Switch.

The controller stores only a SHA-256 user-key hash in its public run. Run ID replay with the same intent is idempotent; changed intent is rejected.

## Customer contracts

### Draft-to-Final

The first output is explicitly labeled `DRAFT`. Final execution requires both a distinct Final Quote Version and explicit customer confirmation. A Final output before confirmation is impossible. Draft and Final each disclose their actual authorized Family, Model and Route.

### Smart Variations

The immutable policy bounds a request to 2–4 variations. Every promised output occupies one unique index and records a verified candidate tuple with `modelDisclosed: true`. Missing, excess, duplicate or unauthorized outputs prevent completion.

### Relaxed Queue

The policy publishes maximum queue wait and concurrency. Its only progress contract is `STAGE_ONLY_NO_PERCENTAGE`; the domain does not expose a fabricated completion percentage. One disclosed Relaxed result completes the run.

## Kill and in-flight behavior

Manual activation, satisfaction below the published threshold or Margin below the hard floor disables new enrollment immediately. Existing pinned runs retain `COMPLETE_PINNED_NO_REDISPATCH`: they may record their promised outputs and complete, but cannot be re-routed or dispatched by this controller.

## Acceptance evidence

- Immutable policies and all three transparent contracts are tested.
- Fake Relaxed Queue percentage progress is rejected.
- Authorization, Exploration reservation and zero-surcharge gates are tested.
- Enrollment replay/conflict handling is tested.
- Draft labeling, separate Final Quote and explicit confirmation are tested.
- Variation limits and per-output actual Model disclosure are tested.
- Relaxed Queue SLA/concurrency/stage-only progress are tested.
- Manual and metric-triggered Kill Switches plus pinned in-flight completion are tested.
- Focused Smart Beta suite: `30/30` passed.
- Full repository suite: `260/260` Vitest tests across `42` files and `6/6` Chromium E2E tests.

## Boundary

This is an in-memory local policy and lifecycle reference. It does not activate a cohort, consume real Exploration budget, send a provider request, perform Smart Dispatch, change the UI, run a Migration or deploy to Production. Every run fixes `dispatchMutationPerformed: false`; every snapshot fixes `externalDispatchPerformed: false`.
