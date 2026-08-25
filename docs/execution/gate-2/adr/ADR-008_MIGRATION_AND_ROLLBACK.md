# ADR-008 — Migration, Canary and Safe Rollback

- Status: `PROPOSED — LOCAL DRAFT`
- Owner: `MISSING`
- Review trigger: schema, traffic cutover or production release strategy change

## Context

Financial and lifecycle migrations can corrupt state if old and new writers disagree. A rollback must preserve evidence and in-flight work.

## Decision

Use expand/verify/backfill/validate/cutover/contract stages. Each migration has preconditions, backup/restore proof, forward and rollback scripts, data invariants and rehearsal evidence. Canary by controlled tenant/route with kill switches and observable acceptance thresholds. Never roll back by deleting financial evidence.

## Alternatives

Big-bang replacement, destructive schema rollback and unmeasured dual writes were rejected.

## Consequences and controls

Cutover is blocked until compatibility, restoration, reconciliation and rollback are rehearsed. The current owner instruction forbids migrations and production deployment, so this ADR documents future governance only.

## Security / financial impact

In-flight operations are drained or quarantined; holds remain protected through rollback. Journal history is append-only.

## Safe fallback

Stop new paid operations, keep read paths available, pin the last certified route/version and reconcile in-flight operations from immutable evidence.

