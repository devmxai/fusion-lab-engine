# ROUTER-001 — Hard Gates and Expected Cost per Usable Success

## Contract

The Profit Router begins as a pure, server-side Shadow evaluator. It accepts immutable candidate snapshots and produces explainable eligibility evidence. It has no Provider adapter access, Ledger authority or Dispatch authority.

## Gate order

A Route must pass every hard gate before any economic metric can reach scoring:

1. published and unexpired Route Version;
2. complete Capability match;
3. approved Exact Equivalence Group when switching Exact Routes;
4. usable, unexpired Cost Version;
5. active, unexpired Credential state;
6. Shadow provider balance covers maximum exposure;
7. closed Circuit and available capacity;
8. compatible privacy/data policy;
9. known Actual-Cost extractor;
10. projected margin does not breach the hard floor;
11. fresh, non-future signature metrics;
12. candidate was pinned by the Quote.

Failure excludes the Route. It is not represented as a lower score.

## Metric signature

Metrics cannot be shared across incompatible work. Each snapshot pins:

```text
route version + model version + input mode + resolution
+ duration bucket + audio mode + reference mode
+ adapter version + retry policy version
```

The server rejects incomplete, cross-Route, stale or future metric snapshots.

## Exact economics

For attempts `i`:

```text
expected policy cost = Σ reach_probability_i × expected_attempt_cost_i
usable-success probability = 1 − Π(1 − usable_success_probability_i)
expected cost per usable success = expected policy cost / usable-success probability
```

Probabilities use integer parts-per-million inputs and calculations remain reduced BigInt rational values. A separate ceiling is provided only for conservative display/comparison; the exact numerator and denominator remain evidence.

`usable success` must represent the full delivered outcome, not merely a Provider `succeeded` status.

## Local-only limitation

Stage 13.1 fixtures prove the contract and arithmetic. They do not establish real Provider reliability, quality, latency, equivalence or margin. Those require approved representative Shadow observations before any Exact canary.
