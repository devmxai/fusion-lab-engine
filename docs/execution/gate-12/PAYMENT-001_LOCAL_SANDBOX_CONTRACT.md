# PAYMENT-001 — Local Payment Sandbox Contract

## Authority and scope

This contract implements the local Stage 12.1 slice of `FL-PMP-001 §26.1`. It is deliberately provider-neutral and local-only. The Legal Gate and formal Gates 3 and 8 remain prerequisites for any production use.

## Trusted flow

```text
Engine product snapshot
→ server-created Checkout + idempotency binding
→ Payment Sandbox For Test session
→ exact raw-body signed Webhook
→ timestamp + signature + delivery/event dedupe
→ checkout amount/currency match
→ unique payment event
→ PURCHASED Credit Lot in the shared ledger
```

The Success URL is outside the mutation chain. It can display `CREATED` or `PAID`, but always returns `mutationPerformed: false` and cannot grant Credits.

## Local endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/dev/commerce/catalog` | Published local sandbox product snapshots |
| `POST` | `/v1/dev/commerce/checkouts` | Server-side idempotent Checkout creation |
| `GET` | `/v1/dev/commerce/checkouts/{id}/success` | Read-only return status; never a grant command |
| `POST` | `/v1/dev/commerce/webhooks/provider-for-test` | Exact raw-body signed payment ingress |
| `GET` | `/v1/dev/commerce/payment-events/{id}` | Processed event evidence |

Webhook headers are `x-payment-delivery-id`, `x-payment-timestamp` and `x-payment-signature`. The signature format is `v1=hex(HMAC_SHA256(secret, timestamp + "." + raw_body))` with a 300-second absolute window.

## Invariants

1. Money, currency and granted Credits come only from the immutable server product snapshot.
2. One user-scoped idempotency key maps to one exact Checkout request.
3. One payment event creates at most one Credit Lot.
4. Delivery replay and event replay return prior evidence without a second Ledger command.
5. Same delivery/event identity with different raw bytes is a conflict, not an update.
6. Signed amount/currency must equal the Checkout snapshot before any grant.
7. Payment fee is preserved and cannot exceed original payment amount.
8. Success/cancel browser navigation is never financial authority.
9. The purchased Lot uses the same ledger as generation reservations; no shadow wallet is introduced.
10. No sandbox result is production, legal, tax, accounting or deployment evidence.
