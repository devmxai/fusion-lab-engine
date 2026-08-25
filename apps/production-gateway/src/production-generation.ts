import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PostgresAtomicGenerationRepository, PostgresAtomicError, type RouteExecutionEvidence } from "../../../packages/durable-execution/src/postgres-atomic.js";
import { PostgresWorkerCoordinator } from "../../../packages/durable-execution/src/postgres-worker.js";
import { DurableProviderAttemptWorker } from "../../engine-api/src/durable-worker/provider-attempt-worker.js";
import { ProviderRegistry } from "../../../packages/providers/src/registry.js";
import { KieMarketAdapter } from "../../../packages/providers/src/kie-market-adapter.js";
import { OpenRouterVideoAdapter } from "../../../packages/providers/src/openrouter-video-adapter.js";
import { OpenRouterDurableImageAdapter } from "../../../packages/providers/src/openrouter-durable-image-adapter.js";
import { ProviderDefinitiveError, type ProviderAdapter } from "../../../packages/providers/src/types.js";
import { parseKieWebhook } from "../../../packages/providers/src/kie-webhook.js";
import { PostgresProviderWebhookInbox, ProviderWebhookInboxError } from "../../../packages/durable-execution/src/postgres-provider-webhook-inbox.js";
import { ProviderGenerationRequestSchema, type ProviderGenerationRequest } from "../../../packages/contracts/src/provider.js";
import { validateMediaBytes, LocalSignatureScanner } from "../../../packages/media-pipeline/src/validator.js";
import { defaultLocalMediaPolicy, MediaPipelineError } from "../../../packages/media-pipeline/src/types.js";
import type { ProductionGatewayConfig } from "./config.js";
import { productionDatabase } from "./database-readiness.js";

type Row = Record<string, unknown>;
type OfferRow = {
  offer_id: string; version: string | number; provider_id: string; provider_account_id: string;
  credential_id: string; credential_version: string | number; reference_model_id: string; provider_model_id: string;
  rate_key: string; provider_rate_version: string | number; customer_price_version: string | number;
  customer_credits: string | number; provider_credit_micros: string | number | null; provider_usd_picos: string | number | null;
  display_name: string; billing_unit: string; variant: Record<string, unknown> | string; adapter_version: string;
  evidence_sha256: string; published_at: string | Date;
};

export type ProductionGenerationResponse = Readonly<{
  status: number;
  body?: Record<string, unknown> | unknown[];
  bytes?: Uint8Array;
  contentType?: string;
}>;

export class ProductionGenerationError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}

