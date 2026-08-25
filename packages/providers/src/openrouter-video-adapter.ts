import { z } from "zod";
import type {
  ProviderGenerationRequest,
  ProviderSubmitResponse,
  ProviderTaskResponse,
} from "../../contracts/src/provider.js";
import { decimalToAtomic } from "../../provider-treasury/src/decimal.js";
import {
  ProviderDefinitiveError,
  ProviderSubmissionUnknownError,
  providerHttpFailure,
  type ProviderAdapter,
  type ProviderAsset,
} from "./types.js";
import { readBoundedProviderAsset } from "./bounded-response.js";

const ModelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1) })),
});
const CreditsResponseSchema = z.object({
  data: z.object({
    total_credits: z.union([z.string(), z.number()]),
    total_usage: z.union([z.string(), z.number()]),
  }),
});
const SubmitResponseSchema = z.object({ id: z.string().min(1), status: z.literal("pending") });
const PollResponseSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["pending", "in_progress", "completed", "failed"]),
  unsigned_urls: z.string().url().array().optional(),
  usage: z.object({ cost: z.union([z.string(), z.number()]).optional() }).optional(),
  error: z.union([z.string(), z.object({ message: z.string().optional() })]).optional(),
});

type OpenRouterVideoAdapterOptions = {
  apiKey: string;
  managementKey?: string;
  /** Optional: polling is authoritative when no workspace signing secret is configured. */
  callbackUrl?: string;
  estimateMaximumAtomic: (request: ProviderGenerationRequest) => bigint;
  fetch?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
};

function safeNumber(value: bigint, code: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ProviderDefinitiveError(code, "Provider atomic amount exceeds the canonical safe integer range.");
  }
  return Number(value);
}

