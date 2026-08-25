// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { buildProviderTestApp } from "./app.ts";
import { loadProviderTestConfig } from "./config.ts";

const apiKey = "provider-test-contract-key";
const apps: ReturnType<typeof buildProviderTestApp>[] = [];

function createApp() {
  const app = buildProviderTestApp({
    config: loadProviderTestConfig({
      NODE_ENV: "test",
      TEST_PROVIDER_API_KEY: apiKey,
      TEST_PROVIDER_LOG_LEVEL: "silent",
      TEST_PROVIDER_PUBLIC_URL: "http://provider.test",
    }),
  });
  apps.push(app);
  return app;
}

const auth = { authorization: `Bearer ${apiKey}` };

function imagePayload(scenario = "success") {
  return {
    operationId: "operation-contract-1",
    model: "local/test-image-v1",
    mediaType: "image",
    scenario,
    input: { quantity: 1, resolution: "720p", audio: false },
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Provider For Test API contract", () => {
  it("requires its server-side Bearer API key", async () => {
    const response = await createApp().inject({ method: "GET", url: "/v1/credits" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("accepts a real generation request, charges provider credits and serves an asset", async () => {
    const app = createApp();
    const submitted = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { ...auth, "idempotency-key": "provider-contract-0001" },
      payload: imagePayload(),
    });
    expect(submitted.statusCode).toBe(202);
    expect(submitted.json()).toMatchObject({
      status: "submitted",
      estimatedProviderCredits: 2,
    });

    const held = await app.inject({ method: "GET", url: "/v1/credits", headers: auth });
    expect(held.json()).toMatchObject({ available: 998, held: 2, spent: 0 });

    const taskId = submitted.json().taskId;
    const running = await app.inject({ method: "GET", url: `/v1/generations/${taskId}`, headers: auth });
    expect(running.json().status).toBe("running");
    const succeeded = await app.inject({ method: "GET", url: `/v1/generations/${taskId}`, headers: auth });
    expect(succeeded.json()).toMatchObject({ status: "succeeded", actualProviderCredits: 2 });

    const asset = await app.inject({ method: "GET", url: `/v1/assets/${taskId}`, headers: auth });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("image/svg+xml");
    expect(asset.body).toContain(">TEST<");

    const settled = await app.inject({ method: "GET", url: "/v1/credits", headers: auth });
    expect(settled.json()).toMatchObject({ available: 998, held: 0, spent: 2 });
  });

  it("deduplicates provider requests using Idempotency-Key", async () => {
    const app = createApp();
    const request = {
      method: "POST" as const,
      url: "/v1/generations",
      headers: { ...auth, "idempotency-key": "provider-same-0001" },
      payload: imagePayload(),
    };
    const first = await app.inject(request);
    const second = await app.inject(request);
    expect(second.json().taskId).toBe(first.json().taskId);
    const balance = await app.inject({ method: "GET", url: "/v1/credits", headers: auth });
    expect(balance.json()).toMatchObject({ available: 998, held: 2, spent: 0 });
  });

  it("supports lookup after an accepted request whose response timed out", async () => {
    const app = createApp();
    const idempotencyKey = "provider-unknown-0001";
    const submitted = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { ...auth, "idempotency-key": idempotencyKey },
      payload: imagePayload("submission_unknown_then_success"),
    });
    expect(submitted.statusCode).toBe(504);

    const lookup = await app.inject({
      method: "GET",
      url: `/v1/generations/by-idempotency/${idempotencyKey}`,
      headers: auth,
    });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json()).toMatchObject({ status: "submitted" });
    const balance = await app.inject({ method: "GET", url: "/v1/credits", headers: auth });
    expect(balance.json()).toMatchObject({ available: 998, held: 2, spent: 0 });
  });

  it("rejects a model/media mismatch before touching provider balance", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { ...auth, "idempotency-key": "provider-mismatch-0001" },
      payload: { ...imagePayload(), mediaType: "audio" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("MODEL_MEDIA_MISMATCH");
    const balance = await app.inject({ method: "GET", url: "/v1/credits", headers: auth });
    expect(balance.json()).toMatchObject({ available: 1_000, held: 0, spent: 0 });
  });

  it("refunds the provider hold on a confirmed provider failure", async () => {
    const app = createApp();
    const submitted = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { ...auth, "idempotency-key": "provider-failure-0001" },
      payload: imagePayload("provider_failure"),
    });
    const taskId = submitted.json().taskId;
    await app.inject({ method: "GET", url: `/v1/generations/${taskId}`, headers: auth });
    const failed = await app.inject({ method: "GET", url: `/v1/generations/${taskId}`, headers: auth });
    expect(failed.json()).toMatchObject({
      status: "failed",
      actualProviderCredits: null,
      errorCode: "SIMULATED_PROVIDER_FAILURE",
    });
    const balance = await app.inject({ method: "GET", url: "/v1/credits", headers: auth });
    expect(balance.json()).toMatchObject({ available: 1_000, held: 0, spent: 0 });
  });
});
