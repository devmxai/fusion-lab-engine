import type { CreativeSpaceProject } from "./domain";
import type { VideoComposerDraft } from "./video-composer-draft";
import { ImageEngineRequestError, readDeliveredAsset, type ConfirmedImageQuote, type ExecutedImageOperation, type ImageQuote, type RecoveredImageOperation } from "./image-quote-client";
import { engineAuthorizationHeaders, ensureEngineSession } from "./engine-session";

export type VideoQuote = ImageQuote;
export type ConfirmedVideoQuote = ConfirmedImageQuote;
export type ExecutedVideoOperation = ExecutedImageOperation;
export type RecoveredVideoOperation = RecoveredImageOperation;
type DurableEnvelope = { quote: VideoQuote; operation: ConfirmedVideoQuote["operation"]; localOnly: boolean; durable: true };

async function request<T>(path: string, init: RequestInit): Promise<T> {
  await ensureEngineSession();
  const response = await fetch(`/api/engine${path}`, { ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(await engineAuthorizationHeaders()), ...init.headers } });
  const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) throw new ImageEngineRequestError(response.status, payload?.error?.code ?? null, payload?.error?.message ?? `Engine request failed (${response.status}).`);
  return payload as T;
}

function durable(value: ConfirmedVideoQuote | DurableEnvelope): value is DurableEnvelope { return "durable" in value && value.durable === true; }
function normalize(value: DurableEnvelope): ConfirmedVideoQuote {
  return { quote: value.quote, operation: { ...value.operation, provider: value.operation.provider ?? value.quote.provider, modelId: value.operation.modelId ?? value.quote.modelId, financials: { ...value.operation.financials } }, localOnly: true, durable: true };
}

export function requestVideoQuote(draft: VideoComposerDraft, project: CreativeSpaceProject): Promise<VideoQuote> {
  if (!draft.offerId) return Promise.reject(new Error("Choose an active published offer before requesting a quote."));
  // Drafts reference the project-card ID so React can always locate the
  // selected asset. Generated cards are projections (`output:<operation>`),
  // while the Engine authorizes their durable private delivery UUID.
  const bindings = draft.bindings.map((binding) => {
    const asset = project.assets[binding.assetId];
    if (!asset) throw new Error(`Bound asset ${binding.assetId} is missing.`);
    return {
      assetId: asset.deliveryAssetId ?? asset.id,
      kind: asset.kind,
      status: asset.status,
      slot: binding.slot,
      ordinal: binding.ordinal,
    };
  });
  return request<VideoQuote>("/v2/quotes", { method: "POST", body: JSON.stringify({ projectId: draft.projectId, recipeId: draft.recipeId, bindings, prompt: draft.prompt, offerId: draft.offerId, settings: draft.settings }) });
}

export async function confirmVideoQuote(quote: VideoQuote, idempotencyKey: string): Promise<ConfirmedVideoQuote> {
  const value = await request<ConfirmedVideoQuote | DurableEnvelope>("/v2/operations", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ quoteId: quote.id, generationIntentId: idempotencyKey, requestHash: quote.requestHash }) });
  return durable(value) ? normalize(value) : value;
}

export async function recoverVideoOperation(operationId: string): Promise<RecoveredVideoOperation> {
  const value = await request<RecoveredVideoOperation | DurableEnvelope>(`/v2/operations/${encodeURIComponent(operationId)}`, { method: "GET" });
  return durable(value) ? normalize(value) : value;
}

/** Polls a previously reserved operation only. It never creates a replacement
 * operation, guesses settlement, or turns a transient status error into a
 * financial outcome. */
export async function runVideoOperation(
  operationId: string,
  onProgress?: (operation: RecoveredVideoOperation) => void,
): Promise<ExecutedVideoOperation> {
  const deadline = Date.now() + 15 * 60_000;
  let attempt = 0;
  let lastTransientError: Error | null = null;
  while (Date.now() < deadline) {
    let recovered: RecoveredVideoOperation;
    try {
      recovered = await recoverVideoOperation(operationId);
      lastTransientError = null;
    } catch (error) {
      if (error instanceof ImageEngineRequestError && error.status < 500) throw error;
      lastTransientError = error instanceof Error ? error : new Error("Video status is temporarily unavailable.");
      const retryDelay = Math.min(2_500 * 1.45 ** Math.floor(attempt / 3), 15_000);
      attempt += 1;
      await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
      continue;
    }
    if (["SETTLED", "PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"].includes(recovered.operation.state)) {
      const resultUrl = recovered.durable && recovered.operation.state === "SETTLED" && recovered.operation.delivery?.assetId ? await readDeliveredAsset(recovered.operation.delivery.assetId) : recovered.operation.resultUrl ?? null;
      return { ...recovered, operation: { ...recovered.operation, resultUrl, assetChecksumSha256: recovered.operation.delivery?.checksumSha256 ?? recovered.operation.assetChecksumSha256 ?? null, state: recovered.operation.state as ExecutedVideoOperation["operation"]["state"] }, timeline: recovered.operation.events.map(({ state, at }) => ({ state, at })) };
    }
    onProgress?.(recovered);
    const retryDelay = Math.min(2_500 * 1.35 ** Math.floor(attempt / 4), 15_000);
    attempt += 1;
    await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
  }
  throw lastTransientError ?? new Error("Video generation exceeded the provider's 15-minute completion window and was sent for review.");
}
