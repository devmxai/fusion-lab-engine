// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageEngineRequestError } from "./image-quote-client";
import { confirmVideoQuote, recoverVideoOperation, requestVideoQuote } from "./video-quote-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Video quote client", () => {
  it("preserves a typed Engine quote-expiry error instead of fabricating an operation", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "QUOTE_EXPIRED", message: "raw" } }), { status: 409, headers: { "content-type": "application/json" } })) as typeof fetch;

    await expect(confirmVideoQuote({ id: "quote", requestHash: "a".repeat(64) } as any, "intent-12345678"))
      .rejects.toMatchObject({ name: "ImageEngineRequestError", status: 409, code: "QUOTE_EXPIRED" } satisfies Partial<ImageEngineRequestError>);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves a typed access error while recovering a video operation", async () => {
    // The local bootstrap is cached after the preceding request; this call is
    // the actual operation read and must retain the Engine's typed response.
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "ASSET_ACCESS_DENIED", message: "raw" } }), { status: 403, headers: { "content-type": "application/json" } })) as typeof fetch;

    await expect(recoverVideoOperation("operation-1"))
      .rejects.toMatchObject({ name: "ImageEngineRequestError", status: 403, code: "ASSET_ACCESS_DENIED" } satisfies Partial<ImageEngineRequestError>);
  });

  it("keeps the project card binding while sending a generated asset's durable delivery ID to the Engine", async () => {
    const durableAssetId = "d065c35b-294e-4a25-9ee0-163e6ca71368";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/dev/session/bootstrap")) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ id: "quote-1", requestHash: "a".repeat(64) }), { headers: { "content-type": "application/json" } });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await requestVideoQuote({
      schemaVersion: 1,
      projectId: "project-1",
      recipeId: "video.image-to-video",
      bindings: [{ assetId: "output:operation-1", slot: "FIRST_FRAME", ordinal: 0 }],
      prompt: "animate this image",
      offerId: "offer-1",
      modelId: "kling-3.0/video",
      settings: {},
      anchor: { x: 0, y: 0 },
      updatedAt: new Date().toISOString(),
    }, {
      assets: {
        "output:operation-1": {
          id: "output:operation-1",
          deliveryAssetId: durableAssetId,
          kind: "IMAGE",
          status: "READY",
        },
      },
    } as any);

    const quoteCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/v2/quotes"));
    expect(quoteCall).toBeTruthy();
    const payload = JSON.parse(String((quoteCall?.[1] as RequestInit).body));
    expect(payload.bindings[0].assetId).toBe(durableAssetId);
  });
});
