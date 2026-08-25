import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ProviderBalanceResponse,
  ProviderGenerationRequest,
  ProviderModel,
  ProviderSubmitResponse,
  ProviderTaskResponse,
} from "../../contracts/src/provider.js";
import { OpenRouterImageAdapter } from "./openrouter-sync-adapters.js";
import {
  ProviderDefinitiveError,
  ProviderRetryableError,
  ProviderSubmissionUnknownError,
  type ProviderAdapter,
  type ProviderAsset,
} from "./types.js";

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const ESCROW_ORIGIN = "https://escrow.fusionlab.internal";
const MetadataSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: z.string().regex(/^orimg_[a-f0-9]{40}$/),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  providerGenerationId: z.string().nullable(),
  actualModel: z.string().nullable(),
  actualProviderCredits: z.number().int().nonnegative().nullable(),
  chargeStatus: z.enum(["ACTUAL", "UNKNOWN"]),
}).strict();

type Metadata = z.infer<typeof MetadataSchema>;

export type OpenRouterDurableImageAdapterOptions = {
  apiKey: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  estimateMaximumAtomic: (request: ProviderGenerationRequest) => number;
  fetch?: typeof fetch;
  bucket?: string;
};

function hash(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function imageType(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
    && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") return "image/webp";
  throw new ProviderDefinitiveError("INVALID_IMAGE_RESULT", "OpenRouter returned an unsupported image payload.");
}

function decodeImage(base64: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    throw new ProviderDefinitiveError("INVALID_IMAGE_RESULT", "OpenRouter returned invalid base64 image data.");
  }
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ProviderDefinitiveError("INVALID_IMAGE_RESULT", "OpenRouter image size is outside the certified limit.");
  }
  return bytes;
}

/**
 * Converts OpenRouter's synchronous image response into a durable provider
 * task. The image is escrowed under a deterministic object key before submit
 * returns, so SUBMISSION_UNKNOWN recovery never resubmits a paid generation.
 */
export class OpenRouterDurableImageAdapter implements ProviderAdapter {
  readonly id = "openrouter";
  readonly displayName = "OpenRouter";
  readonly version = "openrouter-image.v1";
  readonly assetSourcePolicy = { allowedOrigins: [ESCROW_ORIGIN], allowHttpLoopbackForLocalTest: false, allowPrivateLoopbackForLocalTest: false } as const;
  readonly accounting = { nativeUnit: "usd_micro", nativeScale: 1_000_000n, actualUsageSource: "response.usage.cost" } as const;
  private readonly transport: typeof fetch;
  private readonly bucket: string;
  private readonly image: OpenRouterImageAdapter;

  constructor(private readonly options: OpenRouterDurableImageAdapterOptions) {
    if (!options.supabaseUrl.startsWith("https://") || !options.supabaseSecretKey) throw new TypeError("Secure Supabase storage configuration is required.");
    this.transport = options.fetch ?? fetch;
    this.bucket = options.bucket ?? "generated-originals-private";
    this.image = new OpenRouterImageAdapter({ apiKey: options.apiKey, fetch: this.transport, timeoutMs: 240_000 });
  }

  async listModels(): Promise<ProviderModel[]> { return []; }
  async getBalance(): Promise<ProviderBalanceResponse> {
    return { provider: this.id, unit: "provider_credit", available: 0, held: 0, spent: 0 };
  }

  async submit(request: ProviderGenerationRequest, idempotencyKey: string): Promise<ProviderSubmitResponse> {
    if (request.mediaType !== "image" || !request.input.prompt || request.input.quantity !== 1 || request.input.bindings?.length) {
      throw new ProviderDefinitiveError("OPENROUTER_IMAGE_INPUT_UNSUPPORTED", "This released OpenRouter route accepts one text-to-image result only.");
    }
    const taskId = this.taskId(idempotencyKey);
    const requestHash = hash({ idempotencyKey, request });
    const existing = await this.metadata(taskId, true, true);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new ProviderDefinitiveError("IDEMPOTENCY_CONFLICT", "The provider idempotency key is bound to another request.");
      return { taskId, status: "submitted", estimatedProviderCredits: this.estimate(request) };
    }

