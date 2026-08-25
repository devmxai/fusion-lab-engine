# Gate 12 — Payments, Plans and Promotions

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Status | `LOCAL IMPLEMENTATION COMPLETE — FORMAL GATE HOLD` |
| Gate decision | `NOT EVALUATED / FORMAL HOLD` |
| Payment provider | `Payment Sandbox For Test only` |
| Production / migration / deploy | `NONE` |
| Dependency note | `Legal Gate and formal Gates 3 and 8 are not passed` |

## Stage breakdown

| Stage | Scope | Status |
|---|---|---|
| `12.1` | Payment adapter, server checkout, signed raw-body webhook and replay safety | `COMPLETE LOCALLY` |
| `12.2` | Immutable Plan/Subscription versions and Credit Lot renewal semantics | `COMPLETE LOCALLY` |
| `12.3` | Refunds, chargebacks, invoices and economic-value records | `COMPLETE LOCALLY` |
| `12.4` | Promotion budgets, eligibility, stacking and fraud controls | `COMPLETE LOCALLY` |
| `12.5` | Sandbox E2E, reconciliation and Gate decision | `COMPLETE LOCALLY / FORMAL HOLD` |

## Stage 12.1 evidence

- Payment access is behind a provider-neutral `PaymentAdapter`; the active adapter is explicitly `payment-sandbox-for-test`.
- Checkout is created by the Engine from a versioned server-side product snapshot. The client cannot set money, currency or granted Credits.
- Checkout idempotency is scoped to the user and rejects reuse with a different request.
- The Success URL returns a read-only status with `mutationPerformed: false`; repeated visits grant zero Credits.
- Payment ingress verifies HMAC-SHA256 over the exact raw body and timestamp, with a five-minute absolute replay window.
- Signed payload is strict and pins unique event ID, checkout ID, provider payment ID, original amount/currency, fee and occurrence time.
- Forged/stale signatures, amount/currency mismatch, excessive fee, delivery conflict and event conflict fail closed.
- Same delivery replay and same event through a new delivery never duplicate the grant.
- Only a verified matching event creates one `PURCHASED` Credit Lot in the same whole-credit ledger used by generation operations.
- Local reset clears Commerce Inbox state and the shared local wallet together.
- Full verification passed: TypeScript, `180/180` Vitest tests, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Stage 12.2 evidence

- `InMemoryPlanRegistry` validates and deep-freezes every published Plan Version. IDs and `planKey + version` sequences cannot be overwritten.
- Each Plan Version snapshots price/currency/interval, Credits, expiry, concurrency, queue, storage, retention, eligible features/models/profiles, renewal/grace/cancellation and Terms Version.
- The local Subscription product points to one exact Plan Version; Checkout money and granted Credits must agree with that version.
- Initial Subscription payment requires a signed exact billing period and creates one `SUBSCRIPTION` Lot expiring at period end.
- Subscriber state pins `planVersionId`; publishing another version cannot silently modify existing commercial terms.
- Renewal Webhook must use the pinned version and continue exactly from the current period end. Plan drift and out-of-order periods fail closed.
- Replaying the renewal event through the same or a different delivery never creates a second period or Credit Lot.
- Subscription expiry is server-time evaluated and expires only eligible Subscription Lots. Purchased Credits and their Lot remain untouched.
- Live local HTTP evidence: initial period changed the wallet `1000 → 1200`; renewal changed it `1200 → 1400`; the Subscription retained `local-plan-pro-v1`, `local-terms-v1` and exactly two periods.
- Full verification passed: TypeScript, `188/188` Vitest tests, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Stage 12.3 evidence

- Every accepted payment or renewal creates an immutable Invoice snapshot with original minor-unit amount, ISO currency, payment fee, Product/Plan versions and granted Credits.
- USD sandbox net economic value is recorded in integer microusd after the payment fee. Per-credit value remains a rational `numeratorMicrousd / denominatorCredits`, so rounding is deferred rather than lost.
- Refund and Chargeback arrive through the same exact raw-body signature, timestamp, delivery and event dedupe boundary as payments.
- Local policy accepts only a full reversal matching the original Invoice amount/currency. Partial, wrong-currency, nonzero reversal fee and second terminal reversal fail closed.
- A reversal appends a `WITHDRAW_LOT` compensating Journal against the exact original Lot; it never deletes the payment, Invoice, original grant or prior journals.
- Only available Credits are withdrawn. Consumed/held/expired shortfall does not make the Wallet negative; it becomes an explicit open Receivable with rational unrecovered economic value.
- Chargeback additionally opens Fraud Review. Refund does not silently suspend the account or invent a fraud decision.
- Live local HTTP evidence: paid wallet `1000 → 1100`, verified Refund `1100 → 1000`, Invoice status `REFUNDED`, net economic value `9,700,000 microusd`, withdrawn Credits `100`, Receivable `NONE`.
- A separate consumed-credit fixture proved `25` unused Credits withdrawn, `75` unrecovered Credits and open Receivable value `(9,700,000 × 75) / 100` without a negative Wallet.
- Full verification passed: TypeScript, `193/193` Vitest tests, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Stage 12.4 evidence

