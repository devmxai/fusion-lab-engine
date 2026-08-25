import type { ImageComposerDraft } from "./composer-draft";
import type { SpaceAsset, SpaceOperationState } from "./domain";
import { engineAuthorizationHeaders, ensureEngineSession } from "./engine-session";

export type ImageQuote = {
  id: string; projectId: string; recipeId: string; modelId: string; requestHash: string;
  customerCredits: number; providerEstimate?: { unit: string; scale: number; atomic: string };
  pricingPolicy?: { quotedGrossProfitCredits: number; markupBps: number; quotedGrossMarginBps: number };
  pinnedVersions?: Record<string, string>; createdAt: string; expiresAt: string; provider: string;
  configuration?: { recipeId: string; settings: Record<string, string | number | boolean>; bindingCount: number; bindingRoles: string[] };
  localOnly: boolean; durable?: true;
};

type ImageOperation = {
  id: string; quoteId: string; provider: string; modelId: string; state: SpaceOperationState;
  generationIntentId?: string;
  financials: {
    customerQuotedCredits: number; customerChargedCredits: number; providerEstimatedCredits?: number;
    providerChargedCredits?: number; quotedGrossProfitCredits?: number;
  };
  delivery?: { assetId: string; mediaType: "image" | "video" | "audio"; contentType?: string; byteLength?: number; checksumSha256: string } | null;
  resultUrl?: string | null; assetChecksumSha256?: string | null;
  events: Array<{ sequence: number; state: string; version?: number; evidence?: string; at: string }>;
  createdAt: string; updatedAt: string; localOnly: boolean;
};

export type ConfirmedImageQuote = {
  quote: ImageQuote; operation: ImageOperation;
  /** Legacy runtime returns balances; durable V2 deliberately does not fabricate them. */
  wallet?: { customerCredits: { available: number; held: number; spent: number } };
  localOnly: boolean; durable?: true;
};

export type ExecutedImageOperation = {
  quote: ImageQuote; operation: ImageOperation & { state: "SETTLED" | "PROVIDER_FAILED" | "DELIVERY_FAILED" | "RECONCILIATION_REQUIRED" };
  timeline: Array<{ state: string; at: string }>;
  wallet?: ConfirmedImageQuote["wallet"]; localOnly: boolean; durable?: true;
};

export type RecoveredImageOperation = { quote: ImageQuote; operation: ImageOperation; wallet?: ConfirmedImageQuote["wallet"]; localOnly: boolean; durable?: true };
type DurableEnvelope = { quote: ImageQuote; operation: ImageOperation; wallet?: ConfirmedImageQuote["wallet"]; localOnly: boolean; durable: true };

export class ImageEngineRequestError extends Error {
  constructor(readonly status: number, readonly code: string | null, message: string) { super(message); this.name = "ImageEngineRequestError"; }
}

async function engineRequest<T>(path: string, init: RequestInit): Promise<T> {
  await ensureEngineSession();
  const response = await fetch(`/api/engine${path}`, { ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(await engineAuthorizationHeaders()), ...init.headers } });
  const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) throw new ImageEngineRequestError(response.status, payload?.error?.code ?? null, payload?.error?.message ?? `Engine request failed (${response.status}).`);
  return payload as T;
}

