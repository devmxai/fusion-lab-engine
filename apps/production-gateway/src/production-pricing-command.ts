import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAdminPermission } from "../../../packages/admin-control-plane/src/authorization.js";
import type { AdminIdentity } from "../../../packages/admin-control-plane/src/types.js";
import type { ProductionGatewayConfig } from "./config.js";
import { productionDatabase } from "./database-readiness.js";

type Row = Record<string, unknown>;
type ImportedRate = {
  referenceModelId: string;
  providerId: "kie" | "openrouter";
  providerModelId: string;
  rateKey: string;
  label: string;
  billingUnit: string;
  providerCreditMicros: bigint | null;
  providerUsdPicos: bigint | null;
  variant: Record<string, unknown>;
  sourceUrl: string;
};

export class ProductionPricingCommandError extends Error {
  constructor(
    readonly code: "PRICING_COMMAND_INVALID" | "PRICING_COMMAND_CONFLICT" | "PRICING_SOURCE_FAILED" | "PRICING_SOURCE_INCOMPLETE" | "PRICING_RATE_NOT_FOUND",
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ProductionPricingCommandError";
  }
}

const ConfigurePriceInput = z.object({
  referenceModelId: z.string().min(1).max(200),
  rateKey: z.string().min(1).max(160),
  customerCredits: z.number().int().min(1).max(1_000_000_000),
}).strict();

const KiePricingResponse = z.object({
  code: z.literal(200),
  data: z.object({
    pages: z.number().int().min(1).max(100),
    records: z.array(z.object({
      modelDescription: z.string().min(1),
      interfaceType: z.string().default("unknown"),
      provider: z.string().default("unknown"),
      creditPrice: z.union([z.string(), z.number()]).transform(String),
      creditUnit: z.string().nullish(),
      usdPrice: z.union([z.string(), z.number()]).transform(String),
      anchor: z.string().nullish(),
    }).passthrough()),
  }).passthrough(),
}).passthrough();

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const stableHash = (value: unknown) => sha256(JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort()));

function decimalAtomic(value: string, decimals: number, field: string): bigint {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new ProductionPricingCommandError("PRICING_SOURCE_INCOMPLETE", `${field} is not a non-negative decimal.`, 502);
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) {
    const discarded = fraction.slice(decimals);
    if (/[1-9]/.test(discarded)) throw new ProductionPricingCommandError("PRICING_SOURCE_INCOMPLETE", `${field} exceeds the supported precision.`, 502);
  }
  return BigInt(whole!) * (10n ** BigInt(decimals)) + BigInt((fraction.slice(0, decimals) + "0".repeat(decimals)).slice(0, decimals));
}

export function normalizeKiePricingVariant(modelDescription: string, providerModelId: string, billingUnit: string): Record<string, unknown> {
  const tokens = modelDescription.split(",").map((token) => token.trim()).filter(Boolean);
  const dimensions: Record<string, string | number | boolean> = {};
  const routeType = providerModelId.match(/(text-to-image|image-to-image|image-edit|text-to-video|image-to-video|video-to-video|text-to-audio|text-to-speech)/i)?.[1];
  if (routeType) dimensions.generationType = routeType.toLowerCase();
  for (const token of tokens.slice(1)) {
    const normalized = token.toLowerCase();
    if (/^(?:\d+k|\d{3,4}p)$/.test(normalized)) dimensions.resolution = normalized.toUpperCase().replace("P", "p");
    else if (/^(?:low|medium|high|standard|pro|ultra|balanced|fast)$/.test(normalized)) dimensions.quality = normalized;
    else if (/^\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds)$/.test(normalized)) dimensions.durationSeconds = Number.parseFloat(normalized);
    else if (/^(?:with audio|audio on|audio)$/.test(normalized)) dimensions.audio = true;
    else if (/^(?:without audio|no audio|audio off)$/.test(normalized)) dimensions.audio = false;
    else if (/^\d{1,2}:\d{1,2}$/.test(normalized)) dimensions.aspectRatio = normalized;
  }
  // KIE also emits compound SKU labels such as "Turbo Pro-5.0s".  Parse
  // dimensions from the complete official label instead of treating those
  // two billable durations as an indistinguishable "Default" configuration.
  const description = modelDescription.toLowerCase();
  const embeddedDuration = description.match(/(?:^|[^0-9])(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/i);
  if (embeddedDuration && dimensions.durationSeconds === undefined) dimensions.durationSeconds = Number.parseFloat(embeddedDuration[1]!);
  if (/\b(?:pro|turbo\s+pro)\b/.test(description) && dimensions.quality === undefined) dimensions.quality = "pro";
  const unit = billingUnit.toLowerCase();
  dimensions.billingBasis = unit.includes("second") ? "per_second" : unit.includes("image") ? "per_image" : unit.includes("video") ? "per_video" : unit.replace(/\s+/g, "_");
  const variantTokens = tokens.slice(1).filter((token) => token.toLowerCase() !== routeType?.toLowerCase());
  return { label: variantTokens.join(" · ") || "Default", dimensions };
}

type SelectedProviderModel = Awaited<ReturnType<typeof selectedModels>>[number];
type KiePricingRecord = z.infer<typeof KiePricingResponse>["data"]["records"][number];

type PinnedCustomerPresentation = Readonly<{
  schemaVersion: 1;
  productFamily: Readonly<{ id: string; displayName: string }>;
  version?: Readonly<{ id: string; displayName: string }>;
  edition?: Readonly<{ id: string; displayName: string }>;
  experienceCategories: readonly ("IMAGE" | "VIDEO" | "AVATAR" | "AUDIO")[];
}>;

const presentationRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const presentationText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 120;

/**
 * A price release is immutable. Copy a reviewed model presentation only when
 * it is tied to the exact catalog snapshot selected for that route. This
 * prevents a later Admin copy edit from changing an already released offer.
 */
