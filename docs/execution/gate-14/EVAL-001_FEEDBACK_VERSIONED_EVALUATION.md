# EVAL-001 — Structured Feedback and Versioned Evaluation

| Field | Value |
|---|---|
| Stage | `14.2` |
| Status | `COMPLETE LOCALLY / NO AUTO-LEARNING` |
| Formal dependency | `Gate 13 HOLD` |
| Production impact | `NONE` |

## Feedback evidence

Feedback is accepted only when the authenticated actor matches server-known operation ownership. The stored event contains a SHA-256 feedback key, exact Smart outcome identity, controlled rating/reasons, revision link, timestamp and evidence hash. It contains no raw user ID, prompt or free-form text.

Identical Event retry is idempotent. Conflicting ID reuse is rejected. A changed rating is a new contiguous revision that names the prior event; reports select the latest revision without deleting history.

## Evaluation Policy

Each immutable published Policy Version pins:

- technical, semantic and safety weights totaling `10000 bps`;
- automated-quality and user-satisfaction weights totaling `10000 bps`;
- minimum automated samples and minimum feedback samples;
- stable policy key, version and publication time.

Automated evidence pins Evaluation ID, exact Profile/Family/Model/Route outcome, Evaluator Version, Policy Version, bounded integer ppm metrics and timestamp. One evaluator/policy version evaluates an operation only once.

## Deterministic report

The local golden fixture uses `30% technical + 50% semantic + 20% safety`. Two automated samples produce average quality `850000 ppm`. Latest user ratings `5` and `3` normalize to satisfaction `750000 ppm`. With `60% automated + 40% satisfaction`, the exact integer composite is `810000 ppm`.

Samples from another Route are excluded. If either sample minimum is unmet, the report is explicitly unready and returns no composite. The report cannot mutate routing or learn new weights.

## Acceptance evidence

- Non-owner feedback is rejected and raw user identity is absent from stored evidence.
- Identical retries dedupe; conflicts fail closed.
- Revisions are contiguous and append-only.
- Invalid or overwritten Evaluation Policy Versions are rejected.
- Automated quality uses exact integer basis-point math and evaluator dedupe.
- Reports isolate Profile/Family/Model/Route and use latest feedback only.
- Insufficient samples never manufacture a composite score.
- Focused Smart Beta suite: `14/14` tests passed.
- Full repository suite: `244/244` Vitest tests across `40` files and `6/6` Chromium E2E tests.

## Boundary

All evaluations and feedback are deterministic in-memory fixtures. There is no public feedback UI, real evaluator service, Production user data, model switch, experiment or Dispatch. These contracts provide evidence for later locally controlled experiments only.
