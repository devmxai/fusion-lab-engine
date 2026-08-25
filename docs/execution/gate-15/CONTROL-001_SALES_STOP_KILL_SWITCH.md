# CONTROL-001 — Pilot Sales Stop and Kill Switch

| Field | Value |
|---|---|
| Stage | `15.4` |
| Status | `COMPLETE LOCALLY / PILOT NOT ACTIVATED` |
| Initial state | `CLOSED / SALES STOP DEFAULT` |
| Approval | `Maker + distinct Legal + distinct Finance` |
| Production impact | `NONE` |

## Immutable control policy

The Pilot Control Policy pins the exact Offer, Cohort Budget and Risk Model Policy Versions. It also publishes the maximum Cohort membership, minimum remaining-budget threshold, maximum queue age, required approval roles and immediate Kill semantics.

The maximum Cohort membership is a transparent Pilot-admission boundary. It is not a fixed monthly generation allowance and cannot become a hidden per-user usage cap.

Every new Policy Version begins closed with Sales Stop enabled. `productionActivationAllowed` is fixed to false.

## Simulation opening

Opening local simulation requires all of the following:

- a representative Risk Report whose outcome is `WITHIN_APPROVED_BUDGET`;
- a reconciled Cohort Budget with exact `available + reserved + settled = allowed COGS` math;
- zero customer Credit mutation and zero external Dispatch;
- matching policy, offer, budget and risk versions;
- a Maker proposal and approvals from distinct Legal and Finance actors.

The controller verifies the Risk evidence hash and outcome semantics instead of trusting a caller-provided label. It also reconstructs the Budget arithmetic before accepting it.

## Sales Stop

Sales Stop may be invoked manually or automatically when remaining Cohort Budget falls below the published threshold or queue age exceeds the published maximum. It blocks new Cohort admissions but preserves the contract of members already admitted and authorized, whose operations remain subject to the same reservation and usage controls.

## Kill Switch

Kill is immediate and may be invoked manually or automatically when the Risk Report projects a budget breach or Budget reconciliation fails. It blocks all new member admissions and new operations.

Existing in-flight work may only follow the pinned `SETTLE_OR_RELEASE_NO_REDISPATCH` rule. A killed Policy Version is terminal and cannot reopen; recovery requires a new reviewed version.

## Audit and acceptance evidence

- Commands are idempotent and conflicting replay fails closed.
- Maker, Legal and Finance separation is enforced.
- Tampered Risk evidence and Budget arithmetic are rejected.
- Cohort size, remaining-budget and queue-age controls are tested.
- Manual and automatic Sales Stop behavior is tested.
- Manual and automatic Kill behavior, terminal state and in-flight handling are tested.
- Events are append-only and SHA-256 chained; actor identifiers are hashed.
- Focused Gate 15 suite: `32/32` passed.
- Full repository suite: `307/307` Vitest tests across `48` files and `6/6` Chromium E2E tests.

## Boundary

This is a deterministic local control-plane reference. It does not create a real Cohort, admit a customer, reserve real money, execute a provider request, activate Production, run a Migration or deploy any change.
