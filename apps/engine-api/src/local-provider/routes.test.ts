// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { buildEngineApp } from "../app.ts";
import { loadLocalEngineConfig } from "../config.ts";
import { createFakeProviderRegistry } from "../test/fake-provider-adapter.ts";

const apps: ReturnType<typeof buildEngineApp>[] = [];

function createApp() {
  const app = buildEngineApp({
    config: loadLocalEngineConfig({
      NODE_ENV: "test",
      ENGINE_MODE: "local",
      ENGINE_LOG_LEVEL: "silent",
    }),
    providerRegistry: createFakeProviderRegistry(),
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("local mock provider API", () => {
  it("runs quote to settlement and serves a generated local asset", async () => {
    const app = createApp();
    const catalog = await app.inject({ method: "GET", url: "/v1/dev/mock/catalog" });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().models).toHaveLength(3);
    expect(catalog.json().registry).toMatchObject({
      version: 1,
      families: expect.arrayContaining([
        expect.objectContaining({ id: "family:local/test-image-v1:v1", mediaType: "image" }),
      ]),
      routes: expect.arrayContaining([
        expect.objectContaining({ id: "route:local/test-image-v1:v1", certificationScope: "LOCAL_TEST_ONLY" }),
      ]),
    });
    expect(catalog.json().providers).toEqual([{
      id: "provider-test",
      displayName: "Provider For Test",
      version: "test",
    }]);

    const quoteResponse = await app.inject({
      method: "POST",
      url: "/v1/dev/mock/quotes",
      payload: { modelId: "local/test-video-v1", durationSeconds: 10 },
    });
    expect(quoteResponse.statusCode).toBe(201);
    expect(quoteResponse.json()).toMatchObject({
      provider: "provider-test",
      customerCredits: 40,
      localOnly: true,
    });
    expect(quoteResponse.json().providerEstimate.atomic).toBe("20");
    expect(quoteResponse.json().pinnedVersions).toMatchObject({
      routeVersionId: "route:local/test-video-v1:v1",
      capabilityVersionId: "capability:local/test-video-v1:v1",
      billingManifestVersionId: "billing:local/test-video-v1:v1",
      costVersionId: "cost:provider-test-credit:v1",
      adapterVersion: "provider-test-http.v1",
    });
    expect(quoteResponse.json().pricingPolicy).toMatchObject({
      providerToSiteCreditRatio: "1:1",
      markupBps: 10_000,
      quotedGrossMarginBps: 5_000,
      quotedGrossProfitCredits: 20,
    });

    const operationResponse = await app.inject({
      method: "POST",
      url: "/v1/dev/mock/operations",
      payload: {
        quoteId: quoteResponse.json().id,
        idempotencyKey: "api-operation-0001",
        scenario: "success",
      },
    });
    expect(operationResponse.statusCode).toBe(202);

    let operation = operationResponse.json();
    for (let index = 0; index < 6; index += 1) {
      const advanced = await app.inject({
        method: "POST",
        url: `/v1/dev/mock/operations/${operation.id}/advance`,
      });
      expect(advanced.statusCode).toBe(200);
      operation = advanced.json();
    }
    expect(operation.state).toBe("SETTLED");
    expect(operation.financials).toMatchObject({
      customerChargedCredits: 40,
      providerChargedCredits: 20,
      realizedGrossProfitCredits: 20,
      realizedGrossMarginBps: 5_000,
    });

    const assetResponse = await app.inject({
      method: "GET",
      url: operation.resultUrl,
    });
    expect(assetResponse.statusCode).toBe(200);
    expect(assetResponse.headers["content-type"]).toContain("video/mp4");
    expect(assetResponse.body).toContain("TEST Provider For Test");
    expect(assetResponse.body).toContain("Provider For Test");
    expect(assetResponse.headers["x-content-sha256"]).toMatch(/^[a-f0-9]{64}$/);
    const anonymousAsset = await app.inject({
      method: "GET",
      url: `/v1/dev/mock/assets/${operation.id}`,
    });
    expect(anonymousAsset.statusCode).toBe(403);
    expect(anonymousAsset.json().error.code).toBe("ASSET_ACCESS_DENIED");

    const walletResponse = await app.inject({
      method: "GET",
      url: "/v1/dev/mock/wallets/local-user",
    });
    expect(walletResponse.json().customerCredits).toMatchObject({
      available: 960,
      held: 0,
      spent: 40,
    });
    expect(walletResponse.json().providerTreasury.localProvider).toMatchObject({
      availableAtomic: "980",
      heldAtomic: "0",
      spentAtomic: "20",
    });

    const orchestration = await app.inject({ method: "GET", url: "/v1/dev/mock/orchestration" });
    expect(orchestration.json()).toMatchObject({
      outbox: [expect.objectContaining({ status: "ACKED", attempts: 1 })],
      attempts: [expect.objectContaining({ state: "SUCCEEDED", attemptNumber: 1 })],
    });
    const reconciliation = await app.inject({ method: "GET", url: "/v1/dev/mock/reconciliation" });
    expect(reconciliation.json()).toMatchObject({
      reconciliationRateBps: 10_000,
      targetBps: 9_900,
      targetMet: true,
      issues: [],
    });
    const treasury = await app.inject({ method: "GET", url: "/v1/dev/mock/treasury" });
    expect(treasury.json()).toMatchObject({
      treasury: {
        providerAccountId: "provider-test:local-account",
        state: "WARNING",
        confirmedRemainingAtomic: "980",
        shadowAvailableAtomic: "880",
      },
      fundingLots: [expect.objectContaining({
        nativeRemainingAtomic: "980",
        cashAllocatedMicrousd: "200000",
      })],
      actualCosts: [expect.objectContaining({
        usageNativeAtomic: "20",
        nativeBookValueMicrousd: "200000",
        cashCostMicrousd: "200000",
        fundingFeeEffectMicrousd: "0",
      })],
      exactEquivalenceGroups: [],
      crossProviderExactEnabled: false,
      localOnly: true,
    });
  });

  it("rejects malformed and conflicting requests without leaking input", async () => {
    const app = createApp();
    const malformed = await app.inject({
      method: "POST",
      url: "/v1/dev/mock/quotes",
      payload: { modelId: "secret-invalid-model" },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain("secret-invalid-model");
  });

  it("reserves and redeems an eligible promotion through the real quote and operation path", async () => {
    const app = createApp();
    const catalog = await app.inject({ method: "GET", url: "/v1/dev/commerce/promotions" });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().sandboxOnly).toBe(true);
    expect(catalog.json().campaigns[0]).toMatchObject({
      id: "promotion:local-video-launch:v1",
      code: "LOCAL50",
      stacking: { mode: "EXCLUSIVE" },
    });
    expect(catalog.json().budgets[0]).toMatchObject({ reservedCredits: 0, redeemedCredits: 0 });

    const quote = await app.inject({
      method: "POST",
      url: "/v1/dev/mock/quotes",
      payload: {
        userId: "promotion-user-1",
        modelId: "local/test-video-v1",
        durationSeconds: 10,
        promotionCode: "local50",
      },
    });
    expect(quote.statusCode).toBe(201);
    expect(quote.json()).toMatchObject({
      baseCustomerCredits: 40,
      discountCredits: 20,
      customerCredits: 20,
      promotion: {
        campaignVersionId: "promotion:local-video-launch:v1",
        code: "LOCAL50",
        status: "RESERVED",
        subsidyMicrousd: "66667",
      },
    });
    const reservationId = quote.json().promotion.reservationId;
    const reservedBudget = await app.inject({
      method: "GET",
      url: "/v1/dev/commerce/promotions/budgets/promotion:local-video-launch:v1",
    });
    expect(reservedBudget.json()).toMatchObject({ reservedCredits: 20, reservedMicrousd: "66667", redeemedCredits: 0 });

    const operation = await app.inject({
      method: "POST",
      url: "/v1/dev/mock/operations",
      payload: {
        userId: "promotion-user-1",
        quoteId: quote.json().id,
        idempotencyKey: "promotion-operation-001",
        scenario: "success",
      },
    });
    expect(operation.statusCode).toBe(202);
    expect(operation.json().promotion).toMatchObject({ id: reservationId, status: "RESERVED", operationId: operation.json().id });
    let advancedOperation = operation.json();
    for (let index = 0; index < 6; index += 1) {
      const advanced = await app.inject({ method: "POST", url: `/v1/dev/mock/operations/${advancedOperation.id}/advance` });
      expect(advanced.statusCode).toBe(200);
      advancedOperation = advanced.json();
    }
    expect(advancedOperation).toMatchObject({ state: "SETTLED", promotion: { status: "REDEEMED", operationId: operation.json().id } });
    const redemption = await app.inject({
      method: "GET",
      url: `/v1/dev/commerce/promotions/reservations/${encodeURIComponent(reservationId)}`,
    });
    expect(redemption.statusCode).toBe(200);
    expect(redemption.json()).toMatchObject({ status: "REDEEMED", discountCredits: 20, subsidyMicrousd: "66667" });
    const redeemedBudget = await app.inject({
      method: "GET",
      url: "/v1/dev/commerce/promotions/budgets/promotion:local-video-launch:v1",
    });
    expect(redeemedBudget.json()).toMatchObject({
      reservedCredits: 0,
      reservedMicrousd: "0",
      redeemedCredits: 20,
      redeemedMicrousd: "66667",
    });
    const subsidyEntries = await app.inject({
      method: "GET",
      url: "/v1/dev/commerce/promotions/subsidy-entries?campaignVersionId=promotion%3Alocal-video-launch%3Av1",
    });
    expect(subsidyEntries.statusCode).toBe(200);
    expect(subsidyEntries.json().entries).toMatchObject([
      { kind: "RESERVE", reservedCreditsDelta: 20, reservedMicrousdDelta: "66667" },
      { kind: "REDEEM", reservedCreditsDelta: -20, redeemedCreditsDelta: 20, redeemedMicrousdDelta: "66667" },
    ]);
  });

  it("fails promotion requests closed when product eligibility, fraud, or caps reject them", async () => {
    const app = createApp();
    const ineligible = await app.inject({
      method: "POST",
      url: "/v1/dev/mock/quotes",
      payload: { userId: "promo-image-user", modelId: "local/test-image-v1", promotionCode: "LOCAL50" },
    });
    expect(ineligible.statusCode).toBe(409);
    expect(ineligible.json().error.code).toBe("PROMOTION_NOT_ELIGIBLE");

    const fraudBlocked = await app.inject({
      method: "POST",
      url: "/v1/dev/mock/quotes",
      payload: { userId: "local-fraud-blocked", modelId: "local/test-video-v1", durationSeconds: 10, promotionCode: "LOCAL50" },
    });
    expect(fraudBlocked.statusCode).toBe(409);
    expect(fraudBlocked.json().error.code).toBe("PROMOTION_FRAUD_BLOCKED");

    const first = await app.inject({
      method: "POST",
      url: "/v1/dev/mock/quotes",
      payload: { userId: "promo-cap-user", modelId: "local/test-video-v1", durationSeconds: 10, promotionCode: "LOCAL50" },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: "/v1/dev/mock/quotes",
      payload: { userId: "promo-cap-user", modelId: "local/test-video-v1", durationSeconds: 10, promotionCode: "LOCAL50" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("PROMOTION_CAP_REACHED");
  });

  it("releases the reserved promotion budget when generation fails without charging the customer", async () => {
    const app = createApp();
    const quote = await app.inject({
      method: "POST",
      url: "/v1/dev/mock/quotes",
      payload: { userId: "promo-failure-user", modelId: "local/test-video-v1", durationSeconds: 10, promotionCode: "LOCAL50" },
    });
    const created = await app.inject({
      method: "POST",
      url: "/v1/dev/mock/operations",
      payload: { userId: "promo-failure-user", quoteId: quote.json().id, idempotencyKey: "promo-failure-operation", scenario: "provider_failure" },
    });
    let operation = created.json();
    for (let index = 0; index < 5 && operation.state !== "PROVIDER_FAILED"; index += 1) {
      const advanced = await app.inject({ method: "POST", url: `/v1/dev/mock/operations/${operation.id}/advance` });
      operation = advanced.json();
    }
    expect(operation).toMatchObject({
      state: "PROVIDER_FAILED",
      promotion: { status: "RELEASED", releaseReason: "PROVIDER_TERMINAL_FAILURE_NO_CHARGE" },
      financials: { customerChargedCredits: 0 },
    });
    const budget = await app.inject({
      method: "GET",
      url: "/v1/dev/commerce/promotions/budgets/promotion:local-video-launch:v1",
    });
    expect(budget.json()).toMatchObject({ reservedCredits: 0, redeemedCredits: 0, reservedMicrousd: "0", redeemedMicrousd: "0" });
    const entries = await app.inject({ method: "GET", url: "/v1/dev/commerce/promotions/subsidy-entries" });
    expect(entries.json().entries).toMatchObject([
      { kind: "RESERVE", reservedCreditsDelta: 20 },
      { kind: "RELEASE", reservedCreditsDelta: -20, reasonCode: "PROVIDER_TERMINAL_FAILURE_NO_CHARGE" },
    ]);
  });

  it("resets all local balances without external side effects", async () => {
    const app = createApp();
    const reset = await app.inject({ method: "POST", url: "/v1/dev/mock/reset" });
    expect(reset.statusCode).toBe(204);

    const wallet = await app.inject({
      method: "GET",
      url: "/v1/dev/mock/wallets/local-user",
    });
    expect(wallet.json().customerCredits.available).toBe(1_000);
    expect(wallet.json().providerTreasury.localProvider).toMatchObject({
      availableAtomic: "1000",
      heldAtomic: "0",
      spentAtomic: "0",
    });
  });
});
