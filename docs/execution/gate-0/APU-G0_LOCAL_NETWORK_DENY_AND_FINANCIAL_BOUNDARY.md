# APU-G0 — Local Network Deny and Financial Boundary Evidence

> **Artifact ID:** `APU-G0-001`<br>
> **Program:** `FL-APU-001 v1.0.0`<br>
> **Canonical authority:** `FL-PMP-001 v1.1.0`<br>
> **Date:** 2026-08-21 — Asia/Baghdad<br>
> **Decision:** `LOCAL PASS — CONTAINMENT SLICE ONLY`<br>
> **Master Gate 0:** remains `HOLD`

## Scope completed locally

This artifact closes the local code/test portion of four financial containment risks. It does not authorize a provider call, Migration, deployment, or Production change.

| Risk | Local control | Evidence |
|---|---|---|
| external provider call during tests | test setup guards `fetch` and rejects KIE, OpenRouter, Gemini and the legacy KIE upload origin before any upstream fetch | `src/test/provider-network-deny.ts` + tests |
| transport failure after possible dispatch | `start-generation` keeps the reservation held, creates a `submission_unknown` reconciliation record and returns `202`; it does not release or retry | `provider-financial-policy.ts` + edge boundary test |
| terminal failure inferred from a message/code | automatic release now requires task-bound terminal evidence, a 64-hex evidence hash and actual usage exactly zero; arbitrary error strings fail closed | `hasConfirmedTerminalNoChargeEvidence` tests |
| settlement before durable result | `complete-generation` creates the durable legacy generation record and operation evidence before it calls `settle_credits`; an insert/update failure leaves the reservation un-settled | edge boundary test |
| KIE native cost discarded | status normalization preserves `creditsConsumed`/`credits_consumed` as native provider usage only, for a later route-specific extractor and reconciliation flow | KIE edge source boundary test |

## Verification executed

```text
npm exec vitest -- run \
  src/test/provider-financial-policy.test.ts \
  src/test/provider-network-deny.test.ts \
  src/lib/edge-financial-boundary.test.ts \
  src/lib/edge-auth-boundary.test.ts \
  src/lib/browser-generation-write-boundary.test.ts \
  packages/providers/src/openrouter-adapter.test.ts

Result: 6 files / 19 tests passed

tsc --noEmit -p tsconfig.app.json
Result: passed

npm run build
Result: passed
```

## Explicit non-claims and remaining holds

- The legacy Edge path still is not the durable Outbox/Inbox orchestration required by the Master Plan.
- `generations` is a legacy record, not proof of private ingest/media scanning/access verification. The canonical `ASSET_STORED → DELIVERED → SETTLED` path remains work for `APU-G1+` and Master Gates 2–6.
- No KIE task, OpenRouter call, catalog sync, key status request, balance request, webhook delivery, or paid Canary was performed.
- No Supabase schema or data was changed; no Migration was created or applied.
- Credential rotation, restore rehearsal, named RACI owners, durable Admin storage, provider webhook inbox, actual-cost persistence and external reconciliation remain `HOLD`.

## Transition decision

`APU-G0` local containment work may proceed to `APU-G1` contract design. It does **not** pass Master Gate 0 and does not allow external provider activation.
