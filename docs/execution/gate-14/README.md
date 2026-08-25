# Gate 14 — Smart Beta and Economic Offers

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Status | `LOCAL IMPLEMENTATION COMPLETE — FORMAL GATE 14 HOLD` |
| Dependency | `Formal Gate 13 remains HOLD` |
| Runtime authority | `LOCAL CONTRACT ONLY / NO SMART DISPATCH` |
| Active execution route | `Existing pinned Provider For Test route` |
| Production / migration / deploy | `NONE` |

## Stage breakdown

| Stage | Scope | Status |
|---|---|---|
| `14.1` | Explicit opt-in Profiles, model disclosure and no hidden substitution | `COMPLETE LOCALLY` |
| `14.2` | Feedback and versioned evaluations | `COMPLETE LOCALLY` |
| `14.3` | Funded exploration budget limited to `1–5%` | `COMPLETE LOCALLY` |
| `14.4` | Draft-to-Final, Smart Variations and Relaxed queue experiments | `COMPLETE LOCALLY` |
| `14.5` | CFO Advisor proposals and simulations only | `COMPLETE LOCALLY` |
| `14.6` | Gate 14 evidence and decision | `COMPLETE LOCALLY — LOCAL PASS / FORMAL HOLD` |

## Stage 14.1 evidence

- A dedicated `packages/smart-beta` domain package separates Smart consent/profile policy from UI, provider adapters and Dispatch.
- Only the four Master Plan Profiles are valid: `Best Value`, `Cinematic`, `Fast Draft` and `High Consistency`.
- Every Profile is an immutable published Version pinning disclosure text/version and unique certified Family/Model/Route candidates.
- Smart authorization requires an explicit `SMART_OPT_IN` event matching user, Profile Version and Disclosure Version. Missing, cross-user, stale-version or Plan-ineligible consent fails closed.
- Exact Mode cannot silently request Smart authorization. `hiddenSubstitutionAllowed` is structurally false.
- `SMART_OPT_OUT` is append-only and immediately prevents new authorizations without deleting original consent evidence.
- Pre-selection evidence states that automatic selection will occur and carries the complete candidate snapshot.
- Result disclosure requires an exact candidate tuple and exposes the actual Family, Model and Route. An undisclosed Route/Model is rejected.
- An economic Smart output cannot be relabeled `Premium`.
- The package performs no Provider call or Dispatch; `externalDispatchPerformed` and `dispatchMutationPerformed` remain false.
- Full local verification passed: TypeScript including Smart Beta, Engine build, Provider Test build and Vite build.

## Stage 14.2 evidence

- Feedback accepts only the server-verified operation owner and stores a SHA-256 subject/operation key instead of the raw user identity.
- Feedback is structured as a 1–5 rating plus controlled reason codes; no prompt or unrestricted free text enters evaluation evidence.
- Event retries are idempotent. A changed Event ID payload fails closed, and user edits append one contiguous revision that explicitly supersedes the prior event.
- Reports consume only the latest feedback revision while preserving the append-only event history.
- Automated Evaluation pins the exact Smart outcome signature, Evaluator Version and immutable Evaluation Policy Version.
- Technical, semantic and safety metrics plus automated/user composite weights must each total exactly 10,000 basis points. Quality and satisfaction use bounded integer ppm calculations.
- Reports isolate the exact Profile/Family/Model/Route signature and exclude cross-route samples.
- Minimum automated and feedback sample counts are independent. Until both pass, readiness is `INSUFFICIENT_SAMPLES` and composite score remains null.
- Evaluation reports include reason distributions and an evidence hash while fixing `routingMutationPerformed: false` and `autoLearningPerformed: false`.
- Full local verification passed: TypeScript, Engine build, Provider Test build and Vite build.

## Stage 14.3 evidence

- Exploration Policy is immutable and accepts only deterministic allocations from `100–500 bps` (`1–5%`).
- A request requires active Smart opt-in, ready Evaluation evidence, eligible Profile and active policy window before assignment.
- SHA-256 cohort assignment is deterministic; raw user and assignment keys never appear in plans.
- Control requests reserve nothing and leave customer pricing unchanged.
- A selected request passes the hard Margin Floor before reserving the positive incremental maximum cost (`exploration maximum − baseline expected cost`).
- Exploration risk is platform-funded. Customer quoted Credits remain pinned and customer surcharge is structurally zero.
- Available budget and per-user selection caps prevent overcommit. Insufficient budget fails closed.
- Reservation, actual-cost Settlement and unused-cost Release append a SHA-256 chained ledger. Money uses BigInt microusd.
- No-charge failure releases the complete reservation. Settlement below reserve releases the exact difference; settlement above reserve is rejected.
- Instant Kill Switch returns every new selected bucket to Control while prior reservations remain reconcilable.
- The local component produces financial/assignment plans only and performs no external Dispatch.
- Full local verification passed: TypeScript, `252/252` Vitest tests across `41` files, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Stage 14.4 evidence