export function pinnedReviewedPresentation(referencePayload: unknown, selectedCatalogSnapshotId: unknown): PinnedCustomerPresentation | null {
  if (!presentationRecord(referencePayload) || !presentationText(selectedCatalogSnapshotId) || referencePayload.catalogSnapshotId !== selectedCatalogSnapshotId) return null;
  const taxonomy = referencePayload.reviewedTaxonomy;
  if (!presentationRecord(taxonomy) || taxonomy.schemaVersion !== 1 || taxonomy.reviewState !== "REVIEWED" || taxonomy.sourceCatalogSnapshotId !== selectedCatalogSnapshotId) return null;
  const productFamily = taxonomy.productFamily;
  if (!presentationRecord(productFamily) || !presentationText(productFamily.id) || !presentationText(productFamily.displayName) || !Array.isArray(taxonomy.experienceCategories)) return null;
  const experienceCategories = [...new Set(taxonomy.experienceCategories.map(String))];
  if (!experienceCategories.length || experienceCategories.some((category) => !["IMAGE", "VIDEO", "AVATAR", "AUDIO"].includes(category))) return null;
  const part = (value: unknown) => {
    if (value === undefined) return undefined;
    if (!presentationRecord(value) || !presentationText(value.id) || !presentationText(value.displayName)) return null;
    return { id: value.id.trim(), displayName: value.displayName.trim() };
  };
  const version = part(taxonomy.version);
  const edition = part(taxonomy.edition);
  if (version === null || edition === null) return null;
  return {
    schemaVersion: 1,
    productFamily: { id: productFamily.id.trim(), displayName: productFamily.displayName.trim() },
    ...(version ? { version } : {}),
    ...(edition ? { edition } : {}),
    experienceCategories: experienceCategories as PinnedCustomerPresentation["experienceCategories"],
  };
}

/**
 * KIE's public pricing feed is not homogeneous: some rows link to a market
 * page through `anchor`, while others (including Grok Imagine) only carry a
 * documented model description such as `grok-imagine-image-2-0, Image Edit`.
 *
 * An anchor is preferred when present. For unanchored rows we use the base
 * model ID and the explicit route label together. This deliberately refuses
 * an ambiguous match rather than attaching a price to the wrong operation.
 */
function canonicalKieId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const kieRouteKinds = ["text-to-image", "image-to-image", "image-edit", "text-to-video", "image-to-video", "video-to-video", "text-to-audio", "text-to-speech"] as const;

function kieRouteKind(value: string): string | null {
  const normalized = canonicalKieId(value);
  return kieRouteKinds.find((kind) => normalized.includes(kind)) ?? null;
}

function kieBaseModelId(value: string): string {
  const normalized = canonicalKieId(value);
  const route = kieRouteKind(normalized);
  return route ? normalized.replace(new RegExp(`-${route}(?:-|$).*`), "") : normalized;
}

// KIE's public pricing feed and its documented request IDs are independently
// named. Keep the exceptional mapping small and explicit: a loose fuzzy match
// here could attach a text-to-video price to an image-to-video route.
const kiePricingBaseAliases: Readonly<Record<string, readonly string[]>> = {
  "kling-v3-turbo": ["kling-3-0-turbo"],
  // KIE documents the request ID as `kling-3.0/video` while its public
  // pricing page is named `kling-3-0`.  This is an exact documentation
  // mapping, not a fuzzy model-name match.
  "kling-3-0-video": ["kling-3-0"],
};

const kling3Modes = {
  std: "720p",
  pro: "1080p",
  "4K": "4K",
} as const;

const kling3Durations = Array.from({ length: 13 }, (_, index) => index + 3);
const kling3AspectRatios = ["16:9", "9:16", "1:1"] as const;

/**
 * A capability pricing profile is the bridge between a provider's public
 * rate meter and one immutable executable SKU.  New models add a profile;
 * the quoting, UI and adapter pipeline then consume the same dimensions.
 */
function kling3RatesFromRecord(input: {
  model: SelectedProviderModel;
  record: KiePricingRecord;
}): ImportedRate[] | null {
  const { model, record } = input;
  if (String(model.value.providerModelId) !== "kling-3.0/video") return null;
  const description = record.modelDescription.toLowerCase();
  if (!/\bkling\s*3\.0\b/.test(description) || !/\bvideo\b/.test(description) || !/second/i.test(record.creditUnit ?? "")) return null;
  const resolution = /4k/i.test(record.modelDescription) ? "4K" : /1080p/i.test(record.modelDescription) ? "1080p" : /720p/i.test(record.modelDescription) ? "720p" : null;
  if (!resolution) return [];
  const quality = (Object.entries(kling3Modes).find(([, mappedResolution]) => mappedResolution === resolution)?.[0] ?? null) as keyof typeof kling3Modes | null;
  if (!quality) return [];
  const audio = /\bwithout\s+audio\b|\bno\s+audio\b/i.test(description)
    ? false
    : /\bwith\s+audio\b|\baudio\b/i.test(description) ? true : null;
  if (audio === null) return [];
  const providerCreditPerSecond = decimalAtomic(record.creditPrice, 6, "KIE credit price");
  const providerUsdPerSecond = decimalAtomic(record.usdPrice, 12, "KIE USD price");
  return kling3Durations.map((durationSeconds) => ({
    referenceModelId: model.referenceModelId,
    providerId: "kie" as const,
    providerModelId: "kling-3.0/video",
    rateKey: `kling3.mode.${quality}.sound.${audio ? "on" : "off"}.duration.${durationSeconds}`,
    label: `Kling 3.0 · ${quality} · ${resolution} · ${audio ? "sound" : "no sound"} · ${durationSeconds}s`,
    billingUnit: "per video",
    providerCreditMicros: providerCreditPerSecond * BigInt(durationSeconds),
    providerUsdPicos: providerUsdPerSecond * BigInt(durationSeconds),
    variant: {
      label: `${quality} · ${resolution} · ${audio ? "sound" : "no sound"} · ${durationSeconds}s`,
      dimensions: {
        generationType: "image-to-video",
        durationSeconds,
        quality,
        resolution,
        audio,
        supportedAspectRatios: [...kling3AspectRatios],
        billingBasis: "per_video",
        providerMeter: "per_second",
      },
      interfaceType: record.interfaceType,
      publisher: record.provider,
      sourceMeter: record.modelDescription,
      perSecondUsdPicos: providerUsdPerSecond.toString(),
    },
    sourceUrl: record.anchor || "https://kie.ai/kling-3-0",
  }));
}

