# API-001 — Public API v2 Contract

| Field | Value |
|---|---|
| Status | `PROPOSED — LOCAL DRAFT` |
| Contract version | `2.0.0-local-draft` |
| Format | OpenAPI `3.1.0` |
| Compatibility policy | Additive changes within v2; breaking changes require a new major version |
| Deprecation window | 90 days after an approved replacement is available |
| Owner | `MISSING` |

## Canonical source

- Document: `packages/contracts/src/openapi.ts`
- Public DTO validation: `packages/contracts/src/api-v2.ts`
- Executable endpoint: `GET /openapi/v2.json`
- Compatibility tests: `packages/contracts/src/contracts.test.ts`

## Policy enforced by the contract

- JWT bearer authentication is declared for every public operation.
- Every operation carries a privacy classification and rate-limit policy.
- Every mutation requires `Idempotency-Key`.
- Collection endpoints use opaque cursor pagination.
- Public DTOs exclude provider task IDs, provider routing, provider prices, secrets and raw provider payloads.
- Errors use a stable envelope with code, message and request ID.

## Current scope limitation

The contract currently establishes the required route surface and cross-cutting policy. Most `/v2` business handlers are not implemented yet. The local mock lifecycle remains under `/v1/dev/mock/*` and is not part of the public v2 API. Production certification is therefore pending.

