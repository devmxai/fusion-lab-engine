# APU-G5 — KIE Offline Readiness

| Field | Decision |
|---|---|
| Scope | `VALIDATED + LOCAL_TEST_ONLY` |
| Provider connection | `NONE` |
| Secret/API key | `NONE in runtime, browser, Git, or test fixture` |
| Route publication / Canary | `PROHIBITED` |
| Database migration / deploy | `NONE` |

## Target route matrix

| Offline route | Protocol | Native scale | Evidence |
|---|---|---:|---|
| `kie-fixture-image-v1` | Market image | 100 | adapter submit fixture + decimal actual-cost test |
| `kie-fixture-video-v1` | Market video | 100 | adapter submit fixture + common Engine delivery tests |

These identifiers are synthetic test targets, not KIE product claims or a published catalog.

## Requirement-to-evidence audit

| Requirement | Executable evidence | Decision |
|---|---|---|
| Adapter per target/variant | `kie-market-adapter.test.ts` iterates `kieOfflineRouteFixtures` | PASS local |
| Submit / rejection / unknown | adapter fixtures and `ProviderSubmissionUnknownError` test | PASS local |
| Callback HMAC / stale / replay | `kie-webhook.test.ts` | PASS local |
| Actual `creditsConsumed` / decimal scale | adapter terminal and decimal-scale tests | PASS local |
| Terminal result required | `INCOMPLETE_TERMINAL_RESULT` fixture test | PASS local |
| Private ingest → delivered → settlement | `local-provider/service.test.ts` success path | PASS generic Engine contract |
| No settlement before asset | Engine state sequence and delivery-failure test | PASS generic Engine contract |
| No release without no-charge evidence | `does not release a failed provider task when no-charge evidence is missing` | PASS generic Engine contract |
| Unknown callback recovery | `recovers submission unknown from a verified callback` | PASS generic Engine contract |
| Financial failure, loss, cost shock, reconciliation | four financial Engine tests: confirmed failure, delivery loss, cost shock, reconciliation | PASS generic Engine contract |
| Catalog snapshot / diff / maker draft | `catalog-snapshot.test.ts` stages every named KIE fixture route; Admin route test covers immutable maker Draft | PASS local |

## Non-negotiable limits

1. The callback is a verified wake-up only. It does not settle, refund, trust a callback result URL, or retry a KIE task.
2. After recovery, Engine polling must obtain a server-side task record before asset ingest or finance action.
3. The KIE adapter is not registered in the commercial/local runtime without an approved, server-side credential configuration and a separately approved certification route.
4. In-memory Inbox/Outbox/Snapshot stores are local evidence only and are not crash durable.

## Closure decision

`APU-G5 LOCAL OFFLINE: PASS` — the KIE adapter and its named synthetic target matrix are validated against fixtures and the provider-neutral Engine financial/asset invariants. This decision does **not** pass formal Gate 6, certify KIE in Production, authorize API calls, permit a key to be entered, or authorize a Canary/deploy.
