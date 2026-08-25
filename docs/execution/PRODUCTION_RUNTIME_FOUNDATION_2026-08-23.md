# FusionLab — Production Runtime Foundation

**Date:** 2026-08-23  
**Status:** `IMPLEMENTED AND VERIFIED LOCALLY / NOT DEPLOYED / MIGRATION NOT APPLIED`  
**Provider traffic:** `NONE`  
**Paid credits consumed:** `NONE`

## Closed in this work package

- Added a Vercel Node gateway at `api/engine/[...path].ts`.
- Added fail-closed Production configuration. Local mode and fixtures cannot be selected by the Production gateway.
- Added Supabase JWT verification through Auth, then server-side Admin membership lookup.
- Added server-derived `super_admin`/`admin` authorization and mandatory AAL2 for protected Admin capabilities.
- Added a real TOTP MFA enrollment/elevation UI in Admin Settings. Enrollment occurs only after an explicit administrator click.
- Added a Supabase transaction-pooler Postgres adapter with prepared statements disabled and a bounded connection count.
- Added `/healthz` for liveness and `/readyz` for the real `fusion_engine` schema readiness check.
- Added the versioned Production Engine migration containing wallets, double-entry ledger evidence, quotes, atomic reservations, idempotency bindings, operations, events, attempts, inbox/outbox, provider cost evidence, and Provider Control Plane records.
- Revoked `PUBLIC`, `anon`, and `authenticated` access to the entire `fusion_engine` schema and enabled RLS on every table.
- Upgraded React Router, Vite, Vitest, and the Vite React plugin to clear known dependency advisories; removed the obsolete development tagger.

## Verified evidence

- TypeScript: all application, gateway, Engine, and domain package projects passed.
- Unit/integration suite: `101/101` files and `537/537` tests passed.
- Production schema installation test: passed against a clean PostgreSQL-compatible PGlite instance, including table inventory, RLS, and browser-role revocation.
- Production gateway tests: verified missing configuration, invalid sessions, authenticated AAL1 Admin reads, AAL2-only sensitive commands, readiness, and denial of unreleased Engine routes.
- Production Vite build: passed.
- Production dependency audit: `0` known vulnerabilities.
- Local browser inspection: Admin Settings rendered the real MFA control without console errors from the updated page.

## Deliberately still closed

- `/v2/*` generation and unreleased Admin endpoints return `503 PRODUCTION_ENGINE_NOT_RELEASED`.
- No KIE or OpenRouter key is stored and no provider API request is made.
- The migration has not been applied to the remote Supabase project.
- No Vercel deployment or primary-domain cutover has occurred.
- No financial or provider route can silently fall back to Local fixtures.

## Required values before remote release

1. A newly rotated Supabase server secret, because the earlier key was shared in conversation.
2. The Supabase Transaction pooler connection string on port `6543` as `SUPABASE_DATABASE_URL`.
3. Vercel Production environment variables: `ENGINE_ENVIRONMENT`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `SUPABASE_DATABASE_URL`.
4. The administrator must complete TOTP enrollment and elevate the session to AAL2.

## Safe remote order

1. Rotate exposed GitHub, Supabase, and Vercel credentials.
2. Take a database backup and record its identifier.
3. Apply `20260823070000_production_engine_foundation.sql`.
4. Verify RLS, revocations, financial invariants, and `/readyz`.
5. Configure Vercel Production secrets.
6. Deploy with paid/provider routes still closed.
7. Run Auth/Admin/readiness smoke tests.
8. Build and certify the asynchronous queue/worker and private media path.
9. Add provider credentials through governed Admin workflow, then run a separately budgeted canary.

This package creates the Production boundary and durable database foundation. It does not claim that provider execution or financial Production traffic has been released.
