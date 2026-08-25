import { createHash, randomUUID } from "node:crypto";
import {
  ProviderGenerationRequestSchema,
  type ProviderBalanceResponse,
  type ProviderGenerationRequest,
  type ProviderModel,
  type ProviderTaskResponse,
} from "../../../packages/contracts/src/provider.ts";

type ProviderTask = {
  id: string;
  idempotencyKey: string;
  requestHash: string;
  request: ProviderGenerationRequest;
  estimatedCredits: bigint;
  actualCredits: bigint | null;
  status: "submitted" | "running" | "succeeded" | "failed";
  resultUrl: string | null;
  errorCode: string | null;
  ambiguousResponseSent: boolean;
};

type ProviderWallet = { available: bigint; held: bigint; spent: bigint };
export type ProviderTestAsset = { bytes: Uint8Array; contentType: string };

export class ProviderTestError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderTestError";
  }
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function calculateProviderCredits(request: ProviderGenerationRequest): bigint {
  const modelMedia = new Map<string, ProviderGenerationRequest["mediaType"]>([
    ["local/test-image-v1", "image"],
    ["local/test-video-v1", "video"],
    ["local/test-audio-v1", "audio"],
  ]);
  const expectedMedia = modelMedia.get(request.model);
  if (!expectedMedia) {
    throw new ProviderTestError("MODEL_NOT_FOUND", 404, "Provider model is not available.");
  }
  if (expectedMedia !== request.mediaType) {
    throw new ProviderTestError("MODEL_MEDIA_MISMATCH", 400, "Model and media type do not match.");
  }
  const quantity = BigInt(request.input.quantity);
  if (request.mediaType === "image") return 2n * quantity;
  if (request.mediaType === "audio") {
    if (!request.input.characterCount) {
      throw new ProviderTestError("CHARACTER_COUNT_REQUIRED", 400, "characterCount is required.");
    }
    return ceilDiv(BigInt(request.input.characterCount), 100n) * quantity;
  }
  if (!request.input.durationSeconds) {
    throw new ProviderTestError("DURATION_REQUIRED", 400, "durationSeconds is required.");
  }
  const resolutionNumerator = request.input.resolution === "1080p" ? 3n : 1n;
  const resolutionDenominator = request.input.resolution === "1080p" ? 2n : 1n;
  const timed = ceilDiv(
    BigInt(request.input.durationSeconds) * 2n * resolutionNumerator,
    resolutionDenominator,
  );
  return (timed + (request.input.audio ? 5n : 0n)) * quantity;
}

function silentWav(): Uint8Array {
  const sampleRate = 8_000;
  const sampleCount = 2_000;
  const bytes = new Uint8Array(44 + sampleCount);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + sampleCount, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, "data");
  view.setUint32(40, sampleCount, true);
  bytes.fill(128, 44);
  return bytes;
}

function testMp4(): Uint8Array {
  const label = new TextEncoder().encode("TEST Provider For Test");
  const bytes = new Uint8Array(24 + label.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.byteLength, false);
  bytes.set(new TextEncoder().encode("ftypisom"), 4);
  bytes.set(new TextEncoder().encode("isomiso2"), 12);
  bytes.set(label, 24);
  return bytes;
}

export class ProviderTestService {
  private readonly tasks = new Map<string, ProviderTask>();
  private readonly idempotency = new Map<string, string>();
  private wallet: ProviderWallet = { available: 1_000n, held: 0n, spent: 0n };

  constructor(
    private readonly publicUrl: string,
    private readonly id: () => string = randomUUID,
  ) {}

  reset(): void {
    this.tasks.clear();
    this.idempotency.clear();
    this.wallet = { available: 1_000n, held: 0n, spent: 0n };
  }

  listModels(): ProviderModel[] {
    return [
      { id: "local/test-image-v1", mediaType: "image", nativeUnit: "provider_credit" },
      { id: "local/test-video-v1", mediaType: "video", nativeUnit: "provider_credit" },
      { id: "local/test-audio-v1", mediaType: "audio", nativeUnit: "provider_credit" },
    ];
  }

  getBalance(): ProviderBalanceResponse {
    return {
      provider: "provider-test",
      unit: "provider_credit",
      available: Number(this.wallet.available),
      held: Number(this.wallet.held),
      spent: Number(this.wallet.spent),
    };
  }

