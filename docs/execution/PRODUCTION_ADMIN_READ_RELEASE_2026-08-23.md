# FusionLab — Production Admin Read Release

Date: 2026-08-23  
Deployment: `dpl_2PLU8XpKV55srMbmxYXAdAdPLX3Y`  
Primary domain: `https://fusionlab.pro`

## Scope closed

- The browser bundle is built remotely by Vercel from a secret-free source package.
- Supabase browser configuration is injected by Vercel Production environment variables; the previous `[SENSITIVE]` placeholder failure is absent.
- The `fusion_engine` Production schema is installed in Supabase and is reachable only through the dedicated server runtime role.
- Production liveness and database readiness return `200`.
- `/admin` is protected by the Supabase session boundary and redirects anonymous visitors to `/auth`.
- The Production Admin shell verifies server-derived membership before rendering.
- An authenticated Admin at AAL1 may read the Admin projections. Sensitive credential and release commands continue to require AAL2.
- Production Admin read routes project durable operations, wallets, reservations, exceptions, provider cost outcomes, audit metadata and immutable reference-catalog records from PostgreSQL.
- Anonymous Admin requests return `401`.
- Unreleased `/v2/*` execution remains fail-closed with `PRODUCTION_ENGINE_NOT_RELEASED`.
- No KIE or OpenRouter credential was stored and no paid generation request was performed.

## Verification

- Application TypeScript: pass.
- Production gateway TypeScript: pass.
- Production gateway tests: `7/7` pass.
- Full unit/integration suite: `536/538` pass in the parallel run; the two PGlite tests exceeded the shared 30-second limit only.
- Isolated rerun of the two timed-out PGlite suites: `10/10` pass with one worker.
- Production Vite build: pass.
- Staged Vercel bundle contains the expected Supabase host and no `[SENSITIVE]` placeholder.
- Staged `healthz`: pass.
- Staged `readyz`: pass.
- Staged anonymous Admin denial: pass.
- Primary-domain pages `/`, `/auth`, `/admin`, and `/admin/settings`: `200` document responses.
- In-app browser check: `/auth` renders and `/admin` redirects an anonymous visitor to `/auth`.

## Deliberately not claimed

- Provider credentials are not configured.
- The Production write-only Secret Manager workflow is not released yet.
- Official KIE/OpenRouter reference snapshots have not been imported into Production.
- Route candidates, provider cost evidence, customer prices and an atomic Release Bundle have not been published.
- No customer-visible model is active.
- No real generation can be submitted yet.

## Next controlled sequence

1. The owner signs in to `https://fusionlab.pro/auth` and confirms the Production Admin read pages.
2. Enrol MFA so the session reaches AAL2 before any credential command is shown.
3. Release a Supabase Vault-backed, write-only credential workflow with immutable metadata and audit records.
4. Import official public KIE/OpenRouter reference evidence without activating a route.
5. Select a small model subset, pin provider protocols and cost formulas, set customer credit prices, review, and publish one atomic Release Bundle.
6. Run one explicitly budgeted connection test and one canary generation, then reconcile provider evidence, customer ledger capture and delivered asset evidence.

Decision: **PASS — PRODUCTION FOUNDATION AND AUTHORIZED ADMIN READS; PROVIDER EXECUTION REMAINS HOLD**