function sameKieBaseModel(left: string, right: string): boolean {
  if (left === right) return true;
  return (kiePricingBaseAliases[left]?.includes(right) ?? false)
    || (kiePricingBaseAliases[right]?.includes(left) ?? false);
}

function anchorModelId(record: KiePricingRecord): string | null {
  try { return record.anchor ? new URL(record.anchor).searchParams.get("model") : null; }
  catch { return null; }
}

export function resolveKiePricingModel(models: SelectedProviderModel[], record: KiePricingRecord): SelectedProviderModel | null {
  const anchoredModelId = anchorModelId(record);
  if (anchoredModelId) return models.find((model) => String(model.value.providerModelId) === anchoredModelId) ?? null;

  const descriptionParts = record.modelDescription.split(",").map((part) => part.trim()).filter(Boolean);
  const descriptionBase = kieBaseModelId(descriptionParts[0] ?? "");
  const describedRoute = kieRouteKind(descriptionParts.slice(1).join(" "));
  const candidates = models.filter((model) => sameKieBaseModel(kieBaseModelId(String(model.value.providerModelId)), descriptionBase));
  if (describedRoute) return candidates.find((model) => kieRouteKind(String(model.value.providerModelId)) === describedRoute) ?? null;
  return candidates.length === 1 ? candidates[0]! : null;
}

/** A configured price is not automatically an executable route. */
export function releasedAdapterVersion(providerId: string, rawVariant: unknown, providerModelId?: string): string | null {
  const variant = rawVariant && typeof rawVariant === "object" ? rawVariant as Record<string, unknown> : {};
  const dimensions = variant.dimensions && typeof variant.dimensions === "object" ? variant.dimensions as Record<string, unknown> : {};
  const generationType = String(dimensions.generationType ?? "").toLowerCase();
  // Image editing needs the authenticated source-upload pipeline; do not
  // publish it merely because the provider can price it. That prevents an
  // invisible or non-runnable offer from reaching a customer wallet.
  if (providerId === "kie" && generationType === "text-to-image") return "kie-market.v1";
  // GPT Image 2's documented image-to-image contract is deliberately a
  // separate adapter version. KIE requires `input_urls` (an array containing
  // the server-issued private image URL) and documents `aspect_ratio: auto`.
  // The public documentation does not certify a request-side 2K/4K switch,
  // therefore only the 1K default commercial SKU is released. This keeps the
  // customer price and the provider request in lockstep instead of presenting
  // a selectable quality that the provider API cannot prove it will honor.
  if (providerId === "kie"
    && providerModelId === "gpt-image-2-image-to-image"
    && generationType === "image-to-image"
    && dimensions.billingBasis === "per_image"
    && dimensions.resolution === "1K") return "kie-market.image-to-image.gpt-image-2.v1";
  // This is deliberately model-specific: the adapter request has been
  // certified against KIE's V2.5 Turbo I2V documentation, including the
  // required signed image URL and the official 5/10 second SKU dimensions.
  if (providerId === "kie"
    && providerModelId === "kling/v2-5-turbo-image-to-video-pro"
    && generationType === "image-to-video"
    && dimensions.billingBasis === "per_video"
    && (dimensions.durationSeconds === 5 || dimensions.durationSeconds === 10)) return "kie-market.image-to-video.v1";
  // KIE's V3 Turbo I2V public contract documents `image_urls`, a string
  // duration and 720p/1080p output. We publish only the documented 5-second
  // SKU imported below; other durations stay unavailable until verified.
  if (providerId === "kie"
    && providerModelId === "kling/v3-turbo-image-to-video"
    && generationType === "image-to-video"
    && dimensions.billingBasis === "per_video"
    && dimensions.durationSeconds === 5
    && ["720p", "1080p"].includes(String(dimensions.resolution ?? ""))) return "kie-market.image-to-video.v3";
  if (providerId === "kie"
    && providerModelId === "kling-3.0/video"
    && generationType === "image-to-video"
    && dimensions.billingBasis === "per_video"
    && Number.isInteger(dimensions.durationSeconds)
    && kling3Durations.includes(Number(dimensions.durationSeconds))
    && typeof dimensions.audio === "boolean"
    && Object.entries(kling3Modes).some(([quality, resolution]) => dimensions.quality === quality && dimensions.resolution === resolution)
    && Array.isArray(dimensions.supportedAspectRatios)
    && kling3AspectRatios.every((ratio) => (dimensions.supportedAspectRatios as unknown[]).includes(ratio))) return "kie-market.kling-3.v1";
  if (providerId === "openrouter" && generationType === "text-to-image" && dimensions.billingBasis === "per_image" && variant.runtimeReleasable === true) return "openrouter-image.v1";
  if (providerId === "openrouter" && generationType === "text-to-video" && dimensions.billingBasis === "per_video") return "openrouter-video.v1";
  return null;
}

