import { afterEach, describe, expect, it, vi } from "vitest";
import { startLocalGeneration } from "./local-provider-client";

type MockResponseBody = Record<string, unknown>;

function response(body: MockResponseBody, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function wavResponse() {
  const bytes = new TextEncoder().encode("RIFF-test-wave");
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "audio/wav" }),
    arrayBuffer: async () => bytes.buffer,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local provider browser bridge", () => {
  it("runs TTS through the same local provider lifecycle and returns a test WAV", async () => {
    const states = [
      "RUNNING",
      "PROVIDER_SUCCEEDED",
      "ASSET_STORED",
      "DELIVERED",
      "SETTLED",
    ];
    let advanceIndex = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/quotes")) {
        return response({ id: "quote-1", customerCredits: 2 }, 201);
      }
      if (url.endsWith("/operations")) {
        return response({
          id: "operation-1",
          state: "SUBMITTED",
          resultUrl: null,
          customerCredits: 2,
        }, 202);
      }
      if (url.endsWith("/advance")) {
        const state = states[advanceIndex++];
        return response({
          id: "operation-1",
          state,
          resultUrl: state === "SETTLED" ? "/v1/dev/mock/assets/operation-1.svg" : null,
          customerCredits: 2,
        });
      }
      if (url.includes("/assets/operation-1")) return wavResponse();
      throw new Error(`Unexpected local request: ${url} ${init?.method || "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await startLocalGeneration({
      apiType: "tts",
      toolId: "gemini-tts",
      characterCount: 250,
      idempotencyKey: "local-audio-0001",
    });

    expect(result).toMatchObject({
      success: true,
      taskId: "operation-1",
      creditsCharged: 2,
      mimeType: "audio/wav",
      localOnly: true,
    });
    expect(atob(result.audioBase64!).slice(0, 4)).toBe("RIFF");
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("/api/engine/")))
      .toBe(true);

    const quoteBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(quoteBody).toMatchObject({
      modelId: "local/test-audio-v1",
      characterCount: 250,
    });
  });

  it("starts an image task without contacting or naming an official provider", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/quotes")) {
        return response({ id: "quote-2", customerCredits: 2 }, 201);
      }
      return response({
        id: "operation-2",
        state: "SUBMITTED",
        resultUrl: null,
        customerCredits: 2,
      }, 202);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await startLocalGeneration({
      apiType: "standard",
      toolId: "image-generator",
      idempotencyKey: "local-image-0001",
    });

    expect(result).not.toHaveProperty("audioBase64");
    const quoteBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(quoteBody.modelId).toBe("local/test-image-v1");
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/kie|openrouter|gemini/i);
  });
});
