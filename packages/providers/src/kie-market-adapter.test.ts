import { describe, expect, it, vi } from "vitest";
import { KieMarketAdapter } from "./kie-market-adapter.ts";
import { kieFixtureRequest, kieOfflineRouteFixtures } from "./kie-local-fixtures.ts";
const request = { operationId: "op-1", model: "kie/test", mediaType: "image" as const, scenario: "success" as const, input: { prompt: "fixture", quantity: 1, resolution: "720p" as const, audio: false } };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
describe("KIE Market offline adapter", () => {
  it("maps createTask and task-bound creditsConsumed without an external call", async () => {
    const fetch = vi.fn(async (url: string) => url.includes("createTask") ? json({ code: 200, data: { taskId: "kie-task-1" } }) : json({ code: 200, data: { taskId: "kie-task-1", state: "success", creditsConsumed: 2, resultJson: JSON.stringify({ resultUrls: ["https://assets.example.test/kie-1.png"] }) } }));
    const adapter = new KieMarketAdapter({ apiKey: "server-only-fixture", callbackUrl: "https://engine.example.test/webhooks/kie", estimateMaximum: () => 4, fetch: fetch as typeof globalThis.fetch });
    expect(await adapter.submit(request, "ignored")).toMatchObject({ taskId: "kie-task-1", estimatedProviderCredits: 4 });
    expect(await adapter.getTask("kie-task-1")).toMatchObject({ status: "succeeded", actualProviderCredits: 2, chargeStatus: "ACTUAL" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("uses a server-issued source URL and KIE's documented string duration for Kling I2V", async () => {
    let submittedBody: string | null = null;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      submittedBody = String(init?.body ?? "");
      return json({ code: 200, data: { taskId: "kie-kling-task" } });
    });
    const adapter = new KieMarketAdapter({ apiKey: "server-only-fixture", callbackUrl: "https://engine.example.test/webhooks/kie", estimateMaximum: () => 42, fetch: fetch as typeof globalThis.fetch });
    await adapter.submit({ ...request, model: "kling/v2-5-turbo-image-to-video-pro", mediaType: "video", input: { ...request.input, durationSeconds: 5, providerInputUrl: "https://engine.example.test/provider-input/source" } }, "ignored");
    const body = JSON.parse(submittedBody!);
    expect(body).toMatchObject({ model: "kling/v2-5-turbo-image-to-video-pro", input: { image_url: "https://engine.example.test/provider-input/source", duration: "5" } });
  });
  it("uses GPT Image 2 Image-to-Image's documented input_urls contract", async () => {
    let submittedBody: string | null = null;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      submittedBody = String(init?.body ?? "");
      return json({ code: 200, data: { taskId: "kie-gpt-image-2-edit-task" } });
    });
    const adapter = new KieMarketAdapter({ apiKey: "server-only-fixture", callbackUrl: "https://engine.example.test/webhooks/kie", estimateMaximum: () => 6, fetch: fetch as typeof globalThis.fetch });
    await adapter.submit({ ...request, model: "gpt-image-2-image-to-image", input: { ...request.input, aspectRatio: "auto", providerInputUrl: "https://engine.example.test/provider-input/source" } }, "ignored");
    const body = JSON.parse(submittedBody!);
    expect(body).toMatchObject({
      model: "gpt-image-2-image-to-image",
      input: { prompt: "fixture", input_urls: ["https://engine.example.test/provider-input/source"], aspect_ratio: "auto" },
    });
    expect(body.input).not.toHaveProperty("resolution");
    expect(body.input).not.toHaveProperty("image_url");
    expect(body.input).not.toHaveProperty("image_urls");
  });
  it("uses KIE V3 Turbo's documented image_urls contract", async () => {
    let submittedBody: string | null = null;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      submittedBody = String(init?.body ?? "");
      return json({ code: 200, data: { taskId: "kie-kling-v3-task" } });
    });
    const adapter = new KieMarketAdapter({ apiKey: "server-only-fixture", callbackUrl: "https://engine.example.test/webhooks/kie", estimateMaximum: () => 113, fetch: fetch as typeof globalThis.fetch });
    await adapter.submit({ ...request, model: "kling/v3-turbo-image-to-video", mediaType: "video", input: { ...request.input, resolution: "1080p", durationSeconds: 5, providerInputUrl: "https://engine.example.test/provider-input/source" } }, "ignored");
    const body = JSON.parse(submittedBody!);
    expect(body).toMatchObject({
      model: "kling/v3-turbo-image-to-video",
      input: { image_urls: ["https://engine.example.test/provider-input/source"], duration: "5", resolution: "1080p" },
    });
  });
  it("uses Kling 3.0's documented sound, mode, duration and aspect contract", async () => {
    let submittedBody: string | null = null;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      submittedBody = String(init?.body ?? "");
      return json({ code: 200, data: { taskId: "kie-kling3-task" } });
    });
    const adapter = new KieMarketAdapter({ apiKey: "server-only-fixture", callbackUrl: "https://engine.example.test/webhooks/kie", estimateMaximum: () => 126, fetch: fetch as typeof globalThis.fetch });
    await adapter.submit({ ...request, model: "kling-3.0/video", mediaType: "video", input: { ...request.input, durationSeconds: 7, resolution: "1080p", quality: "pro", audio: true, aspectRatio: "9:16", providerInputUrl: "https://engine.example.test/provider-input/source" } }, "ignored");
    const body = JSON.parse(submittedBody!);
    expect(body).toMatchObject({
      model: "kling-3.0/video",
      input: {
        image_urls: ["https://engine.example.test/provider-input/source"], duration: "7", aspect_ratio: "9:16",
        sound: true, mode: "pro", multi_shots: false,
      },
    });
    expect(body.input).not.toHaveProperty("audio");
    expect(body.input).not.toHaveProperty("resolution");
  });
  it("accepts KIE's real nullable status fields on a successful task", async () => {
    const adapter = new KieMarketAdapter({
      apiKey: "server-only-fixture",
      callbackUrl: "https://engine.example.test/webhooks/kie",
      estimateMaximum: () => 6,
      fetch: (async () => json({
        code: 200,
        data: {
          taskId: "kie-real-response",
          state: "success",
          creditsConsumed: 6.0,
          resultJson: JSON.stringify({ resultUrls: ["https://assets.example.test/generated.png"] }),
          failMsg: null,
        },
      })) as typeof globalThis.fetch,
    });
    await expect(adapter.getTask("kie-real-response")).resolves.toMatchObject({
      status: "succeeded",
      actualProviderCredits: 6,
      resultUrl: "https://assets.example.test/generated.png",
      chargeStatus: "ACTUAL",
    });
  });
  it("accepts nullable usage and result fields while a KIE task is running", async () => {
    const adapter = new KieMarketAdapter({
      apiKey: "server-only-fixture",
      callbackUrl: "https://engine.example.test/webhooks/kie",
      estimateMaximum: () => 6,
      fetch: (async () => json({
        code: 200,
        data: { taskId: "kie-running-nullable", state: "generating", creditsConsumed: null, resultJson: null, failMsg: null },
      })) as typeof globalThis.fetch,
    });
    await expect(adapter.getTask("kie-running-nullable")).resolves.toMatchObject({ status: "running", actualProviderCredits: null });
  });
  it("keeps unknown submit and missing terminal usage fail-closed", async () => {
    const adapter = new KieMarketAdapter({ apiKey: "server-only-fixture", callbackUrl: "https://engine.example.test/webhooks/kie", estimateMaximum: () => 4, fetch: (async () => { throw new Error("reset"); }) as typeof globalThis.fetch });
    await expect(adapter.submit(request, "ignored")).rejects.toHaveProperty("name", "ProviderSubmissionUnknownError");
    const terminal = new KieMarketAdapter({ apiKey: "server-only-fixture", callbackUrl: "https://engine.example.test/webhooks/kie", estimateMaximum: () => 4, fetch: (async () => json({ code: 200, data: { taskId: "kie-task-2", state: "success" } })) as typeof globalThis.fetch });
    await expect(terminal.getTask("kie-task-2")).rejects.toMatchObject({ code: "INCOMPLETE_TERMINAL_RESULT" });
  });
  it("normalizes decimal native usage with the route scale", async () => {
    const adapter = new KieMarketAdapter({ apiKey: "server-only-fixture", callbackUrl: "https://engine.example.test/webhooks/kie", estimateMaximum: () => 4, nativeScale: 100n, fetch: (async () => json({ code: 200, data: { taskId: "kie-decimal", state: "failed", creditsConsumed: "0.25" } })) as typeof globalThis.fetch });
    await expect(adapter.getTask("kie-decimal")).resolves.toMatchObject({ actualProviderCredits: 25, chargeStatus: "ACTUAL" });
  });
  it("uses the canonical confirmed-no-charge pair and recognizes documented queueing states", async () => {
    const noCharge = new KieMarketAdapter({ apiKey: "server-only-fixture", callbackUrl: "https://engine.example.test/webhooks/kie", estimateMaximum: () => 4, fetch: (async () => json({ code: 200, data: { taskId: "kie-free-failure", state: "fail", creditsConsumed: 0 } })) as typeof globalThis.fetch });
    await expect(noCharge.getTask("kie-free-failure")).resolves.toMatchObject({
      status: "failed",
      actualProviderCredits: null,
      chargeStatus: "CONFIRMED_NO_CHARGE",
    });
    const queueing = new KieMarketAdapter({ apiKey: "server-only-fixture", callbackUrl: "https://engine.example.test/webhooks/kie", estimateMaximum: () => 4, fetch: (async () => json({ code: 200, data: { taskId: "kie-queue", state: "queuing" } })) as typeof globalThis.fetch });
    await expect(queueing.getTask("kie-queue")).resolves.toMatchObject({ status: "submitted" });
    const generating = new KieMarketAdapter({ apiKey: "server-only-fixture", callbackUrl: "https://engine.example.test/webhooks/kie", estimateMaximum: () => 4, fetch: (async () => json({ code: 200, data: { taskId: "kie-running", state: "generating" } })) as typeof globalThis.fetch });
    await expect(generating.getTask("kie-running")).resolves.toMatchObject({ status: "running" });
  });
  it("enforces a bounded, redirect-free result download", async () => {
    const adapter = new KieMarketAdapter({ apiKey: "server-only-fixture", callbackUrl: "https://engine.example.test/webhooks/kie", estimateMaximum: () => 4, fetch: (async () => new Response(new Uint8Array([1, 2, 3, 4, 5]), { headers: { "content-type": "image/png" } })) as typeof globalThis.fetch });
    await expect(adapter.fetchAsset("https://api.kie.ai/result.png", 4)).rejects.toMatchObject({ code: "RESULT_TOO_LARGE" });
  });
  it("does not misclassify a KIE server failure as a zero-charge rejection", async () => {
    const adapter = new KieMarketAdapter({ apiKey: "server-only-fixture", callbackUrl: "https://engine.example.test/webhooks/kie", estimateMaximum: () => 4, fetch: (async () => new Response("temporary outage", { status: 503 })) as typeof globalThis.fetch });
    await expect(adapter.submit(request, "ignored")).rejects.toHaveProperty("name", "ProviderSubmissionUnknownError");
  });
  it("covers every declared offline KIE route variant with a bounded submit fixture", async () => {
    for (const route of kieOfflineRouteFixtures) {
      const adapter = new KieMarketAdapter({ apiKey: "server-only-fixture", callbackUrl: "https://engine.example.test/webhooks/kie", estimateMaximum: () => 4, nativeScale: route.nativeScale, fetch: (async () => json({ code: 200, data: { taskId: `task-${route.routeId}` } })) as typeof globalThis.fetch });
      await expect(adapter.submit(kieFixtureRequest(route.routeId), "no-kie-idempotency-assumption")).resolves.toMatchObject({ taskId: `task-${route.routeId}`, estimatedProviderCredits: 4 });
    }
  });
});
