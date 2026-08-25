# PCP-G0 — BASELINE-001: Local Execution Baseline

> **Plan:** `FL-PCP-002`  
> **Gate:** `PCP-G0`  
> **Status:** `PASS — LOCAL BASELINE ONLY`  
> **Recorded:** 22 أغسطس 2026 — Asia/Baghdad  
> **External provider calls:** none

## Purpose

تثبيت الحالة التي يبدأ منها برنامج Provider Control Plane من دون افتراض أن كل الملفات المعدلة تخص هذا البرنامج. هذا الدليل لا يمنح صلاحية نشر أو اتصال خارجي.

## Repository identity

| Field | Value |
|---|---|
| Repository root | `C:/Users/hp/Documents/fusion lab/fusionlab-next` |
| Baseline commit | `193c4f63e3eea1dfec12074772c5889738722c96` |
| Commit summary | `Replace legacy plans with professional platform engine master plan` |
| Worktree state | Dirty; existing user and prior-program changes are preserved |
| Canonical local web route | `/projects/:projectId/studio` |
| Canonical local API family | `/v2/*` via Engine API |
| Local service topology | Vite `:8080`, Engine `:8787`, Provider For Test `:8790` |

## Verified baseline

| Check | Result | Scope |
|---|---|---|
| TypeScript | PASS | app, engine, provider-test and package projects using the repository's locked TypeScript version |
| Unit/integration tests | PASS — `80` files, `459/459` tests | Local fixtures, durable runtime, finance, Admin read model and Provider For Test |
| Provider network access | DENIED in local tests | KIE, OpenRouter and other paid-provider hostnames |
| Provider generation | NOT EXECUTED | No KIE/OpenRouter generation or account call occurred |

## Interpretation

The baseline proves the local engine and Provider For Test contracts are reproducible. It does **not** certify KIE or OpenRouter, does **not** prove the Admin setup flow is operational, and does **not** authorize production deployment.

## Required command set

```text
npm ci
npm run typecheck
npm test
npm run build:engine
npm run build:provider-test
npm run build
```

The standard local development command remains:

```text
npm run dev
```

It must reject privileged provider credentials in local mode.

## Exit conclusion

`PCP-0001` and `PCP-0004` are complete as local baseline evidence. All future PCP evidence must state the exact scope it verifies and must not upgrade local fixture evidence to real-provider certification.

