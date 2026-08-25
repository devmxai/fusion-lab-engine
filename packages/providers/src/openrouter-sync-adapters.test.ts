import { describe, expect, it, vi } from "vitest";
import { OpenRouterChatAdapter, OpenRouterImageAdapter, OpenRouterSttAdapter, OpenRouterTtsAdapter } from "./openrouter-sync-adapters.ts";
import { OpenRouterCatalogSnapshotImporter } from "./openrouter-catalog-importer.ts";
import { OpenRouterGenerationUsageClient, OpenRouterKeyStatusClient } from "./openrouter-audit-client.ts";

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("OpenRouter synchronous protocol adapters", () => {
  it("uses the exact documented Chat, Image, TTS and STT routes through injected fixture transport", async () => {
    const transport = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("/api/v1/chat/completions")) {
        expect(body).toMatchObject({ model: "openai/fixture-chat", stream: false, provider: { only: ["openai"], allow_fallbacks: false } });
        return json({ id: "gen-chat", model: "openai/fixture-chat-actual", choices: [{ message: { content: "fixture answer" } }], usage: { cost: "0.000014" } });
      }
      if (String(url).endsWith("/api/v1/images")) {
        expect(body).toMatchObject({ model: "openai/fixture-image", prompt: "fixture image", n: 1, resolution: "2K", aspect_ratio: "16:9" });
        return json({ data: [{ b64_json: "aW1hZ2U=", media_type: "image/png" }], usage: { cost: 0.04 } }, 200, { "x-generation-id": "gen-image" });
      }
      if (String(url).endsWith("/api/v1/audio/speech")) {
        expect(body).toMatchObject({ model: "openai/fixture-tts", input: "hello", voice: "alloy", response_format: "mp3" });
        return new Response(new Uint8Array([73, 68, 51]), { headers: { "content-type": "audio/mpeg", "x-generation-id": "gen-tts" } });
      }
      if (String(url).endsWith("/api/v1/audio/transcriptions")) {
        expect(body).toMatchObject({ model: "openai/fixture-stt", input_audio: { data: "UklGRg==", format: "wav" }, language: "en" });
        return json({ text: "fixture transcript", usage: { cost: "0.000508" } }, 200, { "x-generation-id": "gen-stt" });
      }
      throw new Error(`unexpected ${url}`);
    });
    const options = { apiKey: "fixture-server-key", fetch: transport as typeof fetch };
    const chat = await new OpenRouterChatAdapter(options).complete({ model: "openai/fixture-chat", messages: [{ role: "user", content: "test" }], routing: { only: ["openai"], allowFallbacks: false } });
    const image = await new OpenRouterImageAdapter(options).generate({ model: "openai/fixture-image", prompt: "fixture image", quantity: 1, resolution: "2K", aspectRatio: "16:9" });
    const tts = await new OpenRouterTtsAdapter(options).synthesize({ model: "openai/fixture-tts", text: "hello", voice: "alloy", responseFormat: "mp3" });
    const stt = await new OpenRouterSttAdapter(options).transcribe({ model: "openai/fixture-stt", audioBase64: "UklGRg==", format: "wav", language: "en" });
    expect(chat).toMatchObject({ generationId: "gen-chat", actualModel: "openai/fixture-chat-actual", actualProviderCostAtomic: 14, reconciliationRequired: false });
    expect(image).toMatchObject({ generationId: "gen-image", actualProviderCostAtomic: 40_000, assets: [{ contentType: "image/png" }] });
    expect(tts).toMatchObject({ generationId: "gen-tts", actualProviderCostAtomic: null, chargeStatus: "UNKNOWN", reconciliationRequired: true, assets: [{ contentType: "audio/mpeg" }] });
    expect(stt).toMatchObject({ generationId: "gen-stt", text: "fixture transcript", actualProviderCostAtomic: 508 });
    expect(transport.mock.calls.every(([, init]) => new Headers(init?.headers).get("authorization") === "Bearer fixture-server-key")).toBe(true);
  });

  it("fails closed on unknown transport outcome and never fabricates missing synchronous usage", async () => {
    const unknown = new OpenRouterImageAdapter({ apiKey: "fixture-server-key", fetch: (async () => { throw new Error("connection reset"); }) as typeof fetch });
    await expect(unknown.generate({ model: "image", prompt: "test" })).rejects.toHaveProperty("name", "ProviderSubmissionUnknownError");
    const noUsage = new OpenRouterChatAdapter({ apiKey: "fixture-server-key", fetch: (async () => json({ id: "gen-no-cost", model: "model", choices: [{ message: { content: "answer" } }] })) as typeof fetch });
    await expect(noUsage.complete({ model: "model", messages: [{ role: "user", content: "test" }] })).resolves.toMatchObject({ actualProviderCostAtomic: null, chargeStatus: "UNKNOWN", reconciliationRequired: true });
  });

  it("does not misclassify an OpenRouter server failure as a zero-charge rejection", async () => {
    const adapter = new OpenRouterImageAdapter({ apiKey: "fixture-server-key", fetch: (async () => new Response("temporary outage", { status: 503 })) as typeof fetch });
    await expect(adapter.generate({ model: "image", prompt: "test" })).rejects.toHaveProperty("name", "ProviderRetryableError");
  });
});

