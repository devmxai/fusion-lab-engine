import { z } from "zod";
import { decimalToAtomic } from "../../provider-treasury/src/decimal.js";
import { ProviderDefinitiveError, ProviderRetryableError, ProviderSubmissionUnknownError, providerHttpFailure } from "./types.js";

const CostSchema = z.union([z.string(), z.number()]);
const UsageSchema = z.object({ cost: CostSchema.optional() }).passthrough();
const ChatResponseSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional() }).passthrough() }).passthrough()).min(1),
  usage: UsageSchema.optional(),
}).passthrough();
const ImageResponseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1), media_type: z.string().min(1).optional() }).passthrough()).min(1),
  usage: UsageSchema.optional(),
}).passthrough();
const SttResponseSchema = z.object({ text: z.string(), usage: UsageSchema.optional() }).passthrough();

export type OpenRouterRoutingPolicy = {
  only?: string[];
  order?: string[];
  ignore?: string[];
  allowFallbacks?: boolean;
  /** Sent only by a route whose capability matrix explicitly certified it. */
  maxPrice?: number;
};

export type OpenRouterSynchronousResult = {
  protocol: "CHAT" | "IMAGE" | "TTS" | "STT";
  generationId: string | null;
  actualModel: string | null;
  actualProviderCostAtomic: number | null;
  chargeStatus: "ACTUAL" | "UNKNOWN";
  text: string | null;
  assets: Array<{ base64: string; contentType: string }>;
  /** A true result may exist while cost is unknown.  It must remain HELD until generation audit verifies the cost. */
  reconciliationRequired: boolean;
};

type BaseOptions = {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
};

type JsonRequest = { method: "POST"; body: Record<string, unknown> };

function safeAtomic(value: bigint, code: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ProviderDefinitiveError(code, "Provider atomic amount exceeds the canonical safe integer range.");
  }
  return Number(value);
}

function providerPolicy(policy: OpenRouterRoutingPolicy | undefined): Record<string, unknown> | undefined {
  if (!policy) return undefined;
  return {
    ...(policy.only ? { only: policy.only } : {}),
    ...(policy.order ? { order: policy.order } : {}),
    ...(policy.ignore ? { ignore: policy.ignore } : {}),
    ...(policy.allowFallbacks === undefined ? {} : { allow_fallbacks: policy.allowFallbacks }),
    ...(policy.maxPrice === undefined ? {} : { max_price: policy.maxPrice }),
  };
}

abstract class OpenRouterSynchronousAdapter {
  protected readonly baseUrl: string;
  protected readonly transport: typeof fetch;
  private readonly timeoutMs: number;

  protected constructor(private readonly options: BaseOptions) {
    if (!options.apiKey) throw new TypeError("OpenRouter API key is required server-side.");
    this.baseUrl = (options.baseUrl ?? "https://openrouter.ai").replace(/\/$/, "");
    this.transport = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  protected async request(path: string, request: JsonRequest): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(`${this.baseUrl}${path}`, {
        method: request.method,
        signal: controller.signal,
        headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(request.body),
      });
      if (!response.ok) throw providerHttpFailure("openrouter", response.status, "OpenRouter request failed.");
      return response;
    } catch (error) {
      if (error instanceof ProviderDefinitiveError || error instanceof ProviderRetryableError) throw error;
      throw new ProviderSubmissionUnknownError(error instanceof Error ? error.message : "OpenRouter submission outcome is unknown.");
    } finally {
      clearTimeout(timer);
    }
  }

  protected async json(response: Response): Promise<unknown> {
    return response.json().catch(() => {
      throw new ProviderDefinitiveError("INVALID_PROVIDER_RESPONSE", "OpenRouter returned invalid JSON.");
    });
  }

  protected costAtomic(cost: string | number | undefined): number | null {
    if (cost === undefined) return null;
    return safeAtomic(decimalToAtomic(cost, 1_000_000n, "ceil"), "COST_OUT_OF_RANGE");
  }
}

/** Normalizes the non-streaming Chat Completions protocol.  SSE has a dedicated stream parser before it may be certified. */
export class OpenRouterChatAdapter extends OpenRouterSynchronousAdapter {
  constructor(options: BaseOptions) { super(options); }

