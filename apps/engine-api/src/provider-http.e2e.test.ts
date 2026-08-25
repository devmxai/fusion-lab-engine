// @vitest-environment node

import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { buildProviderTestApp } from "../../provider-test-api/src/app.ts";
import { loadProviderTestConfig } from "../../provider-test-api/src/config.ts";
import { buildEngineApp } from "./app.ts";
import { loadLocalEngineConfig } from "./config.ts";

const apiKey = "provider-http-e2e-key";
const closeables: Array<{ close(): Promise<unknown> }> = [];

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

afterEach(async () => {
  await Promise.all(closeables.splice(0).reverse().map((item) => item.close()));
});

describe("Engine to Provider For Test over HTTP", () => {
  it("performs request, response, polling, ingest, hashing and dual-ledger settlement", async () => {
    const providerPort = await freePort();
    const providerBaseUrl = `http://127.0.0.1:${providerPort}`;
    const provider = buildProviderTestApp({
      config: loadProviderTestConfig({
        NODE_ENV: "test",
        TEST_PROVIDER_PORT: String(providerPort),
        TEST_PROVIDER_PUBLIC_URL: providerBaseUrl,
        TEST_PROVIDER_API_KEY: apiKey,
        TEST_PROVIDER_LOG_LEVEL: "silent",
      }),
    });
    await provider.listen({ host: "127.0.0.1", port: providerPort });
    closeables.push(provider);

    const engine = buildEngineApp({
      config: loadLocalEngineConfig({
        NODE_ENV: "test",
        ENGINE_MODE: "local",
        ENGINE_LOG_LEVEL: "silent",
        TEST_PROVIDER_BASE_URL: providerBaseUrl,
        TEST_PROVIDER_API_KEY: apiKey,
      }),
    });
    closeables.push(engine);

    const quote = await engine.inject({
      method: "POST",
      url: "/v1/dev/mock/quotes",
      payload: { modelId: "local/test-image-v1" },
    });
    expect(quote.json()).toMatchObject({
      provider: "provider-test",
      customerCredits: 4,
      providerEstimate: { atomic: "2" },
    });

    const created = await engine.inject({
      method: "POST",
      url: "/v1/dev/mock/operations",
      payload: {
        quoteId: quote.json().id,
        idempotencyKey: "engine-http-e2e-0001",
        scenario: "success",
      },
    });
    expect(created.statusCode).toBe(202);
    expect(created.json()).toMatchObject({ state: "RESERVED", provider: "provider-test" });
    expect(created.json().providerTaskId).toBeNull();
    expect(created.json().providerRequestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.json().providerResponseHash).toBeNull();

    const held = await engine.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(held.json().customerCredits).toMatchObject({ available: 996, held: 4, spent: 0 });
    expect(held.json().providerTreasury.localProvider).toMatchObject({
      availableAtomic: "1000",
      heldAtomic: "0",
      spentAtomic: "0",
    });

    let operation = (await engine.inject({
      method: "POST",
      url: `/v1/dev/mock/operations/${created.json().id}/advance`,
    })).json();
    expect(operation).toMatchObject({ state: "SUBMITTED" });
    expect(operation.providerTaskId).toBeTruthy();
    expect(operation.providerResponseHash).toMatch(/^[a-f0-9]{64}$/);
    for (let index = 0; index < 5; index += 1) {
      operation = (await engine.inject({
        method: "POST",
        url: `/v1/dev/mock/operations/${operation.id}/advance`,
      })).json();
    }
    expect(operation).toMatchObject({
      state: "SETTLED",
      financials: {
        customerChargedCredits: 4,
        providerChargedCredits: 2,
        realizedGrossProfitCredits: 2,
      },
    });
    expect(operation.assetChecksumSha256).toMatch(/^[a-f0-9]{64}$/);

    const asset = await engine.inject({ method: "GET", url: operation.resultUrl });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain(">TEST<");
    expect(asset.headers["x-content-sha256"]).toBe(operation.assetChecksumSha256);

    const finalBalance = await engine.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(finalBalance.json().customerCredits).toMatchObject({ available: 996, held: 0, spent: 4 });
    expect(finalBalance.json().providerTreasury.localProvider).toMatchObject({
      availableAtomic: "998",
      heldAtomic: "0",
      spentAtomic: "2",
    });
  });

  it("recovers accepted-but-timeout over HTTP without a second provider debit", async () => {
    const providerPort = await freePort();
    const providerBaseUrl = `http://127.0.0.1:${providerPort}`;
    const provider = buildProviderTestApp({
      config: loadProviderTestConfig({
        NODE_ENV: "test",
        TEST_PROVIDER_PORT: String(providerPort),
        TEST_PROVIDER_PUBLIC_URL: providerBaseUrl,
        TEST_PROVIDER_API_KEY: apiKey,
        TEST_PROVIDER_LOG_LEVEL: "silent",
      }),
    });
    await provider.listen({ host: "127.0.0.1", port: providerPort });
    closeables.push(provider);
    const engine = buildEngineApp({
      config: loadLocalEngineConfig({
        NODE_ENV: "test",
        ENGINE_MODE: "local",
        ENGINE_LOG_LEVEL: "silent",
        TEST_PROVIDER_BASE_URL: providerBaseUrl,
        TEST_PROVIDER_API_KEY: apiKey,
      }),
    });
    closeables.push(engine);

    const quote = await engine.inject({
      method: "POST",
      url: "/v1/dev/mock/quotes",
      payload: { modelId: "local/test-image-v1" },
    });
    const created = await engine.inject({
      method: "POST",
      url: "/v1/dev/mock/operations",
      payload: {
        quoteId: quote.json().id,
        idempotencyKey: "engine-http-unknown-0001",
        scenario: "submission_unknown_then_success",
      },
    });
    expect(created.json().state).toBe("RESERVED");

    let operation = (await engine.inject({
      method: "POST",
      url: `/v1/dev/mock/operations/${created.json().id}/advance`,
    })).json();
    expect(operation.state).toBe("SUBMISSION_UNKNOWN");

    const held = await engine.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(held.json().customerCredits.held).toBe(4);
    expect(held.json().providerTreasury.localProvider).toMatchObject({
      availableAtomic: "998",
      heldAtomic: "2",
      spentAtomic: "0",
    });

    const resolved = await engine.inject({
      method: "POST",
      url: `/v1/dev/mock/operations/${operation.id}/advance`,
    });
    operation = resolved.json();
    expect(operation.state).toBe("SUBMITTED");
    expect(operation.providerTaskId).toBeTruthy();

    for (let index = 0; index < 5; index += 1) {
      operation = (await engine.inject({
        method: "POST",
        url: `/v1/dev/mock/operations/${operation.id}/advance`,
      })).json();
    }
    expect(operation.state).toBe("SETTLED");
    const finalBalance = await engine.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(finalBalance.json().customerCredits.spent).toBe(4);
    expect(finalBalance.json().providerTreasury.localProvider.spentAtomic).toBe("2");
  });
});
