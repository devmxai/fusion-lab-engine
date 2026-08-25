import type { AdvancedComposerDraft } from "./advanced-composer-draft";
import type { CreativeSpaceProject } from "./domain";
import { readDeliveredAsset } from "./image-quote-client";
import { engineAuthorizationHeaders, ensureEngineSession } from "./engine-session";

export type AdvancedQuote = {
  id: string;
  projectId: string;
  recipeId: string;
  outputKind: "AUDIO" | "VIDEO";
  modelId: string;
  requestHash: string;
  customerCredits: number;
  providerEstimate?: { unit: string; scale: number; atomic: string };
  pricingPolicy?: { quotedGrossProfitCredits: number; markupBps: number; quotedGrossMarginBps: number };
  pinnedVersions?: Record<string, string>;
  createdAt: string;
  expiresAt: string;
  provider: string;
  localOnly: boolean;
};

export type ConfirmedAdvancedQuote = {
  quote: AdvancedQuote;
  operation: {
    id: string;
    quoteId: string;
    provider: string;
    modelId: string;
    state: string;
    financials: {
      customerQuotedCredits: number;
      customerChargedCredits: number;
      providerEstimatedCredits?: number;
      providerChargedCredits?: number;
      quotedGrossProfitCredits?: number;
    };
    createdAt: string;
    localOnly: boolean;
  };
  wallet: {
    customerCredits: { available: number; held: number; spent: number };
    providerTreasury: { localProvider: { availableAtomic: string; heldAtomic: string; spentAtomic: string } };
  };
  localOnly: boolean;
};

export type ExecutedAdvancedOperation = {
  quote: AdvancedQuote;
  operation: {
    id: string;
    quoteId: string;
    provider: string;
    modelId: string;
    state: "SETTLED" | "PROVIDER_FAILED" | "DELIVERY_FAILED" | "RECONCILIATION_REQUIRED";
    financials: {
      customerQuotedCredits: number;
      customerChargedCredits: number;
      providerEstimatedCredits?: number;
      providerChargedCredits?: number;
      quotedGrossProfitCredits?: number;
    };
    resultUrl: string | null;
    assetChecksumSha256: string | null;
    delivery?: { assetId: string; mediaType?: "image" | "video" | "audio"; checksumSha256: string } | null;
    events: Array<{ sequence: number; state: string; evidence: string; at: string }>;
    createdAt: string;
    updatedAt: string;
    localOnly: boolean;
  };
  timeline: Array<{ state: string; at: string }>;
  wallet: ConfirmedAdvancedQuote["wallet"];
  localOnly: boolean;
};

export type RecoveredAdvancedOperation = {
  quote: AdvancedQuote;
  operation: ExecutedAdvancedOperation["operation"];
  wallet: ConfirmedAdvancedQuote["wallet"];
  localOnly: boolean;
};

async function engineRequest<T>(path: string, init: RequestInit): Promise<T> {
  await ensureEngineSession();
  const response = await fetch(`/api/engine${path}`, {
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(await engineAuthorizationHeaders()), ...init.headers },
  });
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message ?? `Engine request failed (${response.status}).`);
  return payload as T;
}

export function requestAdvancedQuote(draft: AdvancedComposerDraft, project: CreativeSpaceProject): Promise<AdvancedQuote> {
  if (!draft.offerId) return Promise.reject(new Error("Choose an active published offer before requesting a quote."));
  const bindings = [...draft.bindings].sort((left, right) => left.ordinal - right.ordinal).map((binding) => {
    const asset = project.assets[binding.assetId];
    if (!asset) throw new Error(`Bound asset ${binding.assetId} is missing.`);
    return { assetId: asset.id, kind: asset.kind, status: asset.status, role: binding.role, ordinal: binding.ordinal };
  });
  return engineRequest<AdvancedQuote>("/v2/quotes", {
    method: "POST",
    body: JSON.stringify({ projectId: draft.projectId, recipeId: draft.recipeId, bindings, prompt: draft.prompt, offerId: draft.offerId, settings: draft.settings }),
  });
}

export async function confirmAdvancedQuote(quote: AdvancedQuote, idempotencyKey: string): Promise<ConfirmedAdvancedQuote> {
  const response = await engineRequest<ConfirmedAdvancedQuote & { durable?: true }>("/v2/operations", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ quoteId: quote.id, generationIntentId: idempotencyKey, requestHash: quote.requestHash }),
  });
  if (!response.durable) return response;
  return { ...response, quote: response.quote, operation: { ...response.operation, provider: response.operation.provider ?? quote.provider, modelId: response.operation.modelId ?? quote.modelId, financials: { ...response.operation.financials } } };
}

export async function runAdvancedOperation(operationId: string): Promise<ExecutedAdvancedOperation> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const recovered = await recoverAdvancedOperation(operationId);
    if (["SETTLED", "PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"].includes(recovered.operation.state)) {
      const durable = (recovered as { durable?: boolean }).durable;
      const delivery = (recovered.operation as ExecutedAdvancedOperation["operation"] & { delivery?: { assetId: string; checksumSha256: string } }).delivery;
      const resultUrl = durable && recovered.operation.state === "SETTLED" && delivery ? await readDeliveredAsset(delivery.assetId) : recovered.operation.resultUrl;
      return { ...recovered, operation: { ...recovered.operation, resultUrl, assetChecksumSha256: delivery?.checksumSha256 ?? recovered.operation.assetChecksumSha256 }, timeline: recovered.operation.events.map(({ state, at }) => ({ state, at })) } as ExecutedAdvancedOperation;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2_500));
  }
  throw new Error("Generation did not reach a terminal state in time.");
}

export async function recoverAdvancedOperation(operationId: string): Promise<RecoveredAdvancedOperation> {
  const response = await engineRequest<RecoveredAdvancedOperation & { durable?: true }>(`/v2/operations/${encodeURIComponent(operationId)}`, { method: "GET" });
  if (!response.durable) return response;
  return { ...response, operation: { ...response.operation, provider: response.operation.provider ?? response.quote.provider, modelId: response.operation.modelId ?? response.quote.modelId, financials: { ...response.operation.financials } } };
}
