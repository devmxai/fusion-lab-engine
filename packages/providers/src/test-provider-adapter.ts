import {
  ProviderBalanceResponseSchema,
  ProviderModelSchema,
  ProviderSubmitResponseSchema,
  ProviderTaskResponseSchema,
  type ProviderGenerationRequest,
  type ProviderSubmitResponse,
  type ProviderTaskResponse,
} from "../../contracts/src/provider.ts";
import {
  ProviderDefinitiveError,
  ProviderSubmissionUnknownError,
  providerHttpFailure,
  type ProviderAdapter,
  type ProviderAsset,
  type ProviderAssetSourcePolicy,
} from "./types.ts";
import { readBoundedProviderAsset } from "./bounded-response.ts";

type TestProviderAdapterOptions = {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
};

export class TestProviderHttpAdapter implements ProviderAdapter {
  readonly id = "provider-test";
  readonly displayName = "Provider For Test";
  readonly version = "1.0.0";
  readonly assetSourcePolicy: ProviderAssetSourcePolicy;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options: TestProviderAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    const origin = new URL(this.baseUrl);
    const loopback = ["127.0.0.1", "::1", "[::1]"].includes(origin.hostname);
    this.assetSourcePolicy = {
      allowedOrigins: [origin.origin],
      allowHttpLoopbackForLocalTest: origin.protocol === "http:" && loopback,
      allowPrivateLoopbackForLocalTest: loopback,
    };
  }

  async listModels() {
    const payload = await this.request("/v1/models");
    return ProviderModelSchema.array().parse(payload.models);
  }

  async getBalance() {
    return ProviderBalanceResponseSchema.parse(await this.request("/v1/credits"));
  }

  async submit(
    request: ProviderGenerationRequest,
    idempotencyKey: string,
  ): Promise<ProviderSubmitResponse> {
    const response = await this.rawRequest("/v1/generations", {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify(request),
    });
    if (response.status === 504) {
      throw new ProviderSubmissionUnknownError();
    }
    return ProviderSubmitResponseSchema.parse(await this.parseResponse(response));
  }

  async lookupByIdempotency(idempotencyKey: string): Promise<ProviderTaskResponse | null> {
    const response = await this.rawRequest(
      `/v1/generations/by-idempotency/${encodeURIComponent(idempotencyKey)}`,
    );
    if (response.status === 404) return null;
    return ProviderTaskResponseSchema.parse(await this.parseResponse(response));
  }

  async getTask(taskId: string): Promise<ProviderTaskResponse> {
    return ProviderTaskResponseSchema.parse(
      await this.request(`/v1/generations/${encodeURIComponent(taskId)}`),
    );
  }

  async fetchAsset(resultUrl: string, maxBytes = 100 * 1024 * 1024): Promise<ProviderAsset> {
    const parsed = new URL(resultUrl);
    const allowed = new URL(this.baseUrl);
    if (parsed.origin !== allowed.origin || !parsed.pathname.startsWith("/v1/assets/")) {
      throw new ProviderDefinitiveError("UNTRUSTED_RESULT_URL", "Provider result URL is not allowlisted.");
    }
    const response = await this.rawRequest(resultUrl, { redirect: "error" });
    if (!response.ok) {
      throw new ProviderDefinitiveError("RESULT_DOWNLOAD_FAILED", "Provider result download failed.");
    }
    const contentType = response.headers.get("content-type")?.split(";")[0] || "";
    const bytes = await readBoundedProviderAsset(response, maxBytes);
    return { bytes, contentType, sourceUrl: resultUrl };
  }

  async resetForDevelopment(): Promise<void> {
    const response = await this.rawRequest("/v1/dev/reset", {
      method: "POST",
      body: "{}",
    });
    if (response.status !== 204) await this.parseResponse(response);
  }

  private async request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    return this.parseResponse(await this.rawRequest(path, init));
  }

  private async rawRequest(pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch (error) {
      throw new ProviderSubmissionUnknownError(
        error instanceof Error ? error.message : "Provider transport failed.",
      );
    }
  }

  private async parseResponse(response: Response): Promise<Record<string, unknown>> {
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const error = payload?.error as { code?: string; message?: string } | undefined;
      if (error?.code) throw new ProviderDefinitiveError(error.code, error.message || "Provider request failed.");
      throw providerHttpFailure("provider_test", response.status, "Provider request failed.");
    }
    return payload || {};
  }
}
