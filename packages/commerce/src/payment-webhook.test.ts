import { describe, expect, it } from "vitest";
import { parseVerifiedPaymentWebhook, signPaymentWebhook, verifyPaymentWebhook } from "./payment-webhook.ts";

const secret = "local-payment-webhook-secret-only";
const timestamp = "1786593600";
const rawBody = Buffer.from(JSON.stringify({
  schemaVersion: 1,
  eventId: "payment-event-001",
  type: "PAYMENT_SUCCEEDED",
  checkoutId: "550e8400-e29b-41d4-a716-446655440000",
  providerPaymentId: "provider-payment-001",
  money: { amountMinor: "1000", currency: "USD", feeMinor: "30" },
  occurredAt: "2026-08-13T09:20:00.000Z",
}));

describe("payment raw-body webhook contract", () => {
  it("verifies the exact raw bytes and parses a strict payment event", () => {
    const signature = signPaymentWebhook({ rawBody, timestamp, secret });
    expect(verifyPaymentWebhook({ rawBody, timestamp, signature, secret, nowEpochSeconds: Number(timestamp) })).toBe(true);
    expect(parseVerifiedPaymentWebhook({ rawBody, timestamp, signature, secret, nowEpochSeconds: Number(timestamp) }))
      .toMatchObject({ eventId: "payment-event-001", money: { amountMinor: "1000", currency: "USD" } });
  });

  it("rejects byte changes, wrong secrets and stale timestamps", () => {
    const signature = signPaymentWebhook({ rawBody, timestamp, secret });
    expect(verifyPaymentWebhook({ rawBody: Buffer.concat([rawBody, Buffer.from(" ")]), timestamp, signature, secret, nowEpochSeconds: Number(timestamp) })).toBe(false);
    expect(verifyPaymentWebhook({ rawBody, timestamp, signature, secret: `${secret}-wrong`, nowEpochSeconds: Number(timestamp) })).toBe(false);
    expect(verifyPaymentWebhook({ rawBody, timestamp, signature, secret, nowEpochSeconds: Number(timestamp) + 301 })).toBe(false);
  });
});
