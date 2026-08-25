// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { buildEngineApp } from "../app.ts";
import { loadLocalEngineConfig } from "../config.ts";
import { createFakeProviderRegistry } from "../test/fake-provider-adapter.ts";

const apps: ReturnType<typeof buildEngineApp>[] = [];

function createApp() {
  const app = buildEngineApp({
    config: loadLocalEngineConfig({ NODE_ENV: "test", ENGINE_MODE: "local", ENGINE_LOG_LEVEL: "silent" }),
    providerRegistry: createFakeProviderRegistry(),
  });
  apps.push(app);
  return app;
}

const validCreate = {
  projectId: "local-demo",
  recipeId: "image.create",
  input: null,
  prompt: "A clean test image",
  modelId: "local/test-image-v1",
  settings: { aspectRatio: "1:1" },
};

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("Creative Space image quote/confirm API", () => {
  it("revalidates the recipe on the server before pricing", async () => {
    const app = createApp();
    const missingInput = await app.inject({
      method: "POST",
      url: "/v1/dev/space/image-quotes",
      payload: { ...validCreate, recipeId: "image.edit", settings: { aspectRatio: "1:1", strength: 65 } },
    });
    expect(missingInput.statusCode).toBe(400);
    expect(missingInput.json().error.code).toBe("INVALID_IMAGE_RECIPE");

    const inventedSetting = await app.inject({
      method: "POST",
      url: "/v1/dev/space/image-quotes",
      payload: { ...validCreate, settings: { aspectRatio: "1:1", hiddenCost: 99 } },
    });
    expect(inventedSetting.statusCode).toBe(400);
  });

  it("quotes without mutation, then atomically reserves site credits once", async () => {
    const app = createApp();
    const before = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(before.json().customerCredits).toMatchObject({ available: 1000, held: 0, spent: 0 });
    expect(before.json().providerTreasury.localProvider).toMatchObject({ availableAtomic: "1000", heldAtomic: "0", spentAtomic: "0" });

    const priced = await app.inject({ method: "POST", url: "/v1/dev/space/image-quotes", payload: validCreate });
    expect(priced.statusCode).toBe(201);
    const quote = priced.json();
    expect(quote).toMatchObject({ customerCredits: 4, provider: "provider-test", localOnly: true });
    expect(quote.providerEstimate.atomic).toBe("2");

    const afterQuote = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(afterQuote.json().customerCredits).toMatchObject({ available: 1000, held: 0, spent: 0 });
    expect(afterQuote.json().providerTreasury.localProvider).toMatchObject({ availableAtomic: "1000", heldAtomic: "0", spentAtomic: "0" });

    const confirmationPayload = { idempotencyKey: "space-confirm-0001", requestHash: quote.requestHash };
    const confirmed = await app.inject({
      method: "POST",
      url: `/v1/dev/space/image-quotes/${quote.id}/confirm`,
      payload: confirmationPayload,
    });
    expect(confirmed.statusCode).toBe(202);
    expect(confirmed.json()).toMatchObject({
      operation: {
        state: "RESERVED",
        financials: {
          customerQuotedCredits: 4,
          customerChargedCredits: 0,
          providerEstimatedCredits: 2,
          providerChargedCredits: 0,
          quotedGrossProfitCredits: 2,
        },
      },
      wallet: {
        customerCredits: { available: 996, held: 4, spent: 0 },
        providerTreasury: { localProvider: { availableAtomic: "1000", heldAtomic: "0", spentAtomic: "0" } },
      },
    });

    const repeated = await app.inject({
      method: "POST",
      url: `/v1/dev/space/image-quotes/${quote.id}/confirm`,
      payload: confirmationPayload,
    });
    expect(repeated.statusCode).toBe(202);
    expect(repeated.json().operation.id).toBe(confirmed.json().operation.id);
    expect(repeated.json().wallet.customerCredits).toMatchObject({ available: 996, held: 4, spent: 0 });

    const recoveredReservation = await app.inject({ method: "GET", url: `/v1/dev/space/image-operations/${confirmed.json().operation.id}` });
    expect(recoveredReservation.statusCode).toBe(200);
    expect(recoveredReservation.json()).toMatchObject({ operation: { id: confirmed.json().operation.id, state: "RESERVED" } });

    const run = await app.inject({
      method: "POST",
      url: `/v1/dev/space/image-operations/${confirmed.json().operation.id}/run`,
    });
    expect(run.statusCode).toBe(200);
    expect(run.json()).toMatchObject({
      operation: {
        state: "SETTLED",
        financials: { customerChargedCredits: 4, providerChargedCredits: 2 },
      },
      wallet: {
        customerCredits: { available: 996, held: 0, spent: 4 },
        providerTreasury: { localProvider: { availableAtomic: "998", heldAtomic: "0", spentAtomic: "2" } },
      },
    });
    expect(run.json().operation.assetChecksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(run.json().timeline.map(({ state }: { state: string }) => state)).toEqual(expect.arrayContaining(["RESERVED", "SUBMITTED", "RUNNING", "SETTLED"]));

    const output = await app.inject({ method: "GET", url: run.json().operation.resultUrl });
    expect(output.statusCode).toBe(200);
    expect(output.headers["content-type"]).toContain("image/svg+xml");
    expect(output.body).toContain("TEST");

    const recoveredResult = await app.inject({ method: "GET", url: `/v1/dev/space/image-operations/${confirmed.json().operation.id}` });
    expect(recoveredResult.statusCode).toBe(200);
    expect(recoveredResult.json().operation).toMatchObject({ state: "SETTLED", assetChecksumSha256: run.json().operation.assetChecksumSha256 });
    expect(recoveredResult.json().operation.resultUrl).not.toBe(run.json().operation.resultUrl);
    const refreshedOutput = await app.inject({ method: "GET", url: recoveredResult.json().operation.resultUrl });
    expect(refreshedOutput.statusCode).toBe(200);
    expect(refreshedOutput.body).toContain("TEST");
  });

  it("rejects stale confirmation hashes", async () => {
    const app = createApp();
    const priced = await app.inject({ method: "POST", url: "/v1/dev/space/image-quotes", payload: validCreate });
    const rejected = await app.inject({
      method: "POST",
      url: `/v1/dev/space/image-quotes/${priced.json().id}/confirm`,
      payload: { idempotencyKey: "space-confirm-stale", requestHash: "0".repeat(64) },
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe("STALE_IMAGE_QUOTE");
  });
});