function storedResponse(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  throw new ProductionPricingCommandError("PRICING_COMMAND_CONFLICT", "Stored pricing command response is invalid.", 409);
}

async function priorCommand(database: ReturnType<typeof productionDatabase>, commandId: string, requestHash: string): Promise<Record<string, unknown> | null> {
  const result = await database.query<Row>("SELECT request_hash,response FROM fusion_engine.provider_pricing_commands WHERE command_id=$1", [commandId]);
  if (!result.rows[0]) return null;
  if (result.rows[0].request_hash !== requestHash) throw new ProductionPricingCommandError("PRICING_COMMAND_CONFLICT", "The idempotency key is already bound to another pricing intent.", 409);
  return storedResponse(result.rows[0].response);
}

async function selectedModels(config: ProductionGatewayConfig, providerId: "kie" | "openrouter") {
  const result = await productionDatabase(config).query<Row>(`SELECT model.entity_id,model.payload
    FROM fusion_engine.provider_model_selections selection
    JOIN fusion_engine.provider_control_entities entity ON entity.entity_type='REFERENCE_MODEL' AND entity.entity_id=selection.reference_model_id
    JOIN fusion_engine.provider_control_versions model ON model.entity_type=entity.entity_type AND model.entity_id=entity.entity_id AND model.version=entity.current_version
    WHERE selection.provider_id=$1 AND selection.state='SELECTED'`, [providerId]);
  return result.rows.map((row) => ({
    referenceModelId: String(row.entity_id),
    value: (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) as Record<string, unknown>,
  }));
}

async function fetchJson(request: typeof fetch, url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await request(url, { ...init, signal: AbortSignal.timeout(15_000), headers: { accept: "application/json", "user-agent": "FusionLab-Pricing-Evidence/1.0", ...(init?.headers ?? {}) } });
  } catch {
    throw new ProductionPricingCommandError("PRICING_SOURCE_FAILED", "The official provider pricing source could not be reached.", 502);
  }
  const text = await response.text();
  if (!response.ok || text.length > 2_000_000) throw new ProductionPricingCommandError("PRICING_SOURCE_FAILED", "The official provider pricing source returned an invalid response.", 502);
  try { return JSON.parse(text); } catch { throw new ProductionPricingCommandError("PRICING_SOURCE_FAILED", "The official provider pricing source did not return JSON.", 502); }
}

async function importKieRates(models: Awaited<ReturnType<typeof selectedModels>>, request: typeof fetch) {
  const sourceUrl = "https://api.kie.ai/client/v1/model-pricing/page";
  const fetchPage = async (pageNum: number) => {
    const raw = await fetchJson(request, sourceUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pageNum, pageSize: 100, modelDescription: "", interfaceType: "" }) });
    const parsed = KiePricingResponse.safeParse(raw);
    if (!parsed.success) throw new ProductionPricingCommandError("PRICING_SOURCE_INCOMPLETE", "KIE pricing evidence did not match the documented public response.", 502);
    return { raw, value: parsed.data };
  };
  const firstPage = await fetchPage(1);
  const remainingPages = await Promise.all(Array.from({ length: firstPage.value.data.pages - 1 }, (_, index) => fetchPage(index + 2)));
  const pages = [firstPage, ...remainingPages];
  const rawResponses: unknown[] = pages.map((page) => page.raw);
  const records: z.infer<typeof KiePricingResponse>["data"]["records"] = [];
  for (const page of pages) records.push(...page.value.data.records);
  const rates: ImportedRate[] = [];
  for (const record of records) {
    const model = resolveKiePricingModel(models, record);
    if (!model) continue;
    const providerModelId = String(model.value.providerModelId);
    const kling3Rates = kling3RatesFromRecord({ model, record });
    if (kling3Rates) {
      rates.push(...kling3Rates);
      continue;
    }
    const isKlingV3ImageToVideo = providerModelId === "kling/v3-turbo-image-to-video"
      && /\bkling\s+3\.0\s+turbo\b/i.test(record.modelDescription)
      && /\bimage-to-video\b/i.test(record.modelDescription)
      && /\b(?:720|1080)p\b/i.test(record.modelDescription)
      && /second/i.test(record.creditUnit ?? "");
    // KIE publishes this route in credits per second, while its public
    // request example certifies a five-second job. Persist one immutable
    // per-video SKU whose cost is the proven rate × 5, so reservations and
    // customer quotes are never based on a mutable arithmetic step.
    const certifiedDurationSeconds = isKlingV3ImageToVideo ? 5 : null;
    const billingUnit = isKlingV3ImageToVideo ? "per video" : record.creditUnit?.trim() || (record.interfaceType === "unknown" ? "per generation" : `per ${record.interfaceType}`);
    const providerCreditMicros = decimalAtomic(record.creditPrice, 6, "KIE credit price") * BigInt(certifiedDurationSeconds ?? 1);
    const providerUsdPicos = decimalAtomic(record.usdPrice, 12, "KIE USD price") * BigInt(certifiedDurationSeconds ?? 1);
    const normalizedVariant = normalizeKiePricingVariant(record.modelDescription, providerModelId, billingUnit);
    const normalizedDimensions = normalizedVariant.dimensions && typeof normalizedVariant.dimensions === "object"
      ? normalizedVariant.dimensions as Record<string, unknown> : {};
    rates.push({
      referenceModelId: model.referenceModelId,
      providerId: "kie",
      providerModelId,
      rateKey: `sku.${sha256(record.modelDescription.toLowerCase()).slice(0, 16)}`,
      label: record.modelDescription,
      billingUnit,
      providerCreditMicros,
      providerUsdPicos,
      variant: {
        ...normalizedVariant,
        dimensions: {
          ...normalizedDimensions,
          ...(certifiedDurationSeconds ? { durationSeconds: certifiedDurationSeconds, providerMeter: "per_second" } : {}),
        },
        interfaceType: record.interfaceType,
        publisher: record.provider,
      },
      // The API is POST-only. For unanchored records keep a browser-safe
      // evidence link in Admin while the immutable snapshot retains the API
      // payload used for accounting.
      sourceUrl: record.anchor || "https://kie.ai/pricing",
    });
  }
  return { sourceUrl, raw: rawResponses, rates };
}

