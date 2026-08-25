# PLAN-001 — Immutable Plans and Subscriptions

## Contract

A Plan is never a mutable row interpreted at runtime. Every commercial change creates a new `PlanVersion`. A Subscription stores one exact `planVersionId`, so later publication cannot rewrite the subscriber's Credits, price, limits, eligibility, retention or Terms history.

Each published version snapshots:

- original minor-unit price, ISO currency and billing interval;
- whole Credits per period and `PERIOD_END` Credit expiry;
- concurrency, queue, storage and retention limits;
- eligible features, models and profiles;
- grace and cancellation policy;
- Terms Version, effective time and publication time.

## Initial activation

```text
signed PAYMENT_SUCCEEDED
→ immutable Checkout/Product/Plan match
→ exact billing period required
→ Subscription pinned to Plan Version
→ one expiring SUBSCRIPTION Credit Lot
→ one SubscriptionPeriod evidence record
```

## Renewal

```text
signed SUBSCRIPTION_RENEWED
→ unique delivery/event
→ active Subscription lookup
→ pinned Plan Version equality
→ exact amount/currency
→ next period starts at current period end
→ one new SUBSCRIPTION Lot
→ advance current period
```

Grace never grants additional Credits. A different Plan Version or a skipped/overlapping period is rejected rather than silently normalized.

## Expiry invariant

Expiry receives server time and only the Subscription's known Lot IDs. The Ledger validates that every target has source `SUBSCRIPTION`; Purchased, promotion, admin and legacy Lots cannot be targeted by this command. Available Subscription Credits expire through a balanced Journal. Purchased Credits survive subscription expiry.

Held Subscription Credits belonging to an in-flight operation remain governed by reservation settlement/release. A later expiry sweep is required after the hold closes; expiry never rewrites an existing reservation.

## Local-only boundary

The registry, subscriptions and periods are in-memory reference adapters. There is no production scheduler, durable Inbox, database uniqueness, payment provider, tax calculation, customer invoice, legal approval or deployment evidence.
