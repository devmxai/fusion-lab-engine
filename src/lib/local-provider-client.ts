export const isLocalProviderMode = import.meta.env.DEV;

type LocalScenario = NonNullable<ImportMetaEnv["VITE_LOCAL_PROVIDER_SCENARIO"]>;

type LocalQuote = {
  id: string;
  customerCredits: number;
};

type LocalOperation = {
  id: string;
  state:
    | "RESERVED"
    | "QUEUED"
    | "DISPATCHING"
    | "SUBMISSION_UNKNOWN"
    | "SUBMITTED"
    | "RUNNING"
    | "PROVIDER_SUCCEEDED"
    | "PROVIDER_FAILED"
    | "ASSET_STORED"
    | "DELIVERED"
    | "DELIVERY_FAILED"
    | "SETTLED"
    | "RECONCILIATION_REQUIRED";
  resultUrl: string | null;
  customerCredits: number;
};

type LocalWallet = {
  customerCredits: { available: number; held: number; spent: number };
};

type GenerationBody = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
}

function numericValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numberValue = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) return Math.ceil(numberValue);
  }
  return undefined;
}

async function localRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/engine/v1/dev/mock${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new Error(payload?.error?.message || payload?.error?.code || "Local provider request failed");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function chooseMockModel(body: GenerationBody) {
  const metadata = asRecord(body.metadata);
  const input = asRecord(body.input);
  const apiType = String(body.apiType || "");
  const toolId = String(body.toolId || "").toLowerCase();
  const fileType = String(metadata.file_type || "").toLowerCase();
  const isAudio = body.apiType === "tts" || fileType === "audio" || toolId.includes("tts");
  const isVideo = !isAudio && (fileType === "video"
    || ["veo", "video", "animate", "avatar", "seedance", "kling"].some(
      (marker) => apiType.includes(marker) || toolId.includes(marker),
    ));
  const durationSeconds = numericValue(
    metadata.effective_duration_seconds,
    metadata.detected_duration_seconds,
    input.duration,
    input.durationSeconds,
    body.duration,
  );
  return {
    modelId: isAudio
      ? "local/test-audio-v1"
      : isVideo
        ? "local/test-video-v1"
        : "local/test-image-v1",
    durationSeconds: isVideo ? durationSeconds ?? 5 : undefined,
    characterCount: isAudio ? numericValue(body.characterCount, metadata.character_count) ?? 1 : undefined,
    resolution: String(body.resolution || metadata.selected_resolution || "720p").includes("1080")
      ? "1080p"
      : "720p",
    audio: Boolean(input.audio || body.audio),
  };
}

async function fetchLocalAssetBase64(resultUrl: string) {
  const response = await fetch(localResultUrl(resultUrl));
  if (!response.ok) throw new Error("Stored local provider asset could not be read");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + 8_192));
  }
  return {
    audioBase64: btoa(binary),
    mimeType: response.headers.get("content-type")?.split(";")[0] || "audio/wav",
  };
}

async function settleLocalOperation(operation: LocalOperation): Promise<LocalOperation> {
  let current = operation;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (["SETTLED", "PROVIDER_FAILED", "DELIVERY_FAILED"].includes(current.state)) {
      return current;
    }
    current = await advanceLocalTask(current.id);
  }
  throw new Error("Local provider operation did not reach a terminal state");
}

export async function startLocalGeneration(body: GenerationBody) {
  const model = chooseMockModel(body);
  const quote = await localRequest<LocalQuote>("/quotes", {
    method: "POST",
    body: JSON.stringify(model),
  });
  const scenario: LocalScenario = import.meta.env.VITE_LOCAL_PROVIDER_SCENARIO || "success";
  let operation = await localRequest<LocalOperation>("/operations", {
    method: "POST",
    body: JSON.stringify({
      quoteId: quote.id,
      idempotencyKey: typeof body.idempotencyKey === "string"
        ? body.idempotencyKey
        : crypto.randomUUID(),
      scenario,
    }),
  });
  if (body.apiType === "tts") {
    operation = await settleLocalOperation(operation);
    if (operation.state !== "SETTLED") {
      throw new Error(`Local provider audio simulation ended in ${operation.state}`);
    }
  }
  const audioArtifact = body.apiType === "tts" && operation.resultUrl
    ? await fetchLocalAssetBase64(operation.resultUrl)
    : null;
  return {
    success: true,
    reservationId: quote.id,
    taskId: operation.id,
    jobId: operation.id,
    creditsCharged: quote.customerCredits,
    ...(audioArtifact || {}),
    localOnly: true,
  };
}

export async function advanceLocalTask(taskId: string): Promise<LocalOperation> {
  return localRequest<LocalOperation>(`/operations/${encodeURIComponent(taskId)}/advance`, {
    method: "POST",
    body: "{}",
  });
}

export async function getLocalProviderCredits(): Promise<number> {
  const wallet = await localRequest<LocalWallet>("/wallets/local-user");
  return wallet.customerCredits.available;
}

export function localResultUrl(resultUrl: string): string {
  return `/api/engine${resultUrl}`;
}

export function localUploadUrl(fileName: string): string {
  return `local-upload://${encodeURIComponent(fileName)}`;
}