/** Customer copy for typed Engine outcomes. It never invents a refund or completed charge. */
export function imageRequestErrorMessage(error: unknown, locale: "en" | "ar"): string {
  const code = error instanceof ImageEngineRequestError ? error.code : null;
  const messages = locale === "en"
    ? {
      QUOTE_EXPIRED: "This price has expired. Request a new price; no new operation was created.",
      IMAGE_QUOTE_EXPIRED: "This price has expired. Request a new price; no new operation was created.",
      INSUFFICIENT_CREDITS: "Your available credits are insufficient. No generation was started.",
      PUBLISHED_OFFER_STALE: "This model or price changed. Reload the published offer and review a new price.",
      PUBLISHED_OFFER_INCOMPATIBLE: "The selected model no longer supports these settings. Review the published model again.",
      PUBLISHED_PRICE_INVALID: "This model price is not currently available. No generation was started.",
      ASSET_ACCESS_DENIED: "This private result is no longer available to this session. Reopen the project and try again.",
      ASSET_GRANT_EXPIRED: "The secure download link expired. Try the download again; no new generation was started.",
      ASSET_NOT_FOUND: "This private result is no longer available. No new generation was started.",
      ASSET_CONTENT_UNAVAILABLE: "This private result could not be read. Try again from the project gallery.",
    }
    : {
      QUOTE_EXPIRED: "انتهت صلاحية السعر. اطلب سعراً جديداً؛ لم تُنشأ عملية جديدة.",
      IMAGE_QUOTE_EXPIRED: "انتهت صلاحية السعر. اطلب سعراً جديداً؛ لم تُنشأ عملية جديدة.",
      INSUFFICIENT_CREDITS: "الرصيد المتاح غير كافٍ. لم يبدأ أي توليد.",
      PUBLISHED_OFFER_STALE: "تغيّر النموذج أو السعر. حدّث العرض المنشور وراجع سعراً جديداً.",
      PUBLISHED_OFFER_INCOMPATIBLE: "النموذج المختار لم يعد يدعم هذه الإعدادات. راجع النموذج المنشور مجدداً.",
      PUBLISHED_PRICE_INVALID: "سعر هذا النموذج غير متاح حالياً. لم يبدأ أي توليد.",
      ASSET_ACCESS_DENIED: "هذه النتيجة الخاصة لم تعد متاحة لهذه الجلسة. أعد فتح المشروع ثم حاول مجدداً.",
      ASSET_GRANT_EXPIRED: "انتهت صلاحية رابط التنزيل الآمن. أعد محاولة التنزيل؛ لم يبدأ أي توليد جديد.",
      ASSET_NOT_FOUND: "هذه النتيجة الخاصة لم تعد متاحة. لم يبدأ أي توليد جديد.",
      ASSET_CONTENT_UNAVAILABLE: "تعذر قراءة هذه النتيجة الخاصة. حاول مجدداً من معرض المشروع.",
    };
  if (code && code in messages) return messages[code as keyof typeof messages];
  return error instanceof Error ? error.message : (locale === "en" ? "The request could not be completed." : "تعذر إكمال الطلب.");
}

function isDurable(value: ConfirmedImageQuote | DurableEnvelope): value is DurableEnvelope {
  return "durable" in value && value.durable === true;
}

function durableConfirmation(value: DurableEnvelope): ConfirmedImageQuote {
  return {
    quote: value.quote,
    operation: {
      ...value.operation,
      provider: value.operation.provider ?? value.quote.provider,
      modelId: value.operation.modelId ?? value.quote.modelId,
      financials: { ...value.operation.financials },
    },
    wallet: value.wallet,
    localOnly: value.localOnly, durable: true,
  };
}

export function requestImageQuote(draft: ImageComposerDraft, asset: SpaceAsset | null): Promise<ImageQuote> {
  if (!draft.offerId) return Promise.reject(new Error("Choose an active published offer before requesting a quote."));
  return engineRequest<ImageQuote>("/v2/quotes", { method: "POST", body: JSON.stringify({
    projectId: draft.projectId, recipeId: draft.recipeId,
    input: asset ? { assetId: asset.id, kind: asset.kind, status: asset.status } : null,
    prompt: draft.prompt, offerId: draft.offerId, settings: draft.settings,
  }) });
}

export async function confirmImageQuote(quote: ImageQuote, idempotencyKey: string): Promise<ConfirmedImageQuote> {
  const response = await engineRequest<ConfirmedImageQuote | DurableEnvelope>("/v2/operations", {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ quoteId: quote.id, generationIntentId: idempotencyKey, requestHash: quote.requestHash }),
  });
  return isDurable(response) ? durableConfirmation(response) : response;
}

