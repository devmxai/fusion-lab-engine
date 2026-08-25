# REFUND-001 — Invoices and Financial Reversals

## Economic Invoice

Every accepted paid event creates an immutable local Invoice with:

- original payment amount in provider minor units and ISO currency;
- original payment fee, preserved even after a reversal;
- Product Version and optional pinned Plan Version;
- whole Credits granted and exact Credit Lot identity;
- net economic value in integer microusd;
- rational economic value allocation across all granted Credits.

For the USD sandbox only:

```text
net_economic_value_microusd = (amount_minor - payment_fee_minor) × 10,000
per_credit_value = net_economic_value_microusd / granted_credits
```

The denominator remains stored. Profit reporting cannot assume breakage or allocate value only to consumed Credits.

## Reversal policy

The Stage 12.3 local policy supports an exact full Refund or Chargeback only. It does not pretend to resolve production legal rules for partial refunds, tax, FX, fees or consumed service value.

```text
signed reversal event
→ unique event/delivery
→ original paid event + Invoice
→ exact amount/currency match
→ one exact-Lot WITHDRAW_LOT journal
→ Invoice terminal status
→ optional Receivable / Fraud Review
```

## Non-negative Wallet rule

The Ledger withdraws only the original Lot's available remainder. Credits already consumed, held, expired or withdrawn are never removed from unrelated Lots and never make the Wallet negative.

```text
unrecovered_credits = originally_granted - withdrawn_available
unrecovered_value = net_economic_value × unrecovered_credits / originally_granted
```

If `unrecovered_credits > 0`, the reversal records `receivableState=OPEN`. Chargeback always records `fraudReviewState=OPEN`; automated suspension remains outside this local slice and requires an approved server policy.

## Evidence retention

The original payment event, Invoice, Credit Lot grant and all Journals remain queryable after reversal. A second terminal reversal is rejected. Delivery/event replay returns prior evidence without another Ledger command.

## Boundary

These are local in-memory records and a test policy. They are not tax invoices, accounting books, legal refund terms, payment-processor settlement evidence or production chargeback handling.
