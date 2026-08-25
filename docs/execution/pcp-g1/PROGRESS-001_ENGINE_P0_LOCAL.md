# PCP-G1 — Engine P0 Local Progress Evidence

> **Evidence ID:** `PCP-G1-PROGRESS-001`  
> **Date:** 22 August 2026  
> **Scope:** Local only. No KIE/OpenRouter credential, account probe, generation call, migration, or deployment occurred.

## Completed in this evidence increment

- Legacy Supabase generation paths are retired with `410 ENGINE_V2_REQUIRED`; Generation V2 is the only commercial execution boundary.
- A provider webhook inbox is now durable: `(provider_id, delivery_id)` uniqueness, raw SHA-256 evidence, task binding, atomic claim/finalize, and conflict failure survive process restart.
- Webhook parsers are pure authenticators. KIE now uses its signed timestamp header, and neither KIE nor OpenRouter uses an in-memory replay set.
- A quote pins immutable route/account/model/catalog/cost/adapter/usage-extractor evidence before a customer hold; dispatch validates the bound provider/model/adapter.
- Kill Switch is checked before the reservation and again immediately before durable dispatch. A queued operation stopped at that boundary is cancelled and its held customer credits are released exactly once, before a provider call.
- Provider failure contracts are explicit:
  - confirmed no-charge → customer hold released once;
  - confirmed positive charge → customer hold released and `LOSS` provider-cost outcome recorded;
  - unknown charge → protected hold and reconciliation.
- Every provider attempt has a durable deadline. Expiry becomes `RECONCILIATION_REQUIRED`; it never causes a time-based blind refund.
- Asset downloads now reject redirects and are streamed with a bounded byte budget before ingestion; existing DNS/IP, MIME/magic, malware, quarantine and private-delivery checks remain in force.

## Verification run

- Focused durable/provider tests: `31/31` pass.
- Subsequent focused financial, asset, media and timeout tests: `27/27`, `29/29`, and `7/7` pass in their respective runs.
- TypeScript passes for Engine API, durable execution, and media pipeline projects.
- `git diff --check` returned no whitespace errors.

## Still required before PCP-G1 can close

1. Wire the durable webhook inbox to authenticated Engine webhook routes only after G3 Secret Manager supplies server-only signing secrets; the route must perform authoritative provider fetch and wake the durable worker, never settle directly from webhook JSON.
2. Run the complete local verification suite after the final webhook-boundary integration.
3. Record a Gate-1 decision with the final test log and threat-model evidence.

`PCP-G1` therefore remains **IN PROGRESS**.