async function importOpenRouterRates(models: Awaited<ReturnType<typeof selectedModels>>, request: typeof fetch) {
  const sourceUrl = "https://openrouter.ai/api/v1/models?output_modalities=all";
  const imageModelsUrl = "https://openrouter.ai/api/v1/images/models";
  const videoModelsUrl = "https://openrouter.ai/api/v1/videos/models";
  const [raw, rawImageModels, rawVideoModels] = await Promise.all([
    fetchJson(request, sourceUrl), fetchJson(request, imageModelsUrl), fetchJson(request, videoModelsUrl),
  ]);
  const rows = (value: unknown) => value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)
    ? (value as { data: unknown[] }).data : null;
  const data = rows(raw);
  const imageModels = rows(rawImageModels);
  const videoModels = rows(rawVideoModels);
  if (!data || !imageModels || !videoModels) throw new ProductionPricingCommandError("PRICING_SOURCE_INCOMPLETE", "OpenRouter pricing evidence did not match the documented public response.", 502);
  const byProviderModel = new Map(models.map((model) => [String(model.value.providerModelId), model]));
  const rates: ImportedRate[] = [];

  // Video prices are per-second SKUs. Expand each supported duration into an
  // immutable per-video maximum so a customer quote never depends on a later
  // multiplication or a mutable UI value.
  const videoIds = new Set<string>();
  for (const item of videoModels) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const modelId = typeof record.id === "string" ? record.id : "";
    const model = byProviderModel.get(modelId);
    const skus = record.pricing_skus && typeof record.pricing_skus === "object" ? record.pricing_skus as Record<string, unknown> : null;
    const durations = Array.isArray(record.supported_durations) ? record.supported_durations.filter((value): value is number => Number.isSafeInteger(value) && Number(value) > 0) : [];
    const supportedAspectRatios = Array.isArray(record.supported_aspect_ratios) ? record.supported_aspect_ratios.filter((value): value is string => typeof value === "string") : [];
    const supportedResolutions = Array.isArray(record.supported_resolutions) ? record.supported_resolutions.filter((value): value is string => typeof value === "string") : [];
    if (!model || !skus || !durations.length) continue;
    videoIds.add(modelId);
    for (const [sku, rawValue] of Object.entries(skus)) {
      if ((typeof rawValue !== "string" && typeof rawValue !== "number") || !/^\d+(?:\.\d+)?$/.test(String(rawValue))) continue;
      const perSecondPicos = decimalAtomic(String(rawValue), 12, `OpenRouter ${sku} price`);
      const audio = sku.includes("without_audio") ? false : sku.includes("with_audio") ? true : undefined;
      const resolution = sku.match(/(?:^|_)(480p|720p|1080p|1k|2k|4k)(?:_|$)/i)?.[1];
      const quality = sku.match(/(?:^|_)(fast|precise|creative|standard|pro|quality)(?:_|$)/i)?.[1];
      for (const durationSeconds of durations) {
        const dimensions: Record<string, unknown> = { generationType: "text-to-video", durationSeconds, billingBasis: "per_video" };
        if (audio !== undefined) dimensions.audio = audio;
        if (resolution) dimensions.resolution = resolution.toUpperCase().replace("P", "p");
        else if (supportedResolutions[0]) dimensions.resolution = supportedResolutions[0];
        dimensions.supportedResolutions = supportedResolutions;
        dimensions.supportedAspectRatios = supportedAspectRatios;
        if (quality) dimensions.quality = quality.toLowerCase();
        rates.push({
          referenceModelId: model.referenceModelId, providerId: "openrouter", providerModelId: modelId,
          rateKey: `video.${sku}.duration.${durationSeconds}`,
          label: `${String(record.name ?? modelId)} · ${durationSeconds}s · ${sku.replace(/_/g, " ")}`,
          billingUnit: "per video", providerCreditMicros: null,
          providerUsdPicos: perSecondPicos * BigInt(durationSeconds),
          variant: { label: `${durationSeconds}s · ${sku.replace(/_/g, " ")}`, dimensions, sourceMeter: sku, perSecondUsdPicos: perSecondPicos.toString() },
          sourceUrl: videoModelsUrl,
        });
      }
    }
  }

  // Image endpoint pricing is endpoint-specific. Keep the evidence visible in
  // Admin, but do not imply that a token/megapixel meter is a fixed generation
  // cost. Runtime publication is independently gated below.
  const imageIds = new Set<string>();
  for (const item of imageModels) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const modelId = typeof record.id === "string" ? record.id : "";
    const model = byProviderModel.get(modelId);
    const endpointsPath = typeof record.endpoints === "string" ? record.endpoints : "";
    if (!model || !endpointsPath.startsWith("/api/v1/images/models/")) continue;
    imageIds.add(modelId);
    const endpointUrl = `https://openrouter.ai${endpointsPath}`;
    const endpointRaw = await fetchJson(request, endpointUrl);
    const endpoints = endpointRaw && typeof endpointRaw === "object" && Array.isArray((endpointRaw as { endpoints?: unknown }).endpoints)
      ? (endpointRaw as { endpoints: unknown[] }).endpoints : null;
    if (!endpoints) throw new ProductionPricingCommandError("PRICING_SOURCE_INCOMPLETE", `OpenRouter image endpoint pricing is incomplete for ${modelId}.`, 502);
    const maxima = new Map<string, { value: bigint; billable: string; unit: string; variant: string | null }>();
    const supportedResolutions = new Set<string>();
    const supportedAspectRatios = new Set<string>();
    for (const endpoint of endpoints) {
      if (!endpoint || typeof endpoint !== "object") continue;
      const endpointRecord = endpoint as Record<string, unknown>;
      const supported = endpointRecord.supported_parameters && typeof endpointRecord.supported_parameters === "object"
        ? endpointRecord.supported_parameters as Record<string, unknown> : {};
      const resolutions = supported.resolution && typeof supported.resolution === "object"
        ? (supported.resolution as Record<string, unknown>).values : [];
      const aspectRatios = supported.aspect_ratio && typeof supported.aspect_ratio === "object"
        ? (supported.aspect_ratio as Record<string, unknown>).values : [];
      if (Array.isArray(resolutions)) for (const value of resolutions) if (typeof value === "string") supportedResolutions.add(value);
      if (Array.isArray(aspectRatios)) for (const value of aspectRatios) if (typeof value === "string") supportedAspectRatios.add(value);
      const pricing = Array.isArray(endpointRecord.pricing) ? endpointRecord.pricing as unknown[] : [];
      for (const line of pricing) {
        if (!line || typeof line !== "object") continue;
        const price = line as Record<string, unknown>;
        const billable = typeof price.billable === "string" ? price.billable : "";
        const unit = typeof price.unit === "string" ? price.unit : "";
        const cost = typeof price.cost_usd === "number" ? price.cost_usd.toFixed(12).replace(/0+$/, "").replace(/\.$/, "") : String(price.cost_usd ?? "");
        if (!billable || !unit || !/^\d+(?:\.\d+)?$/.test(cost)) continue;
        const variant = typeof price.variant === "string" ? price.variant : null;
        const key = `${billable}.${unit}.${variant ?? "default"}`;
        const value = decimalAtomic(cost, 12, `OpenRouter ${key} price`);
        const before = maxima.get(key);
        if (!before || value > before.value) maxima.set(key, { value, billable, unit, variant });
      }
    }
    for (const [key, price] of maxima) rates.push({
      referenceModelId: model.referenceModelId, providerId: "openrouter", providerModelId: modelId,
      rateKey: `image.${key}`, label: `${String(record.name ?? modelId)} · ${key.replace(/\./g, " ")}`,
      billingUnit: `per ${price.unit}`, providerCreditMicros: null, providerUsdPicos: price.value,
      variant: { label: price.variant ?? price.billable, dimensions: {
        generationType: "text-to-image", billingBasis: `per_${price.unit}`, meter: price.billable,
        supportedResolutions: [...supportedResolutions], supportedAspectRatios: [...supportedAspectRatios],
        ...(price.variant ? { quality: price.variant } : {}),
      }, runtimeReleasable: price.unit === "image" },
      sourceUrl: endpointUrl,
    });
  }

  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const modelId = typeof record.id === "string" ? record.id : "";
    const model = byProviderModel.get(modelId);
    const pricing = record.pricing && typeof record.pricing === "object" ? record.pricing as Record<string, unknown> : null;
    if (!model || !pricing || videoIds.has(modelId) || imageIds.has(modelId)) continue;
    for (const [meter, value] of Object.entries(pricing)) {
      if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) continue;
      rates.push({ referenceModelId: model.referenceModelId, providerId: "openrouter", providerModelId: modelId, rateKey: `meter.${meter}`,
        label: `${String(record.name ?? modelId)} · ${meter}`, billingUnit: `per ${meter}`, providerCreditMicros: null,
        providerUsdPicos: decimalAtomic(value, 12, `OpenRouter ${meter} price`), variant: { meter }, sourceUrl });
    }
  }
  return { sourceUrl, raw: { models: raw, images: rawImageModels, videos: rawVideoModels }, rates };
}