- Each experiment is an immutable published Policy Version with an explicit disclosure, eligible Profiles, active window, pinned Exploration Policy and platform-subsidized customer contract.
- Draft-to-Final labels the draft, requires a separate Final Quote and refuses Final output until explicit confirmation is recorded.
- Smart Variations is bounded to 2–4 outputs and records the actual authorized Family/Model/Route tuple for every output.
- Relaxed Queue publishes maximum wait and concurrency and allows stage-only progress; fabricated percentages are structurally unavailable.
- Enrollment requires a pinned Smart authorization and an actual selected Exploration reservation with unchanged customer Credits and zero surcharge.
- Run replay is idempotent; changed intent, output ID reuse or occupied output slot fails closed.
- Manual, satisfaction-regression and Margin-Floor Kill Switches stop new enrollment immediately while pinned in-flight runs may complete without redispatch.
- The controller hashes the user key, discloses the actual Model evidence and performs no provider request or Dispatch mutation.
- Full local verification passed: TypeScript, targeted ESLint, `260/260` Vitest tests across `42` files, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Stage 14.5 evidence

- CFO Advisor accepts only sufficient weekly aggregate metrics explicitly marked sanitized, without user identity, prompts, assets or credentials.
- An immutable Policy Version pins the target and hard-floor Margin, cost-shock threshold, concentration limit, provider runway targets and maximum unreconciled exposure.
- Exact BigInt simulations expose current and recommended-price Expected/P90/Maximum COGS and conservative signed Margin basis points.
- The Advisor deterministically detects Margin breach, loss-making Route, cost shock, low runway, Route concentration and unreconciled exposure.
- Recommendations are limited to Price, Route Weight, Treasury and Suspension Drafts. Every Draft is `ADVISORY_DRAFT` and requires `MAKER_REVIEW`.
- Proposal retries are idempotent and changed Report-ID reuse fails closed. Proposal evidence is append-only and SHA-256 chained.
- The Advisor has no Publish, Credit mutation, provider Top-up, secret activation, journal deletion or runtime mutation capability.
- Full local verification passed: TypeScript, targeted ESLint, `268/268` Vitest tests across `43` files, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Stage 14.6 evidence

- An executable Gate evaluator validates one bounded immutable evidence report across all Stage 14 controls.
- Local PASS requires complete opt-in/result disclosure, zero hidden substitution, ready Evaluation evidence and all five focused suites passing.
- Exploration must remain at `1–5%`, reconcile Reserve exactly to Settle plus Release and charge the customer zero surcharge.
- All three experiment contracts and their disclosed outputs must complete, with no Margin breach, satisfaction below limit or failed Kill Switch drill.
- CFO evidence must exist, preserve its proposal chain and perform zero runtime mutation.
- Any local external Dispatch fails the local Gate. Malformed money, counts, ratios or evidence bounds are rejected instead of producing a decision.
- Formal PASS additionally requires formal Gate 13, representative real data, consent/privacy/legal/finance approvals, a real Smart Beta canary, Production rollback drill and observed satisfaction/Margin limits.
- Current deterministic fixtures produce Local `PASS`, Formal `HOLD`, Production authorization `DENIED` and Smart Beta activation `DENIED`.
- Full local verification passed: TypeScript, targeted ESLint, `275/275` Vitest tests across `44` files, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Boundary

This stage implements the local policy/domain foundation. It does not expose a public Smart UI, activate a Smart route, run an experiment, spend exploration budget or collect real user consent. All candidates and users in tests are deterministic fixtures. Formal Gate 13 remains `HOLD`, so Production Smart Beta is not authorized.

- [OPTIN-001 Profiles, consent and result disclosure](./OPTIN-001_PROFILES_CONSENT_DISCLOSURE.md)
- [EVAL-001 Structured feedback and versioned evaluation](./EVAL-001_FEEDBACK_VERSIONED_EVALUATION.md)
- [EXPLORE-001 Platform-funded exploration budget](./EXPLORE-001_PLATFORM_FUNDED_BUDGET.md)
- [EXPERIMENT-001 Transparent experiment contracts](./EXPERIMENT-001_TRANSPARENT_EXPERIMENT_CONTRACTS.md)
- [ADVISOR-001 CFO proposals and deterministic simulations](./ADVISOR-001_CFO_PROPOSALS_SIMULATIONS.md)
- [Gate 14 evidence and decision](./GATE-14-EVIDENCE_DECISION.md)