describe("OpenRouter catalog snapshot importer", () => {
  it("normalizes endpoint-specific capability and pricing without treating model unions as a route price", () => {
    const importer = new OpenRouterCatalogSnapshotImporter();
    expect(importer.normalizeGeneralEndpoint({ provider_name: "OpenAI", provider_slug: "openai", provider_tag: "openai", supported_parameters: { max_tokens: {}, temperature: {} }, pricing: { prompt: "0.000001", completion: "0.000002" } })).toMatchObject({ providerSlug: "openai", pricing: [{ billable: "prompt", costAtomic: 1 }, { billable: "completion", costAtomic: 2 }] });
    expect(importer.normalizeImageEndpoint({ provider_name: "Bytedance", provider_slug: "bytedance", supported_parameters: { resolution: {} }, pricing: [{ billable: "output_image", unit: "image", cost_usd: 0.05, variant: "2k" }] })).toMatchObject({ pricing: [{ billable: "output_image", unit: "image", variant: "2k", costAtomic: 50_000 }] });
    expect(importer.normalizeVideoModel({ id: "google/fixture-video", supported_resolutions: ["720p"], pricing_skus: { generate: "0.50", "generate-1080p": "0.75" } })).toMatchObject({ model: "google/fixture-video", pricing: [{ billable: "generate", costAtomic: 500_000 }, { billable: "generate-1080p", costAtomic: 750_000 }] });
    expect(() => importer.normalizeVideoModel({ id: "unknown/video" })).toThrowError(expect.objectContaining({ code: "INCOMPLETE_CATALOG_PRICING" }));
  });
});

describe("OpenRouter actual-cost and key-limit evidence", () => {
  it("records actual model/host/cost from the generation audit and keeps key limits as observations", async () => {
    const transport = vi.fn(async (url: string | URL) => {
      if (String(url).includes("/api/v1/generation?id=gen-audit")) return json({ data: { id: "gen-audit", model: "openai/gpt-image-2", provider_name: "OpenAI", total_cost: "0.040000", usage: "0.040000" } });
      if (String(url).endsWith("/api/v1/key")) return json({ data: { limit: 10, limit_remaining: "8.5", limit_reset: "monthly", is_management_key: false, label: "must-not-leak" } });
      throw new Error(`unexpected ${url}`);
    });
    const options = { apiKey: "fixture-read-only-key", fetch: transport as typeof fetch };
    await expect(new OpenRouterGenerationUsageClient(options).get("gen-audit")).resolves.toEqual({ generationId: "gen-audit", actualModel: "openai/gpt-image-2", actualHostingProvider: "OpenAI", actualProviderCostAtomic: 40_000, reconciliationRequired: false });
    await expect(new OpenRouterKeyStatusClient(options).get()).resolves.toEqual({ providerSideLimitAtomic: 10_000_000, providerSideRemainingAtomic: 8_500_000, reset: "monthly", managementKey: false });
  });

  it("fails closed on mismatched generation evidence or a cost discrepancy", async () => {
    const mismatch = new OpenRouterGenerationUsageClient({ apiKey: "fixture", fetch: (async () => json({ data: { id: "other", total_cost: 0.01 } })) as typeof fetch });
    await expect(mismatch.get("expected")).rejects.toMatchObject({ code: "GENERATION_ID_MISMATCH" });
    const costMismatch = new OpenRouterGenerationUsageClient({ apiKey: "fixture", fetch: (async () => json({ data: { id: "expected", total_cost: 0.01, usage: 0.02 } })) as typeof fetch });
    await expect(costMismatch.get("expected")).rejects.toMatchObject({ code: "GENERATION_COST_MISMATCH" });
  });
});