async function fetchDeliveredAsset(assetId: string): Promise<Blob> {
  const grant = await engineRequest<{ token: string }>(`/v2/assets/${encodeURIComponent(assetId)}/access-grants`, {
    method: "POST", body: JSON.stringify({ ttlSeconds: 300 }),
  });
  const response = await fetch(`/api/engine/v2/assets/${encodeURIComponent(assetId)}/content`, {
    headers: { ...(await engineAuthorizationHeaders()), "x-fusion-asset-grant": grant.token },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
    throw new ImageEngineRequestError(response.status, payload?.error?.code ?? "ASSET_CONTENT_UNAVAILABLE", payload?.error?.message ?? "Unable to read the delivered private asset.");
  }
  return response.blob();
}

const extensionByContentType: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/webm": "webm", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg",
};

export function deliveredAssetFilename(requestedName: string, contentType: string): string {
  const safe = requestedName
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120) || "FusionLab-result";
  if (/\.[a-z0-9]{2,5}$/i.test(safe)) return safe;
  const extension = extensionByContentType[contentType.split(";")[0]!.toLowerCase()] ?? "bin";
  return `${safe}.${extension}`;
}

export async function readDeliveredAsset(assetId: string): Promise<string> {
  return URL.createObjectURL(await fetchDeliveredAsset(assetId));
}

export async function downloadDeliveredAsset(assetId: string, requestedName: string): Promise<{ filename: string; bytes: number }> {
  const blob = await fetchDeliveredAsset(assetId);
  const filename = deliveredAssetFilename(requestedName, blob.type);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
  return { filename, bytes: blob.size };
}

export async function runImageOperation(
  operationId: string,
  onProgress?: (operation: RecoveredImageOperation) => void,
): Promise<ExecutedImageOperation> {
  const deadline = Date.now() + 15 * 60_000;
  let attempt = 0;
  let lastTransientError: Error | null = null;
  while (Date.now() < deadline) {
    let recovered: RecoveredImageOperation;
    try {
      recovered = await recoverImageOperation(operationId);
      lastTransientError = null;
    } catch (error) {
      if (error instanceof ImageEngineRequestError && error.status < 500) throw error;
      lastTransientError = error instanceof Error ? error : new Error("Generation status is temporarily unavailable.");
      const retryDelay = Math.min(2_500 * 1.45 ** Math.floor(attempt / 3), 15_000);
      attempt += 1;
      await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
      continue;
    }
    if (["SETTLED", "PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"].includes(recovered.operation.state)) {
      let resultUrl = recovered.operation.resultUrl ?? null;
      if (recovered.durable && recovered.operation.state === "SETTLED" && recovered.operation.delivery?.assetId) {
        // A browser-scoped Blob URL is intentionally not persisted as a provider/storage URL.
        resultUrl = await readDeliveredAsset(recovered.operation.delivery.assetId);
      }
      return {
        ...recovered,
        operation: { ...recovered.operation, resultUrl, assetChecksumSha256: recovered.operation.delivery?.checksumSha256 ?? recovered.operation.assetChecksumSha256 ?? null,
          state: recovered.operation.state as ExecutedImageOperation["operation"]["state"] },
        timeline: recovered.operation.events.map(({ state, at }) => ({ state, at })),
      };
    }
    onProgress?.(recovered);
    const retryDelay = Math.min(2_500 * 1.35 ** Math.floor(attempt / 4), 15_000);
    attempt += 1;
    await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
  }
  throw lastTransientError ?? new Error("Generation exceeded the provider's 15-minute completion window and was sent for review.");
}

export async function recoverImageOperation(operationId: string): Promise<RecoveredImageOperation> {
  const response = await engineRequest<RecoveredImageOperation | DurableEnvelope>(`/v2/operations/${encodeURIComponent(operationId)}`, { method: "GET" });
  return isDurable(response) ? durableConfirmation(response) : response;
}