async function syncProviderRates(input: { identity: AdminIdentity; providerId: "kie" | "openrouter"; commandId: string; config: ProductionGatewayConfig; request: typeof fetch }) {
  requireAdminPermission(input.identity, "DRAFT", "PRICING_POLICY");
  const database = productionDatabase(input.config);
  const requestHash = stableHash({ action: "SYNC_PROVIDER_RATES", providerId: input.providerId });
  const prior = await priorCommand(database, input.commandId, requestHash);
  if (prior) return prior;
  const models = await selectedModels(input.config, input.providerId);
  if (!models.length) throw new ProductionPricingCommandError("PRICING_RATE_NOT_FOUND", "Select at least one provider model before importing prices.", 409);
  const imported = input.providerId === "kie" ? await importKieRates(models, input.request) : await importOpenRouterRates(models, input.request);
  if (!imported.rates.length) throw new ProductionPricingCommandError("PRICING_SOURCE_INCOMPLETE", "The official source contains no pricing rows for the selected models.", 422);
  const matchedModelIds = new Set(imported.rates.map((rate) => rate.referenceModelId));
  const unmatchedReferenceModelIds = models.filter((model) => !matchedModelIds.has(model.referenceModelId)).map((model) => model.referenceModelId);
  const observedAt = new Date().toISOString();
  const payloadText = JSON.stringify(imported.raw);
  return database.transaction(async (transaction) => {
    const repeated = await transaction.query<Row>("SELECT request_hash,response FROM fusion_engine.provider_pricing_commands WHERE command_id=$1 FOR UPDATE", [input.commandId]);
    if (repeated.rows[0]) {
      if (repeated.rows[0].request_hash !== requestHash) throw new ProductionPricingCommandError("PRICING_COMMAND_CONFLICT", "The idempotency key is already bound to another pricing intent.", 409);
      return storedResponse(repeated.rows[0].response);
    }
    const snapshotId = randomUUID();
    await transaction.query("INSERT INTO fusion_engine.provider_pricing_snapshots(id,provider_id,source_url,observed_at,payload_sha256,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
      [snapshotId, input.providerId, imported.sourceUrl, observedAt, sha256(payloadText), payloadText]);
    let maximumVersion = 1;
    for (const rate of imported.rates) {
      const versionResult = await transaction.query<Row>("SELECT coalesce(max(version),0)+1 AS next_version FROM fusion_engine.provider_model_rate_versions WHERE reference_model_id=$1 AND rate_key=$2", [rate.referenceModelId, rate.rateKey]);
      const version = Number(versionResult.rows[0]?.next_version ?? 1);
      maximumVersion = Math.max(maximumVersion, version);
      await transaction.query(`INSERT INTO fusion_engine.provider_model_rate_versions
        (reference_model_id,rate_key,version,provider_id,provider_model_id,label,billing_unit,provider_credit_micros,provider_usd_picos,variant,source_url,snapshot_id,effective_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)`,
        [rate.referenceModelId, rate.rateKey, version, rate.providerId, rate.providerModelId, rate.label, rate.billingUnit,
          rate.providerCreditMicros?.toString() ?? null, rate.providerUsdPicos?.toString() ?? null, JSON.stringify(rate.variant), rate.sourceUrl, snapshotId, observedAt]);
      await transaction.query(`INSERT INTO fusion_engine.provider_model_rate_pointers(reference_model_id,rate_key,current_version)
        VALUES($1,$2,$3) ON CONFLICT(reference_model_id,rate_key) DO UPDATE SET current_version=excluded.current_version,updated_at=now()`, [rate.referenceModelId, rate.rateKey, version]);
    }
    const response = {
      providerId: input.providerId, snapshotId, observedAt, importedRateCount: imported.rates.length,
      selectedModelCount: models.length, matchedModelCount: matchedModelIds.size, unmatchedReferenceModelIds,
    };
    await transaction.query("INSERT INTO fusion_engine.provider_pricing_commands(command_id,actor_id,action,request_hash,response) VALUES($1,$2,'SYNC_PROVIDER_RATES',$3,$4::jsonb)", [input.commandId, input.identity.actorId, requestHash, JSON.stringify(response)]);
    await transaction.query("INSERT INTO fusion_engine.provider_pricing_audit(command_id,actor_id,action,resource_id,before_version,after_version,evidence_hash) VALUES($1,$2,'PROVIDER_RATES_SYNCED',$3,NULL,$4,$5)",
      [input.commandId, input.identity.actorId, `provider:${input.providerId}`, maximumVersion, sha256(`${snapshotId}:${sha256(payloadText)}`)]);
    return response;
  });
}

