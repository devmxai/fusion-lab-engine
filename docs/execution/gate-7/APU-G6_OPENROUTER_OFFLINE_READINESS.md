# APU-G6 — OpenRouter Offline Readiness

| Field | Decision |
|---|---|
| Scope | `VALIDATED + LOCAL_TEST_ONLY` |
| Provider connection / paid request | `NONE` |
| Secret/API key | `NONE in runtime, browser, Git, or test fixture` |
| Route publication / Canary | `PROHIBITED` |
| Database migration / deploy | `NONE` |

## Named target matrix

| Fixture route | Protocol | Result form | Cost evidence rule |
|---|---|---|---|
| `openrouter.fixture.chat` | Chat | normalized text | response `usage.cost`, then Generation audit if absent |
| `openrouter.fixture.image` | Image | inline base64 → private ingest | response `usage.cost`, then Generation audit if absent |
| `openrouter.fixture.video` | Video | async URL → private ingest | terminal `usage.cost` + signed callback/poll evidence |
| `openrouter.fixture.tts` | TTS | raw binary → private ingest | `X-Generation-Id` then Generation audit; never character-count estimate |
| `openrouter.fixture.stt` | STT | normalized text | response `usage.cost`, then Generation audit if absent |

All identifiers and payloads in this matrix are synthetic fixtures. They are not a current OpenRouter catalog, account, credential, or published product route.

## Requirement-to-evidence audit

| Requirement | Executable evidence | Decision |
|---|---|---|
| Chat/Image/TTS/STT adapters use protocol-specific routes | `openrouter-sync-adapters.test.ts` injected transport assertions | PASS local |
| Video submit/poll/download and unknown submit | `openrouter-adapter.test.ts` | PASS local |
| Inline/binary results are not forged into public URLs | sync adapter result contract; Image base64/TTS bytes tests | PASS local |
| Missing synchronous cost does not invent a debit/refund | adapter marks `UNKNOWN + reconciliationRequired`; test coverage | PASS local |
| Actual cost/model/hosting-provider audit | `OpenRouterGenerationUsageClient`; matching/mismatch tests | PASS local |
| Key limit is an observation, not a proven enforced spend cap | sanitized `OpenRouterKeyStatusClient` fixture test | PASS local |
| Endpoint-specific price/capability parsing | general/image/video importer tests; video without SKU rejected | PASS local |
| Catalog scope | `catalog-snapshot.test.ts` stages exactly five protocol routes, all `LOCAL_TEST_ONLY` | PASS local |
| Video raw HMAC / stale / delivery-id / replay | `openrouter-adapter.test.ts` | PASS local |
| No provider route is reachable in local tests | `provider-network-deny.test.ts` | PASS local |
| Engine hold/delivery/reconciliation invariants | `local-provider/service.test.ts` | PASS generic Engine contract |

## Financial and security invariants

1. `Customer Reservation` remains the accepted customer quote. Provider fallback maximum is a separate treasury commitment; a fallback never increases the customer hold.
2. A response result is not authority to settle. Final customer debit still requires valid private ingest and delivery; missing/ambiguous provider cost stays `HELD / RECONCILIATION_REQUIRED`.
3. `actual_hosting_provider` comes only from OpenRouter generation evidence. Missing evidence is `UNKNOWN`, never inferred from a preferred route.
4. Chat/Image/STT accept direct `usage.cost` only as provider actual cost; TTS deliberately does not synthesize cost from characters and requires the later audit record.
5. Image and general catalog model-level data are discovery data only. Publishing requires endpoint-level price/capability validation and a maximum cost guard per candidate route/SKU.
6. Video webhook acceptance requires the exact raw-body HMAC, a ±300-second timestamp window, matching `<data.id>-<data.status>` delivery id, and a unique inbox. A verified callback is evidence/wake-up, not delivery or settlement.
7. Generation and management/treasury credentials are separate server-side configurations. Key limit observations and OpenRouter credits do not substitute for FusionLab internal budgets/circuit breakers.

## Commands executed locally

```text
npm exec vitest -- run packages/providers/src/openrouter-sync-adapters.test.ts --reporter=dot
# 1 file / 5 tests passed

npm exec vitest -- run packages/providers/src/openrouter-adapter.test.ts packages/providers/src/catalog-snapshot.test.ts --reporter=dot
# 2 files / 9 tests passed

npm exec vitest -- run src/test/provider-network-deny.test.ts --reporter=dot
# 1 file / 2 tests passed

npm exec vitest -- run apps/engine-api/src/local-provider/service.test.ts --reporter=dot
# 1 file / 11 tests passed

npm run typecheck
npm run build
# passed
```

The test runner's single large combined command exceeded the local Node heap. The authoritative acceptance suites above were rerun as bounded, independent processes and all passed.

## Closure decision

`APU-G6 LOCAL OFFLINE: PASS` — all five OpenRouter protocol contracts, endpoint/SKU fixture normalization, actual-cost audit semantics, and video webhook verification have local executable evidence. No OpenRouter adapter is registered in the runtime composition, and no network request or credential was used.

This does **not** pass formal Gates 3–7, certify a route, authorize a key, permit a real catalog sync, allow Canary/API calls, or authorize migration/deploy/production changes. The next authorized program stage is `APU-G7` (Platform and Creative Space UX) against the existing local simulator/fixtures.