- Every Campaign is a validated, deep-frozen immutable Promotion Version with an active window, exact code, attribution, stop conditions and independent maker plus two-approver publication evidence.
- The active local Campaign has separate Whole-Credit and microusd budgets. A Quote reserves both atomically inside the Promotion engine; insufficient budget fails closed rather than silently applying an unfunded discount.
- Eligibility is evaluated server-side against the internally selected Product, certified Route and server-derived Cohort. The client cannot declare its own eligible Route or Cohort.
- Per-user/global caps, UTC-day velocity, blocked-user fraud rules, exclusive/allowlisted stacking and Campaign kill switch all fail closed with stable reason codes. Public Campaign views do not expose the blocked-user rules.
- Hard-floor subsidy uses exact integer rational arithmetic: `ceil(conservative cost × 10000 / (10000 − hard-floor bps)) − post-discount economic value`, floored at zero.
- A Promotion reservation is pinned into the Quote request hash. Operation creation attaches it; only successful customer settlement redeems it. Quote expiry or a no-charge Provider/Delivery failure releases both budgets.
- Every budget movement appends an immutable `RESERVE`, `REDEEM` or `RELEASE` Subsidy Entry. Current budget projections can therefore be reconstructed and reconciled from evidence.
- Live Engine integration fixture: a 40-Credit Video Quote with `LOCAL50` became 20 customer Credits, reserved `20 Credits + 66,667 microusd`, and moved them to redeemed only after verified settlement.
- Failure fixture: the same reservation was fully released after confirmed Provider failure, customer charge remained zero, and both reserved/redeemed budget projections returned to zero.
- Full verification passed: TypeScript, `200/200` Vitest tests, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

## Stage 12.5 evidence and decision

- `GET /v1/dev/commerce/reconciliation` reconstructs the Commerce chain across paid/reversal Events, Invoices, exact Credit Lots, balanced grant/withdrawal Journals, Promotion budgets and append-only Subsidy Entries.
- The report checks Event↔Invoice, Event↔Lot, grant Journal, reversal↔Invoice terminal state, Credit conservation, exact-Lot withdrawal evidence and Promotion projection reconstruction.
- It reports paid/reversed net economic value, exact rational open Receivable value and redeemed Promotion subsidy without floating-point aggregation.
- A real-socket HTTP E2E starts the Engine on an ephemeral loopback port and proves Checkout → read-only Success URL → signed Payment → replay dedupe → funded Promo Quote → Operation → Provider For Test → settlement → Refund → final reconciliation.
- The real HTTP test discovered and fixed a clock-consistency defect: Commerce, Promotion, Quote and Local Provider now receive one server clock, preventing false Quote/Promotion expiry disagreement.
- Final real-socket evidence: wallet `1000 → 1100 → 1080 → 980`; the operation charged `20` site Credits while Provider For Test charged `20`; Refund withdrew the untouched `100`-Credit purchase Lot; reconciliation returned no issues and `10,000 bps`.
- There is no customer-facing Commerce UI in this local API slice, so no new Commerce a11y surface is claimed. Existing desktop/mobile Creative Space surfaces still pass Axe WCAG A/AA in the `6/6` Chromium suite.
- Full verification passed: TypeScript, `202/202` Vitest tests across `33` files, Engine build, Provider Test build, Vite build and `6/6` Chromium E2E tests.

### Decision

- Local implementation decision: `PASS`.
- Formal Gate 12 decision: `HOLD`.
- Formal blockers: Legal approval, formal Gates 3 and 8, production payment-provider selection, and approved tax/accounting policy.
- This decision authorizes no Migration, Production deploy, real payment, public Campaign or production Credit grant.

## Boundary

This is a local architecture and sandbox test, not a payment launch. Product price `local-credit-pack-100-v1` is test data and is not a commercial offer. No legal/tax approval, real payment provider, public webhook receiver, invoice, refund policy, migration, deployment or production grant exists.

- [PAYMENT-001 local sandbox contract](./PAYMENT-001_LOCAL_SANDBOX_CONTRACT.md)
- [PLAN-001 immutable plans and subscriptions](./PLAN-001_IMMUTABLE_PLANS_SUBSCRIPTIONS.md)
- [REFUND-001 invoices and financial reversals](./REFUND-001_INVOICES_REVERSALS.md)
- [PROMO-001 promotion budgets and controls](./PROMO-001_BUDGETS_ELIGIBILITY_CONTROLS.md)
- [RECON-001 Commerce reconciliation and Gate decision](./RECON-001_COMMERCE_RECONCILIATION_GATE_DECISION.md)
