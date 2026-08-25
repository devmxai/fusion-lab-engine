# ADMIN-001 — Versioned Admin Command Contract

| Field | Value |
|---|---|
| Status | `PROPOSED — LOCALLY TESTED` |
| Scope | Pricing, Route, Treasury, credentials, financial adjustment and anonymization |
| Mutation rule | Commands only; no direct table mutation |
| Rollback rule | New version / compensating command only |

## Command lifecycle

```text
Draft → Validate → Simulate → Approve → Publish
```

- Draft pins resource identity, payload hash, maker, reason and prior version.
- Validate checks the resource-specific contract and records an evidence hash.
- Simulate records deterministic simulation evidence before approval.
- Approve requires a resource-scoped checker different from the maker.
- Publish invokes the local runtime side effect only after approval, then freezes the version.
- Reject freezes the rejected version.
- Rollback creates a new draft. For a financial adjustment, the compensating direction is reversed.

Every command carries an `Idempotency-Key`. Reuse with the same intent returns the original result; reuse with different intent is rejected.

## Local runtime effects

| Resource | Published local effect |
|---|---|
| `ROUTE_CONTROL` | Updates the provider/model dispatch guard. Enabled kill switch blocks before provider reserve/spend. |
| `FINANCIAL_ADJUSTMENT` | Posts a maker-checker adjustment through `InMemoryWholeCreditLedger`. |
| `PRICING_POLICY` | Stores the latest immutable published runtime policy reference. |
| `TREASURY_POLICY` | Stores the latest immutable published runtime policy reference. |
| `USER_ANONYMIZATION` | Stores the approved anonymization control record; data execution is not implemented. |
| `PROVIDER_CREDENTIAL` | Uses the separate write-only credential lifecycle. |

## Local cockpit

`/admin/v2` is hard-disabled outside Vite development mode. In APU-G2 it presents only Treasury and reconciliation status, audit-chain integrity, credential metadata and the change workflow as a read-only shell.

The browser receives only a short-lived signed `ADMIN_VIEWER` local session. It cannot choose an actor, role or AAL header. Independent signed test identities exercise maker/checker server contracts, but production identity remains a later requirement.
