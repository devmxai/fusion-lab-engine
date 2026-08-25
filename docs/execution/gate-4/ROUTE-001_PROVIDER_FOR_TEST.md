# ROUTE-001 — Provider For Test Local Certification Package

| Field | Value |
|---|---|
| Status | `CERTIFIED FOR LOCAL TEST HARNESS ONLY` |
| Production eligibility | `PROHIBITED` |
| Provider | `provider-test` |
| Adapter | `provider-test-http.v1` |
| Transport | Authenticated loopback HTTP |
| Owner | `local-test-harness` — production owner missing |
| Canary evidence | Automated local contract/E2E tests only |

## Route versions

| Route version | Family | Billing version | Capability |
|---|---|---|---|
| `route:local/test-image-v1:v1` | `family:local/test-image-v1:v1` | per-image, 2 units | image, 720p/1080p, up to 4 references |
| `route:local/test-video-v1:v1` | `family:local/test-video-v1:v1` | 2 units/sec, rational resolution multiplier, audio addon | 1–60 sec, 720p/1080p, audio, up to 4 references |
| `route:local/test-audio-v1:v1` | `family:local/test-audio-v1:v1` | 1 unit/100-character block | 1–100,000 characters |

## Mandatory manifest evidence

| Requirement | Local evidence | Result |
|---|---|---|
| Provider account/model ID | Versioned route manifest | PASS local |
| Canonical family/version | Immutable reference validation | PASS local |
| Input modes/semantic slots/reference limits | Capability versions and mismatch tests | PASS local |
| Resolution/duration/audio/output semantics | Golden capability fixtures | PASS local |
| Typed billing basis | Rational DSL; unknown formula rejected | PASS local |
| Source snapshot/hash/freshness | `local://` fixture + SHA-256 + valid-until | PASS local only |
| Actual usage extractor | `actualProviderCredits` canonical task field | PASS local |
| Failure/refund semantics | provider failure, submission unknown and delivery loss scenarios | PASS local |
| Privacy/retention/region | no retention, loopback, training false | PASS local |
| Adapter version | Pinned in route and quote | PASS local |
| Canary/result ingest | Real local HTTP, polling, asset validation and SHA-256 | PASS local |
| Kill switch | Quote exclusion test | PASS domain test |
| Margin shock | max-cost multiplier and hard-floor tests | PASS domain test |

## Known limitations

- The source is synthetic, not an official external provider source.
- Certification is stored in memory and has no named human approval.
- There is no external billing invoice, provider funding lot or cash reconciliation.
- This package cannot be copied to KIE/OpenRouter by changing a name; each external route requires its own documentation importer, adapter fixtures, real canary and signed certification.

