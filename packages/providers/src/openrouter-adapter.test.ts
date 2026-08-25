import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ProviderGenerationRequest } from "../../contracts/src/provider.ts";
import { OpenRouterVideoAdapter } from "./openrouter-video-adapter.ts";
import { parseOpenRouterWebhook, verifyOpenRouterWebhookSignature } from "./openrouter-webhook.ts";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const videoRequest: ProviderGenerationRequest = {
  operationId: "operation-openrouter-1",
  model: "example/video-model-v1",
  mediaType: "video",
  scenario: "success",
  input: {
    prompt: "A local contract test video",
    quantity: 1,
    durationSeconds: 5,
    resolution: "720p",
    audio: false,
    aspectRatio: "16:9",
  },
};

describe("OpenRouter async video adapter contract", () => {
  it("maps model discovery, scoped balance, submit, poll and asset download without a real request", async () => {
    const transport = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/videos/models")) return jsonResponse({ data: [{ id: "example/video-model-v1" }] });
      if (url.endsWith("/api/v1/credits")) return jsonResponse({ data: { total_credits: "100.50", total_usage: "25.75" } });
      if (url.endsWith("/api/v1/videos") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body).toEqual({
          model: "example/video-model-v1",
          prompt: "A local contract test video",
          duration: 5,
          resolution: "720p",
          aspect_ratio: "16:9",
          generate_audio: false,
          callback_url: "https://engine.example.test/webhooks/openrouter",
        });
        return jsonResponse({ id: "openrouter-job-1", polling_url: "https://openrouter.ai/api/v1/videos/openrouter-job-1", status: "pending" }, 202);
      }
      if (url.endsWith("/api/v1/videos/openrouter-job-1")) {
        return jsonResponse({
          id: "openrouter-job-1",
          status: "completed",
          unsigned_urls: ["https://openrouter.ai/api/v1/videos/openrouter-job-1/content?index=0"],
          usage: { cost: "0.250001" },
        });
      }
      if (url.includes("/content?index=0")) {
        return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), {
          headers: { "content-type": "video/mp4" },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const adapter = new OpenRouterVideoAdapter({
      apiKey: "server-generation-key",
      managementKey: "scoped-management-key",
      callbackUrl: "https://engine.example.test/webhooks/openrouter",
      estimateMaximumAtomic: () => 500_000n,
      fetch: transport as typeof fetch,
    });
    expect(await adapter.listModels()).toEqual([
      { id: "example/video-model-v1", mediaType: "video", nativeUnit: "provider_credit" },
    ]);
    expect(await adapter.getBalance()).toMatchObject({ available: 74_750_000, spent: 25_750_000 });
    const submitted = await adapter.submit(videoRequest, "local-idempotency-only");
    expect(submitted).toEqual({ taskId: "openrouter-job-1", status: "submitted", estimatedProviderCredits: 500_000 });
    const task = await adapter.getTask(submitted.taskId);
    expect(task).toMatchObject({
      status: "succeeded",
      actualProviderCredits: 250_001,
      chargeStatus: "ACTUAL",
    });
    const asset = await adapter.fetchAsset(task.resultUrl!);
    expect(asset).toMatchObject({ contentType: "video/mp4", sourceUrl: task.resultUrl });
    expect(transport.mock.calls.every(([, init]) => {
      const headers = new Headers(init?.headers);
      return headers.get("authorization")?.startsWith("Bearer ");
    })).toBe(true);
  });

  it("keeps failed jobs with missing usage cost unknown and does not invent no-charge evidence", async () => {
    const adapter = new OpenRouterVideoAdapter({
      apiKey: "server-generation-key",
      callbackUrl: "https://engine.example.test/webhooks/openrouter",
      estimateMaximumAtomic: () => 500_000n,
      fetch: (async () => jsonResponse({ id: "job-failed", status: "failed", error: "policy" })) as typeof fetch,
    });
    await expect(adapter.getBalance()).rejects.toMatchObject({ code: "MANAGEMENT_KEY_REQUIRED" });
    await expect(adapter.getTask("job-failed")).resolves.toMatchObject({
      status: "failed",
      actualProviderCredits: null,
      chargeStatus: "UNKNOWN",
    });
  });

  it("supports authoritative polling with only an API key and does not invent a callback URL", async () => {
    const transport = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "example/video-model-v1", prompt: "A local contract test video", duration: 5,
        resolution: "720p", aspect_ratio: "16:9", generate_audio: false,
      });
      return jsonResponse({ id: "poll-only-job", status: "pending" }, 202);
    });
    const adapter = new OpenRouterVideoAdapter({
      apiKey: "server-generation-key", estimateMaximumAtomic: () => 500_000n,
      fetch: transport as typeof fetch,
    });
    await expect(adapter.submit(videoRequest, "local-idempotency-only"))
      .resolves.toMatchObject({ taskId: "poll-only-job", status: "submitted" });
  });

  it("rejects untrusted result origins and maps an ambiguous submit transport to submission unknown", async () => {
    const adapter = new OpenRouterVideoAdapter({
      apiKey: "server-generation-key",
      callbackUrl: "https://engine.example.test/webhooks/openrouter",
      estimateMaximumAtomic: () => 500_000n,
      fetch: (async () => { throw new Error("socket reset"); }) as typeof fetch,
    });
    await expect(adapter.submit(videoRequest, "request-key")).rejects.toHaveProperty("name", "ProviderSubmissionUnknownError");
    await expect(adapter.fetchAsset("https://attacker.invalid/video.mp4"))
      .rejects.toMatchObject({ code: "UNTRUSTED_RESULT_URL" });
    await expect(adapter.lookupByIdempotency("request-key")).resolves.toBeNull();
  });

  it("enforces the asset byte budget before returning an OpenRouter result", async () => {
    const adapter = new OpenRouterVideoAdapter({
      apiKey: "server-generation-key",
      callbackUrl: "https://engine.example.test/webhooks/openrouter",
      estimateMaximumAtomic: () => 500_000n,
      fetch: (async () => new Response(new Uint8Array([1, 2, 3, 4, 5]), { headers: { "content-type": "video/mp4" } })) as typeof fetch,
    });
    await expect(adapter.fetchAsset("https://openrouter.ai/api/v1/videos/job/content?index=0", 4))
      .rejects.toMatchObject({ code: "RESULT_TOO_LARGE" });
  });

  it("does not misclassify an OpenRouter server failure as a zero-charge rejection", async () => {
    const adapter = new OpenRouterVideoAdapter({
      apiKey: "server-generation-key",
      callbackUrl: "https://engine.example.test/webhooks/openrouter",
      estimateMaximumAtomic: () => 500_000n,
      fetch: (async () => new Response("temporary outage", { status: 503 })) as typeof fetch,
    });
    await expect(adapter.submit(videoRequest, "request-key")).rejects.toHaveProperty("name", "ProviderSubmissionUnknownError");
  });
});

