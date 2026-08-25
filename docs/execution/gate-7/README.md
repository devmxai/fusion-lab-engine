# Gate 7 — OpenRouter Exact and Provider Treasury

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Status | `LOCALLY IMPLEMENTED REFERENCE` |
| Gate decision | `NOT EVALUATED / NOT PASSED` |
| OpenRouter network calls | `ZERO — injected transport fixtures only` |
| Certified OpenRouter routes | `NONE` |
| Database / production change | `NONE` |
| Owner / reviewers | `MISSING — Finance, Engine, Security and SRE required` |

## Artifacts

- [TREASURY-001 — Provider funding, shadow balance and dispatch controls](./TREASURY-001_PROVIDER_TREASURY.md)
- [OPENROUTER-001 — Async video adapter and webhook contract](./OPENROUTER-001_ASYNC_VIDEO_CONTRACT.md)
- [APU-G6 — OpenRouter Offline Readiness](./APU-G6_OPENROUTER_OFFLINE_READINESS.md)
- [EQUIV-001 — Exact equivalence gate](./EQUIV-001_EXACT_EQUIVALENCE.md)
- Executable Treasury package: `packages/provider-treasury/src/`
- OpenRouter transport fixture implementation: `packages/providers/src/openrouter-video-adapter.ts`
- Raw-body HMAC verifier: `packages/providers/src/openrouter-webhook.ts`
- Local dashboard endpoint: `GET /v1/dev/mock/treasury`

## Proven locally

- Decimal provider costs become integer atomic units without floating-point ledger math.
- Funding Lots allocate actual usage FIFO and separate provider-native book value, cash COGS and funding fee/bonus effect.
- Terminal cost is idempotent and immutable; missing or conflicting actual cost fails closed.
- Confirmed balance snapshots subtract running, unknown and reconciliation exposures plus safety reserve to produce shadow available balance.
- Burn windows, conservative daily forecast, runway ratio, reorder point, recharge recommendation and concentration inputs are deterministic.
- Per-job/day/month spend limits, circuit breaker and shadow/runway gate run before provider submission.
- Exact cross-provider fallback fails unless both immutable route versions share one approved evidence group and semantic contract hash.
- OpenRouter video fixtures cover model discovery, scoped Credits API, async submit/poll, `usage.cost`, authenticated download and unknown-cost failure semantics.
- Webhook verification uses exact raw bytes, timestamp tolerance, HMAC-SHA256 timing-safe comparison and delivery identity.
- A provider `failed` status without confirmed no-charge evidence goes to `RECONCILIATION_REQUIRED`; the customer hold is not released by assumption.
- Chat/Image/TTS/STT each use a distinct fixture-tested protocol adapter. Inline/binary outputs are normalized for private ingest; missing actual cost remains held for reconciliation.

## Gate blockers

1. Gate 6 and its dependencies are not production-approved; Gate 0 remains `HOLD`.
2. No real OpenRouter request, Management Key, workspace webhook, public HTTPS receiver or paid canary has been used.
3. No OpenRouter route has official model/SKU snapshot, capability evidence, golden billing, privacy review or quality canary.
4. Treasury state is in memory; funding invoices, balance snapshots, commitments and spend lack persistent audit storage and maker-checker approvals.
5. No provider-side key spend limit or workspace budget has been read or enforced in a real account.
6. There is no approved KIE↔OpenRouter Exact equivalence group; cross-provider Exact remains disabled.
7. Runway and reconciliation have local deterministic evidence only, not a representative observation window.

The presence of an adapter class must not be described as OpenRouter certification. Production registration remains prohibited until the route evidence pack and Gate approvals exist.