    const result = await this.image.generate({
      model: request.model,
      prompt: request.input.prompt,
      quantity: 1,
      resolution: request.input.resolution,
      aspectRatio: request.input.aspectRatio,
    });
    if (result.assets.length !== 1) throw new ProviderSubmissionUnknownError("OpenRouter returned an unexpected image count after submission.");
    const bytes = decodeImage(result.assets[0]!.base64);
    const contentType = imageType(bytes);
    const metadata: Metadata = {
      schemaVersion: 1,
      taskId,
      requestHash,
      providerGenerationId: result.generationId,
      actualModel: result.actualModel,
      actualProviderCredits: result.actualProviderCostAtomic,
      chargeStatus: result.chargeStatus,
    };
    const upload = await this.transport(this.storageObjectUrl(taskId), {
      method: "POST",
      headers: {
        ...this.storageHeaders(),
        "content-type": contentType,
        "cache-control": "no-store",
        "x-upsert": "false",
        "x-metadata": Buffer.from(JSON.stringify(metadata), "utf8").toString("base64"),
      },
      body: bytes,
      signal: AbortSignal.timeout(30_000),
    }).catch((error) => {
      throw new ProviderSubmissionUnknownError(error instanceof Error ? error.message : "OpenRouter result escrow outcome is unknown.");
    });
    if (!upload.ok && upload.status !== 409) {
      throw new ProviderSubmissionUnknownError(`OpenRouter result escrow returned HTTP ${upload.status}.`);
    }
    if (upload.status === 409) {
      const replay = await this.metadata(taskId, false);
      if (!replay || replay.requestHash !== requestHash) throw new ProviderSubmissionUnknownError("OpenRouter result escrow conflict could not be proven idempotent.");
    }
    return { taskId, status: "submitted", estimatedProviderCredits: this.estimate(request) };
  }

  async lookupByIdempotency(idempotencyKey: string): Promise<ProviderTaskResponse | null> {
    const taskId = this.taskId(idempotencyKey);
    return this.task(taskId, await this.metadata(taskId, true));
  }

  async getTask(taskId: string): Promise<ProviderTaskResponse> {
    if (!/^orimg_[a-f0-9]{40}$/.test(taskId)) throw new ProviderDefinitiveError("INVALID_PROVIDER_TASK", "OpenRouter task identity is invalid.");
    const metadata = await this.metadata(taskId, false);
    if (!metadata) throw new ProviderRetryableError("OPENROUTER_RESULT_NOT_FOUND", "OpenRouter durable result is not visible yet.");
    return this.task(taskId, metadata)!;
  }

  async fetchAsset(resultUrl: string, maxBytes = MAX_IMAGE_BYTES): Promise<ProviderAsset> {
    const url = new URL(resultUrl);
    const taskId = url.origin === ESCROW_ORIGIN && url.pathname.match(/^\/openrouter\/(orimg_[a-f0-9]{40})$/)?.[1];
    if (!taskId) throw new ProviderDefinitiveError("INVALID_ASSET_URL", "OpenRouter result URL is outside the private escrow.");
    const response = await this.transport(this.storageObjectUrl(taskId), { headers: this.storageHeaders(), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new ProviderRetryableError("OPENROUTER_ESCROW_READ_FAILED", "OpenRouter result escrow is temporarily unavailable.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > Math.min(maxBytes, MAX_IMAGE_BYTES)) throw new ProviderDefinitiveError("INVALID_IMAGE_RESULT", "Escrowed OpenRouter image size is invalid.");
    const contentType = imageType(bytes);
    return { bytes, contentType, sourceUrl: resultUrl };
  }

  private task(taskId: string, metadata: Metadata | null): ProviderTaskResponse | null {
    if (!metadata) return null;
    return {
      taskId,
      status: "succeeded",
      actualProviderCredits: metadata.actualProviderCredits,
      chargeStatus: metadata.chargeStatus,
      resultUrl: `${ESCROW_ORIGIN}/openrouter/${taskId}`,
      errorCode: null,
    };
  }

  private estimate(request: ProviderGenerationRequest): number {
    const value = this.options.estimateMaximumAtomic(request);
    if (!Number.isSafeInteger(value) || value < 0) throw new ProviderDefinitiveError("INVALID_PROVIDER_ESTIMATE", "OpenRouter cost estimate is invalid.");
    return value;
  }

  private taskId(idempotencyKey: string): string {
    if (!idempotencyKey || idempotencyKey.length > 200) throw new ProviderDefinitiveError("INVALID_IDEMPOTENCY_KEY", "Provider idempotency key is invalid.");
    return `orimg_${hash(idempotencyKey).slice(0, 40)}`;
  }

  private async metadata(taskId: string, allowMissing: boolean, preflight = false): Promise<Metadata | null> {
    const response = await this.transport(this.storageInfoUrl(taskId), { headers: this.storageHeaders(), signal: AbortSignal.timeout(10_000) })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "OpenRouter escrow metadata is unavailable.";
        if (preflight) throw new ProviderDefinitiveError("OPENROUTER_ESCROW_PREFLIGHT_FAILED", message);
        throw new ProviderRetryableError("OPENROUTER_ESCROW_INFO_FAILED", message);
      });
    const record = await response.json().catch(() => null) as Record<string, unknown> | null;
    const storageStatus = Number(record?.statusCode);
    const missing = response.status === 404
      || (storageStatus === 404 && (record?.code === "NoSuchKey" || record?.error === "not_found"));
    if (missing && allowMissing) return null;
    if (!response.ok) {
      if (preflight) throw new ProviderDefinitiveError("OPENROUTER_ESCROW_PREFLIGHT_FAILED", `OpenRouter escrow metadata returned HTTP ${response.status}.`);
      throw new ProviderRetryableError("OPENROUTER_ESCROW_INFO_FAILED", `OpenRouter escrow metadata returned HTTP ${response.status}.`);
    }
    const candidates = [record?.user_metadata, record?.userMetadata, record?.metadata];
    for (const candidate of candidates) {
      const parsed = MetadataSchema.safeParse(candidate);
      if (parsed.success && parsed.data.taskId === taskId) return parsed.data;
    }
    throw new ProviderDefinitiveError("OPENROUTER_ESCROW_EVIDENCE_INVALID", "OpenRouter escrow metadata failed validation.");
  }

  private objectPath(taskId: string): string { return `_provider-escrow/openrouter/${taskId}`; }
  private encodedPath(taskId: string): string { return this.objectPath(taskId).split("/").map(encodeURIComponent).join("/"); }
  private storageObjectUrl(taskId: string): string { return `${this.options.supabaseUrl}/storage/v1/object/${encodeURIComponent(this.bucket)}/${this.encodedPath(taskId)}`; }
  private storageInfoUrl(taskId: string): string { return `${this.options.supabaseUrl}/storage/v1/object/info/${encodeURIComponent(this.bucket)}/${this.encodedPath(taskId)}`; }
  private storageHeaders() { return { apikey: this.options.supabaseSecretKey, authorization: `Bearer ${this.options.supabaseSecretKey}` }; }
}
