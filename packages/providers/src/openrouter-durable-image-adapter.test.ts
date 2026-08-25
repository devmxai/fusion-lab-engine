import { describe, expect, it } from "vitest";
import type { ProviderGenerationRequest } from "../../contracts/src/provider.js";
import { OpenRouterDurableImageAdapter } from "./openrouter-durable-image-adapter.js";

const request: ProviderGenerationRequest = {
  operationId: "operation-1",
  model: "bytedance-seed/seedream-4.5",
  mediaType: "image",
  scenario: "success",
  input: { prompt: "durable image", quantity: 1, resolution: "1K", audio: false, aspectRatio: "1:1" },
};
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe("OpenRouterDurableImageAdapter", () => {
  it("escrows one synchronous result and recovers it without a second generation", async () => {
    let generationCalls = 0;
    let stored: { bytes: Uint8Array; metadata: Record<string, unknown> } | null = null;
    const transport = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/images")) {
        generationCalls += 1;
        return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from(png).toString("base64") }], usage: { cost: 0.04 } }), {
          status: 200, headers: { "content-type": "application/json", "x-generation-id": "generation-1" },
        });
      }
      if (url.includes("/object/info/")) {
        return stored ? new Response(JSON.stringify({ metadata: stored.metadata }), { status: 200, headers: { "content-type": "application/json" } }) : new Response("", { status: 404 });
      }
      if (url.includes("/storage/v1/object/") && init?.method === "POST") {
        const encoded = new Headers(init.headers).get("x-metadata")!;
        stored = { bytes: new Uint8Array(await new Response(init.body).arrayBuffer()), metadata: JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as Record<string, unknown> };
        return new Response(JSON.stringify({ Key: "escrow" }), { status: 200 });
      }
      if (url.includes("/storage/v1/object/")) {
        return stored ? new Response(stored.bytes, { status: 200, headers: { "content-type": "image/png" } }) : new Response("", { status: 404 });
      }
      throw new Error(`unexpected_url:${url}`);
    }) as typeof fetch;
    const adapter = new OpenRouterDurableImageAdapter({
      apiKey: "provider-key", supabaseUrl: "https://project.supabase.co", supabaseSecretKey: "service-key",
      estimateMaximumAtomic: () => 40_000, fetch: transport,
    });

    const submitted = await adapter.submit(request, "provider-attempt:operation-1:1");
    expect(submitted).toMatchObject({ status: "submitted", estimatedProviderCredits: 40_000 });
    const recoveredAfterRestart = new OpenRouterDurableImageAdapter({
      apiKey: "provider-key", supabaseUrl: "https://project.supabase.co", supabaseSecretKey: "service-key",
      estimateMaximumAtomic: () => 40_000, fetch: transport,
    });
    await expect(recoveredAfterRestart.lookupByIdempotency("provider-attempt:operation-1:1")).resolves.toMatchObject({
      taskId: submitted.taskId, status: "succeeded", actualProviderCredits: 40_000, chargeStatus: "ACTUAL",
    });
    const task = await recoveredAfterRestart.getTask(submitted.taskId);
    const asset = await recoveredAfterRestart.fetchAsset(task.resultUrl!);
    expect(asset).toMatchObject({ contentType: "image/png", bytes: png });
    await expect(adapter.submit(request, "provider-attempt:operation-1:1")).resolves.toEqual(submitted);
    expect(generationCalls).toBe(1);
  });

  it("accepts Supabase Storage's NoSuchKey envelope as an empty escrow preflight", async () => {
    let generationCalls = 0;
    let stored: { bytes: Uint8Array; metadata: Record<string, unknown> } | null = null;
    const transport = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/images")) {
        generationCalls += 1;
        return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from(png).toString("base64") }], usage: { cost: 0.04 } }), { status: 200 });
      }
      if (url.includes("/object/info/")) {
        return stored
          ? new Response(JSON.stringify({ metadata: stored.metadata }), { status: 200 })
          : new Response(JSON.stringify({ statusCode: "404", error: "not_found", code: "NoSuchKey" }), { status: 400 });
      }
      if (url.includes("/storage/v1/object/") && init?.method === "POST") {
        const encoded = new Headers(init.headers).get("x-metadata")!;
        stored = { bytes: new Uint8Array(await new Response(init.body).arrayBuffer()), metadata: JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as Record<string, unknown> };
        return new Response(JSON.stringify({ Key: "escrow" }), { status: 200 });
      }
      throw new Error(`unexpected_url:${url}`);
    }) as typeof fetch;
    const adapter = new OpenRouterDurableImageAdapter({
      apiKey: "provider-key", supabaseUrl: "https://project.supabase.co", supabaseSecretKey: "service-key",
      estimateMaximumAtomic: () => 40_000, fetch: transport,
    });

    await expect(adapter.submit(request, "provider-attempt:operation-nosuchkey:1")).resolves.toMatchObject({ status: "submitted" });
    expect(generationCalls).toBe(1);
  });

  it("keeps the submission unknown when durable escrow cannot be proven", async () => {
    const transport = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/object/info/")) return new Response("", { status: 404 });
      if (url.endsWith("/api/v1/images")) return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from(png).toString("base64") }], usage: { cost: 0.04 } }), { status: 200 });
      return new Response("storage unavailable", { status: 503 });
    }) as typeof fetch;
    const adapter = new OpenRouterDurableImageAdapter({
      apiKey: "provider-key", supabaseUrl: "https://project.supabase.co", supabaseSecretKey: "service-key",
      estimateMaximumAtomic: () => 40_000, fetch: transport,
    });
    await expect(adapter.submit(request, "provider-attempt:operation-1:1")).rejects.toHaveProperty("name", "ProviderSubmissionUnknownError");
  });
});
