// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { signPaymentWebhook } from "../../../../packages/commerce/src/payment-webhook.ts";
import { buildEngineApp } from "../app.ts";
import { loadLocalEngineConfig } from "../config.ts";
import { createFakeProviderRegistry } from "../test/fake-provider-adapter.ts";

const now = new Date("2026-08-13T12:00:00.000Z");
const webhookSecret = "fusionlab-local-payment-webhook-secret";
const apps: ReturnType<typeof buildEngineApp>[] = [];

async function responseJson(response: Response) {
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
}

function webhookHeaders(rawBody: string, deliveryId: string) {
  const timestamp = String(Math.floor(now.getTime() / 1000));
  return {
    "content-type": "application/json",
    "x-payment-delivery-id": deliveryId,
    "x-payment-timestamp": timestamp,
    "x-payment-signature": signPaymentWebhook({ rawBody: Buffer.from(rawBody), timestamp, secret: webhookSecret }),
  };
}

describe("Commerce sandbox over a real HTTP socket", () => {
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it("reconciles checkout, signed payment, replay, promoted generation, settlement and refund end-to-end", async () => {
    const app = buildEngineApp({
      config: loadLocalEngineConfig({
        NODE_ENV: "test",
        ENGINE_MODE: "local",
        ENGINE_LOG_LEVEL: "silent",
        TEST_PAYMENT_WEBHOOK_SECRET: webhookSecret,
      }),
      providerRegistry: createFakeProviderRegistry(),
      now: () => now,
    });
    apps.push(app);
    const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });

    const checkout = await responseJson(await fetch(`${baseUrl}/v1/dev/commerce/checkouts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "http-e2e-user",
        productId: "local-credit-pack-100-v1",
        idempotencyKey: "http-e2e-checkout-001",
      }),
    }));
    expect(checkout.status).toBe(201);

    const successBefore = await responseJson(await fetch(`${baseUrl}${checkout.body.successUrl}`));
    const successReplay = await responseJson(await fetch(`${baseUrl}${checkout.body.successUrl}`));
    expect(successBefore.body).toMatchObject({ state: "CREATED", mutationPerformed: false });
    expect(successReplay.body).toEqual(successBefore.body);

    const paymentBody = JSON.stringify({
      schemaVersion: 1,
      eventId: "http-e2e-payment-001",
      type: "PAYMENT_SUCCEEDED",
      checkoutId: checkout.body.id,
      providerPaymentId: "http-e2e-provider-payment-001",
      money: { amountMinor: "1000", currency: "USD", feeMinor: "30" },
      occurredAt: now.toISOString(),
    });
    const payment = await responseJson(await fetch(`${baseUrl}/v1/dev/commerce/webhooks/provider-for-test`, {
      method: "POST",
      headers: webhookHeaders(paymentBody, "http-e2e-payment-delivery-001"),
      body: paymentBody,
    }));
    const paymentReplay = await responseJson(await fetch(`${baseUrl}/v1/dev/commerce/webhooks/provider-for-test`, {
      method: "POST",
      headers: webhookHeaders(paymentBody, "http-e2e-payment-delivery-002"),
      body: paymentBody,
    }));
    expect(payment).toMatchObject({ status: 202, body: { accepted: true, duplicateEvent: false } });
    expect(paymentReplay).toMatchObject({ status: 200, body: { duplicateEvent: true } });
    const paidWallet = await responseJson(await fetch(`${baseUrl}/v1/dev/mock/wallets/http-e2e-user`));
    expect(paidWallet.body.customerCredits.available).toBe(1100);

    const quote = await responseJson(await fetch(`${baseUrl}/v1/dev/mock/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "http-e2e-user",
        modelId: "local/test-video-v1",
        durationSeconds: 10,
        promotionCode: "LOCAL50",
      }),
    }));
    expect(quote).toMatchObject({
      status: 201,
      body: { baseCustomerCredits: 40, discountCredits: 20, customerCredits: 20, promotion: { status: "RESERVED", subsidyMicrousd: "66667" } },
    });
    const createdOperation = await responseJson(await fetch(`${baseUrl}/v1/dev/mock/operations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "http-e2e-user",
        quoteId: quote.body.id,
        idempotencyKey: "http-e2e-operation-001",
        scenario: "success",
      }),
    }));
    expect(createdOperation.status).toBe(202);
    let operation = createdOperation.body;
    for (let index = 0; index < 6; index += 1) {
      const advanced = await responseJson(await fetch(`${baseUrl}/v1/dev/mock/operations/${operation.id}/advance`, { method: "POST" }));
      expect(advanced.status).toBe(200);
      operation = advanced.body;
    }
    expect(operation).toMatchObject({
      state: "SETTLED",
      financials: { customerChargedCredits: 20, providerChargedCredits: 20 },
      promotion: { status: "REDEEMED", subsidyMicrousd: "66667" },
    });

    const refundBody = JSON.stringify({
      schemaVersion: 1,
      eventId: "http-e2e-refund-001",
      type: "PAYMENT_REFUNDED",
      originalPaymentEventId: "http-e2e-payment-001",
      providerReversalId: "http-e2e-provider-refund-001",
      money: { amountMinor: "1000", currency: "USD", feeMinor: "0" },
      reasonCode: "CUSTOMER_FULL_REFUND",
      occurredAt: now.toISOString(),
    });
    const refund = await responseJson(await fetch(`${baseUrl}/v1/dev/commerce/webhooks/provider-for-test`, {
      method: "POST",
      headers: webhookHeaders(refundBody, "http-e2e-refund-delivery-001"),
      body: refundBody,
    }));
    expect(refund.status).toBe(202);
    const finalWallet = await responseJson(await fetch(`${baseUrl}/v1/dev/mock/wallets/http-e2e-user`));
    expect(finalWallet.body.customerCredits).toMatchObject({ available: 980, held: 0, spent: 20 });

    const reconciliation = await responseJson(await fetch(`${baseUrl}/v1/dev/commerce/reconciliation`));
    expect(reconciliation).toMatchObject({
      status: 200,
      body: {
        counts: {
          paidEvents: 1,
          reversalEvents: 1,
          invoices: 1,
          financialReversals: 1,
          commerceCreditLots: 1,
          commerceLedgerJournals: 2,
          promotionCampaigns: 1,
          promotionSubsidyEntries: 2,
        },
        financials: {
          paidNetEconomicValueMicrousd: "9700000",
          reversedNetEconomicValueMicrousd: "9700000",
          promotionRedeemedMicrousd: "66667",
        },
        issues: [],
        reconciliationRateBps: 10_000,
        targetMet: true,
        localImplementationDecision: "PASS",
        formalGateDecision: "HOLD",
        localOnly: true,
      },
    });
  });
});
