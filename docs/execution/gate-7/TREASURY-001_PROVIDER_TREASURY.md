# TREASURY-001 — Provider Treasury Contract

| Field | Value |
|---|---|
| Status | `PROPOSED — LOCALLY TESTED` |
| Arithmetic | Integer provider atomic units and integer `microusd` |
| Auto top-up | Prohibited |
| Review trigger | Funding, provider balance, cost source, exposure, spend limit or dispatch policy change |

## Funding Lots

Each immutable lot records provider account, native atomic units received, cash paid in microusd, native face value, funding timestamp and source evidence hash. Actual provider usage allocates FIFO.

```text
native book value = allocated native atomic × approved face value
cash COGS = proportional cash paid from Funding Lots
funding fee/bonus effect = cash COGS - native book value
```

Cumulative proportional allocation is rounded conservatively and reaches the exact lot cash total when the lot is fully consumed. A usage ID is idempotent; different content under the same ID is a conflict.

## Shadow balance

```text
confirmed remaining
- submitted/running maximum exposure
- submission-unknown exposure
- reconciliation uncertainty
- safety reserve
= shadow available
```

The latest immutable balance snapshot is evidence, not a mutable wallet. Unknown balance means zero confirmed availability and stops dispatch.

## Runway and reorder

- Burn is exposed for 1 hour, 24 hours, 7 days and 31 days.
- Forecast daily burn is the maximum of 1h×24, 24h and conservative 7d/7.
- Runway is returned as an exact rational: shadow atomic / forecast daily atomic.
- Reorder point includes lead-time burn, largest approved job, unknown exposure and safety stock.
- Auto top-up is absent; the result is a recommendation only.

## Dispatch hard gates

Before provider submission:

1. Provider policy and confirmed snapshot must exist.
2. Circuit must be closed.
3. State cannot be `CRITICAL` or `DISPATCH_STOP`.
4. Maximum job exposure must fit per-job, daily and monthly limits.
5. Shadow availability must cover the new maximum exposure.

Low balance never silently selects a semantically different Exact route. Any alternative Exact route must also pass EQUIV-001.
