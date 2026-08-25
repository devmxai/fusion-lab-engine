import type {
  ProviderBalanceResponse,
  ProviderGenerationRequest,
  ProviderModel,
  ProviderSubmitResponse,
  ProviderTaskResponse,
} from "../../contracts/src/provider.js";

export type ProviderAsset = {
  bytes: Uint8Array;
  contentType: string;
  sourceUrl: string;
};

export type ProviderAssetSourcePolicy = {
  allowedOrigins: readonly string[];
  allowHttpLoopbackForLocalTest: boolean;
  allowPrivateLoopbackForLocalTest: boolean;
};

export interface ProviderAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly assetSourcePolicy: ProviderAssetSourcePolicy;
  readonly accounting?: {
    nativeUnit: string;
    nativeScale: bigint;
    actualUsageSource: string;
  };
  listModels(): Promise<ProviderModel[]>;
  getBalance(): Promise<ProviderBalanceResponse>;
  submit(
    request: ProviderGenerationRequest,
    idempotencyKey: string,
  ): Promise<ProviderSubmitResponse>;
  lookupByIdempotency(idempotencyKey: string): Promise<ProviderTaskResponse | null>;
  getTask(taskId: string): Promise<ProviderTaskResponse>;
  fetchAsset(resultUrl: string, maxBytes?: number): Promise<ProviderAsset>;
  resetForDevelopment?(): Promise<void>;
}

export class ProviderSubmissionUnknownError extends Error {
  constructor(message = "Provider submission outcome is unknown.") {
    super(message);
    this.name = "ProviderSubmissionUnknownError";
  }
}

export class ProviderDefinitiveError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderDefinitiveError";
  }
}

/** A transport/server response that may become safe after observation or delay. */
export class ProviderRetryableError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderRetryableError";
  }
}

/**
 * Provider HTTP codes are not all a proof of zero charge.  Only stable client
 * rejection is definitive; rate limits, timeouts, conflicts and 5xx results
 * remain retryable/unknown depending on the operation phase.
 */
export function providerHttpFailure(provider: string, status: number, message: string): ProviderDefinitiveError | ProviderRetryableError {
  const code = `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_HTTP_${status}`;
  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) {
    return new ProviderRetryableError(code, message);
  }
  return new ProviderDefinitiveError(code, message);
}