describe("OpenRouter raw-body webhook verification", () => {
  const secret = "local-webhook-signing-secret";
  const timestamp = 1_786_536_000;
  const body = new TextEncoder().encode(JSON.stringify({
    type: "video.generation.completed",
    created_at: "2026-08-12T12:00:00.000Z",
    data: {
      id: "openrouter-job-2",
      status: "completed",
      generation_id: "generation-2",
      model: "example/video-model-v1",
      unsigned_urls: ["https://openrouter.ai/api/v1/videos/openrouter-job-2/content?index=0"],
      usage: { cost: 0.5, is_byok: false },
    },
  }));
  const signature = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp},`), Buffer.from(body)]))
    .digest("hex");
  const header = `t=${timestamp},v1=${signature}`;

  it("verifies exact raw bytes and converts a terminal webhook to canonical actual usage", () => {
    expect(verifyOpenRouterWebhookSignature({ rawBody: body, signatureHeader: header, secret, nowEpochSeconds: timestamp }))
      .toBe(true);
    expect(parseOpenRouterWebhook({
      rawBody: body,
      signatureHeader: header,
      deliveryId: "openrouter-job-2-completed",
      secret,
      nowEpochSeconds: timestamp,
    })).toMatchObject({
      deliveryId: "openrouter-job-2-completed",
      task: { taskId: "openrouter-job-2", status: "succeeded", actualProviderCredits: 500_000, chargeStatus: "ACTUAL" },
    });
  });

  it("rejects changed bytes, stale timestamps and completed events without usage.cost", () => {
    expect(verifyOpenRouterWebhookSignature({
      rawBody: new TextEncoder().encode(`${Buffer.from(body).toString("utf8")} `),
      signatureHeader: header,
      secret,
      nowEpochSeconds: timestamp,
    })).toBe(false);
    expect(verifyOpenRouterWebhookSignature({ rawBody: body, signatureHeader: header, secret, nowEpochSeconds: timestamp + 301 }))
      .toBe(false);
    const incomplete = new TextEncoder().encode(JSON.stringify({
      type: "video.generation.completed",
      created_at: "2026-08-12T12:00:00.000Z",
      data: { id: "job-incomplete", status: "completed", unsigned_urls: ["https://openrouter.ai/video.mp4"] },
    }));
    const incompleteSignature = createHmac("sha256", secret)
      .update(Buffer.concat([Buffer.from(`${timestamp},`), Buffer.from(incomplete)]))
      .digest("hex");
    expect(() => parseOpenRouterWebhook({
      rawBody: incomplete,
      signatureHeader: `t=${timestamp},v1=${incompleteSignature}`,
      deliveryId: "job-incomplete-completed",
      secret,
      nowEpochSeconds: timestamp,
    })).toThrowError(expect.objectContaining({ code: "INCOMPLETE_TERMINAL_USAGE" }));
    expect(() => parseOpenRouterWebhook({
      rawBody: body,
      signatureHeader: header,
      deliveryId: "wrong-task-completed",
      secret,
      nowEpochSeconds: timestamp,
    })).toThrowError(expect.objectContaining({ code: "WEBHOOK_DELIVERY_MISMATCH" }));
  });
});
