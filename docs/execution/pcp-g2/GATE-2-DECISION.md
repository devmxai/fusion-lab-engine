# PCP-G2 Gate Decision — Durable Provider Control Plane

> **Decision:** `PASS — LOCAL`  
> **Date:** 22 August 2026  
> **Scope:** durable provider-neutral records and local governance contracts only.

`PCP-G2` is accepted for local development. The project now has a durable, immutable, versioned control-plane foundation that can represent providers, accounts, models, candidate routes, and published-offer pointers without schema changes per provider.

The following conditions remain mandatory:

- This decision does **not** authorize adding a key, calling KIE/OpenRouter, generating media, changing production, or deploying.
- `PCP-G3` must first add a server-only Secret Manager and provider-specific **read-only** verification. A key connection must result in `CONNECTED`, never in automatic model activation.
- No direct runtime map, catalog snapshot, or Admin UI action may bypass the Change Set → immutable version → release workflow.

Evidence: [PCP-G2 progress](./PROGRESS-001_DURABLE_CONTROL_PLANE_LOCAL.md).