  submit(raw: unknown, idempotencyKey: string) {
    const request = ProviderGenerationRequestSchema.parse(raw);
    const requestHash = stableHash(request);
    const existingId = this.idempotency.get(idempotencyKey);
    if (existingId) {
      const existing = this.tasks.get(existingId)!;
      if (existing.requestHash !== requestHash) {
        throw new ProviderTestError("IDEMPOTENCY_CONFLICT", 409, "Idempotency key conflict.");
      }
      return { task: this.submitView(existing), submissionUnknown: false };
    }

    const estimatedCredits = calculateProviderCredits(request);
    if (this.wallet.available < estimatedCredits) {
      throw new ProviderTestError("INSUFFICIENT_PROVIDER_CREDITS", 409, "Provider balance is insufficient.");
    }
    this.wallet.available -= estimatedCredits;
    this.wallet.held += estimatedCredits;
    const task: ProviderTask = {
      id: this.id(),
      idempotencyKey,
      requestHash,
      request,
      estimatedCredits,
      actualCredits: null,
      status: "submitted",
      resultUrl: null,
      errorCode: null,
      ambiguousResponseSent: request.scenario === "submission_unknown_then_success",
    };
    this.tasks.set(task.id, task);
    this.idempotency.set(idempotencyKey, task.id);
    return {
      task: this.submitView(task),
      submissionUnknown: task.ambiguousResponseSent,
    };
  }

  lookup(idempotencyKey: string): ProviderTaskResponse | null {
    const taskId = this.idempotency.get(idempotencyKey);
    return taskId ? this.taskView(this.tasks.get(taskId)!) : null;
  }

  poll(taskId: string): ProviderTaskResponse {
    const task = this.requireTask(taskId);
    if (task.status === "submitted") {
      task.status = "running";
    } else if (task.status === "running") {
      if (task.request.scenario === "provider_failure") {
        this.wallet.held -= task.estimatedCredits;
        this.wallet.available += task.estimatedCredits;
        task.status = "failed";
        task.errorCode = "SIMULATED_PROVIDER_FAILURE";
      } else {
        const actualCredits = task.request.scenario === "cost_shock_success"
          ? ceilDiv(task.estimatedCredits * 15n, 10n)
          : task.estimatedCredits;
        const difference = actualCredits - task.estimatedCredits;
        if (difference > 0n && this.wallet.available < difference) {
          throw new ProviderTestError("INSUFFICIENT_PROVIDER_CREDITS", 409, "Actual cost exceeds balance.");
        }
        this.wallet.held -= task.estimatedCredits;
        this.wallet.available -= difference;
        this.wallet.spent += actualCredits;
        task.actualCredits = actualCredits;
        task.status = "succeeded";
        task.resultUrl = `${this.publicUrl.replace(/\/$/, "")}/v1/assets/${task.id}`;
      }
    }
    return this.taskView(task);
  }

  getAsset(taskId: string): ProviderTestAsset {
    const task = this.requireTask(taskId);
    if (task.status !== "succeeded") {
      throw new ProviderTestError("ASSET_NOT_READY", 409, "Asset is not ready.");
    }
    if (task.request.scenario === "delivery_failure") {
      throw new ProviderTestError("SIMULATED_ASSET_FAILURE", 503, "Asset delivery failed.");
    }
    if (task.request.mediaType === "audio") {
      return { bytes: silentWav(), contentType: "audio/wav" };
    }
    if (task.request.mediaType === "video") {
      return { bytes: testMp4(), contentType: "video/mp4" };
    }
    const safeId = task.id.replace(/[<>&"']/g, "_");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#fff"/><text x="640" y="340" text-anchor="middle" font-family="system-ui" font-size="140" font-weight="800">TEST</text><text x="640" y="430" text-anchor="middle" font-family="monospace" font-size="28">Provider For Test</text><text x="640" y="500" text-anchor="middle" font-family="monospace" font-size="18">${safeId}</text></svg>`;
    return { bytes: new TextEncoder().encode(svg), contentType: "image/svg+xml" };
  }

  private requireTask(taskId: string): ProviderTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new ProviderTestError("TASK_NOT_FOUND", 404, "Task not found.");
    return task;
  }

  private submitView(task: ProviderTask) {
    return {
      taskId: task.id,
      status: "submitted" as const,
      estimatedProviderCredits: Number(task.estimatedCredits),
    };
  }

  private taskView(task: ProviderTask): ProviderTaskResponse {
    return {
      taskId: task.id,
      status: task.status,
      actualProviderCredits: task.actualCredits === null ? null : Number(task.actualCredits),
      resultUrl: task.resultUrl,
      errorCode: task.errorCode,
      chargeStatus: task.status === "succeeded"
        ? "ACTUAL"
        : task.status === "failed"
          ? "CONFIRMED_NO_CHARGE"
          : "UNKNOWN",
    };
  }
}
