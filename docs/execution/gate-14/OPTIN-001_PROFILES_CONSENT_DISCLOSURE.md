# OPTIN-001 — Profiles, Consent and Result Disclosure

| Field | Value |
|---|---|
| Stage | `14.1` |
| Status | `COMPLETE LOCALLY / NO SMART DISPATCH` |
| Formal dependency | `Gate 13 HOLD` |
| Production impact | `NONE` |

## Published Profile contract

Every Smart Profile Version pins:

- one of `BEST_VALUE`, `CINEMATIC`, `FAST_DRAFT`, `HIGH_CONSISTENCY`;
- public display name and immutable version sequence;
- Disclosure Version plus pre-selection and result-disclosure text;
- unique candidate Family, Model and Route Versions;
- Exact and Smart Profile certification flags for every candidate;
- a mandatory false policy for calling economic output Premium.

A Profile ID or key/version sequence cannot be overwritten.

## Consent lifecycle

Opt-in is a server record of an explicit action tied to the user, Profile Version and Disclosure Version. It is idempotent only for identical evidence; conflicting reuse fails closed. Opt-out appends a separate immutable event and blocks every new authorization under that consent.

Plan eligibility is checked independently of consent. Consent cannot grant access to a Profile excluded by the user's pinned Plan.

## No hidden substitution

Exact Mode cannot enter this authorization path. Smart authorization returns the automatic-selection disclosure and the complete certified candidate snapshot, while fixing `hiddenSubstitutionAllowed: false` and `externalDispatchPerformed: false`.

After a result, disclosure succeeds only if actual Family, Model and Route exactly match an authorized candidate. The actual identifiers and automatic-selection fact are returned. A fabricated Model, undisclosed Route or `Premium` relabel fails closed.

## Acceptance evidence

- All four named Profiles publish as immutable local versions.
- Uncertified candidates and Premium-claim policy are rejected.
- Opt-in replay is idempotent; conflicting consent ID reuse is rejected.
- Exact Mode, missing consent, cross-user consent and Plan-ineligible Profile fail closed.
- Opt-out prevents new authorization without erasing original evidence.
- Smart authorization exposes its certified candidates and performs no Dispatch.
- Result disclosure reveals the exact actual tuple and rejects hidden substitution.
- Focused tests: `7/7` passed.
- Full repository verification: `237/237` Vitest tests across `39` files and `6/6` Chromium E2E tests.

## Boundary

This is an in-memory local reference adapter because Database Migration is prohibited. It is not a public consent screen, Production registry, real experiment or provider switch. User-facing integration and real data are not claimed by this artifact.