const OperationInput = z.object({
  quoteId: z.string().uuid(), requestHash: z.string().regex(/^[a-f0-9]{64}$/), generationIntentId: z.string().min(8).max(200),
}).strict();
const GrantInput = z.object({ ttlSeconds: z.number().int().min(30).max(900).optional() }).strict();
const InputAssetIntent = z.object({
  projectId: z.string().trim().min(1).max(200),
  filename: z.string().trim().min(1).max(160),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  byteLength: z.number().int().positive().max(10 * 1024 * 1024),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const InputAssetFinalize = z.object({ checksumSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const ProjectActionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("RENAME"), title: z.string().trim().min(1).max(120), expectedVersion: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("DUPLICATE"), title: z.string().trim().min(1).max(120).optional(), expectedVersion: z.number().int().positive() }).strict(),
  z.object({ action: z.enum(["ARCHIVE", "RESTORE", "DELETE"]), expectedVersion: z.number().int().positive() }).strict(),
]);
const sha = (value: unknown) => createHash("sha256").update(value instanceof Uint8Array ? value : typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const json = (value: unknown) => typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value as Record<string, unknown>;
const iso = (value: string | Date) => new Date(value).toISOString();

function isCertifiedImage(bytes: Uint8Array, contentType: string): boolean {
  const prefix = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (contentType === "image/png") return bytes.byteLength >= 8 && prefix(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (contentType === "image/jpeg") return bytes.byteLength >= 3 && prefix(0xff, 0xd8, 0xff);
  if (contentType === "image/webp") return bytes.byteLength >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

function projectIdentity(ownerId: string, idempotencyKey: string): string {
  const digest = sha(`fusionlab-project:${ownerId}:${idempotencyKey}`);
  return `project-${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

function emptyProjectDocument(projectId: string, title: string, now = new Date()) {
  const timestamp = now.toISOString();
  return {
    schemaVersion: 1,
    projectId,
    title,
    lifecycle: { state: "ACTIVE", changedAt: timestamp },
    assets: {},
    operations: {},
    bindings: {},
    canvasItems: {},
    viewport: { x: 0, y: 0, zoom: 1 },
    activity: [{ id: randomUUID(), type: "PROJECT_CREATED", summary: "تم إنشاء مساحة المشروع", occurredAt: timestamp }],
    updatedAt: timestamp,
  };
}

function lifecycleState(document: Record<string, unknown>): "ACTIVE" | "ARCHIVED" | "DELETED" {
  const lifecycle = document.lifecycle && typeof document.lifecycle === "object" && !Array.isArray(document.lifecycle)
    ? document.lifecycle as Record<string, unknown> : null;
  return lifecycle?.state === "ARCHIVED" || lifecycle?.state === "DELETED" ? lifecycle.state : "ACTIVE";
}

function appendProjectActivity(document: Record<string, unknown>, type: string, summary: string, timestamp: string) {
  const activity = Array.isArray(document.activity) ? document.activity.slice(-499) : [];
  return [...activity, { id: randomUUID(), type, summary, occurredAt: timestamp }];
}

function projectPayload(row: Row) {
  return {
    projectId: row.project_id,
    document: json(row.document),
    version: Number(row.version),
    createdAt: iso(row.created_at as string | Date),
    updatedAt: iso(row.updated_at as string | Date),
  };
}

function dimensions(offer: OfferRow): Record<string, unknown> {
  const variant = json(offer.variant);
  return variant.dimensions && typeof variant.dimensions === "object" ? variant.dimensions as Record<string, unknown> : {};
}

type CustomerOfferPresentation = Readonly<{
  schemaVersion: 1;
  productFamily: Readonly<{ id: string; displayName: string }>;
  version?: Readonly<{ id: string; displayName: string }>;
  edition?: Readonly<{ id: string; displayName: string }>;
  experienceCategories: readonly ("IMAGE" | "VIDEO" | "AVATAR" | "AUDIO")[];
}>;

const presentationRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const presentationText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 120;

/** Returns only the presentation already pinned into this immutable offer. */
export function customerOfferPresentation(offer: Pick<OfferRow, "variant">): CustomerOfferPresentation | null {
  const variant = json(offer.variant);
  const value = variant.presentation;
  if (!presentationRecord(value) || value.schemaVersion !== 1 || !presentationRecord(value.productFamily) || !presentationText(value.productFamily.id) || !presentationText(value.productFamily.displayName) || !Array.isArray(value.experienceCategories)) return null;
  const categories = [...new Set(value.experienceCategories.map(String))];
  if (!categories.length || categories.some((category) => !["IMAGE", "VIDEO", "AVATAR", "AUDIO"].includes(category))) return null;
  const part = (candidate: unknown) => {
    if (candidate === undefined) return undefined;
    if (!presentationRecord(candidate) || !presentationText(candidate.id) || !presentationText(candidate.displayName)) return null;
    return { id: candidate.id.trim(), displayName: candidate.displayName.trim() };
  };
  const version = part(value.version);
  const edition = part(value.edition);
  if (version === null || edition === null) return null;
  return {
    schemaVersion: 1,
    productFamily: { id: value.productFamily.id.trim(), displayName: value.productFamily.displayName.trim() },
    ...(version ? { version } : {}),
    ...(edition ? { edition } : {}),
    experienceCategories: categories as CustomerOfferPresentation["experienceCategories"],
  };
}

function generationType(offer: OfferRow): string {
  return String(dimensions(offer).generationType ?? offer.provider_model_id.match(/(?:text|image)-to-image/i)?.[0] ?? "").toLowerCase();
}

export function sourceAssetIdFromQuoteInput(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const direct = input.input && typeof input.input === "object" && !Array.isArray(input.input)
    ? (input.input as Record<string, unknown>).assetId : null;
  if (typeof direct === "string" && z.string().uuid().safeParse(direct).success) return direct;
  if (Array.isArray(input.bindings)) {
    const source = input.bindings.find((binding) => {
      if (!binding || typeof binding !== "object" || Array.isArray(binding)) return false;
      const candidate = binding as Record<string, unknown>;
      // `slot` is the current client contract. `role` is accepted for older
      // persisted drafts and API callers during the migration window.
      const bindingRole = candidate.slot ?? candidate.role;
      return ["SOURCE", "FIRST_FRAME"].includes(String(bindingRole))
        && String(candidate.kind ?? "IMAGE") === "IMAGE";
    });
    const assetId = source && typeof source === "object" ? (source as Record<string, unknown>).assetId : null;
    if (typeof assetId === "string" && z.string().uuid().safeParse(assetId).success) return assetId;
  }
  return null;
}

/**
 * Resolve the browser's configuration against one immutable published SKU.
 * This is deliberately stricter than a UI validation: a tampered or stale
 * browser request must never be silently downgraded to another resolution,
 * duration, quality tier or audio state under the same price.  A caller must
 * explicitly select a currently published configuration and request a new
 * quote when that configuration changes.
 */
export function resolveCertifiedPublishedSettings(input: Readonly<{
  dimensions: Readonly<Record<string, unknown>>;
  providerId: string;
  providerModelId: string;
  video: boolean;
  imageToVideo: boolean;
  settings: Readonly<Record<string, unknown>>;
}>): Readonly<{
  aspectRatio?: string;
  resolution: "720p" | "1080p" | "1K" | "2K" | "4K";
  durationSeconds?: number;
  quality?: string;
  audio: boolean;
}> {
  const knownSettingKeys = new Set(["aspectRatio", "resolution", "durationSeconds", "quality", "audio"]);
  for (const key of Object.keys(input.settings)) {
    if (!knownSettingKeys.has(key)) {
      throw new ProductionGenerationError("PUBLISHED_OFFER_INCOMPATIBLE", 409, `The published offer does not certify the '${key}' setting.`);
    }
  }

  const documentedAspectRatios = Array.isArray(input.dimensions.supportedAspectRatios)
    ? input.dimensions.supportedAspectRatios.filter((value): value is string => typeof value === "string")
    : [];
  const supportedAspectRatios = documentedAspectRatios.length
    ? documentedAspectRatios
    : input.providerId === "kie" && input.providerModelId.startsWith("gpt-image-2")
      ? ["auto"]
      : [];
  const requestedAspectRatio = typeof input.settings.aspectRatio === "string"
    ? input.settings.aspectRatio
    : undefined;
  if (requestedAspectRatio !== undefined && (typeof requestedAspectRatio !== "string" || !supportedAspectRatios.includes(requestedAspectRatio))) {
    throw new ProductionGenerationError("PUBLISHED_OFFER_INCOMPATIBLE", 409, "The selected aspect ratio is not certified for this published offer.");
  }

  const listedResolutions = Array.isArray(input.dimensions.supportedResolutions)
    ? input.dimensions.supportedResolutions.filter((value): value is string => typeof value === "string")
    : [];
  // An explicit `resolution` is an immutable rate dimension and takes
  // precedence over a model-wide capability list. Only a rate explicitly
  // certified for every listed resolution may omit this exact dimension.
  const certifiedResolutions = typeof input.dimensions.resolution === "string"
    ? [input.dimensions.resolution]
    : listedResolutions;
  const fallbackResolution = certifiedResolutions[0] ?? (input.video || input.imageToVideo ? "720p" : "1K");
  const requestedResolution = input.settings.resolution;
  if (requestedResolution !== undefined && (typeof requestedResolution !== "string" || !certifiedResolutions.includes(requestedResolution))) {
    throw new ProductionGenerationError("PUBLISHED_OFFER_INCOMPATIBLE", 409, "The selected resolution is not certified for this published offer.");
  }

  const isVideo = input.video || input.imageToVideo;
  const exactDuration = Number(input.dimensions.durationSeconds);
  if (input.settings.durationSeconds !== undefined) {
    if (!isVideo || !Number.isSafeInteger(input.settings.durationSeconds) || input.settings.durationSeconds !== exactDuration) {
      throw new ProductionGenerationError("PUBLISHED_OFFER_INCOMPATIBLE", 409, "The selected duration is not certified for this published offer.");
    }
  }
  if (isVideo && !Number.isSafeInteger(exactDuration)) {
    throw new ProductionGenerationError("PUBLISHED_OFFER_INCOMPATIBLE", 409, "This published video offer has no certified duration.");
  }

  const certifiedQuality = typeof input.dimensions.quality === "string" ? input.dimensions.quality : undefined;
  if (input.settings.quality !== undefined && (typeof input.settings.quality !== "string" || input.settings.quality !== certifiedQuality)) {
    throw new ProductionGenerationError("PUBLISHED_OFFER_INCOMPATIBLE", 409, "The selected quality is not certified for this published offer.");
  }

  const certifiedAudio = typeof input.dimensions.audio === "boolean" ? input.dimensions.audio : false;
  if (input.settings.audio !== undefined && (typeof input.settings.audio !== "boolean" || input.settings.audio !== certifiedAudio)) {
    throw new ProductionGenerationError("PUBLISHED_OFFER_INCOMPATIBLE", 409, "The selected audio setting is not certified for this published offer.");
  }

  return {
    ...(requestedAspectRatio !== undefined ? { aspectRatio: requestedAspectRatio } : supportedAspectRatios[0] ? { aspectRatio: supportedAspectRatios[0] } : {}),
    resolution: fallbackResolution as "720p" | "1080p" | "1K" | "2K" | "4K",
    ...(isVideo ? { durationSeconds: exactDuration } : {}),
    ...(certifiedQuality ? { quality: certifiedQuality } : {}),
    audio: certifiedAudio,
  };
}

function customerOffer(offer: OfferRow) {
  const dims = dimensions(offer);
  const type = generationType(offer);
  const imageToVideo = type === "image-to-video";
  const video = type === "text-to-video" || imageToVideo;
  const supportedResolutions = Array.isArray(dims.supportedResolutions) ? dims.supportedResolutions.map(String) : [];
  const resolution = typeof dims.resolution === "string" ? dims.resolution : supportedResolutions[0] ?? (video && !imageToVideo ? "720p" : "1K");
  const imageToVideoResolutions = supportedResolutions.length ? supportedResolutions : imageToVideo && typeof dims.resolution === "string" ? [dims.resolution] : [];
  const durationSeconds = video && Number.isSafeInteger(dims.durationSeconds) ? Number(dims.durationSeconds) : null;
  // Never invent visual controls.  A catalog may only expose aspect ratios
  // explicitly certified by the provider.  KIE's GPT Image 2 documentation
  // publishes `aspect_ratio: "auto"`, so that is the only safe default until
  // KIE publishes a finite manual ratio list for this model.
  const documentedAspectRatios = Array.isArray(dims.supportedAspectRatios)
    ? dims.supportedAspectRatios.map(String)
    : [];
  const aspectRatios = documentedAspectRatios.length
    ? documentedAspectRatios
    : offer.provider_id === "kie" && offer.provider_model_id.startsWith("gpt-image-2")
      ? ["auto"]
      : [];
  const textToImage = type === "text-to-image";
  const recipeId = imageToVideo ? "video.image-to-video" : video ? "video.text-to-video" : textToImage ? "image.create" : "image.edit";
  const modelName = offer.provider_model_id.startsWith("gpt-image-2")
    ? "GPT Image 2"
    : offer.display_name.split(" - ")[0]?.trim() || offer.display_name;
  const presentation = customerOfferPresentation(offer);
  return {
    offerId: offer.offer_id,
    displayName: imageToVideo && durationSeconds !== null ? `${modelName} · ${durationSeconds}s` : `${modelName} · ${resolution}`,
    modelFamilyId: offer.reference_model_id,
    providerId: offer.provider_id,
    providerModelId: offer.provider_model_id,
    ...(presentation ? { presentation } : {}),
    modalities: [video ? "video" : "image"],
    capability: {
      id: `capability:${offer.offer_id}`, version: Number(offer.version), mediaType: video ? "video" : "image",
      inputModes: imageToVideo ? ["text", "image"] : textToImage || video ? ["text"] : ["text", "image"],
      semanticSlots: imageToVideo ? ["FIRST_FRAME"] : textToImage || video ? [] : ["SOURCE"], maxReferences: imageToVideo || (!textToImage && !video) ? 1 : 0,
      resolutions: imageToVideo ? imageToVideoResolutions : supportedResolutions.length ? supportedResolutions : [resolution], durationSeconds: durationSeconds === null ? null : { min: durationSeconds, max: durationSeconds }, characterCount: null,
      supportsAudio: video && typeof dims.audio === "boolean", outputHasAudio: video && dims.audio === true,
      controlSchema: { version: `offer-${offer.version}`, recipes: [{
        recipeId, prompt: { required: true, maxLength: 1200, visible: true },
        bindings: imageToVideo ? { min: 1, max: 1, roles: ["FIRST_FRAME"], slots: [{ role: "FIRST_FRAME", kind: "IMAGE", required: true }] }
          : textToImage || video ? { min: 0, max: 0, roles: [], slots: [] } : {
          min: 1, max: 1, roles: ["SOURCE"], slots: [{ role: "SOURCE", kind: "IMAGE", required: true }],
        },
        controls: video ? [
          { id: "durationSeconds", kind: "enum", defaultValue: durationSeconds!, values: [durationSeconds!], ui: { labelKey: "Duration", group: "BASIC", order: 10 } },
          // A fixed provider tier is still meaningful to the customer, but
          // it is not editable unless the verified catalog exposes another
          // SKU for it.  Do not invent resolution/aspect controls for this
          // Kling route: its public contract only prices duration and tier.
          ...(imageToVideo && typeof dims.quality === "string" ? [
            { id: "quality", kind: "enum" as const, defaultValue: dims.quality, values: [dims.quality], ui: { labelKey: "Quality", group: "BASIC" as const, order: 20 } },
          ] : []),
          ...(imageToVideo && imageToVideoResolutions.length ? [
            // Each imported rate is one immutable commercial SKU.  The
            // family UI unions these fixed values, then resolves a customer
            // selection to the matching SKU.  Publishing every supported
            // resolution on each SKU would let a 4K selection keep a 720p
            // price, which is neither financially nor operationally valid.
            { id: "resolution", kind: "enum" as const, defaultValue: resolution, values: [resolution], ui: { labelKey: "Resolution", group: "BASIC" as const, order: 30 } },
          ] : []),
          ...(imageToVideo ? [
            ...(aspectRatios.length ? [{ id: "aspectRatio", kind: "enum" as const, defaultValue: aspectRatios[0]!, values: aspectRatios, ui: { labelKey: "Aspect ratio", group: "BASIC" as const, order: 40 } }] : []),
            ...(typeof dims.audio === "boolean" ? [{ id: "audio", kind: "enum" as const, defaultValue: dims.audio, values: [dims.audio], ui: { labelKey: "Sound", group: "BASIC" as const, order: 50 } }] : []),
          ] : [
            { id: "resolution", kind: "enum" as const, defaultValue: resolution, values: [resolution], ui: { labelKey: "Resolution", group: "BASIC" as const, order: 20 } },
            ...(aspectRatios.length ? [{ id: "aspectRatio", kind: "enum" as const, defaultValue: aspectRatios[0]!, values: aspectRatios, ui: { labelKey: "Aspect ratio", group: "BASIC" as const, order: 30 } }] : []),
            { id: "audio", kind: "enum" as const, defaultValue: dims.audio === true, values: [dims.audio === true], ui: { labelKey: "Audio", group: "ADVANCED" as const, order: 40 } },
          ]),
        ] : [
          { id: "resolution", kind: "enum", defaultValue: resolution, values: supportedResolutions.length ? supportedResolutions : [resolution], ui: { labelKey: "Resolution", group: "BASIC", order: 10 } },
          ...(aspectRatios.length ? [{ id: "aspectRatio", kind: "enum" as const, defaultValue: aspectRatios[0]!, values: aspectRatios, ui: { labelKey: "Aspect ratio", group: "BASIC" as const, order: 20 } }] : []),
        ],
      }] },
    },
    customerPriceVersionId: `price:${offer.reference_model_id}:${offer.rate_key}:v${offer.customer_price_version}`,
    commercialRecipeVersionId: `recipe:${recipeId}:v1`,
    releaseBundleId: offer.offer_id,
    releaseBundleVersion: Number(offer.version),
  };
}

export class ProductionGenerationService {
  private readonly database: ReturnType<typeof productionDatabase>;
  private readonly atomic: PostgresAtomicGenerationRepository;
  private readonly coordinator: PostgresWorkerCoordinator;
  private readonly worker: DurableProviderAttemptWorker;
  private readonly scanner = new LocalSignatureScanner();

  constructor(private readonly config: ProductionGatewayConfig, private readonly request: typeof fetch = fetch) {
    this.database = productionDatabase(config);
    this.atomic = new PostgresAtomicGenerationRepository(this.database);
    this.coordinator = new PostgresWorkerCoordinator(this.database);
    this.worker = new DurableProviderAttemptWorker(this.coordinator, new ProviderRegistry(), 3, randomUUID, {
      withAdapter: (input, work) => this.withOperationAdapter(input.operationId, input.providerId, work),
    });
  }

  async offers(): Promise<ProductionGenerationResponse> {
    const rows = await this.activeOffers();
    // Every customer-visible offer must have both an approved provider
    // adapter and its matching private input path. GPT Image 2 I2I is
    // released only after its `input_urls` adapter was certified; other
    // image editing models remain hidden until their own contracts are added.
    return { status: 200, body: rows.filter((offer) =>
      (offer.adapter_version === "kie-market.v1" && generationType(offer) === "text-to-image")
      || (offer.adapter_version === "kie-market.image-to-image.gpt-image-2.v1" && generationType(offer) === "image-to-image")
      || (offer.adapter_version === "openrouter-image.v1" && generationType(offer) === "text-to-image")
      || (offer.adapter_version === "openrouter-video.v1" && generationType(offer) === "text-to-video")
      || (offer.adapter_version === "kie-market.image-to-video.v1" && generationType(offer) === "image-to-video")
      || (offer.adapter_version === "kie-market.image-to-video.v3" && generationType(offer) === "image-to-video")
      || (offer.adapter_version === "kie-market.kling-3.v1" && generationType(offer) === "image-to-video")
    ).map(customerOffer) };
  }

  async projects(ownerId: string): Promise<ProductionGenerationResponse> {
    const result = await this.database.query<Row>(`SELECT project_id,document,version,created_at,updated_at
      FROM fusion_engine.creative_projects WHERE owner_id=$1 ORDER BY updated_at DESC, project_id ASC LIMIT 100`, [ownerId]);
    const items = result.rows.map((row) => {
      const document = json(row.document);
      const assets = document.assets && typeof document.assets === "object" && !Array.isArray(document.assets)
        ? Object.keys(document.assets as Record<string, unknown>).length : 0;
      const operations = document.operations && typeof document.operations === "object" && !Array.isArray(document.operations)
        ? Object.keys(document.operations as Record<string, unknown>).length : 0;
      return {
        projectId: String(row.project_id),
        title: typeof document.title === "string" && document.title.trim() ? document.title.trim() : "مشروع بدون عنوان",
        lifecycleState: lifecycleState(document),
        assetCount: assets,
        operationCount: operations,
        version: Number(row.version),
        createdAt: iso(row.created_at as string | Date),
        updatedAt: iso(row.updated_at as string | Date),
      };
    });
    return { status: 200, body: { items, nextCursor: null } };
  }

  async createProject(ownerId: string, raw: unknown, idempotencyKey?: string): Promise<ProductionGenerationResponse> {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new ProductionGenerationError("IDEMPOTENCY_KEY_REQUIRED", 400, "A valid Idempotency-Key is required.");
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ProductionGenerationError("INVALID_PROJECT", 400, "Project creation request is invalid.");
    }
    const title = typeof (raw as { title?: unknown }).title === "string"
      ? (raw as { title: string }).title.trim().replace(/\s+/g, " ") : "";
    if (!title || title.length > 120) {
      throw new ProductionGenerationError("INVALID_PROJECT_TITLE", 400, "Project title must contain between 1 and 120 characters.");
    }
    const projectId = projectIdentity(ownerId, idempotencyKey);
    const document = emptyProjectDocument(projectId, title);
    const result = await this.database.transaction(async (transaction) => {
      const inserted = await transaction.query<Row>(`INSERT INTO fusion_engine.creative_projects(project_id,owner_id,document)
        VALUES($1,$2,$3::jsonb) ON CONFLICT (project_id) DO NOTHING
        RETURNING project_id,document,version,created_at,updated_at`, [projectId, ownerId, JSON.stringify(document)]);
      if (inserted.rows[0]) return inserted;
      return transaction.query<Row>(`SELECT project_id,document,version,created_at,updated_at
        FROM fusion_engine.creative_projects WHERE project_id=$1 AND owner_id=$2`, [projectId, ownerId]);
    });
    const row = result.rows[0];
    if (!row) throw new ProductionGenerationError("PROJECT_IDEMPOTENCY_CONFLICT", 409, "Project creation identity is already in use.");
    return { status: 200, body: { projectId: row.project_id, document: json(row.document), version: Number(row.version), createdAt: iso(row.created_at as string | Date), updatedAt: iso(row.updated_at as string | Date) } };
  }

  async projectAction(ownerId: string, projectId: string, raw: unknown, idempotencyKey?: string): Promise<ProductionGenerationResponse> {
    if (!projectId.trim() || projectId.length > 200 || !idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new ProductionGenerationError("INVALID_PROJECT_COMMAND", 400, "Project identity and Idempotency-Key are required.");
    }
    const parsed = ProjectActionInput.safeParse(raw);
    if (!parsed.success) throw new ProductionGenerationError("INVALID_PROJECT_COMMAND", 400, "Project lifecycle command is invalid.");
    const command = parsed.data;
    const timestamp = new Date().toISOString();

    if (command.action === "DUPLICATE") {
      const duplicateId = projectIdentity(ownerId, `duplicate:${projectId}:${idempotencyKey}`);
      const duplicated = await this.database.transaction(async (transaction) => {
        const replay = await transaction.query<Row>(`SELECT project_id,document,version,created_at,updated_at
          FROM fusion_engine.creative_projects WHERE project_id=$1 AND owner_id=$2`, [duplicateId, ownerId]);
        if (replay.rows[0]) return replay;
        const sourceResult = await transaction.query<Row>(`SELECT project_id,document,version FROM fusion_engine.creative_projects
          WHERE project_id=$1 AND owner_id=$2 FOR UPDATE`, [projectId, ownerId]);
        const source = sourceResult.rows[0];
        if (!source) throw new ProductionGenerationError("PROJECT_NOT_FOUND", 404, "Project was not found.");
        const sourceDocument = json(source.document);
        if (lifecycleState(sourceDocument) === "DELETED") throw new ProductionGenerationError("PROJECT_DELETED", 409, "Restore the project before duplicating it.");
        if (Number(source.version) !== command.expectedVersion) throw new ProductionGenerationError("PROJECT_VERSION_CONFLICT", 409, "Project changed before the command was applied.");
        const sourceTitle = typeof sourceDocument.title === "string" && sourceDocument.title.trim() ? sourceDocument.title.trim() : "مشروع";
        const document = emptyProjectDocument(duplicateId, command.title?.trim() || `${sourceTitle} — نسخة`, new Date(timestamp));
        const duplicateDocument = {
          ...document,
          duplicatedFromProjectId: projectId,
          activity: [
            ...document.activity,
            { id: randomUUID(), type: "PROJECT_DUPLICATED", summary: `تم إنشاء نسخة مستقلة من ${sourceTitle}`, occurredAt: timestamp },
          ],
        };
        return transaction.query<Row>(`INSERT INTO fusion_engine.creative_projects(project_id,owner_id,document)
          VALUES($1,$2,$3::jsonb) RETURNING project_id,document,version,created_at,updated_at`, [duplicateId, ownerId, JSON.stringify(duplicateDocument)]);
      });
      return { status: 200, body: projectPayload(duplicated.rows[0]!) };
    }

    const result = await this.database.transaction(async (transaction) => {
      const current = await transaction.query<Row>(`SELECT project_id,owner_id,document,version,created_at,updated_at
        FROM fusion_engine.creative_projects WHERE project_id=$1 AND owner_id=$2 FOR UPDATE`, [projectId, ownerId]);
      const row = current.rows[0];
      if (!row) throw new ProductionGenerationError("PROJECT_NOT_FOUND", 404, "Project was not found.");
      const document = json(row.document);
      const state = lifecycleState(document);
      const title = typeof document.title === "string" ? document.title : "مشروع";
      const alreadyApplied = (command.action === "RENAME" && state !== "DELETED" && title === command.title.trim())
        || (command.action === "ARCHIVE" && state === "ARCHIVED")
        || (command.action === "DELETE" && state === "DELETED")
        || (command.action === "RESTORE" && state === "ACTIVE");
      if (alreadyApplied) return current;
      if (Number(row.version) !== command.expectedVersion) throw new ProductionGenerationError("PROJECT_VERSION_CONFLICT", 409, "Project changed before the command was applied.");
      if (state === "DELETED" && command.action !== "RESTORE") throw new ProductionGenerationError("PROJECT_DELETED", 409, "Restore the project before changing it.");
      const nextState = command.action === "ARCHIVE" ? "ARCHIVED" : command.action === "DELETE" ? "DELETED" : "ACTIVE";
      const summaries = {
        RENAME: `تم تغيير اسم المشروع إلى ${command.action === "RENAME" ? command.title.trim() : title}`,
        ARCHIVE: "تمت أرشفة المشروع",
        RESTORE: "تمت استعادة المشروع",
        DELETE: "تم نقل المشروع إلى المحذوفات",
      } as const;
      const activityTypes = { RENAME: "PROJECT_RENAMED", ARCHIVE: "PROJECT_ARCHIVED", RESTORE: "PROJECT_RESTORED", DELETE: "PROJECT_DELETED" } as const;
      const nextDocument = {
        ...document,
        ...(command.action === "RENAME" ? { title: command.title.trim() } : {}),
        lifecycle: { state: nextState, changedAt: timestamp },
        activity: appendProjectActivity(document, activityTypes[command.action], summaries[command.action], timestamp),
        updatedAt: timestamp,
      };
      return transaction.query<Row>(`UPDATE fusion_engine.creative_projects SET document=$3::jsonb,version=version+1,updated_at=now()
        WHERE project_id=$1 AND owner_id=$2 AND version=$4 RETURNING project_id,document,version,created_at,updated_at`,
      [projectId, ownerId, JSON.stringify(nextDocument), Number(row.version)]);
    });
    const row = result.rows[0];
    if (!row) throw new ProductionGenerationError("PROJECT_VERSION_CONFLICT", 409, "Project changed before the command was applied.");
    return { status: 200, body: projectPayload(row) };
  }

  async project(ownerId: string, projectId: string): Promise<ProductionGenerationResponse> {
    if (!projectId.trim() || projectId.length > 200) throw new ProductionGenerationError("INVALID_PROJECT_ID", 400, "Project identity is invalid.");
    const result = await this.database.query<Row>("SELECT project_id,document,version,created_at,updated_at FROM fusion_engine.creative_projects WHERE project_id=$1 AND owner_id=$2", [projectId, ownerId]);
    const row = result.rows[0];
    if (!row) throw new ProductionGenerationError("PROJECT_NOT_FOUND", 404, "Project was not found.");
    return { status: 200, body: projectPayload(row) };
  }

  async saveProject(ownerId: string, projectId: string, raw: unknown): Promise<ProductionGenerationResponse> {
    if (!projectId.trim() || projectId.length > 200 || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProductionGenerationError("INVALID_PROJECT", 400, "Project save request is invalid.");
    const body = raw as { document?: unknown; expectedVersion?: unknown };
    if (!body.document || typeof body.document !== "object" || Array.isArray(body.document) || JSON.stringify(body.document).length > 2_000_000
      || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) throw new ProductionGenerationError("INVALID_PROJECT", 400, "Project document or revision is invalid.");
    const result = await this.database.transaction(async (transaction) => {
      const current = await transaction.query<Row>("SELECT owner_id,version,document FROM fusion_engine.creative_projects WHERE project_id=$1 FOR UPDATE", [projectId]);
      if (!current.rows[0]) {
        if (Number(body.expectedVersion) !== 0) throw new ProductionGenerationError("PROJECT_VERSION_CONFLICT", 409, "Project changed in another session.");
        return transaction.query<Row>(`INSERT INTO fusion_engine.creative_projects(project_id,owner_id,document) VALUES($1,$2,$3::jsonb)
          RETURNING project_id,document,version,created_at,updated_at`, [projectId, ownerId, JSON.stringify(body.document)]);
      }
      if (current.rows[0].owner_id !== ownerId) throw new ProductionGenerationError("PROJECT_NOT_FOUND", 404, "Project was not found.");
      if (lifecycleState(json(current.rows[0].document)) !== "ACTIVE") throw new ProductionGenerationError("PROJECT_NOT_ACTIVE", 409, "Restore the project before editing it.");
      if (Number(current.rows[0].version) !== Number(body.expectedVersion)) throw new ProductionGenerationError("PROJECT_VERSION_CONFLICT", 409, "Project changed in another session.");
      return transaction.query<Row>(`UPDATE fusion_engine.creative_projects SET document=$3::jsonb,version=version+1,updated_at=now()
        WHERE project_id=$1 AND owner_id=$2 AND version=$4 RETURNING project_id,document,version,created_at,updated_at`,
        [projectId, ownerId, JSON.stringify(body.document), Number(body.expectedVersion)]);
    });
    const row = result.rows[0];
    if (!row) throw new ProductionGenerationError("PROJECT_VERSION_CONFLICT", 409, "Project changed in another session.");
    return { status: 200, body: { projectId: row.project_id, document: json(row.document), version: Number(row.version), createdAt: iso(row.created_at as string | Date), updatedAt: iso(row.updated_at as string | Date) } };
  }

  async createQuote(ownerId: string, raw: unknown): Promise<ProductionGenerationResponse> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProductionGenerationError("INVALID_QUOTE", 400, "Quote request is invalid.");
    const input = raw as Record<string, unknown>;
    const offerId = typeof input.offerId === "string" ? input.offerId : "";
    const projectId = typeof input.projectId === "string" ? input.projectId.trim() : "";
    const recipeId = typeof input.recipeId === "string" ? input.recipeId : "";
    const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
    if (!offerId || !projectId || projectId.length > 200 || !prompt || prompt.length > 1200) {
      throw new ProductionGenerationError("INVALID_QUOTE", 400, "Offer, project and prompt are required.");
    }
    const project = await this.database.query<Row>("SELECT document FROM fusion_engine.creative_projects WHERE project_id=$1 AND owner_id=$2", [projectId, ownerId]);
    if (!project.rows[0]) throw new ProductionGenerationError("PROJECT_NOT_FOUND", 404, "Project was not found.");
    if (lifecycleState(json(project.rows[0].document)) !== "ACTIVE") throw new ProductionGenerationError("PROJECT_NOT_ACTIVE", 409, "Restore the project before starting a generation.");
    const offer = await this.offer(offerId);
    const type = offer ? generationType(offer) : "";
    const image = ["kie-market.v1", "openrouter-image.v1"].includes(String(offer?.adapter_version)) && type === "text-to-image" && recipeId === "image.create";
    const imageToImage = offer?.adapter_version === "kie-market.image-to-image.gpt-image-2.v1" && type === "image-to-image" && recipeId === "image.edit";
    const video = offer?.adapter_version === "openrouter-video.v1" && type === "text-to-video" && recipeId === "video.text-to-video";
    const imageToVideo = ["kie-market.image-to-video.v1", "kie-market.image-to-video.v3", "kie-market.kling-3.v1"].includes(String(offer?.adapter_version)) && type === "image-to-video" && recipeId === "video.image-to-video";
    const sourceAssetId = imageToVideo || imageToImage ? sourceAssetIdFromQuoteInput(input) : null;
    if (!offer || (!image && !imageToImage && !video && !imageToVideo)) {
      throw new ProductionGenerationError("OFFER_NOT_ACTIVE", 409, "The selected model configuration is not active for this recipe.");
    }
    // Fail before a quote or customer hold can exist if the private ingress
    // signer was not configured in Production.
    if ((imageToVideo || imageToImage) && !this.config.RECOVERY_SECRET) throw new ProductionGenerationError("PROVIDER_INPUT_NOT_CONFIGURED", 503, "Private provider input delivery is not configured.");
    if ((imageToVideo || imageToImage) && !sourceAssetId) throw new ProductionGenerationError("SOURCE_IMAGE_REQUIRED", 409, imageToVideo
      ? "Choose one project image before requesting an image-to-video quote."
      : "Choose one project image before requesting an image-to-image quote.");
    if (sourceAssetId) await this.requireSourceImage(ownerId, projectId, sourceAssetId);
    const settings = input.settings && typeof input.settings === "object" ? input.settings as Record<string, unknown> : {};
    const dims = dimensions(offer);
    const certified = resolveCertifiedPublishedSettings({
      dimensions: dims,
      providerId: offer.provider_id,
      providerModelId: offer.provider_model_id,
      video,
      imageToVideo,
      settings,
    });
    const { aspectRatio, resolution, durationSeconds, quality, audio } = certified;
    if (imageToVideo && offer.adapter_version === "kie-market.image-to-video.v1" && ![5, 10].includes(durationSeconds ?? 0)) throw new ProductionGenerationError("KIE_DURATION_UNCERTIFIED", 409, "The published Kling V2.5 rate has no certified 5 or 10 second duration.");
    if (imageToVideo && offer.adapter_version === "kie-market.image-to-video.v3" && durationSeconds !== 5) throw new ProductionGenerationError("KIE_DURATION_UNCERTIFIED", 409, "The published Kling V3 Turbo rate is certified for five seconds only.");
    if (imageToVideo && offer.adapter_version === "kie-market.kling-3.v1" && (!durationSeconds || durationSeconds < 3 || durationSeconds > 15 || !quality)) throw new ProductionGenerationError("KIE_CONFIGURATION_UNCERTIFIED", 409, "The published Kling 3.0 configuration is incomplete or unsupported.");
    const requestTemplate = ProviderGenerationRequestSchema.omit({ operationId: true }).parse({
      model: offer.provider_model_id, mediaType: video || imageToVideo ? "video" : "image", scenario: "success",
      input: { prompt, quantity: 1, resolution, durationSeconds, audio: video || imageToVideo ? audio : false, ...(quality ? { quality } : {}), ...((imageToVideo || imageToImage) && sourceAssetId ? { sourceAssetId } : {}), ...(aspectRatio ? { aspectRatio } : {}) },
    });
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 10 * 60_000);
    const requestHash = sha({ offerId, offerVersion: Number(offer.version), projectId, recipeId, prompt, sourceAssetId, settings: { ...(aspectRatio ? { aspectRatio } : {}), resolution, durationSeconds, quality, audio }, ownerId });
    const evidenceBase = {
      routeId: `route:${offer.offer_id}:v${offer.version}`, providerId: offer.provider_id,
      providerAccountId: offer.provider_account_id, providerAccountScope: "PRODUCTION" as const,
      providerModelBindingId: offer.reference_model_id, providerModelId: offer.provider_model_id,
      catalogSnapshotId: `catalog:${offer.reference_model_id}`, catalogSnapshotHash: offer.evidence_sha256,
      providerCostVersionId: `${offer.reference_model_id}:${offer.rate_key}`, providerCostVersion: String(offer.provider_rate_version),
      adapterVersion: offer.adapter_version, usageExtractorVersion: video ? "openrouter-video.usage.cost.v1" : offer.adapter_version === "openrouter-image.v1" ? "openrouter-image.response.usage.cost.v1" : "kie-record-info.creditsConsumed.v1",
      certificationLifecycle: "PUBLISHED", dispatchSource: "PUBLISHED_OFFER" as const,
      publishedOfferId: offer.offer_id, releaseBundleId: offer.offer_id, releaseBundleVersion: Number(offer.version),
    };
    const executionEvidence: RouteExecutionEvidence = { ...evidenceBase, evidenceSha256: sha(evidenceBase) };
    const quoteId = randomUUID();
    const quote = {
      id: quoteId, projectId, recipeId, modelId: offer.provider_model_id, provider: offer.provider_id,
      offerId, customerCredits: Number(offer.customer_credits), requestHash,
      createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(), durable: true, localOnly: false,
    };
    await this.atomic.issueQuote({
      id: quoteId, ownerId, requestHash, customerCredits: Number(offer.customer_credits), expiresAt: expiresAt.toISOString(),
      metadata: { projectId, recipeId, providerId: offer.provider_id, providerRequestTemplate: requestTemplate, pricingSnapshot: quote, executionEvidence },
    });
    return { status: 201, body: quote };
  }

  async createOperation(ownerId: string, raw: unknown, idempotencyKey: string | undefined): Promise<ProductionGenerationResponse> {
    const parsed = OperationInput.safeParse(raw);
    if (!parsed.success || !idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new ProductionGenerationError("INVALID_GENERATION_INTENT", 400, "A valid quote and idempotency key are required.");
    }
    const metadata = await this.quoteMetadata(parsed.data.quoteId);
    if (!metadata || metadata.ownerId !== ownerId || metadata.requestHash !== parsed.data.requestHash) {
      throw new ProductionGenerationError("QUOTE_NOT_FOUND", 404, "Quote not found.");
    }
    const operationId = randomUUID();
    const template = ProviderGenerationRequestSchema.parse({ ...metadata.providerRequestTemplate, operationId });
    const request = ["kling/v2-5-turbo-image-to-video-pro", "kling/v3-turbo-image-to-video", "kling-3.0/video", "gpt-image-2-image-to-image"].includes(template.model)
      ? ProviderGenerationRequestSchema.parse({ ...template, input: { ...template.input, providerInputUrl: await this.issueProviderInputUrl(operationId, ownerId, template.input.sourceAssetId) } })
      : template;
    const committed = await this.atomic.commitGeneration({
      operationId, reservationId: randomUUID(), journalId: randomUUID(), journalCommandId: `production-reserve:${operationId}`,
      operationEventId: randomUUID(), outboxEventId: randomUUID(), ownerId, quoteId: parsed.data.quoteId,
      generationIntentId: parsed.data.generationIntentId, idempotencyKey, route: "POST /v2/durable/operations",
      requestHash: parsed.data.requestHash, outboxPayload: { operationId, providerId: metadata.providerId, request, projectId: metadata.projectId },
    });
    // Submission happens only after the atomic wallet hold has committed.
    await this.drive(committed.operation.id, true);
    return { status: 202, body: await this.operationEnvelope(ownerId, committed.operation.id) };
  }

  async operation(ownerId: string, operationId: string): Promise<ProductionGenerationResponse> {
    const current = await this.coordinator.operation(operationId).catch(() => null);
    if (!current || current.ownerId !== ownerId) throw new ProductionGenerationError("OPERATION_NOT_FOUND", 404, "Operation not found.");
    await this.drive(operationId, false);
    return { status: 200, body: await this.operationEnvelope(ownerId, operationId) };
  }

  async recoverPending(): Promise<ProductionGenerationResponse> {
    const candidates = await this.database.query<Row>(`SELECT o.id,a.attempt_number,a.dispatch_deadline_at
      FROM fusion_engine.operations o
      LEFT JOIN LATERAL (
        SELECT attempt_number,dispatch_deadline_at FROM fusion_engine.operation_attempts
        WHERE operation_id=o.id ORDER BY attempt_number DESC LIMIT 1
      ) a ON true
      WHERE o.state IN ('RESERVED','DISPATCHING','SUBMISSION_UNKNOWN','SUBMITTED','RUNNING','PROVIDER_SUCCEEDED')
      ORDER BY o.updated_at ASC LIMIT 8`);
    let progressed = 0;
    let reviewed = 0;
    for (const candidate of candidates.rows) {
      const operationId = String(candidate.id);
      try {
        const before = await this.coordinator.operation(operationId);
        await this.drive(operationId, false);
        const latest = await this.coordinator.operation(operationId);
        if (["DISPATCHING", "SUBMISSION_UNKNOWN", "SUBMITTED", "RUNNING"].includes(latest.state)
          && candidate.attempt_number != null
          && Date.parse(String(candidate.dispatch_deadline_at)) <= Date.now()) {
          await this.worker.timeoutIfExpired(operationId, Number(candidate.attempt_number));
          reviewed += 1;
        }
        if ((await this.coordinator.operation(operationId)).state !== before.state) progressed += 1;
      } catch {
        // A single provider/account fault must not stop recovery of unrelated
        // customer operations. The durable attempt retains the evidence.
      }
    }
    return { status: 200, body: { status: "ok", scanned: candidates.rows.length, progressed, movedToReview: reviewed } };
  }

  async handleKieWebhook(input: { rawBody: Uint8Array; timestamp?: string; signature?: string }): Promise<ProductionGenerationResponse> {
    let secret = await this.kieWebhookSecret();
    let verified: ReturnType<typeof parseKieWebhook>;
    try {
      verified = parseKieWebhook({
        rawBody: input.rawBody,
        signatureHeader: input.signature ?? "",
        timestampHeader: input.timestamp ?? "",
        secret,
      });
    } finally {
      secret = "";
    }
    const inbox = new PostgresProviderWebhookInbox(this.database);
    const received = await inbox.receiveVerified({
      providerId: "kie", deliveryId: verified.deliveryId, taskId: verified.taskId,
      rawBody: input.rawBody, payload: verified.rawPayload,
    });
    if (received.receipt.status === "PROCESSED" || received.receipt.status === "REJECTED") {
      return { status: 200, body: { status: "duplicate" } };
    }
    const consumerId = `production-webhook:${randomUUID()}`;
    const claim = await inbox.claim({ providerId: "kie", deliveryId: verified.deliveryId, consumerId });
    if (claim.kind !== "CLAIMED") return { status: 200, body: { status: claim.kind.toLowerCase() } };
    const operation = await this.database.query<Row>(`SELECT operation_id FROM fusion_engine.operation_attempts
      WHERE provider_id='kie' AND provider_task_id=$1 ORDER BY created_at DESC LIMIT 1`, [verified.taskId]);
    const operationId = operation.rows[0]?.operation_id;
    if (!operationId) {
      await inbox.reject({ providerId: "kie", deliveryId: verified.deliveryId, consumerId, rejectionCode: "PROVIDER_TASK_NOT_FOUND" });
      return { status: 200, body: { status: "unmatched" } };
    }
    try {
      // The callback is only a wake-up signal. The authoritative recordInfo
      // response remains the financial and delivery evidence.
      await this.drive(String(operationId), false);
      await inbox.complete({ providerId: "kie", deliveryId: verified.deliveryId, consumerId });
      return { status: 200, body: { status: "accepted" } };
    } catch (error) {
      await inbox.defer({ providerId: "kie", deliveryId: verified.deliveryId, consumerId }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Creates a one-time, private Storage upload target. The browser receives
   * no service key and the uploaded bytes are not trusted until finalize
   * reads them back through the server, checks their hash and verifies magic
   * bytes. This is deliberately separate from provider-delivered assets.
   */
  async createInputAssetUpload(ownerId: string, raw: unknown): Promise<ProductionGenerationResponse> {
    const parsed = InputAssetIntent.safeParse(raw);
    if (!parsed.success) throw new ProductionGenerationError("INPUT_ASSET_INVALID", 400, "Image upload metadata is invalid.");
    const project = await this.database.query<Row>("SELECT project_id FROM fusion_engine.creative_projects WHERE project_id=$1 AND owner_id=$2", [parsed.data.projectId, ownerId]);
    if (!project.rows[0]) throw new ProductionGenerationError("PROJECT_NOT_FOUND", 404, "Project not found.");
    const id = randomUUID();
    const uploadExpiresAt = new Date(Date.now() + 10 * 60_000);
    const extension = parsed.data.contentType === "image/jpeg" ? "jpg" : parsed.data.contentType.split("/")[1]!;
    const objectKey = `owner/${sha(ownerId).slice(0, 24)}/${id}.${extension}`;
    await this.database.query(`INSERT INTO fusion_engine.customer_input_assets
      (id,owner_id,project_id,object_key,original_filename,content_type,byte_length,checksum_sha256,state,upload_expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING_UPLOAD',$9)`, [
      id, ownerId, parsed.data.projectId, objectKey, parsed.data.filename,
      parsed.data.contentType, parsed.data.byteLength, parsed.data.checksumSha256, uploadExpiresAt.toISOString(),
    ]);
    const signed = await this.request(`${this.config.SUPABASE_URL}/storage/v1/object/upload/sign/customer-inputs-private/${this.storagePath(objectKey)}`, {
      method: "POST", headers: { ...this.storageHeaders(), "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15_000),
    });
    const payload = await signed.json().catch(() => null) as Row | null;
    const relative = typeof payload?.url === "string" ? payload.url : typeof payload?.signedURL === "string" ? payload.signedURL : "";
    if (!signed.ok || !relative) {
      await this.database.query("UPDATE fusion_engine.customer_input_assets SET state='FAILED' WHERE id=$1", [id]);
      throw new ProductionGenerationError("INPUT_UPLOAD_UNAVAILABLE", 503, "A secure upload target could not be created.");
    }
    const uploadUrl = /^https:\/\//i.test(relative)
      ? relative
      : new URL(relative.startsWith("/") ? `/storage/v1${relative}` : `/storage/v1/${relative}`, this.config.SUPABASE_URL).toString();
    return { status: 201, body: { assetId: id, uploadUrl, expiresAt: uploadExpiresAt.toISOString(), contentType: parsed.data.contentType } };
  }

  async finalizeInputAssetUpload(ownerId: string, assetId: string, raw: unknown): Promise<ProductionGenerationResponse> {
    const parsed = InputAssetFinalize.safeParse(raw);
    if (!parsed.success || !z.string().uuid().safeParse(assetId).success) throw new ProductionGenerationError("INPUT_ASSET_INVALID", 400, "Image upload confirmation is invalid.");
    const result = await this.database.transaction(async (transaction) => {
      const row = await transaction.query<Row>(`SELECT id,project_id,object_key,original_filename,content_type,byte_length,checksum_sha256,state,upload_expires_at
        FROM fusion_engine.customer_input_assets WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [assetId, ownerId]);
      const asset = row.rows[0];
      if (!asset) throw new ProductionGenerationError("INPUT_ASSET_NOT_FOUND", 404, "Uploaded image was not found.");
      if (asset.state === "READY") return asset;
      if (new Date(String(asset.upload_expires_at)).getTime() <= Date.now()) {
        await transaction.query("UPDATE fusion_engine.customer_input_assets SET state='EXPIRED' WHERE id=$1", [assetId]);
        throw new ProductionGenerationError("INPUT_UPLOAD_EXPIRED", 409, "The upload window expired. Start the upload again.");
      }
      if (String(asset.checksum_sha256) !== parsed.data.checksumSha256) throw new ProductionGenerationError("INPUT_ASSET_INTEGRITY_FAILED", 409, "The upload checksum does not match its declared file.");
      return asset;
    });
    if (result.state !== "READY") {
      const storage = await this.request(`${this.config.SUPABASE_URL}/storage/v1/object/customer-inputs-private/${this.storagePath(String(result.object_key))}`, {
        headers: this.storageHeaders(), signal: AbortSignal.timeout(20_000),
      });
      const bytes = new Uint8Array(await storage.arrayBuffer());
      const valid = storage.ok && bytes.byteLength === Number(result.byte_length) && sha(bytes) === result.checksum_sha256 && isCertifiedImage(bytes, String(result.content_type));
      if (!valid) {
        await this.database.query("UPDATE fusion_engine.customer_input_assets SET state='FAILED' WHERE id=$1 AND owner_id=$2", [assetId, ownerId]);
        throw new ProductionGenerationError("INPUT_ASSET_INTEGRITY_FAILED", 409, "The uploaded file could not be verified as the selected image.");
      }
      await this.database.query("UPDATE fusion_engine.customer_input_assets SET state='READY',finalized_at=now() WHERE id=$1 AND owner_id=$2", [assetId, ownerId]);
    }
    return { status: 201, body: { assetId, projectId: String(result.project_id), name: String(result.original_filename), contentType: String(result.content_type), byteLength: Number(result.byte_length), checksumSha256: String(result.checksum_sha256), state: "READY" } };
  }

  async readInputAsset(ownerId: string, assetId: string): Promise<ProductionGenerationResponse> {
    if (!z.string().uuid().safeParse(assetId).success) throw new ProductionGenerationError("INPUT_ASSET_NOT_FOUND", 404, "Uploaded image was not found.");
    const assets = await this.database.query<Row>(`SELECT object_key,content_type,checksum_sha256 FROM fusion_engine.customer_input_assets
      WHERE id=$1 AND owner_id=$2 AND state='READY'`, [assetId, ownerId]);
    const asset = assets.rows[0];
    if (!asset) throw new ProductionGenerationError("INPUT_ASSET_NOT_FOUND", 404, "Uploaded image was not found.");
    const storage = await this.request(`${this.config.SUPABASE_URL}/storage/v1/object/customer-inputs-private/${this.storagePath(String(asset.object_key))}`, { headers: this.storageHeaders(), signal: AbortSignal.timeout(20_000) });
    if (!storage.ok) throw new ProductionGenerationError("INPUT_ASSET_UNAVAILABLE", 503, "Uploaded image is temporarily unavailable.");
    const bytes = new Uint8Array(await storage.arrayBuffer());
    if (sha(bytes) !== asset.checksum_sha256 || !isCertifiedImage(bytes, String(asset.content_type))) throw new ProductionGenerationError("INPUT_ASSET_INTEGRITY_FAILED", 503, "Uploaded image integrity could not be verified.");
    return { status: 200, bytes, contentType: String(asset.content_type) };
  }

  async createAssetGrant(ownerId: string, assetId: string, raw: unknown): Promise<ProductionGenerationResponse> {
    const parsed = GrantInput.safeParse(raw ?? {});
    if (!parsed.success || !z.string().uuid().safeParse(assetId).success) throw new ProductionGenerationError("INVALID_ASSET_GRANT", 400, "Asset grant is invalid.");
    const asset = await this.database.query<Row>("SELECT id FROM fusion_engine.operation_assets WHERE id=$1 AND owner_id=$2", [assetId, ownerId]);
    if (!asset.rows[0]) throw new ProductionGenerationError("ASSET_NOT_FOUND", 404, "Asset not found.");
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + (parsed.data.ttlSeconds ?? 300) * 1000).toISOString();
    await this.database.query("INSERT INTO fusion_engine.production_asset_access_grants(token_hash,asset_id,owner_id,expires_at) VALUES($1,$2,$3,$4)", [sha(token), assetId, ownerId, expiresAt]);
    await this.auditAsset(assetId, ownerId, "GRANT_ISSUED", token);
    return { status: 201, body: { token, expiresAt } };
  }

  async readAsset(ownerId: string, assetId: string, token: string | undefined): Promise<ProductionGenerationResponse> {
    const tokenHash = token ? sha(token) : "";
    const result = await this.database.query<Row>(`SELECT asset.object_key,asset.content_type,asset.checksum_sha256
      FROM fusion_engine.production_asset_access_grants grant_row
      JOIN fusion_engine.operation_assets asset ON asset.id=grant_row.asset_id
      WHERE grant_row.token_hash=$1 AND grant_row.asset_id=$2 AND grant_row.owner_id=$3
        AND grant_row.expires_at>now() AND asset.owner_id=$3`, [tokenHash, assetId, ownerId]);
    const asset = result.rows[0];
    if (!asset) {
      if (token) await this.auditAsset(assetId, ownerId, "READ_DENIED", token).catch(() => undefined);
      throw new ProductionGenerationError("ASSET_ACCESS_DENIED", 403, "Asset access grant is invalid or expired.");
    }
    const response = await this.request(`${this.config.SUPABASE_URL}/storage/v1/object/generated-originals-private/${this.storagePath(String(asset.object_key))}`, {
      headers: this.storageHeaders(), signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new ProductionGenerationError("ASSET_UNAVAILABLE", 503, "Stored asset is temporarily unavailable.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (sha(bytes) !== asset.checksum_sha256) throw new ProductionGenerationError("ASSET_CHECKSUM_MISMATCH", 503, "Stored asset integrity check failed.");
    await this.auditAsset(assetId, ownerId, "READ_ALLOWED", token!);
    return { status: 200, bytes, contentType: String(asset.content_type) };
  }

  private async activeOffers(): Promise<OfferRow[]> {
    const result = await this.database.query<OfferRow>(`SELECT version.* FROM fusion_engine.production_offer_pointers pointer
      JOIN fusion_engine.production_offer_versions version ON version.offer_id=pointer.offer_id AND version.version=pointer.current_version
      JOIN fusion_engine.provider_accounts account ON account.id=version.provider_account_id
      JOIN fusion_engine.provider_credentials credential ON credential.id=version.credential_id
      WHERE pointer.state='ACTIVE' AND account.state='CONNECTED' AND account.active_credential_id=version.credential_id AND credential.status='ACTIVE'
      ORDER BY version.display_name,version.offer_id`);
    return result.rows;
  }

  private async offer(offerId: string): Promise<OfferRow | null> {
    return (await this.activeOffers()).find((offer) => offer.offer_id === offerId) ?? null;
  }

  private async quoteMetadata(quoteId: string) {
    const result = await this.database.query<Row>(`SELECT quote.owner_id,quote.request_hash,quote.state,quote.consumed_operation_id,
      metadata.project_id,metadata.recipe_id,metadata.provider_id,metadata.provider_request_template,metadata.pricing_snapshot,metadata.execution_evidence
      FROM fusion_engine.quotes quote JOIN fusion_engine.generation_quote_metadata metadata ON metadata.quote_id=quote.id WHERE quote.id=$1`, [quoteId]);
    const row = result.rows[0];
    if (!row) return null;
    return { ownerId: String(row.owner_id), requestHash: String(row.request_hash), state: String(row.state), consumedOperationId: row.consumed_operation_id,
      projectId: String(row.project_id), recipeId: String(row.recipe_id), providerId: String(row.provider_id),
      providerRequestTemplate: json(row.provider_request_template), pricingSnapshot: json(row.pricing_snapshot), executionEvidence: json(row.execution_evidence) };
  }

  private async relay(operationId: string): Promise<void> {
    const lease = await this.coordinator.claimNextOutbox(`production-relay:${randomUUID()}`, 10_000);
    if (!lease) return;
    try {
      const payload = lease.payload as { providerId?: unknown; request?: unknown };
      const request = ProviderGenerationRequestSchema.parse(payload.request);
      if (lease.operationId !== operationId || typeof payload.providerId !== "string") {
        await this.coordinator.rejectOutbox({ eventId: lease.eventId, workerId: lease.workerId, errorCode: "OTHER_OPERATION", retryAt: new Date(Date.now() + 250).toISOString(), maxAttempts: 50 });
        return;
      }
      const queued = await this.coordinator.consumeQueuedDelivery({ consumerName: "production-generation-relay", eventId: lease.eventId, operationId, payload: lease.payload, eventRecordId: randomUUID() });
      if (queued.operation.state === "QUEUED") await this.coordinator.beginDispatch({
        operationId, expectedVersion: queued.operation.stateVersion, attemptId: randomUUID(), attemptNumber: 1,
        providerId: payload.providerId, providerIdempotencyKey: `provider-attempt:${operationId}:1`, requestHash: queued.operation.requestHash,
        requestPayload: request, dispatchDeadlineAt: new Date(Date.now() + 15 * 60_000).toISOString(), eventRecordId: randomUUID(),
      });
      await this.coordinator.acknowledgeOutbox(lease.eventId, lease.workerId);
    } catch (error) {
      await this.coordinator.rejectOutbox({ eventId: lease.eventId, workerId: lease.workerId, errorCode: error instanceof Error ? error.name : "RELAY_ERROR", retryAt: new Date(Date.now() + 1000).toISOString(), maxAttempts: 5 });
      throw error;
    }
  }

  private async drive(operationId: string, allowSubmit: boolean): Promise<void> {
    let operation = await this.coordinator.operation(operationId);
    if (operation.state === "RESERVED") { await this.relay(operationId); operation = await this.coordinator.operation(operationId); }
    const attempts = await this.database.query<Row>("SELECT attempt_number,updated_at FROM fusion_engine.operation_attempts WHERE operation_id=$1 ORDER BY attempt_number DESC LIMIT 1", [operationId]);
    const latest = attempts.rows[0];
    if (latest && ["DISPATCHING", "SUBMISSION_UNKNOWN", "SUBMITTED", "RUNNING"].includes(operation.state)) {
      const oldEnough = Date.now() - new Date(String(latest.updated_at)).getTime() >= 2_000;
      if ((operation.state === "DISPATCHING" && allowSubmit) || (operation.state !== "DISPATCHING" && oldEnough)) {
        await this.worker.driveOnce(operationId, Number(latest.attempt_number));
      }
    }
    if (latest && operation.state === "PROVIDER_FAILED") {
      await this.worker.driveOnce(operationId, Number(latest.attempt_number));
    }
    operation = await this.coordinator.operation(operationId);
    if (operation.state === "PROVIDER_SUCCEEDED") await this.ingest(operationId);
  }

  private async withOperationAdapter<T>(operationId: string, providerId: string, work: (adapter: ProviderAdapter) => Promise<T>): Promise<T> {
    const operation = await this.coordinator.operation(operationId);
    const metadata = await this.quoteMetadata(operation.quoteId);
    if (!metadata) throw new ProviderDefinitiveError("QUOTE_EVIDENCE_MISSING", "Published quote evidence is missing.");
    const evidence = metadata.executionEvidence;
    const offer = await this.offer(String(evidence.publishedOfferId ?? ""));
    if (!offer || offer.provider_id !== providerId || offer.provider_model_id !== evidence.providerModelId || Number(offer.version) !== evidence.releaseBundleVersion) {
      throw new ProviderDefinitiveError("RELEASE_EVIDENCE_MISMATCH", "Operation route does not match the immutable released offer.");
    }
    const secretResult = await this.database.query<Row>("SELECT fusion_engine.lease_provider_secret($1::uuid) AS secret", [offer.credential_id]);
    const secret = String(secretResult.rows[0]?.secret ?? "");
    if (!secret) throw new ProviderDefinitiveError("PROVIDER_CREDENTIAL_UNAVAILABLE", "The active provider key cannot be leased.");
    const providerCredits = Math.ceil(Number(offer.provider_credit_micros ?? 0) / 1_000_000);
    try {
      if (providerId === "kie" && ["kie-market.v1", "kie-market.image-to-image.gpt-image-2.v1", "kie-market.image-to-video.v1", "kie-market.image-to-video.v3", "kie-market.kling-3.v1"].includes(offer.adapter_version)) {
        return await work(new KieMarketAdapter({ apiKey: secret, callbackUrl: "https://fusionlab.pro/api/engine/v2/provider-callbacks/kie", estimateMaximum: () => providerCredits, fetch: this.request }));
      }
      if (providerId === "openrouter" && offer.adapter_version === "openrouter-video.v1") {
        const usdPicos = BigInt(String(offer.provider_usd_picos ?? 0));
        const maximumMicrocredits = (usdPicos + 999_999n) / 1_000_000n;
        return await work(new OpenRouterVideoAdapter({ apiKey: secret, estimateMaximumAtomic: () => maximumMicrocredits, fetch: this.request }));
      }
      if (providerId === "openrouter" && offer.adapter_version === "openrouter-image.v1") {
        const usdPicos = BigInt(String(offer.provider_usd_picos ?? 0));
        const maximumMicrocredits = Number((usdPicos + 999_999n) / 1_000_000n);
        return await work(new OpenRouterDurableImageAdapter({
          apiKey: secret,
          supabaseUrl: this.config.SUPABASE_URL,
          supabaseSecretKey: this.config.SUPABASE_SECRET_KEY,
          estimateMaximumAtomic: () => maximumMicrocredits,
          fetch: this.request,
        }));
      }
      throw new ProviderDefinitiveError("PROVIDER_NOT_RELEASED", "The published provider adapter is not released for this route.");
    } finally { /* The adapter is request-scoped and is never cached. */ }
  }

  private async ingest(operationId: string): Promise<void> {
    const operation = await this.coordinator.operation(operationId);
    const attempt = await this.coordinator.attempt(operationId, 1);
    const metadata = await this.quoteMetadata(operation.quoteId);
    if (!metadata || !attempt.providerResultUrl || !attempt.providerTaskId) return;
    try {
      const offer = await this.offer(String(metadata.executionEvidence.publishedOfferId ?? ""));
      if (!offer) throw new Error("offer_not_active");
      let bytes: Uint8Array;
      let declared: string;
      if (offer.provider_id === "kie") {
        const secretResult = await this.database.query<Row>("SELECT fusion_engine.lease_provider_secret($1::uuid) AS secret", [offer.credential_id]);
        const secret = String(secretResult.rows[0]?.secret ?? "");
        const linkResponse = await this.request("https://api.kie.ai/api/v1/common/download-url", {
          method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
          body: JSON.stringify({ url: attempt.providerResultUrl }), signal: AbortSignal.timeout(15_000),
        });
        const link = await linkResponse.json().catch(() => null) as { code?: unknown; data?: unknown } | null;
        if (!linkResponse.ok || link?.code !== 200 || typeof link.data !== "string" || !link.data.startsWith("https://")) throw new Error("kie_download_link_failed");
        const download = await this.request(link.data, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
        if (!download.ok) throw new Error("kie_asset_download_failed");
        declared = download.headers.get("content-type")?.split(";")[0] ?? "";
        bytes = new Uint8Array(await download.arrayBuffer());
      } else if (offer.provider_id === "openrouter") {
        const asset = await this.withOperationAdapter(operationId, offer.provider_id, (adapter) => adapter.fetchAsset(attempt.providerResultUrl!));
        bytes = asset.bytes;
        declared = asset.contentType;
      } else throw new Error("provider_asset_ingest_not_released");
      const expectedMediaType = metadata.providerRequestTemplate.mediaType === "video" ? "video" : "image";
      const validation = validateMediaBytes({ bytes, declaredContentType: declared, expectedMediaType, policy: defaultLocalMediaPolicy });
      if (await this.scanner.scan(bytes) !== "CLEAN") throw new MediaPipelineError("MALWARE_DETECTED", "Generated asset failed the signature scan.");
      const checksum = sha(bytes);
      const objectKey = `${metadata.ownerId}/${operationId}/${checksum}`;
      const upload = await this.request(`${this.config.SUPABASE_URL}/storage/v1/object/generated-originals-private/${this.storagePath(objectKey)}`, {
        method: "POST", headers: { ...this.storageHeaders(), "content-type": validation.contentType, "x-upsert": "false" }, body: bytes,
        signal: AbortSignal.timeout(30_000),
      });
      if (!upload.ok && upload.status !== 409) throw new Error("private_storage_upload_failed");
      const assetId = randomUUID();
      const stored = await this.coordinator.storeAsset({
        operationId, expectedOperationVersion: operation.stateVersion, attemptId: attempt.id, assetId, privateObjectId: objectKey,
        objectKey, bucket: "generated-originals-private", ownerId: metadata.ownerId, projectId: metadata.projectId,
        mediaType: expectedMediaType, contentType: validation.contentType, byteLength: bytes.byteLength, checksumSha256: checksum,
        metadata: validation.metadata, sourceUrl: attempt.providerResultUrl, eventRecordId: randomUUID(), evidenceHash: sha({ objectKey, checksum }),
      });
      const deliveryEvidence = sha({ assetId, checksum, ownerId: metadata.ownerId });
      const delivered = await this.coordinator.recordDelivery({ operationId, expectedOperationVersion: stored.operation.stateVersion, assetId,
        deliveryId: randomUUID(), ownerId: metadata.ownerId, evidenceHash: deliveryEvidence, eventRecordId: randomUUID() });
      await this.coordinator.settleDelivered({ operationId, expectedOperationVersion: delivered.operation.stateVersion,
        commandId: `settle-production-delivery:${operationId}`, journalId: randomUUID(), eventRecordId: randomUUID(),
        evidenceHash: sha({ operationId, assetId, checksum, settlement: "private_delivery_ready" }) });
    } catch (error) {
      const latest = await this.coordinator.operation(operationId);
      if (latest.state === "PROVIDER_SUCCEEDED") await this.coordinator.releaseDeliveryFailure({
        operationId, expectedOperationState: "PROVIDER_SUCCEEDED", expectedOperationVersion: latest.stateVersion, attemptId: attempt.id,
        commandId: `release-production-delivery:${operationId}`, journalId: randomUUID(), eventRecordId: randomUUID(),
        evidenceHash: sha({ operationId, failure: error instanceof Error ? error.name : "ASSET_DELIVERY_FAILED" }),
      });
    }
  }

  private async operationEnvelope(ownerId: string, operationId: string): Promise<Record<string, unknown>> {
    const operation = await this.coordinator.operation(operationId);
    if (operation.ownerId !== ownerId) throw new ProductionGenerationError("OPERATION_NOT_FOUND", 404, "Operation not found.");
    const metadata = await this.quoteMetadata(operation.quoteId);
    if (!metadata) throw new ProductionGenerationError("OPERATION_NOT_FOUND", 404, "Operation not found.");
    const [reservation, attempt, asset, events, wallet] = await Promise.all([
      this.database.query<Row>("SELECT quoted_credits,captured_credits FROM fusion_engine.credit_reservations WHERE operation_id=$1", [operationId]),
      this.database.query<Row>("SELECT provider_id,actual_provider_credits FROM fusion_engine.operation_attempts WHERE operation_id=$1 ORDER BY attempt_number DESC LIMIT 1", [operationId]),
      this.database.query<Row>(`SELECT asset.id,asset.media_type,asset.content_type,asset.byte_length,asset.checksum_sha256,delivery.id AS delivery_id FROM fusion_engine.operation_assets asset
        LEFT JOIN fusion_engine.operation_deliveries delivery ON delivery.asset_id=asset.id WHERE asset.operation_id=$1`, [operationId]),
      this.database.query<Row>("SELECT sequence,state,state_version,occurred_at FROM fusion_engine.operation_events WHERE operation_id=$1 ORDER BY sequence", [operationId]),
      this.database.query<Row>("SELECT available_credits,held_credits,spent_credits FROM fusion_engine.wallets WHERE owner_id=$1", [ownerId]),
    ]);
    const storedAsset = asset.rows[0];
    return { quote: metadata.pricingSnapshot, operation: {
      id: operation.id, quoteId: operation.quoteId, state: operation.state, stateVersion: operation.stateVersion,
      generationIntentId: operation.generationIntentId, provider: attempt.rows[0]?.provider_id ?? metadata.providerId,
      modelId: metadata.pricingSnapshot.modelId,
      financials: { customerQuotedCredits: operation.customerCredits, customerChargedCredits: Number(reservation.rows[0]?.captured_credits ?? 0),
        providerChargedCredits: Number(attempt.rows[0]?.actual_provider_credits ?? 0) },
      delivery: storedAsset?.delivery_id ? { assetId: storedAsset.id, mediaType: storedAsset.media_type, contentType: storedAsset.content_type,
        byteLength: Number(storedAsset.byte_length), checksumSha256: storedAsset.checksum_sha256 } : null,
      events: events.rows.map((event) => ({ sequence: Number(event.sequence), state: event.state, version: Number(event.state_version), at: iso(event.occurred_at as string | Date) })),
      createdAt: operation.createdAt, updatedAt: operation.updatedAt, localOnly: false,
    }, wallet: { customerCredits: {
      available: Number(wallet.rows[0]?.available_credits ?? 0),
      held: Number(wallet.rows[0]?.held_credits ?? 0),
      spent: Number(wallet.rows[0]?.spent_credits ?? 0),
    } }, localOnly: false, durable: true };
  }

  private storageHeaders() {
    return { apikey: this.config.SUPABASE_SECRET_KEY, authorization: `Bearer ${this.config.SUPABASE_SECRET_KEY}` };
  }
  async readProviderInput(operationId: string, assetId: string, query: Readonly<Record<string, string | undefined>>): Promise<ProductionGenerationResponse> {
    const expiresAt = Number(query.expiresAt);
    const signature = query.signature ?? "";
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 20 * 60_000 || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
      throw new ProductionGenerationError("PROVIDER_INPUT_ACCESS_DENIED", 403, "Provider input grant is invalid or expired.");
    }
    const operation = await this.database.query<Row>("SELECT owner_id FROM fusion_engine.operations WHERE id=$1", [operationId]);
    const ownerId = typeof operation.rows[0]?.owner_id === "string" ? operation.rows[0].owner_id : "";
    const expected = this.providerInputSignature(operationId, assetId, ownerId, expiresAt);
    const supplied = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (!ownerId || supplied.length !== expectedBytes.length || !timingSafeEqual(supplied, expectedBytes)) {
      throw new ProductionGenerationError("PROVIDER_INPUT_ACCESS_DENIED", 403, "Provider input grant is invalid or expired.");
    }
    const asset = await this.database.query<Row>(`SELECT object_key,bucket,content_type,checksum_sha256 FROM fusion_engine.operation_assets
      WHERE id=$1 AND owner_id=$2 AND media_type='image'
      UNION ALL
      SELECT object_key,bucket,content_type,checksum_sha256 FROM fusion_engine.customer_input_assets
      WHERE id=$1 AND owner_id=$2 AND state='READY'`, [assetId, ownerId]);
    const row = asset.rows[0];
    if (!row) throw new ProductionGenerationError("PROVIDER_INPUT_ACCESS_DENIED", 403, "Provider input grant is invalid or expired.");
    const response = await this.request(`${this.config.SUPABASE_URL}/storage/v1/object/${this.storagePath(String(row.bucket))}/${this.storagePath(String(row.object_key))}`, {
      headers: this.storageHeaders(), signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new ProductionGenerationError("PROVIDER_INPUT_UNAVAILABLE", 503, "Provider input is temporarily unavailable.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (sha(bytes) !== row.checksum_sha256 || !String(row.content_type).startsWith("image/")) throw new ProductionGenerationError("PROVIDER_INPUT_INTEGRITY_FAILED", 503, "Provider input failed integrity verification.");
    await this.auditAsset(assetId, ownerId, "READ_ALLOWED", signature).catch(() => undefined);
    return { status: 200, bytes, contentType: String(row.content_type) };
  }
  private async requireSourceImage(ownerId: string, projectId: string, assetId: string) {
    const asset = await this.database.query<Row>(`SELECT id FROM fusion_engine.operation_assets
      WHERE id=$1 AND owner_id=$2 AND project_id=$3 AND media_type='image'
      UNION ALL
      SELECT id FROM fusion_engine.customer_input_assets
      WHERE id=$1 AND owner_id=$2 AND project_id=$3 AND state='READY'`, [assetId, ownerId, projectId]);
    if (!asset.rows[0]) throw new ProductionGenerationError("SOURCE_IMAGE_INVALID", 409, "The selected source must be a ready image from this project.");
  }
  private async issueProviderInputUrl(operationId: string, ownerId: string, assetId: string | undefined) {
    if (!assetId) throw new ProductionGenerationError("SOURCE_IMAGE_REQUIRED", 409, "Choose one project image before starting this generation.");
    const operation = await this.coordinator.operation(operationId);
    const metadata = await this.quoteMetadata(operation.quoteId);
    await this.requireSourceImage(ownerId, metadata?.projectId ?? "", assetId);
    const expiresAt = Date.now() + 15 * 60_000;
    const signature = this.providerInputSignature(operationId, assetId, ownerId, expiresAt);
    return `https://fusionlab.pro/api/engine/v2/provider-inputs/${encodeURIComponent(operationId)}/${encodeURIComponent(assetId)}?expiresAt=${expiresAt}&signature=${encodeURIComponent(signature)}`;
  }
  private providerInputSignature(operationId: string, assetId: string, ownerId: string, expiresAt: number) {
    if (!this.config.RECOVERY_SECRET) throw new ProductionGenerationError("PROVIDER_INPUT_NOT_CONFIGURED", 503, "Private provider input delivery is not configured.");
    return createHmac("sha256", this.config.RECOVERY_SECRET).update(`provider-input:v1:${operationId}:${assetId}:${ownerId}:${expiresAt}`).digest("base64url");
  }
  private async kieWebhookSecret(): Promise<string> {
    try {
      const result = await this.database.query<Row>(`SELECT fusion_engine.lease_provider_secret(credential.id) AS secret
        FROM fusion_engine.provider_credentials credential
        WHERE credential.provider_id='kie' AND credential.environment='PRODUCTION'
          AND credential.purpose='PROVIDER_WEBHOOK_HMAC' AND credential.status='ACTIVE'
        ORDER BY credential.version DESC LIMIT 1`);
      const secret = String(result.rows[0]?.secret ?? "");
      if (secret) return secret;
    } catch (error) {
      if (!this.config.KIE_WEBHOOK_HMAC_KEY) throw error;
    }
    if (this.config.KIE_WEBHOOK_HMAC_KEY) return this.config.KIE_WEBHOOK_HMAC_KEY;
    throw new ProductionGenerationError("KIE_WEBHOOK_NOT_CONFIGURED", 503, "The verified KIE webhook signing key is not active.");
  }
  private storagePath(value: string) { return value.split("/").map(encodeURIComponent).join("/"); }
  private async auditAsset(assetId: string, ownerId: string, action: string, token: string) {
    await this.database.query("INSERT INTO fusion_engine.asset_access_events(id,asset_id,owner_id,action,token_hash,occurred_at) VALUES($1,$2,$3,$4,$5,now())",
      [randomUUID(), assetId, ownerId, action, sha(token)]);
  }
}

export function productionGenerationFailure(error: unknown): ProductionGenerationResponse {
  if (error instanceof ProductionGenerationError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  if (error instanceof PostgresAtomicError) return { status: error.code === "QUOTE_NOT_FOUND" ? 404 : 409, body: { error: { code: error.code, message: error.message } } };
  if (error instanceof ProviderDefinitiveError) {
    const status = ["INVALID_WEBHOOK_SIGNATURE", "STALE_WEBHOOK"].includes(error.code) ? 401 : 400;
    return { status, body: { error: { code: error.code, message: error.message } } };
  }
  if (error instanceof ProviderWebhookInboxError) return { status: 409, body: { error: { code: error.code, message: error.message } } };
  return { status: 503, body: { error: { code: "PRODUCTION_GENERATION_UNAVAILABLE", message: "Generation is temporarily unavailable; no unproven charge was made." } } };
}
