// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { signPaymentWebhook } from "../../../../packages/commerce/src/payment-webhook.ts";
import { buildEngineApp } from "../app.ts";
import { loadLocalEngineConfig } from "../config.ts";
import { createFakeProviderRegistry } from "../test/fake-provider-adapter.ts";

const apps: ReturnType<typeof buildEngineApp>[] = [];
const now = new Date("2026-08-13T12:00:00.000Z");
const webhookSecret = "fusionlab-local-payment-webhook-secret";

function createApp(nowProvider: () => Date = () => now) {
  const app = buildEngineApp({
    config: loadLocalEngineConfig({
      NODE_ENV: "test",
      ENGINE_MODE: "local",
      ENGINE_LOG_LEVEL: "silent",
      TEST_PAYMENT_WEBHOOK_SECRET: webhookSecret,
    }),
    providerRegistry: createFakeProviderRegistry(),
    now: nowProvider,
  });
  apps.push(app);
  return app;
}

async function checkout(app: ReturnType<typeof buildEngineApp>, key = "checkout-key-001", productId = "local-credit-pack-100-v1") {
  const response = await app.inject({
    method: "POST",
    url: "/v1/dev/commerce/checkouts",
    headers: { "content-type": "application/json" },
    payload: Buffer.from(JSON.stringify({ userId: "local-user", productId, idempotencyKey: key })),
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

function paymentBody(checkoutId: string, patch: Record<string, unknown> = {}) {
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    eventId: "payment-event-001",
    type: "PAYMENT_SUCCEEDED",
    checkoutId,
    providerPaymentId: "provider-payment-001",
    money: { amountMinor: "1000", currency: "USD", feeMinor: "30" },
    occurredAt: now.toISOString(),
    ...patch,
  }));
}

function renewalBody(subscriptionId: string, patch: Record<string, unknown> = {}) {
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    eventId: "subscription-renewal-event-002",
    type: "SUBSCRIPTION_RENEWED",
    subscriptionId,
    planVersionId: "local-plan-pro-v1",
    providerPaymentId: "provider-renewal-payment-002",
    money: { amountMinor: "1500", currency: "USD", feeMinor: "45" },
    billingPeriod: { start: "2026-09-13T00:00:00.000Z", end: "2026-10-13T00:00:00.000Z" },
    occurredAt: now.toISOString(),
    ...patch,
  }));
}

function reversalBody(originalPaymentEventId: string, type: "PAYMENT_REFUNDED" | "PAYMENT_CHARGEBACK" = "PAYMENT_REFUNDED", patch: Record<string, unknown> = {}) {
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    eventId: type === "PAYMENT_REFUNDED" ? "payment-refund-event-001" : "payment-chargeback-event-001",
    type,
    originalPaymentEventId,
    providerReversalId: type === "PAYMENT_REFUNDED" ? "provider-refund-001" : "provider-chargeback-001",
    money: { amountMinor: "1000", currency: "USD", feeMinor: "0" },
    reasonCode: type === "PAYMENT_REFUNDED" ? "CUSTOMER_FULL_REFUND" : "CARDHOLDER_DISPUTE",
    occurredAt: now.toISOString(),
    ...patch,
  }));
}

