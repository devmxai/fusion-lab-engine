// @vitest-environment node

import { describe, expect, it } from "vitest";
import { LocalPaymentSandboxAdapter } from "../../../../packages/commerce/src/local-payment-adapter.ts";
import { signPaymentWebhook } from "../../../../packages/commerce/src/payment-webhook.ts";
import { LocalCommerceService, type CommerceCreditGateway } from "./service.ts";

const now = new Date("2026-08-13T12:00:00.000Z");
const secret = "fusionlab-local-payment-webhook-secret";

class ConsumedCreditGateway implements CommerceCreditGateway {
  reversalCalls = 0;
  grantPurchasedCredits(input: { paymentEventId: string }) { return { lot: { id: `payment-lot:${input.paymentEventId}` } }; }
  grantSubscriptionCredits(input: { paymentEventId: string }) { return { lot: { id: `subscription-lot:${input.paymentEventId}` } }; }
  expireSubscriptionLots() { return { expiredLotIds: [] }; }
  commerceLedgerEvidence() { return { lots: [], journals: [] }; }
  reverseCreditLot() {
    this.reversalCalls += 1;
    return {
      withdrawnCredits: 25n,
      lot: { granted: 100n, available: 0n, held: 0n, consumed: 75n, expired: 0n, withdrawn: 25n },
    };
  }
}

function signed(service: LocalCommerceService, event: object, deliveryId: string) {
  const rawBody = Buffer.from(JSON.stringify(event));
  const timestamp = String(Math.floor(now.getTime() / 1000));
  return service.processWebhook({
    rawBody,
    deliveryId,
    timestamp,
    signature: signPaymentWebhook({ rawBody, timestamp, secret }),
  });
}

describe("Commerce refund risk accounting", () => {
  it("withdraws only unused Credits and opens a non-negative receivable for consumed value", async () => {
    const gateway = new ConsumedCreditGateway();
    const service = new LocalCommerceService({
      paymentAdapter: new LocalPaymentSandboxAdapter(),
      webhookSecret: secret,
      creditGateway: gateway,
      now: () => now,
    });
    const checkout = await service.createCheckout({ userId: "local-user", productId: "local-credit-pack-100-v1", idempotencyKey: "consumed-refund-checkout" });
    signed(service, {
      schemaVersion: 1, eventId: "consumed-original-payment", type: "PAYMENT_SUCCEEDED",
      checkoutId: checkout.id, providerPaymentId: "consumed-provider-payment",
      money: { amountMinor: "1000", currency: "USD", feeMinor: "30" }, occurredAt: now.toISOString(),
    }, "consumed-payment-delivery");
    const reversalEvent = signed(service, {
      schemaVersion: 1, eventId: "consumed-refund-event", type: "PAYMENT_REFUNDED",
      originalPaymentEventId: "consumed-original-payment", providerReversalId: "consumed-provider-refund",
      money: { amountMinor: "1000", currency: "USD", feeMinor: "0" },
      reasonCode: "CUSTOMER_FULL_REFUND", occurredAt: now.toISOString(),
    }, "consumed-refund-delivery");
    if (!("reversalId" in reversalEvent.event)) throw new Error("expected_reversal_event");
    const reversal = service.financialReversal(reversalEvent.event.reversalId);
    expect(reversal).toMatchObject({
      withdrawnCredits: 25,
      unrecoveredCredits: 75,
      receivableState: "OPEN",
      unrecoveredEconomicValue: { numeratorMicrousd: "727500000", denominatorCredits: "100" },
    });
    expect(gateway.reversalCalls).toBe(1);
    expect(service.invoice("invoice:consumed-original-payment").status).toBe("REFUNDED");
  });
});