  async complete(input: { model: string; messages: Array<{ role: "system" | "user" | "assistant"; content: string }>; routing?: OpenRouterRoutingPolicy }): Promise<OpenRouterSynchronousResult> {
    const response = await this.request("/api/v1/chat/completions", { method: "POST", body: { model: input.model, messages: input.messages, stream: false, ...(providerPolicy(input.routing) ? { provider: providerPolicy(input.routing) } : {}) } });
    const payload = ChatResponseSchema.parse(await this.json(response));
    const cost = this.costAtomic(payload.usage?.cost);
    const text = payload.choices[0]?.message.content;
    if (text === null || text === undefined) throw new ProviderDefinitiveError("INCOMPLETE_RESULT", "Chat completion has no textual result.");
    return { protocol: "CHAT", generationId: payload.id, actualModel: payload.model, actualProviderCostAtomic: cost, chargeStatus: cost === null ? "UNKNOWN" : "ACTUAL", text, assets: [], reconciliationRequired: cost === null };
  }
}

/** Image output is inline base64; it is intentionally not treated as a remote asset URL. */
export class OpenRouterImageAdapter extends OpenRouterSynchronousAdapter {
  constructor(options: BaseOptions) { super(options); }

  async generate(input: { model: string; prompt: string; quantity?: number; resolution?: string; aspectRatio?: string; routing?: OpenRouterRoutingPolicy }): Promise<OpenRouterSynchronousResult> {
    const response = await this.request("/api/v1/images", { method: "POST", body: {
      model: input.model, prompt: input.prompt,
      ...(input.quantity ? { n: input.quantity } : {}),
      ...(input.resolution ? { resolution: input.resolution } : {}),
      ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
      ...(providerPolicy(input.routing) ? { provider: providerPolicy(input.routing) } : {}),
    } });
    const payload = ImageResponseSchema.parse(await this.json(response));
    const cost = this.costAtomic(payload.usage?.cost);
    return { protocol: "IMAGE", generationId: response.headers.get("x-generation-id"), actualModel: input.model, actualProviderCostAtomic: cost, chargeStatus: cost === null ? "UNKNOWN" : "ACTUAL", text: null, assets: payload.data.map((asset) => ({ base64: asset.b64_json, contentType: asset.media_type ?? "application/octet-stream" })), reconciliationRequired: cost === null };
  }
}

/** TTS returns binary bytes; provider cost is reconciled from generation audit, never invented from character count. */
export class OpenRouterTtsAdapter extends OpenRouterSynchronousAdapter {
  constructor(options: BaseOptions) { super(options); }

  async synthesize(input: { model: string; text: string; voice: string; speed?: number; responseFormat?: "mp3" | "pcm"; routing?: OpenRouterRoutingPolicy }): Promise<OpenRouterSynchronousResult> {
    const response = await this.request("/api/v1/audio/speech", { method: "POST", body: { model: input.model, input: input.text, voice: input.voice, ...(input.speed === undefined ? {} : { speed: input.speed }), ...(input.responseFormat ? { response_format: input.responseFormat } : {}), ...(providerPolicy(input.routing) ? { provider: providerPolicy(input.routing) } : {}) } });
    const contentType = response.headers.get("content-type")?.split(";")[0];
    if (!contentType?.startsWith("audio/")) throw new ProviderDefinitiveError("INVALID_TTS_RESULT", "OpenRouter TTS result must be an audio byte stream.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) throw new ProviderDefinitiveError("INCOMPLETE_RESULT", "OpenRouter TTS result is empty.");
    return { protocol: "TTS", generationId: response.headers.get("x-generation-id"), actualModel: input.model, actualProviderCostAtomic: null, chargeStatus: "UNKNOWN", text: null, assets: [{ base64: Buffer.from(bytes).toString("base64"), contentType }], reconciliationRequired: true };
  }
}

export class OpenRouterSttAdapter extends OpenRouterSynchronousAdapter {
  constructor(options: BaseOptions) { super(options); }

  async transcribe(input: { model: string; audioBase64: string; format: string; language?: string; routing?: OpenRouterRoutingPolicy }): Promise<OpenRouterSynchronousResult> {
    const response = await this.request("/api/v1/audio/transcriptions", { method: "POST", body: { model: input.model, input_audio: { data: input.audioBase64, format: input.format }, ...(input.language ? { language: input.language } : {}), ...(providerPolicy(input.routing) ? { provider: providerPolicy(input.routing) } : {}) } });
    const payload = SttResponseSchema.parse(await this.json(response));
    const cost = this.costAtomic(payload.usage?.cost);
    return { protocol: "STT", generationId: response.headers.get("x-generation-id"), actualModel: input.model, actualProviderCostAtomic: cost, chargeStatus: cost === null ? "UNKNOWN" : "ACTUAL", text: payload.text, assets: [], reconciliationRequired: cost === null };
  }
}