function signedHeaders(rawBody: Buffer, deliveryId = "payment-delivery-001", timestamp = String(Math.floor(now.getTime() / 1000))) {
  return {
    "content-type": "application/json",
    "x-payment-delivery-id": deliveryId,
    "x-payment-timestamp": timestamp,
    "x-payment-signature": signPaymentWebhook({ rawBody, timestamp, secret: webhookSecret }),
  };
}

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("local payment sandbox API", () => {
  it("keeps the formal Gate on HOLD while an empty local ledger reconciles exactly", async () => {
    const response = await createApp().inject({ method: "GET", url: "/v1/dev/commerce/reconciliation" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      issues: [],
      reconciliationRateBps: 10_000,
      targetMet: true,
      localImplementationDecision: "PASS",
      formalGateDecision: "HOLD",
      formalBlockers: expect.arrayContaining(["LEGAL_GATE_NOT_APPROVED", "FORMAL_GATE_3_NOT_PASSED", "FORMAL_GATE_8_NOT_PASSED"]),
      localOnly: true,
    });
  });

  it("publishes an explicitly local-only versioned product snapshot", async () => {
    const response = await createApp().inject({ method: "GET", url: "/v1/dev/commerce/catalog" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "payment-sandbox-for-test",
      sandboxOnly: true,
      products: [
        { id: "local-credit-pack-100-v1", version: 1, grantedCredits: 100, amountMinor: "1000", currency: "USD" },
        { id: "local-subscription-pro-monthly-v1", version: 1, grantedCredits: 200, planVersionId: "local-plan-pro-v1" },
      ],
      plans: [{ id: "local-plan-pro-v1", version: 1, creditsPerPeriod: 200, termsVersion: "local-terms-v1" }],
    });
  });

  it("creates checkout server-side and enforces request idempotency", async () => {
    const app = createApp();
    const first = await checkout(app);
    const replay = await checkout(app);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ state: "CREATED", provider: "payment-sandbox-for-test", paymentEventId: null });

    const conflict = await app.inject({
      method: "POST",
      url: "/v1/dev/commerce/checkouts",
      headers: { "content-type": "application/json" },
      payload: Buffer.from(JSON.stringify({ userId: "another-user", productId: "local-credit-pack-100-v1", idempotencyKey: "checkout-key-001" })),
    });
    expect(conflict.statusCode).toBe(201);
    expect(conflict.json().id).not.toBe(first.id);

    const sameUserConflict = await app.inject({
      method: "POST",
      url: "/v1/dev/commerce/checkouts",
      headers: { "content-type": "application/json" },
      payload: Buffer.from(JSON.stringify({ userId: "local-user", productId: "unknown-product", idempotencyKey: "checkout-key-001" })),
    });
    expect(sameUserConflict.statusCode).toBe(409);
    expect(sameUserConflict.json().error.code).toBe("CHECKOUT_IDEMPOTENCY_CONFLICT");
  });

  it("proves the success URL is read-only and grants zero credits", async () => {
    const app = createApp();
    const created = await checkout(app);
    const before = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    const success = await app.inject({ method: "GET", url: created.successUrl });
    const repeated = await app.inject({ method: "GET", url: created.successUrl });
    const after = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(success.json()).toMatchObject({ state: "CREATED", creditGrantState: "AWAITING_VERIFIED_WEBHOOK", mutationPerformed: false });
    expect(repeated.json()).toEqual(success.json());
    expect(before.json().customerCredits).toEqual(after.json().customerCredits);
    expect(after.json().customerCredits.available).toBe(1000);
  });

  it("rejects forged and stale webhooks without granting credits", async () => {
    const app = createApp();
    const created = await checkout(app);
    const rawBody = paymentBody(created.id);
    const forged = await app.inject({
      method: "POST",
      url: "/v1/dev/commerce/webhooks/provider-for-test",
      headers: { ...signedHeaders(rawBody), "x-payment-signature": `v1=${"0".repeat(64)}` },
      payload: rawBody,
    });
    const staleTimestamp = String(Math.floor(now.getTime() / 1000) - 301);
    const stale = await app.inject({
      method: "POST",
      url: "/v1/dev/commerce/webhooks/provider-for-test",
      headers: signedHeaders(rawBody, "payment-delivery-stale", staleTimestamp),
      payload: rawBody,
    });
    expect(forged.statusCode).toBe(401);
    expect(stale.statusCode).toBe(401);
    const wallet = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(wallet.json().customerCredits.available).toBe(1000);
  });

  it("grants one purchased credit lot only after a verified matching webhook", async () => {
    const app = createApp();
    const created = await checkout(app);
    const rawBody = paymentBody(created.id);
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/dev/commerce/webhooks/provider-for-test",
      headers: signedHeaders(rawBody),
      payload: rawBody,
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toMatchObject({
      accepted: true,
      replay: false,
      duplicateEvent: false,
      event: { event: { eventId: "payment-event-001" }, creditLotId: "payment-lot:payment-event-001" },
    });
    const wallet = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(wallet.json().customerCredits.available).toBe(1100);
    const success = await app.inject({ method: "GET", url: created.successUrl });
    expect(success.json()).toMatchObject({ state: "PAID", creditGrantState: "GRANTED_BY_VERIFIED_WEBHOOK", mutationPerformed: false });
  });

  it("deduplicates delivery replay and the same event through a new delivery", async () => {
    const app = createApp();
    const created = await checkout(app);
    const rawBody = paymentBody(created.id);
    const first = await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(rawBody), payload: rawBody });
    const deliveryReplay = await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(rawBody), payload: rawBody });
    const eventReplay = await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(rawBody, "payment-delivery-002"), payload: rawBody });
    expect(first.statusCode).toBe(202);
    expect(deliveryReplay.json()).toMatchObject({ replay: true, duplicateEvent: true });
    expect(eventReplay.json()).toMatchObject({ replay: false, duplicateEvent: true });
    const wallet = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(wallet.json().customerCredits.available).toBe(1100);
  });

  it("fails closed when a delivery or event identity is reused with different signed bytes", async () => {
    const app = createApp();
    const created = await checkout(app);
    const original = paymentBody(created.id);
    await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(original), payload: original });

    const deliveryConflictBody = paymentBody(created.id, { eventId: "payment-event-002", providerPaymentId: "provider-payment-002" });
    const deliveryConflict = await app.inject({
      method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test",
      headers: signedHeaders(deliveryConflictBody), payload: deliveryConflictBody,
    });
    expect(deliveryConflict.statusCode).toBe(409);
    expect(deliveryConflict.json().error.code).toBe("PAYMENT_DELIVERY_CONFLICT");

    const eventConflictBody = paymentBody(created.id, { providerPaymentId: "provider-payment-conflict" });
    const eventConflict = await app.inject({
      method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test",
      headers: signedHeaders(eventConflictBody, "payment-delivery-003"), payload: eventConflictBody,
    });
    expect(eventConflict.statusCode).toBe(409);
    expect(eventConflict.json().error.code).toBe("PAYMENT_EVENT_CONFLICT");
    const wallet = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(wallet.json().customerCredits.available).toBe(1100);
  });

  it("rejects a signed amount mismatch without trusting provider data", async () => {
    const app = createApp();
    const created = await checkout(app);
    const rawBody = paymentBody(created.id, { money: { amountMinor: "999", currency: "USD", feeMinor: "30" } });
    const response = await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(rawBody), payload: rawBody });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("PAYMENT_AMOUNT_MISMATCH");
    const wallet = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(wallet.json().customerCredits.available).toBe(1000);
  });

  it("resets commerce inbox state and its shared local wallet together", async () => {
    const app = createApp();
    const created = await checkout(app);
    const rawBody = paymentBody(created.id);
    await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(rawBody), payload: rawBody });
    const paidWallet = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(paidWallet.json().customerCredits.available).toBe(1100);

    const reset = await app.inject({ method: "POST", url: "/v1/dev/mock/reset" });
    expect(reset.statusCode).toBe(204);
    const oldCheckout = await app.inject({ method: "GET", url: created.successUrl });
    expect(oldCheckout.statusCode).toBe(404);
    const resetWallet = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(resetWallet.json().customerCredits.available).toBe(1000);
  });

  it("activates a Subscription pinned to one immutable Plan Version and period Lot", async () => {
    const app = createApp();
    const created = await checkout(app, "subscription-checkout-001", "local-subscription-pro-monthly-v1");
    const rawBody = paymentBody(created.id, {
      money: { amountMinor: "1500", currency: "USD", feeMinor: "45" },
      billingPeriod: { start: "2026-08-13T00:00:00.000Z", end: "2026-09-13T00:00:00.000Z" },
    });
    const accepted = await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(rawBody), payload: rawBody });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().event).toMatchObject({
      creditLotId: "subscription-lot:payment-event-001",
      subscriptionId: `subscription:${created.id}`,
    });
    const subscription = await app.inject({ method: "GET", url: `/v1/dev/commerce/subscriptions/subscription:${created.id}` });
    expect(subscription.json()).toMatchObject({
      state: "ACTIVE",
      planVersionId: "local-plan-pro-v1",
      currentPeriodEnd: "2026-09-13T00:00:00.000Z",
      plan: { version: 1, creditsPerPeriod: 200, termsVersion: "local-terms-v1" },
      periods: [{ creditLotId: "subscription-lot:payment-event-001" }],
    });
    const wallet = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(wallet.json().customerCredits.available).toBe(1200);
  });

  it("renews the pinned version exactly once and rejects plan drift or out-of-order periods", async () => {
    const app = createApp();
    const created = await checkout(app, "subscription-checkout-002", "local-subscription-pro-monthly-v1");
    const initial = paymentBody(created.id, {
      money: { amountMinor: "1500", currency: "USD", feeMinor: "45" },
      billingPeriod: { start: "2026-08-13T00:00:00.000Z", end: "2026-09-13T00:00:00.000Z" },
    });
    await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(initial), payload: initial });
    const subscriptionId = `subscription:${created.id}`;
    const renewal = renewalBody(subscriptionId);
    const accepted = await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(renewal, "subscription-delivery-002"), payload: renewal });
    const replay = await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(renewal, "subscription-delivery-003"), payload: renewal });
    expect(accepted.statusCode).toBe(202);
    expect(replay.json()).toMatchObject({ duplicateEvent: true });
    const subscription = await app.inject({ method: "GET", url: `/v1/dev/commerce/subscriptions/${subscriptionId}` });
    expect(subscription.json()).toMatchObject({ planVersionId: "local-plan-pro-v1", currentPeriodEnd: "2026-10-13T00:00:00.000Z" });
    expect(subscription.json().periods).toHaveLength(2);
    const wallet = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(wallet.json().customerCredits.available).toBe(1400);

    const planDrift = renewalBody(subscriptionId, { eventId: "subscription-renewal-event-003", planVersionId: "local-plan-pro-v2" });
    const driftResponse = await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(planDrift, "subscription-delivery-004"), payload: planDrift });
    expect(driftResponse.statusCode).toBe(409);
    expect(driftResponse.json().error.code).toBe("PLAN_VERSION_MISMATCH");

    const outOfOrder = renewalBody(subscriptionId, {
      eventId: "subscription-renewal-event-004",
      billingPeriod: { start: "2026-12-13T00:00:00.000Z", end: "2027-01-13T00:00:00.000Z" },
    });
    const orderResponse = await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(outOfOrder, "subscription-delivery-005"), payload: outOfOrder });
    expect(orderResponse.statusCode).toBe(409);
    expect(orderResponse.json().error.code).toBe("OUT_OF_ORDER_SUBSCRIPTION_PERIOD");
  });

  it("requires a billing period before initial Subscription credits can be granted", async () => {
    const app = createApp();
    const created = await checkout(app, "subscription-checkout-003", "local-subscription-pro-monthly-v1");
    const rawBody = paymentBody(created.id, { money: { amountMinor: "1500", currency: "USD", feeMinor: "45" } });
    const response = await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(rawBody), payload: rawBody });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("SUBSCRIPTION_PERIOD_REQUIRED");
    const wallet = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(wallet.json().customerCredits.available).toBe(1000);
  });

  it("expires only Subscription Lots while purchased Credits survive", async () => {
    let current = new Date("2026-08-13T12:00:00.000Z");
    const app = createApp(() => current);
    const purchase = await checkout(app, "expiry-purchase-checkout", "local-credit-pack-100-v1");
    const purchaseBody = paymentBody(purchase.id, { eventId: "expiry-purchase-event", providerPaymentId: "expiry-purchase-payment" });
    await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(purchaseBody, "expiry-purchase-delivery"), payload: purchaseBody });

    const subscriptionCheckout = await checkout(app, "expiry-subscription-checkout", "local-subscription-pro-monthly-v1");
    const subscriptionBody = paymentBody(subscriptionCheckout.id, {
      eventId: "expiry-subscription-event",
      providerPaymentId: "expiry-subscription-payment",
      money: { amountMinor: "1500", currency: "USD", feeMinor: "45" },
      billingPeriod: { start: "2026-08-13T00:00:00.000Z", end: "2026-09-13T00:00:00.000Z" },
    });
    await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(subscriptionBody, "expiry-subscription-delivery"), payload: subscriptionBody });
    const subscriptionId = `subscription:${subscriptionCheckout.id}`;
    const early = await app.inject({ method: "POST", url: `/v1/dev/commerce/subscriptions/${subscriptionId}/expire` });
    expect(early.statusCode).toBe(409);

    current = new Date("2026-09-14T00:00:00.000Z");
    const expired = await app.inject({ method: "POST", url: `/v1/dev/commerce/subscriptions/${subscriptionId}/expire` });
    expect(expired.statusCode).toBe(200);
    expect(expired.json()).toMatchObject({ state: "EXPIRED", expiredLotIds: ["subscription-lot:expiry-subscription-event"] });
    const wallet = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(wallet.json().customerCredits.available).toBe(1100);
    const audit = await app.inject({ method: "GET", url: "/v1/dev/mock/orchestration" });
    const lots = audit.json().lots;
    expect(lots.find((lot: { id: string }) => lot.id === "payment-lot:expiry-purchase-event")).toMatchObject({ source: "PURCHASED", available: "100", expired: "0" });
    expect(lots.find((lot: { id: string }) => lot.id === "subscription-lot:expiry-subscription-event")).toMatchObject({ source: "SUBSCRIPTION", available: "0", expired: "200" });
  });

  it("records original money, fee and rational per-credit economic value in an immutable Invoice", async () => {
    const app = createApp();
    const created = await checkout(app, "invoice-checkout-001");
    const paid = paymentBody(created.id, { eventId: "invoice-payment-event-001", providerPaymentId: "invoice-provider-payment-001" });
    const accepted = await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(paid, "invoice-delivery-001"), payload: paid });
    const invoiceId = accepted.json().event.invoiceId;
    const invoice = await app.inject({ method: "GET", url: `/v1/dev/commerce/invoices/${invoiceId}` });
    expect(invoice.statusCode).toBe(200);
    expect(invoice.json()).toMatchObject({
      paymentEventId: "invoice-payment-event-001",
      productId: "local-credit-pack-100-v1",
      originalAmountMinor: "1000",
      currency: "USD",
      paymentFeeMinor: "30",
      netEconomicValueMicrousd: "9700000",
      grantedCredits: 100,
      allocatedValue: { numeratorMicrousd: "9700000", denominatorCredits: "100" },
      status: "PAID",
    });
  });

  it("posts a full Refund as a compensating exact-Lot withdrawal without deleting payment history", async () => {
    const app = createApp();
    const created = await checkout(app, "refund-checkout-001");
    const paid = paymentBody(created.id, { eventId: "refund-original-payment-001", providerPaymentId: "refund-original-provider-payment" });
    const acceptedPayment = await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(paid, "refund-payment-delivery"), payload: paid });
    expect((await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" })).json().customerCredits.available).toBe(1100);

    const refund = reversalBody("refund-original-payment-001");
    const acceptedRefund = await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(refund, "refund-delivery-001"), payload: refund });
    const replay = await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(refund, "refund-delivery-002"), payload: refund });
    expect(acceptedRefund.statusCode).toBe(202);
    expect(replay.json()).toMatchObject({ duplicateEvent: true });
    expect((await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" })).json().customerCredits.available).toBe(1000);

    const reversalId = acceptedRefund.json().event.reversalId;
    const reversal = await app.inject({ method: "GET", url: `/v1/dev/commerce/reversals/${reversalId}` });
    expect(reversal.json()).toMatchObject({
      kind: "REFUND",
      withdrawnCredits: 100,
      unrecoveredCredits: 0,
      receivableState: "NONE",
      fraudReviewState: "NOT_REQUIRED",
    });
    const invoice = await app.inject({ method: "GET", url: `/v1/dev/commerce/invoices/${acceptedPayment.json().event.invoiceId}` });
    expect(invoice.json().status).toBe("REFUNDED");
    const original = await app.inject({ method: "GET", url: "/v1/dev/commerce/payment-events/refund-original-payment-001" });
    expect(original.statusCode).toBe(200);
    expect(original.json()).toMatchObject({ creditLotId: "payment-lot:refund-original-payment-001" });
    const reconciliation = await app.inject({ method: "GET", url: "/v1/dev/commerce/reconciliation" });
    expect(reconciliation.json()).toMatchObject({
      counts: {
        paidEvents: 1,
        reversalEvents: 1,
        invoices: 1,
        financialReversals: 1,
        commerceCreditLots: 1,
        commerceLedgerJournals: 2,
      },
      financials: {
        paidNetEconomicValueMicrousd: "9700000",
        reversedNetEconomicValueMicrousd: "9700000",
        openReceivableEconomicValue: { numeratorMicrousd: "0", denominatorBasis: "1" },
      },
      issues: [],
      reconciliationRateBps: 10_000,
      localImplementationDecision: "PASS",
      formalGateDecision: "HOLD",
    });
  });

  it("opens fraud review for a Chargeback and rejects partial or second terminal reversals", async () => {
    const app = createApp();
    const created = await checkout(app, "chargeback-checkout-001");
    const paid = paymentBody(created.id, { eventId: "chargeback-original-payment", providerPaymentId: "chargeback-original-provider-payment" });
    const acceptedPayment = await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(paid, "chargeback-payment-delivery"), payload: paid });

    const partial = reversalBody("chargeback-original-payment", "PAYMENT_CHARGEBACK", { money: { amountMinor: "500", currency: "USD", feeMinor: "0" } });
    const partialResponse = await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(partial, "chargeback-partial-delivery"), payload: partial });
    expect(partialResponse.statusCode).toBe(409);
    expect(partialResponse.json().error.code).toBe("PARTIAL_REVERSAL_NOT_SUPPORTED");

    const chargeback = reversalBody("chargeback-original-payment", "PAYMENT_CHARGEBACK");
    const accepted = await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(chargeback, "chargeback-delivery"), payload: chargeback });
    const reversal = await app.inject({ method: "GET", url: `/v1/dev/commerce/reversals/${accepted.json().event.reversalId}` });
    expect(reversal.json()).toMatchObject({ kind: "CHARGEBACK", fraudReviewState: "OPEN", receivableState: "NONE" });
    const invoice = await app.inject({ method: "GET", url: `/v1/dev/commerce/invoices/${acceptedPayment.json().event.invoiceId}` });
    expect(invoice.json().status).toBe("CHARGEBACK");

    const second = reversalBody("chargeback-original-payment", "PAYMENT_REFUNDED", { eventId: "second-terminal-reversal", providerReversalId: "second-terminal-provider-refund" });
    const secondResponse = await app.inject({ method: "POST", url: "/v1/dev/commerce/webhooks/provider-for-test", headers: signedHeaders(second, "second-terminal-delivery"), payload: second });
    expect(secondResponse.statusCode).toBe(409);
    expect(secondResponse.json().error.code).toBe("PAYMENT_ALREADY_REVERSED");
  });
});