async function configureCustomerPrice(input: { identity: AdminIdentity; commandId: string; body: unknown; config: ProductionGatewayConfig }) {
  requireAdminPermission(input.identity, "DRAFT", "PRICING_POLICY");
  const parsed = ConfigurePriceInput.safeParse(input.body);
  if (!parsed.success) throw new ProductionPricingCommandError("PRICING_COMMAND_INVALID", "Model rate and a positive whole customer-credit price are required.");
  const database = productionDatabase(input.config);
  const requestHash = stableHash({ action: "CONFIGURE_CUSTOMER_PRICE", ...parsed.data });
  const prior = await priorCommand(database, input.commandId, requestHash);
  if (prior) return prior;
  return database.transaction(async (transaction) => {
    const repeated = await transaction.query<Row>("SELECT request_hash,response FROM fusion_engine.provider_pricing_commands WHERE command_id=$1 FOR UPDATE", [input.commandId]);
    if (repeated.rows[0]) {
      if (repeated.rows[0].request_hash !== requestHash) throw new ProductionPricingCommandError("PRICING_COMMAND_CONFLICT", "The idempotency key is already bound to another pricing intent.", 409);
      return storedResponse(repeated.rows[0].response);
    }
    const rate = await transaction.query<Row>(`SELECT pointer.current_version FROM fusion_engine.provider_model_rate_pointers pointer
      WHERE pointer.reference_model_id=$1 AND pointer.rate_key=$2 FOR UPDATE`, [parsed.data.referenceModelId, parsed.data.rateKey]);
    if (!rate.rows[0]) throw new ProductionPricingCommandError("PRICING_RATE_NOT_FOUND", "Import the official provider rate before configuring the customer price.", 409);
    const priorVersion = await transaction.query<Row>("SELECT coalesce(max(version),0) AS current_version FROM fusion_engine.platform_model_price_versions WHERE reference_model_id=$1 AND rate_key=$2", [parsed.data.referenceModelId, parsed.data.rateKey]);
    const beforeVersion = Number(priorVersion.rows[0]?.current_version ?? 0);
    const version = beforeVersion + 1;
    await transaction.query(`INSERT INTO fusion_engine.platform_model_price_versions
      (reference_model_id,rate_key,version,provider_rate_version,customer_credits,configured_by)
      VALUES($1,$2,$3,$4,$5,$6)`, [parsed.data.referenceModelId, parsed.data.rateKey, version, Number(rate.rows[0].current_version), parsed.data.customerCredits, input.identity.actorId]);
    await transaction.query(`INSERT INTO fusion_engine.platform_model_price_pointers(reference_model_id,rate_key,current_version)
      VALUES($1,$2,$3) ON CONFLICT(reference_model_id,rate_key) DO UPDATE SET current_version=excluded.current_version,updated_at=now()`, [parsed.data.referenceModelId, parsed.data.rateKey, version]);
    const releasable = await transaction.query<Row>(`SELECT rate.provider_id,rate.provider_model_id,rate.label,rate.billing_unit,
        rate.provider_credit_micros,rate.provider_usd_picos,rate.variant,rate.version AS provider_rate_version,
        account.id AS provider_account_id,credential.id AS credential_id,credential.version AS credential_version,
        selection.catalog_snapshot_id AS catalog_snapshot_id,reference_model.payload AS reference_model_payload
      FROM fusion_engine.provider_model_rate_versions rate
      JOIN fusion_engine.provider_model_selections selection
        ON selection.reference_model_id=rate.reference_model_id AND selection.state='SELECTED'
      JOIN fusion_engine.provider_control_entities reference_entity
        ON reference_entity.entity_type='REFERENCE_MODEL' AND reference_entity.entity_id=rate.reference_model_id
      JOIN fusion_engine.provider_control_versions reference_model
        ON reference_model.entity_type=reference_entity.entity_type AND reference_model.entity_id=reference_entity.entity_id AND reference_model.version=reference_entity.current_version
      JOIN fusion_engine.provider_accounts account
        ON account.provider_id=rate.provider_id AND account.environment='PRODUCTION' AND account.state='CONNECTED'
      JOIN fusion_engine.provider_credentials credential
        ON credential.id=account.active_credential_id AND credential.status='ACTIVE'
      WHERE rate.reference_model_id=$1 AND rate.rate_key=$2 AND rate.version=$3`,
      [parsed.data.referenceModelId, parsed.data.rateKey, Number(rate.rows[0].current_version)]);
    const release = releasable.rows[0];
    let publishedOfferId: string | null = null;
    const releaseVariant = release ? (typeof release.variant === "string" ? JSON.parse(String(release.variant)) : release.variant) : null;
    const adapterVersion = release ? releasedAdapterVersion(String(release.provider_id), releaseVariant, String(release.provider_model_id)) : null;
    if (release && adapterVersion) {
      const presentation = pinnedReviewedPresentation(release.reference_model_payload, release.catalog_snapshot_id);
      const pinnedVariant = presentation ? { ...(releaseVariant as Record<string, unknown>), presentation } : releaseVariant;
      publishedOfferId = `offer:${parsed.data.referenceModelId}:${parsed.data.rateKey}`;
      const nextOffer = await transaction.query<Row>(
        "SELECT coalesce(max(version),0)+1 AS next_version FROM fusion_engine.production_offer_versions WHERE offer_id=$1",
        [publishedOfferId],
      );
      const offerVersion = Number(nextOffer.rows[0]?.next_version ?? 1);
      const evidence = sha256(JSON.stringify({
        offerId: publishedOfferId, offerVersion, providerRateVersion: Number(release.provider_rate_version),
        customerPriceVersion: version, credentialId: String(release.credential_id), customerCredits: parsed.data.customerCredits,
      }));
      await transaction.query(`INSERT INTO fusion_engine.production_offer_versions
        (offer_id,version,provider_id,provider_account_id,credential_id,credential_version,reference_model_id,
         provider_model_id,rate_key,provider_rate_version,customer_price_version,customer_credits,
         provider_credit_micros,provider_usd_picos,display_name,billing_unit,variant,adapter_version,evidence_sha256,published_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20)`, [
        publishedOfferId, offerVersion, release.provider_id, release.provider_account_id, release.credential_id,
        Number(release.credential_version), parsed.data.referenceModelId, release.provider_model_id, parsed.data.rateKey,
        Number(release.provider_rate_version), version, parsed.data.customerCredits, release.provider_credit_micros,
        release.provider_usd_picos, release.label, release.billing_unit,
        JSON.stringify(pinnedVariant), adapterVersion, evidence, input.identity.actorId,
      ]);
      await transaction.query(`INSERT INTO fusion_engine.production_offer_pointers(offer_id,current_version,state)
        VALUES($1,$2,'ACTIVE') ON CONFLICT(offer_id) DO UPDATE SET current_version=excluded.current_version,state='ACTIVE',updated_at=now()`,
        [publishedOfferId, offerVersion]);
    }
    const response = { ...parsed.data, version, status: "CONFIGURED" as const, publishedOfferId };
    await transaction.query("INSERT INTO fusion_engine.provider_pricing_commands(command_id,actor_id,action,request_hash,response) VALUES($1,$2,'CONFIGURE_CUSTOMER_PRICE',$3,$4::jsonb)", [input.commandId, input.identity.actorId, requestHash, JSON.stringify(response)]);
    await transaction.query("INSERT INTO fusion_engine.provider_pricing_audit(command_id,actor_id,action,resource_id,before_version,after_version,evidence_hash) VALUES($1,$2,'CUSTOMER_PRICE_CONFIGURED',$3,$4,$5,$6)",
      [input.commandId, input.identity.actorId, `${parsed.data.referenceModelId}:${parsed.data.rateKey}`, beforeVersion || null, version, sha256(JSON.stringify(response))]);
    return response;
  });
}

export async function executeProductionPricingCommand(input: { path: string; body: unknown; commandId: string | undefined; identity: AdminIdentity; config: ProductionGatewayConfig; request?: typeof fetch }) {
  if (!input.commandId || input.commandId.length < 8 || input.commandId.length > 200) throw new ProductionPricingCommandError("PRICING_COMMAND_INVALID", "A valid idempotency key is required.");
  const sync = input.path.match(/^\/v1\/admin\/pricing\/providers\/(kie|openrouter)\/sync$/);
  if (sync) return { status: 200, body: await syncProviderRates({ identity: input.identity, providerId: sync[1] as "kie" | "openrouter", commandId: input.commandId, config: input.config, request: input.request ?? fetch }) };
  if (input.path === "/v1/admin/pricing/customer-price") return { status: 200, body: await configureCustomerPrice({ identity: input.identity, commandId: input.commandId, body: input.body, config: input.config }) };
  throw new ProductionPricingCommandError("PRICING_COMMAND_INVALID", "Admin pricing command route was not found.", 404);
}