export class OpenRouterVideoAdapter implements ProviderAdapter {
  readonly id = "openrouter";
  readonly displayName = "OpenRouter";
  readonly version = "openrouter-video.v1";
  readonly accounting = {
    nativeUnit: "openrouter_credit",
    nativeScale: 1_000_000n,
    actualUsageSource: "usage.cost",
  } as const;
  readonly assetSourcePolicy;
  private readonly baseUrl: string;
  private readonly transport: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpenRouterVideoAdapterOptions) {
    if (!options.apiKey) throw new TypeError("OpenRouter API key is required server-side.");
    if (options.callbackUrl && new URL(options.callbackUrl).protocol !== "https:") throw new TypeError("OpenRouter callback URL must use HTTPS.");
    this.baseUrl = (options.baseUrl ?? "https://openrouter.ai").replace(/\/$/, "");
    this.transport = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.assetSourcePolicy = {
      allowedOrigins: [new URL(this.baseUrl).origin],
      allowHttpLoopbackForLocalTest: false,
      allowPrivateLoopbackForLocalTest: false,
    } as const;
  }

  async listModels() {
    const response = ModelsResponseSchema.parse(await this.request("/api/v1/videos/models", this.options.apiKey));
    return response.data.map(({ id }) => ({ id, mediaType: "video" as const, nativeUnit: "provider_credit" as const }));
  }

  async getBalance() {
    if (!this.options.managementKey) {
      throw new ProviderDefinitiveError("MANAGEMENT_KEY_REQUIRED", "OpenRouter Credits API requires a scoped management key.");
    }
    const response = CreditsResponseSchema.parse(await this.request("/api/v1/credits", this.options.managementKey));
    const total = decimalToAtomic(response.data.total_credits, this.accounting.nativeScale, "ceil");
    const used = decimalToAtomic(response.data.total_usage, this.accounting.nativeScale, "ceil");
    if (used > total) throw new ProviderDefinitiveError("INVALID_CREDITS_SNAPSHOT", "OpenRouter usage exceeds purchased credits.");
    return {
      provider: this.id,
      unit: "provider_credit" as const,
      available: safeNumber(total - used, "BALANCE_OUT_OF_RANGE"),
      held: 0,
      spent: safeNumber(used, "BALANCE_OUT_OF_RANGE"),
    };
  }

  async submit(request: ProviderGenerationRequest, _idempotencyKey: string): Promise<ProviderSubmitResponse> {
    if (request.mediaType !== "video" || !request.input.prompt) {
      throw new ProviderDefinitiveError("INVALID_VIDEO_REQUEST", "OpenRouter video requires mediaType=video and a prompt.");
    }
    const maximum = this.options.estimateMaximumAtomic(request);
    try {
      const response = await this.raw("/api/v1/videos", this.options.apiKey, {
        method: "POST",
        body: JSON.stringify({
          model: request.model,
          prompt: request.input.prompt,
          duration: request.input.durationSeconds,
          resolution: request.input.resolution,
          aspect_ratio: request.input.aspectRatio,
          generate_audio: request.input.audio,
          ...(this.options.callbackUrl ? { callback_url: this.options.callbackUrl } : {}),
        }),
      });
      return {
        taskId: SubmitResponseSchema.parse(await this.payload(response)).id,
        status: "submitted",
        estimatedProviderCredits: safeNumber(maximum, "ESTIMATE_OUT_OF_RANGE"),
      };
    } catch (error) {
      if (error instanceof ProviderDefinitiveError) throw error;
      throw new ProviderSubmissionUnknownError(error instanceof Error ? error.message : "OpenRouter submission outcome is unknown.");
    }
  }

  async lookupByIdempotency(_idempotencyKey: string): Promise<ProviderTaskResponse | null> {
    return null;
  }

  async getTask(taskId: string): Promise<ProviderTaskResponse> {
    const task = PollResponseSchema.parse(await this.request(`/api/v1/videos/${encodeURIComponent(taskId)}`, this.options.apiKey));
    if (task.status === "pending" || task.status === "in_progress") {
      return {
        taskId: task.id,
        status: task.status === "pending" ? "submitted" : "running",
        actualProviderCredits: null,
        resultUrl: null,
        errorCode: null,
        chargeStatus: "UNKNOWN",
      };
    }
    const usage = task.usage?.cost;
    const actual = usage === undefined ? null : decimalToAtomic(usage, this.accounting.nativeScale, "ceil");
    if (task.status === "completed") {
      if (actual === null || !task.unsigned_urls?.[0]) {
        throw new ProviderDefinitiveError("INCOMPLETE_TERMINAL_USAGE", "Completed OpenRouter video lacks usage.cost or result URL.");
      }
      return {
        taskId: task.id,
        status: "succeeded",
        actualProviderCredits: safeNumber(actual, "COST_OUT_OF_RANGE"),
        resultUrl: task.unsigned_urls[0],
        errorCode: null,
        chargeStatus: "ACTUAL",
      };
    }
    return {
      taskId: task.id,
      status: "failed",
      actualProviderCredits: actual === null ? null : safeNumber(actual, "COST_OUT_OF_RANGE"),
      resultUrl: null,
      errorCode: "OPENROUTER_FAILED",
      chargeStatus: actual === null ? "UNKNOWN" : "ACTUAL",
    };
  }

  async fetchAsset(resultUrl: string, maxBytes = 100 * 1024 * 1024): Promise<ProviderAsset> {
    const url = new URL(resultUrl);
    const allowed = new URL(this.baseUrl);
    if (url.origin !== allowed.origin || !url.pathname.startsWith("/api/v1/videos/")) {
      throw new ProviderDefinitiveError("UNTRUSTED_RESULT_URL", "OpenRouter result URL is not allowlisted.");
    }
    const response = await this.raw(resultUrl, this.options.apiKey, { redirect: "error" });
    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
    return { bytes: await readBoundedProviderAsset(response, maxBytes), contentType, sourceUrl: resultUrl };
  }

  private async request(path: string, key: string): Promise<unknown> {
    return this.payload(await this.raw(path, key));
  }

  private async raw(pathOrUrl: string, key: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.transport(pathOrUrl.startsWith("http") ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`, {
        ...init,
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${key}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw providerHttpFailure("openrouter", response.status, "OpenRouter request failed.");
    }
    return response;
  }

  private async payload(response: Response): Promise<unknown> {
    return response.json().catch(() => {
      throw new ProviderDefinitiveError("INVALID_PROVIDER_RESPONSE", "OpenRouter returned invalid JSON.");
    });
  }
}
