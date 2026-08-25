# ADVISOR-001 — CFO Proposals and Deterministic Simulations

| Field | Value |
|---|---|
| Stage | `14.5` |
| Status | `COMPLETE LOCALLY / ADVISORY ONLY` |
| Authority | `PROPOSE_AND_SIMULATE_ONLY` |
| Publish / Top-up / Credit mutation | `PROHIBITED` |
| Production impact | `NONE` |

## Input trust boundary

The Advisor accepts only weekly aggregate finance/Route metrics with a minimum sample count. The snapshot must explicitly assert that it contains no user identity, prompts, assets or credentials. It pins the metric window, Route Version and Provider Account Version and is preserved by evidence hash.

Invalid money, insufficient samples, inconsistent Expected/P90/Maximum COGS, malformed windows or any sensitive input fail closed.

## Immutable Policy

The Policy Version fixes:

- target and hard-floor Margin basis points;
- cost-shock trigger;
- maximum Route concentration;
- minimum and target provider runway days;
- maximum unreconciled exposure;
- weekly reporting cadence;
- advisory-only authority.

An existing Policy ID cannot change, and each Policy key/version sequence is unique.

## Exact simulation and signals

Money uses BigInt microusd and Margin uses conservative signed integer basis points. Each analysis reports Current and Recommended-Price scenarios for Expected, P90 and Maximum COGS. The recommended price is the ceiling required to preserve the configured target Margin at Maximum COGS and can never reduce the existing customer economic value.

Deterministic signals cover:

- Margin Floor breach;
- loss-making Route;
- provider cost shock;
- insufficient provider runway;
- Route concentration;
- excess unreconciled exposure.

## Proposal boundary

Signals may create Price, Route Weight, Treasury Funding or Suspension Drafts. They are proposals only:

```text
Advisor proposal
→ deterministic simulation
→ Maker review required
→ external approval/publish workflow (not implemented here)
```

Every proposal structurally fixes execution, Publish, Credit mutation, provider Top-up, secret activation and journal deletion authority to false. The Advisor exports no command that can perform those actions.

Reports deduplicate identical retries and reject conflicting Report-ID reuse. Proposals form an append-only SHA-256 chain across weekly reports.

## Acceptance evidence

- Immutable advisory-only policies are tested.
- Sensitive or insufficient metric snapshots are rejected.
- Healthy reports do not manufacture recommendations.
- All six financial/Route signals and four Draft kinds are tested.
- Exact conservative price and Margin simulation is tested.
- Treasury recommendation is separated from provider Top-up authority.
- Report idempotency/conflict behavior is tested.
- Proposal ledger continuity and reconciliation are tested.
- Focused Smart Beta suite: `38/38` passed.
- Full repository suite: `268/268` Vitest tests across `43` files and `6/6` Chromium E2E tests.

## Boundary

This is an in-memory local Advisor reference using deterministic fixtures. It reads no Production metrics, calls no model/provider, changes no price or Route, moves no money/Credits, performs no Migration and deploys nothing.
