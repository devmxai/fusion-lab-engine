# Gate 17 Evidence and Decision

| Field | Value |
|---|---|
| Gate | `17 — Professional Graph` |
| Local implementation | `PASS` |
| Formal Gate | `HOLD` |
| Production authorization | `DENIED` |
| Scope | `Deterministic local project fixtures only` |

## Local acceptance

- The evaluator verifies the exact `STANDARD → PROFESSIONAL → STANDARD` sequence and compares canonical assets, operations, bindings, canvas items and viewport without conversion.
- It recomputes the semantic Professional projection and rejects any mismatch.
- It evaluates the published local budget for nodes, edges, Timeline clips and projection time.
- It emits SHA-256 evidence and decision hashes.

## Formal blocker

`FORMAL_GA_EVIDENCE_MISSING` is always present in this local evaluator. It has no input or implementation path that can produce Formal `PASS` or Production authorization.

## Decision

```text
Local Gate 17: PASS
Formal Gate 17: HOLD
Production authorization: DENIED
Migration / deploy / paid provider: NONE
```

## Verification summary

- Focused Creative Space / Gate 17 suite: `18/18` tests passed.
- Full local repository suite: `368/368` Vitest tests across `57` files passed.
- Chromium E2E: `7/7` scenarios passed, including Professional switch, semantic ports/edges, local graph tools, Timeline, safe Debug View and Axe WCAG checks.
