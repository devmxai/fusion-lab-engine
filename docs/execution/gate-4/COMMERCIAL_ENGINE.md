# Commercial Registry and Deterministic Quote Engine

## Source-of-truth separation

```text
Provider Adapter Registry
  = authentication and protocol implementation

Versioned Commercial Registry
  = family, recipe, route, capabilities, billing, cost, price and policy versions

Deterministic Quote Engine
  = validates full input, evaluates one certified snapshot and pins every version
```

The previous local hard-coded price calculator was removed from the execution path. The Provider For Test HTTP quote now reads only the active immutable Commercial Registry snapshot.

## Immutable snapshot contents

- Model Family Versions and Product Recipe Versions.
- Provider Route Versions referencing Capability, Billing Manifest and Cost Versions.
- Customer Price Versions and Exact/Smart policy schemas.
- Adapter version, provider account, provider model, privacy constraints, certification evidence and kill switch.
- Cost source URL, SHA-256 snapshot, capture/expiry timestamps, replacement unit cost and risk/maximum multipliers.

Registering the same snapshot ID twice is rejected. Callers receive structured clones, so mutating a returned object cannot modify the stored version.

## Billing DSL

The local certified subset is declarative JSON with rational `bigint` arithmetic:

- `per_generation`
- `per_image`
- `per_output_second` with certified resolution multipliers and audio addon
- `per_character_block`

There is no `eval`, JavaScript expression or floating-point money. Unknown formula kinds disable quote creation.

## Quote algorithm

1. Load one active published snapshot.
2. Resolve published Family, Recipe, Routing Policy and Customer Price versions.
3. Apply route lifecycle, kill-switch, full capability and cost-freshness gates.
4. Refuse automatic selection if more than one candidate remains in Phase 4.
5. Evaluate provider atomic units with rational arithmetic.
6. Calculate replacement cost, risk-adjusted/maximum conservative cost and variable platform cost.
7. Calculate target contribution price and round once to the allowed whole-credit step.
8. Enforce the hard margin floor.
9. Store immutable request hash, TTL and every version pin.

Public Quote projection includes customer credits, mode, TTL, request hash and public Recipe/Family/Customer Price pins. It excludes provider account/model/route, provider cost and secret metadata.

## Local golden prices

| Model | Certified formula | Provider charge | Site quote at 50% margin |
|---|---|---:|---:|
| Test image | 2 provider credits per image | 2 | 4 whole credits |
| Test video, 10s 720p | 2 provider credits per second | 20 | 40 whole credits |
| Test audio, 250 characters | 1 credit per started 100-character block | 3 | 6 whole credits |

Increasing a Cost Version maximum multiplier changes only future Quotes. Activating a new Customer Price Version cannot mutate an already-issued Quote.

