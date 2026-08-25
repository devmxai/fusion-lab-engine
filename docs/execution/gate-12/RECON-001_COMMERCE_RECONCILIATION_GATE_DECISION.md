# RECON-001 — Commerce Reconciliation and Gate Decision

## Scope

This artifact closes the local Stage 12 implementation only. It does not approve production Commerce.

## Reconciliation contract

The local report rebuilds and checks:

```text
signed Payment Event
→ immutable Invoice
→ exact owner/source/grant Credit Lot
→ balanced grant Journal
→ optional signed Refund/Chargeback Event
→ terminal Invoice + Financial Reversal
→ exact-Lot withdrawal Journal or explicit unrecovered Receivable

Promotion Version
→ Quote budget reservation
→ Subsidy RESERVE entry
→ settlement REDEEM or failure/expiry RELEASE entry
→ reconstructed Credit and microusd budget projections
```

Any missing or contradictory link creates a stable reconciliation issue and changes `localImplementationDecision` to `HOLD`. The formal decision remains `HOLD` regardless of a clean local report until external dependencies are approved.

## Real HTTP evidence

The Commerce E2E uses an actual loopback socket and standard HTTP requests, not Fastify injection. It proves:

1. server-created idempotent Checkout;
2. repeated Success URL reads grant nothing;
3. exact raw-body signed Payment Webhook;
4. same Event through another delivery grants nothing twice;
5. funded Promotion reservation and a Provider For Test generation;
6. Promotion redemption only after customer settlement;
7. signed full Refund and exact purchase-Lot withdrawal;
8. final `10,000 bps` reconciliation with zero issues.

The flow produced wallet states `1000 → 1100 → 1080 → 980`. Payment net economic value and reversed value were each `9,700,000 microusd`; redeemed Promotion subsidy was `66,667 microusd`.

## Accessibility boundary

Stage 12 currently exposes local Engine APIs, not a new customer Commerce UI. Therefore this artifact makes no unsupported accessibility claim for Checkout pages. The existing customer Creative Space remains covered by desktop/mobile Axe WCAG A/AA checks and six passing Chromium scenarios. A future Checkout/Plans UI requires its own keyboard, screen-reader, RTL, error-state and payment-return accessibility evidence before release.

## Decision

| Decision | Value |
|---|---|
| Local implementation | `PASS` |
| Formal Gate 12 | `HOLD` |
| Production authorization | `NONE` |

Formal blockers:

- `LEGAL_GATE_NOT_APPROVED`
- `FORMAL_GATE_3_NOT_PASSED`
- `FORMAL_GATE_8_NOT_PASSED`
- `PRODUCTION_PAYMENT_PROVIDER_NOT_SELECTED`
- `TAX_AND_ACCOUNTING_POLICY_NOT_APPROVED`

No Migration, deployment, real payment, public Campaign or production Credit grant was performed.
