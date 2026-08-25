import { z } from "zod";
import type { ProviderGenerationRequest, ProviderSubmitResponse, ProviderTaskResponse } from "../../contracts/src/provider.js";
import { decimalToAtomic } from "../../provider-treasury/src/decimal.js";
import { ProviderDefinitiveError, ProviderSubmissionUnknownError, providerHttpFailure, type ProviderAdapter, type ProviderAsset } from "./types.js";
import { readBoundedProviderAsset } from "./bounded-response.js";

const CreateSchema = z.object({ code: z.number(), data: z.object({ taskId: z.string().min(1) }).optional() });
const StatusSchema = z.object({
  code: z.number(),
  data: z.object({
    taskId: z.string().min(1),
    state: z.string().nullish(),
    status: z.string().nullish(),
    creditsConsumed: z.union([z.string(), z.number()]).nullish(),
    resultJson: z.string().nullish(),
    failMsg: z.string().nullish(),
  }).optional(),
});

function resultUrl(resultJson: string | null | undefined): string | null {
  if (!resultJson) return null;
  try {
    const parsed = z.object({ resultUrls: z.array(z.string().url()).min(1) }).parse(JSON.parse(resultJson));
    return parsed.resultUrls[0];
  } catch { return null; }
}

export class KieMarketAdapter implements ProviderAdapter {
  readonly id = "kie";
  readonly displayName = "KIE.ai";
  readonly version = "kie-market.v1";
  readonly accounting: { nativeUnit: string; nativeScale: bigint; actualUsageSource: string };
  readonly assetSourcePolicy;
  private readonly transport: typeof fetch;
  private readonly baseUrl: string;
  constructor(private readonly options: { apiKey: string; callbackUrl: string; estimateMaximum: (request: ProviderGenerationRequest) => number; nativeScale?: bigint; fetch?: typeof fetch; baseUrl?: string; assetOrigins?: string[]; timeoutMs?: number }) {
    if (!options.apiKey) throw new TypeError("KIE API key is required server-side.");
    if (new URL(options.callbackUrl).protocol !== "https:") throw new TypeError("KIE callback URL must use HTTPS.");
    this.baseUrl = (options.baseUrl ?? "https://api.kie.ai/api/v1").replace(/\/$/, ""); this.transport = options.fetch ?? fetch;
    this.accounting = { nativeUnit: "kie_credit", nativeScale: options.nativeScale ?? 1n, actualUsageSource: "creditsConsumed" };
    this.assetSourcePolicy = { allowedOrigins: options.assetOrigins ?? [new URL(this.baseUrl).origin], allowHttpLoopbackForLocalTest: false, allowPrivateLoopbackForLocalTest: false } as const;
  }
  async listModels() { return []; }
  async getBalance(): Promise<{ provider: string; unit: "provider_credit"; available: number; held: number; spent: number }> { throw new ProviderDefinitiveError("KIE_BALANCE_UNIMPLEMENTED", "KIE balance is route-specific and not inferred by this adapter."); }
  async submit(request: ProviderGenerationRequest, _key: string): Promise<ProviderSubmitResponse> {
    try {
      const klingImageToVideo = request.model === "kling/v2-5-turbo-image-to-video-pro";
      const klingV3ImageToVideo = request.model === "kling/v3-turbo-image-to-video";
      // Kling 3.0 is a separate, documented contract.  It deliberately has
      // its own branch rather than inheriting Turbo's fields: `sound`,
      // `mode`, and `multi_shots` are part of its public API.
      const kling3Video = request.model === "kling-3.0/video";
      const imageToVideo = klingImageToVideo || klingV3ImageToVideo || kling3Video;
      // GPT Image 2 Image-to-Image is a separate documented KIE contract:
      // it requires `input_urls`, never the Kling `image_url(s)` fields.
      // Keep the branching model-specific so a future provider/model cannot
      // accidentally inherit a payload that it does not document.
      const gptImage2ImageToImage = request.model === "gpt-image-2-image-to-image";
      if ((imageToVideo || gptImage2ImageToImage) && !request.input.providerInputUrl) {
        throw new ProviderDefinitiveError("KIE_SOURCE_IMAGE_REQUIRED", imageToVideo
          ? "Kling image-to-video requires a server-issued source image URL."
          : "GPT Image 2 Image-to-Image requires a server-issued source image URL.");
      }
      const providerInput: Record<string, unknown> = {
        ...(request.input.prompt ? { prompt: request.input.prompt } : {}),
        ...(gptImage2ImageToImage ? { input_urls: [request.input.providerInputUrl] } : {}),
        ...(klingImageToVideo ? { image_url: request.input.providerInputUrl } : {}),
        // V3 Turbo is a different documented KIE contract: it receives an
        // array named image_urls, not V2.5's singular image_url field.
        ...(klingV3ImageToVideo ? { image_urls: [request.input.providerInputUrl] } : {}),
        ...(kling3Video && request.input.providerInputUrl ? { image_urls: [request.input.providerInputUrl] } : {}),
        ...(request.input.aspectRatio ? { aspect_ratio: request.input.aspectRatio } : {}),
        ...(!gptImage2ImageToImage && !kling3Video && ((klingV3ImageToVideo && ["720p", "1080p"].includes(request.input.resolution)) || ["1K", "2K", "4K"].includes(request.input.resolution))
          ? { resolution: request.input.resolution } : {}),
        // KIE documents Kling V2.5 Turbo I2V duration as a string; other
        // KIE routes retain their existing numeric representation.
        ...(request.input.durationSeconds ? { duration: imageToVideo ? String(request.input.durationSeconds) : request.input.durationSeconds } : {}),
        // Kling 3.0 calls this field `sound`; sending a generic `audio`
        // field as well would violate its strict documented request schema.
        ...(!kling3Video && request.input.audio ? { audio: true } : {}),
        ...(kling3Video ? {
          // KIE documents sound explicitly, including the false value.
          sound: request.input.audio,
          mode: request.input.quality ?? "pro",
          multi_shots: false,
        } : {}),
      };
      const raw = await this.request("/jobs/createTask", { method: "POST", body: JSON.stringify({ model: request.model, input: providerInput, callBackUrl: this.options.callbackUrl }) });
      const result = CreateSchema.parse(raw); if (result.code !== 200 || !result.data?.taskId) throw new ProviderDefinitiveError("KIE_CREATE_REJECTED", "KIE did not create a task.");
      return { taskId: result.data.taskId, status: "submitted", estimatedProviderCredits: this.options.estimateMaximum(request) };
    } catch (error) { if (error instanceof ProviderDefinitiveError) throw error; throw new ProviderSubmissionUnknownError(error instanceof Error ? error.message : "KIE submission outcome is unknown."); }
  }
  async lookupByIdempotency(_key: string): Promise<ProviderTaskResponse | null> { return null; }
  async getTask(taskId: string): Promise<ProviderTaskResponse> {
    const result = StatusSchema.parse(await this.request(`/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`));
    if (result.code !== 200 || !result.data || result.data.taskId !== taskId) throw new ProviderDefinitiveError("KIE_STATUS_INVALID", "KIE status lacks matching task evidence.");
    const state = (result.data.state ?? result.data.status ?? "").toLowerCase(); const usage = result.data.creditsConsumed;
    const actualAtomic = usage == null ? null : decimalToAtomic(usage, this.accounting.nativeScale, "ceil");
    if (actualAtomic !== null && actualAtomic > BigInt(Number.MAX_SAFE_INTEGER)) throw new ProviderDefinitiveError("KIE_USAGE_INVALID", "KIE creditsConsumed exceeds the canonical safe integer range.");
    const actual = actualAtomic === null ? null : Number(actualAtomic);
    if (["success", "completed"].includes(state)) {
      const output = resultUrl(result.data.resultJson);
      if (actual === null || !output) throw new ProviderDefinitiveError("INCOMPLETE_TERMINAL_RESULT", "KIE success requires task-bound actual usage and a result URL.");
      return { taskId, status: "succeeded", actualProviderCredits: actual, resultUrl: output, errorCode: null, chargeStatus: "ACTUAL" };
    }
    if (["fail", "failed", "error"].includes(state)) {
      // `CONFIRMED_NO_CHARGE` is represented by a null usage value.  Zero is
      // not fabricated as an actual charge: the worker accepts this exact
      // pair to release the customer hold, whereas any observed positive (or
      // unknown) usage enters reconciliation/platform-loss handling.
      return {
        taskId,
        status: "failed",
        actualProviderCredits: actual === 0 ? null : actual,
        resultUrl: null,
        errorCode: result.data.failMsg ?? "KIE_FAILED",
        chargeStatus: actual === null ? "UNKNOWN" : actual === 0 ? "CONFIRMED_NO_CHARGE" : "ACTUAL",
      };
    }
    if (["pending", "submitted", "waiting", "queuing", "queued"].includes(state)) return { taskId, status: "submitted", actualProviderCredits: null, resultUrl: null, errorCode: null, chargeStatus: "UNKNOWN" };
    if (["running", "processing", "generating"].includes(state)) return { taskId, status: "running", actualProviderCredits: null, resultUrl: null, errorCode: null, chargeStatus: "UNKNOWN" };
    throw new ProviderDefinitiveError("PROVIDER_STATUS_UNKNOWN", "KIE returned an unknown task state.");
  }
  async fetchAsset(resultUrl: string, maxBytes = 100 * 1024 * 1024): Promise<ProviderAsset> { const url = new URL(resultUrl); if (!this.assetSourcePolicy.allowedOrigins.includes(url.origin)) throw new ProviderDefinitiveError("UNTRUSTED_RESULT_URL", "KIE result URL is not allowlisted."); const response = await this.raw(resultUrl, { redirect: "error" }); if (!response.ok) throw new ProviderDefinitiveError("RESULT_DOWNLOAD_FAILED", "KIE result download failed."); return { bytes: await readBoundedProviderAsset(response, maxBytes), contentType: response.headers.get("content-type")?.split(";")[0] ?? "", sourceUrl: resultUrl }; }
  private async request(path: string, init: RequestInit = {}) { const response = await this.raw(`${this.baseUrl}${path}`, init); if (!response.ok) throw providerHttpFailure("kie", response.status, "KIE request failed."); return response.json().catch(() => { throw new ProviderDefinitiveError("INVALID_PROVIDER_RESPONSE", "KIE returned invalid JSON."); }); }
  private async raw(url: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
    try {
      return await this.transport(url, { ...init, signal: controller.signal, headers: { authorization: `Bearer ${this.options.apiKey}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
    } finally { clearTimeout(timeout); }
  }
}
