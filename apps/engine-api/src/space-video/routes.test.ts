// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { buildEngineApp } from "../app.ts";
import { loadLocalEngineConfig } from "../config.ts";
import { createFakeProviderRegistry, FakeProviderAdapter } from "../test/fake-provider-adapter.ts";
import type { ProviderGenerationRequest } from "../../../../packages/contracts/src/provider.ts";
import { ProviderRegistry } from "../../../../packages/providers/src/registry.ts";

const apps: ReturnType<typeof buildEngineApp>[] = [];

function createApp() {
  const app = buildEngineApp({
    config: loadLocalEngineConfig({ NODE_ENV: "test", ENGINE_MODE: "local", ENGINE_LOG_LEVEL: "silent" }),
    providerRegistry: createFakeProviderRegistry(),
  });
  apps.push(app);
  return app;
}

class CapturingProviderAdapter extends FakeProviderAdapter {
  lastRequest: ProviderGenerationRequest | null = null;

  override async submit(request: ProviderGenerationRequest, idempotencyKey: string) {
    this.lastRequest = request;
    return super.submit(request, idempotencyKey);
  }
}

function validVideo(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "video-local-demo",
    recipeId: "video.text-to-video",
    bindings: [],
    prompt: "A slow cinematic camera move",
    modelId: "local/test-video-v1",
    settings: { durationSeconds: 5, resolution: "720p", aspectRatio: "16:9", audio: false },
    ...overrides,
  };
}

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("Creative Space video quote/confirm API", () => {
  it("revalidates exact bindings, semantic roles and settings on the server", async () => {
    const app = createApp();
    const invalidBindings = await app.inject({
      method: "POST",
      url: "/v1/dev/space/video-quotes",
      payload: validVideo({
        recipeId: "video.first-last",
        bindings: [
          { assetId: "same", kind: "IMAGE", status: "READY", slot: "LAST_FRAME", ordinal: 0 },
          { assetId: "same", kind: "IMAGE", status: "READY", slot: "FIRST_FRAME", ordinal: 3 },
        ],
      }),
    });
    expect(invalidBindings.statusCode).toBe(400);
    expect(invalidBindings.json().error.code).toBe("INVALID_VIDEO_RECIPE");

    const inventedSetting = await app.inject({
      method: "POST",
      url: "/v1/dev/space/video-quotes",
      payload: validVideo({ settings: { durationSeconds: 5, resolution: "720p", aspectRatio: "16:9", audio: false, hiddenCost: 99 } }),
    });
    expect(inventedSetting.statusCode).toBe(400);

    const unreadyAsset = await app.inject({
      method: "POST",
      url: "/v1/dev/space/video-quotes",
      payload: validVideo({
        recipeId: "video.image-to-video",
        bindings: [{ assetId: "image-1", kind: "IMAGE", status: "VERIFYING", slot: "FIRST_FRAME", ordinal: 0 }],
      }),
    });
    expect(unreadyAsset.statusCode).toBe(400);
  });

  it.each([
    [{ durationSeconds: 5, resolution: "720p", aspectRatio: "16:9", audio: false }, "10", 20],
    [{ durationSeconds: 5, resolution: "1080p", aspectRatio: "16:9", audio: false }, "15", 30],
    [{ durationSeconds: 10, resolution: "720p", aspectRatio: "9:16", audio: true }, "25", 50],
    [{ durationSeconds: 10, resolution: "1080p", aspectRatio: "1:1", audio: true }, "35", 70],
  ])("matches the golden billing matrix for settings %o", async (settings, providerAtomic, customerCredits) => {
    const app = createApp();
    const priced = await app.inject({ method: "POST", url: "/v1/dev/space/video-quotes", payload: validVideo({ settings }) });
    expect(priced.statusCode).toBe(201);
    expect(priced.json()).toMatchObject({
      customerCredits,
      providerEstimate: { atomic: providerAtomic, unit: "provider_credit" },
      pricingPolicy: { quotedGrossProfitCredits: customerCredits - Number(providerAtomic) },
      provider: "provider-test",
      localOnly: true,
    });
    const wallet = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(wallet.json()).toMatchObject({
      customerCredits: { available: 1000, held: 0, spent: 0 },
      providerTreasury: { localProvider: { availableAtomic: "1000", heldAtomic: "0", spentAtomic: "0" } },
    });
  });

  it("reserves site credits idempotently, then charges site 20 and provider 10 after verified MP4 delivery", async () => {
    const app = createApp();
    const priced = await app.inject({ method: "POST", url: "/v1/dev/space/video-quotes", payload: validVideo() });
    const quote = priced.json();
    const confirmationPayload = { idempotencyKey: "space-video-confirm-0001", requestHash: quote.requestHash };

    const confirmed = await app.inject({
      method: "POST",
      url: `/v1/dev/space/video-quotes/${quote.id}/confirm`,
      payload: confirmationPayload,
    });
    expect(confirmed.statusCode).toBe(202);
    expect(confirmed.json()).toMatchObject({
      operation: {
        state: "RESERVED",
        financials: {
          customerQuotedCredits: 20,
          customerChargedCredits: 0,
          providerEstimatedCredits: 10,
          providerChargedCredits: 0,
          quotedGrossProfitCredits: 10,
        },
      },
      wallet: {
        customerCredits: { available: 980, held: 20, spent: 0 },
        providerTreasury: { localProvider: { availableAtomic: "1000", heldAtomic: "0", spentAtomic: "0" } },
      },
    });

    const repeated = await app.inject({
      method: "POST",
      url: `/v1/dev/space/video-quotes/${quote.id}/confirm`,
      payload: confirmationPayload,
    });
    expect(repeated.json().operation.id).toBe(confirmed.json().operation.id);
    expect(repeated.json().wallet.customerCredits).toMatchObject({ available: 980, held: 20, spent: 0 });

    const run = await app.inject({ method: "POST", url: `/v1/dev/space/video-operations/${confirmed.json().operation.id}/run` });
    expect(run.statusCode).toBe(200);
    expect(run.json()).toMatchObject({
      operation: {
        state: "SETTLED",
        financials: {
          customerChargedCredits: 20,
          providerChargedCredits: 10,
          realizedGrossProfitCredits: 10,
        },
      },
      wallet: {
        customerCredits: { available: 980, held: 0, spent: 20 },
        providerTreasury: { localProvider: { availableAtomic: "990", heldAtomic: "0", spentAtomic: "10" } },
      },
    });
    expect(run.json().operation.assetChecksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(run.json().timeline.map(({ state }: { state: string }) => state)).toEqual(expect.arrayContaining(["RESERVED", "SUBMITTED", "RUNNING", "SETTLED"]));

    const output = await app.inject({ method: "GET", url: run.json().operation.resultUrl });
    expect(output.statusCode).toBe(200);
    expect(output.headers["content-type"]).toContain("video/mp4");
    expect(output.rawPayload.subarray(4, 12).toString()).toBe("ftypisom");
  });

  it("forwards prompt, aspect ratio and ordered semantic bindings through the canonical provider request", async () => {
    const adapter = new CapturingProviderAdapter();
    const registry = new ProviderRegistry();
    registry.register(adapter);
    const app = buildEngineApp({
      config: loadLocalEngineConfig({ NODE_ENV: "test", ENGINE_MODE: "local", ENGINE_LOG_LEVEL: "silent" }),
      providerRegistry: registry,
    });
    apps.push(app);
    const payload = validVideo({
      recipeId: "video.first-last",
      prompt: "Move from dawn to night",
      bindings: [
        { assetId: "first-image", kind: "IMAGE", status: "READY", slot: "FIRST_FRAME", ordinal: 0 },
        { assetId: "last-image", kind: "IMAGE", status: "READY", slot: "LAST_FRAME", ordinal: 1 },
      ],
      settings: { durationSeconds: 5, resolution: "720p", aspectRatio: "9:16", audio: false },
    });
    const priced = await app.inject({ method: "POST", url: "/v1/dev/space/video-quotes", payload });
    const confirmed = await app.inject({
      method: "POST",
      url: `/v1/dev/space/video-quotes/${priced.json().id}/confirm`,
      payload: { idempotencyKey: "provider-payload-0001", requestHash: priced.json().requestHash },
    });
    await app.inject({ method: "POST", url: `/v1/dev/space/video-operations/${confirmed.json().operation.id}/run` });
    expect(adapter.lastRequest).toMatchObject({
      model: "local/test-video-v1",
      mediaType: "video",
      input: {
        prompt: "Move from dawn to night",
        aspectRatio: "9:16",
        bindings: [
          { assetId: "first-image", role: "FIRST_FRAME", ordinal: 0 },
          { assetId: "last-image", role: "LAST_FRAME", ordinal: 1 },
        ],
      },
    });
  });

  it("rejects stale confirmation hashes", async () => {
    const app = createApp();
    const priced = await app.inject({ method: "POST", url: "/v1/dev/space/video-quotes", payload: validVideo() });
    const rejected = await app.inject({
      method: "POST",
      url: `/v1/dev/space/video-quotes/${priced.json().id}/confirm`,
      payload: { idempotencyKey: "space-video-stale", requestHash: "0".repeat(64) },
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe("STALE_VIDEO_QUOTE");
  });
});
