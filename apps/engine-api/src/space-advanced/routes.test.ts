// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import type { ProviderGenerationRequest } from "../../../../packages/contracts/src/provider.ts";
import { ProviderRegistry } from "../../../../packages/providers/src/registry.ts";
import { buildEngineApp } from "../app.ts";
import { loadLocalEngineConfig } from "../config.ts";
import { createFakeProviderRegistry, FakeProviderAdapter } from "../test/fake-provider-adapter.ts";

const apps: ReturnType<typeof buildEngineApp>[] = [];

function createApp(providerRegistry = createFakeProviderRegistry()) {
  const app = buildEngineApp({
    config: loadLocalEngineConfig({ NODE_ENV: "test", ENGINE_MODE: "local", ENGINE_LOG_LEVEL: "silent" }),
    providerRegistry,
  });
  apps.push(app);
  return app;
}

function tts(prompt = "a".repeat(150)) {
  return {
    projectId: "advanced-local",
    recipeId: "audio.tts",
    bindings: [],
    prompt,
    modelId: "local/test-audio-v1",
    settings: { voice: "test-neutral", speed: 1 },
  };
}

const videoSettings = { durationSeconds: 5, resolution: "720p", aspectRatio: "16:9", audio: false };
const image = { assetId: "image-1", kind: "IMAGE", status: "READY", role: "SOURCE", ordinal: 0 };
const audio = { assetId: "audio-1", kind: "AUDIO", status: "READY", role: "VOICE_AUDIO", ordinal: 1 };
const video = { assetId: "video-1", kind: "VIDEO", status: "READY", role: "SOURCE", ordinal: 0 };

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("Creative Space advanced multimodal API", () => {
  it("rejects invalid cross-media bindings and invented settings before Quote", async () => {
    const app = createApp();
    const wrongMotion = await app.inject({
      method: "POST",
      url: "/v1/dev/space/advanced-quotes",
      payload: {
        projectId: "advanced-local", recipeId: "video.motion-control", prompt: "", modelId: "local/test-video-v1",
        bindings: [image, { ...audio, role: "MOTION" }], settings: videoSettings,
      },
    });
    expect(wrongMotion.statusCode).toBe(400);
    expect(wrongMotion.json().error.code).toBe("INVALID_ADVANCED_RECIPE");

    const invented = await app.inject({ method: "POST", url: "/v1/dev/space/advanced-quotes", payload: { ...tts(), settings: { voice: "test-neutral", speed: 1, hidden: true } } });
    expect(invented.statusCode).toBe(400);
  });

  it("prices 150 TTS characters as site 4 / provider 2 without mutating either wallet", async () => {
    const app = createApp();
    const priced = await app.inject({ method: "POST", url: "/v1/dev/space/advanced-quotes", payload: tts() });
    expect(priced.statusCode).toBe(201);
    expect(priced.json()).toMatchObject({ outputKind: "AUDIO", customerCredits: 4, providerEstimate: { atomic: "2" }, pricingPolicy: { quotedGrossProfitCredits: 2 } });
    const wallet = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(wallet.json()).toMatchObject({ customerCredits: { available: 1000, held: 0, spent: 0 }, providerTreasury: { localProvider: { availableAtomic: "1000", heldAtomic: "0", spentAtomic: "0" } } });
  });

  it.each([
    ["video.avatar", [image, audio], { ...videoSettings, audio: true }, 30, "15"],
    ["video.motion-control", [image, { assetId: "motion-1", kind: "VIDEO", status: "READY", role: "MOTION", ordinal: 1 }], videoSettings, 20, "10"],
    ["video.edit", [video], videoSettings, 20, "10"],
    ["video.extend", [video], videoSettings, 20, "10"],
  ])("quotes %s through the certified video billing route", async (recipeId, bindings, settings, customerCredits, providerAtomic) => {
    const app = createApp();
    const priced = await app.inject({
      method: "POST",
      url: "/v1/dev/space/advanced-quotes",
      payload: { projectId: "advanced-local", recipeId, bindings, prompt: recipeId === "video.avatar" || recipeId === "video.motion-control" ? "" : "Continue the scene", modelId: "local/test-video-v1", settings },
    });
    expect(priced.statusCode).toBe(201);
    expect(priced.json()).toMatchObject({ outputKind: "VIDEO", customerCredits, providerEstimate: { atomic: providerAtomic } });
  });

  it("reserves and settles TTS only after verified WAV delivery", async () => {
    const app = createApp();
    const priced = await app.inject({ method: "POST", url: "/v1/dev/space/advanced-quotes", payload: tts() });
    const confirmed = await app.inject({
      method: "POST",
      url: `/v1/dev/space/advanced-quotes/${priced.json().id}/confirm`,
      payload: { idempotencyKey: "advanced-tts-confirm-1", requestHash: priced.json().requestHash },
    });
    expect(confirmed.json()).toMatchObject({
      operation: { state: "RESERVED", financials: { customerQuotedCredits: 4, customerChargedCredits: 0, providerEstimatedCredits: 2, providerChargedCredits: 0 } },
      wallet: { customerCredits: { available: 996, held: 4, spent: 0 } },
    });
    const run = await app.inject({ method: "POST", url: `/v1/dev/space/advanced-operations/${confirmed.json().operation.id}/run` });
    expect(run.json()).toMatchObject({
      operation: { state: "SETTLED", financials: { customerChargedCredits: 4, providerChargedCredits: 2 } },
      wallet: { customerCredits: { available: 996, held: 0, spent: 4 }, providerTreasury: { localProvider: { availableAtomic: "998", spentAtomic: "2" } } },
    });
    const output = await app.inject({ method: "GET", url: run.json().operation.resultUrl });
    expect(output.headers["content-type"]).toContain("audio/wav");
    expect(output.rawPayload.subarray(0, 4).toString()).toBe("RIFF");
  });

  it("forwards voice controls and Avatar semantic bindings through the canonical Provider Adapter", async () => {
    class CapturingAdapter extends FakeProviderAdapter {
      lastRequest: ProviderGenerationRequest | null = null;
      override async submit(request: ProviderGenerationRequest, idempotencyKey: string) {
        this.lastRequest = request;
        return super.submit(request, idempotencyKey);
      }
    }
    const adapter = new CapturingAdapter();
    const registry = new ProviderRegistry();
    registry.register(adapter);
    const app = createApp(registry);
    const priced = await app.inject({
      method: "POST", url: "/v1/dev/space/advanced-quotes",
      payload: { projectId: "advanced-local", recipeId: "video.avatar", bindings: [image, audio], prompt: "Smile gently", modelId: "local/test-video-v1", settings: { ...videoSettings, audio: true } },
    });
    const confirmed = await app.inject({ method: "POST", url: `/v1/dev/space/advanced-quotes/${priced.json().id}/confirm`, payload: { idempotencyKey: "advanced-avatar-provider", requestHash: priced.json().requestHash } });
    await app.inject({ method: "POST", url: `/v1/dev/space/advanced-operations/${confirmed.json().operation.id}/run` });
    expect(adapter.lastRequest).toMatchObject({
      mediaType: "video",
      input: {
        prompt: "Smile gently",
        bindings: [
          { assetId: "image-1", role: "SOURCE", ordinal: 0 },
          { assetId: "audio-1", role: "VOICE_AUDIO", ordinal: 1 },
        ],
      },
    });
  });

  it("rejects a stale Advanced confirmation hash", async () => {
    const app = createApp();
    const priced = await app.inject({ method: "POST", url: "/v1/dev/space/advanced-quotes", payload: tts() });
    const rejected = await app.inject({ method: "POST", url: `/v1/dev/space/advanced-quotes/${priced.json().id}/confirm`, payload: { idempotencyKey: "advanced-stale-hash", requestHash: "0".repeat(64) } });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe("STALE_ADVANCED_QUOTE");
  });
});
