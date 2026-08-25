import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ProviderGenerationRequest } from "../../../../packages/contracts/src/provider.ts";
import { PostgresAtomicError } from "../../../../packages/durable-execution/src/postgres-atomic.ts";
import type { SpaceAdvancedService } from "../space-advanced/service.ts";
import { AdvancedQuoteRequestSchema } from "../space-advanced/domain.ts";
import type { SpaceImageService } from "../space-image/service.ts";
import { ImageQuoteRequestSchema } from "../space-image/domain.ts";
import type { SpaceVideoService } from "../space-video/service.ts";
import { VideoQuoteRequestSchema } from "../space-video/domain.ts";
import type { LocalMockProviderService } from "../local-provider/service.ts";
import type { LocalDurableRuntime } from "../durable-worker/runtime.ts";
import type { CustomerPublishedOffer } from "../../../../packages/provider-control-plane/src/postgres-repository.ts";
import type { PublishedOfferQuote, PublishedOfferQuoteInput } from "../../../../packages/commercial-engine/src/published-offer-quote.ts";

const CreateGenerationOperationSchema = z.object({
  quoteId: z.string().uuid(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  generationIntentId: z.string().trim().min(8).max(200),
}).strict();
const AssetGrantRequestSchema = z.object({ ttlSeconds: z.number().int().min(1).max(900).optional() }).strict();

type GenerationKind = "IMAGE" | "VIDEO" | "ADVANCED";
type QuoteView = {
  id: string;
  projectId: string;
  recipeId: string;
  modelId: string;
  requestHash: string;
  customerCredits: number;
  provider: string;
  expiresAt: string;
  [key: string]: unknown;
};
type CustomerQuoteConfiguration = Readonly<{
  recipeId: string;
  /** Validated, customer-selected controls only. Provider cost/route data is never exposed. */
  settings: Readonly<Record<string, string | number | boolean>>;
  bindingCount: number;
  bindingRoles: readonly string[];
}>;
type OperationEnvelope = { operation: { id: string; state: string } };
type PublishedOfferExecutionEvidence = Readonly<{
  offerId: string; routeId: string; providerId: string; providerAccountId: string; providerAccountScope: "LOCAL_TEST_ONLY" | "PRODUCTION";
  providerModelBindingId: string; providerModelId: string; catalogSnapshotId: string; catalogSnapshotHash: string;
  providerCostVersionId: string; providerCostVersion: string; adapterVersion: string; usageExtractorVersion: string;
  certificationLifecycle: "PUBLISHED"; releaseBundleId: string; releaseBundleVersion: number;
}>;
type PublishedOfferGateway = Readonly<{
  offers: () => Promise<ReadonlyArray<CustomerPublishedOffer>>;
  quote: (input: PublishedOfferQuoteInput) => Promise<PublishedOfferQuote>;
  executionEvidence: (offerId: string) => Promise<PublishedOfferExecutionEvidence>;
}>;
const customerSettingValue = (value: unknown): value is string | number | boolean => ["string", "number", "boolean"].includes(typeof value);

export class GenerationV2Error extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) {
    super(message);
  }
}

/**
 * Without a durable runtime this preserves legacy unit-test compatibility.
 * The local server injects that runtime, making V2 quotes and operations
 * restart-safe at the API boundary rather than retaining financial state in Maps.
 */
export class GenerationV2Service {
  private readonly quoteKinds = new Map<string, GenerationKind>();
  private readonly operationKinds = new Map<string, GenerationKind>();
  private readonly executions = new Map<string, Promise<void>>();

  constructor(
    private readonly image: SpaceImageService,
    private readonly video: SpaceVideoService,
    private readonly advanced: SpaceAdvancedService,
    private readonly provider: LocalMockProviderService,
    private readonly durableRuntime?: LocalDurableRuntime,
    private readonly published: PublishedOfferGateway | undefined = undefined,
    private readonly allowFixtureQuotes = true,
  ) {}

  /** Customer-safe discovery surface. Generation still requires a separately
   * pinned quote and never accepts a browser-supplied provider route. */
  async activePublishedOffers(): Promise<ReadonlyArray<CustomerPublishedOffer>> {
    return this.published?.offers() ?? [];
  }

  async createQuote(rawInput: unknown, ownerId = "local-user") {
    if (this.offerId(rawInput)) return this.createPublishedOfferQuote(rawInput, ownerId);
    if (!this.allowFixtureQuotes) {
      throw new GenerationV2Error("PUBLISHED_OFFER_REQUIRED", 409, "Choose an active published offer before requesting a quote.");
    }
    const recipeId = this.recipeId(rawInput);
    const kind = this.kindForRecipe(recipeId);
    const quote = this.service(kind).createQuote(rawInput) as QuoteView;
    if (!this.durableRuntime) {
      this.quoteKinds.set(quote.id, kind);
      return quote;
    }

    await this.durableRuntime.ensureLocalDevelopmentCredits(ownerId);
    const providerRequestTemplate = this.providerRequestTemplate(kind, rawInput, quote.modelId);
    const executionEvidence = this.durableRuntime.executionEvidenceFor(quote.provider, providerRequestTemplate);
    const durableQuoteId = randomUUID();
    await this.durableRuntime.issueLocalQuote({
      id: durableQuoteId,
        ownerId,
      requestHash: quote.requestHash,
      customerCredits: quote.customerCredits,
      expiresAt: quote.expiresAt,
      metadata: {
        projectId: quote.projectId,
        recipeId: quote.recipeId,
        providerId: quote.provider,
        providerRequestTemplate,
        pricingSnapshot: { ...quote, id: durableQuoteId },
        executionEvidence,
      },
    });
    return { ...quote, id: durableQuoteId, durable: true };
  }

  private async createPublishedOfferQuote(rawInput: unknown, ownerId: string) {
    if (!this.durableRuntime || !this.published) {
      throw new GenerationV2Error("PUBLISHED_OFFER_CATALOG_UNAVAILABLE", 503, "Published offers require the durable Control Plane.");
    }
    const offerId = this.offerId(rawInput);
    if (!offerId) throw new GenerationV2Error("PUBLISHED_OFFER_REQUIRED", 400, "A published offer ID is required.");
    const recipeId = this.recipeId(rawInput);
    const kind = this.kindForRecipe(recipeId);
    const normalized = this.normalizedPublishedRequest(rawInput, kind);
    const offers = await this.published.offers();
    const offer = offers.filter((candidate) => candidate.offerId === offerId)[0];
    const mediaType = kind === "IMAGE" ? "image" : recipeId === "audio.tts" ? "audio" : "video";
    if (!offer || !offer.modalities.includes(mediaType)) {
      throw new GenerationV2Error("PUBLISHED_OFFER_INCOMPATIBLE", 409, "The selected offer is not active or does not support this recipe output.");
    }
    this.assertPublishedControlSchema(offer, normalized);
    const providerRequestTemplate = this.providerRequestTemplate(kind, normalized, offer.providerModelId);
    this.assertPublishedCapability(offer, providerRequestTemplate);
    const commercial = await this.published.quote({
      offerId, projectId: this.projectIdOf(normalized), mode: "exact", quantity: providerRequestTemplate.input.quantity,
      resolution: providerRequestTemplate.input.resolution, audio: providerRequestTemplate.input.audio,
      referenceCount: providerRequestTemplate.input.bindings?.length ?? 0,
      ...(providerRequestTemplate.input.durationSeconds ? { durationSeconds: providerRequestTemplate.input.durationSeconds } : {}),
      ...(providerRequestTemplate.input.characterCount ? { characterCount: providerRequestTemplate.input.characterCount } : {}),
    });
    const frozen = await this.published.executionEvidence(offerId);
    if (frozen.providerId !== offer.providerId || frozen.providerModelId !== offer.providerModelId
      || frozen.releaseBundleId !== commercial.releaseBundleId || frozen.releaseBundleVersion !== commercial.releaseBundleVersion) {
      throw new GenerationV2Error("PUBLISHED_OFFER_STALE", 409, "The offer changed while its quote was being prepared. Reload the catalog.");
    }
    const unhashedEvidence = {
      ...frozen,
      dispatchSource: "PUBLISHED_OFFER" as const,
      publishedOfferId: offerId,
    };
    const executionEvidence = Object.freeze({
      ...unhashedEvidence,
      evidenceSha256: createHash("sha256").update(JSON.stringify(unhashedEvidence)).digest("hex"),
    });
    const customerCredits = this.safeCredits(commercial.customerCredits);
    const configuration = this.customerQuoteConfiguration(normalized);
    const durableQuoteId = randomUUID();
    const quote = {
      id: durableQuoteId, projectId: this.projectIdOf(normalized), recipeId, modelId: offer.providerModelId, provider: offer.providerId,
      offerId, customerCredits, requestHash: commercial.requestHash, createdAt: commercial.createdAt, expiresAt: commercial.expiresAt,
      configuration,
      providerEstimate: { unit: "provider_atomic", scale: 1, atomic: commercial.providerAtomicUnits.toString() },
      pricingPolicy: { quotedGrossMarginBps: Number(commercial.quotedGrossMarginBps), releaseBundleId: commercial.releaseBundleId, releaseBundleVersion: commercial.releaseBundleVersion },
      pinnedVersions: commercial.pins, durable: true, localOnly: false,
    };
    await this.durableRuntime.ensureLocalDevelopmentCredits(ownerId);
    await this.durableRuntime.issueLocalQuote({
      id: durableQuoteId, ownerId, requestHash: commercial.requestHash, customerCredits, expiresAt: commercial.expiresAt,
      metadata: {
        projectId: quote.projectId, recipeId, providerId: offer.providerId, providerRequestTemplate,
        pricingSnapshot: quote, executionEvidence,
      },
    });
    return this.customerQuoteView(quote);
  }

  async createOperation(rawInput: unknown, idempotencyKey: string | undefined, ownerId = "local-user") {
    const parsed = CreateGenerationOperationSchema.safeParse(rawInput);
    if (!parsed.success) throw new GenerationV2Error("INVALID_GENERATION_INTENT", 400, "GenerationIntent is invalid.");
    if (!idempotencyKey || idempotencyKey.trim().length < 8 || idempotencyKey.trim().length > 200) {
      throw new GenerationV2Error("IDEMPOTENCY_KEY_REQUIRED", 400, "A valid Idempotency-Key header is required.");
    }
    if (this.durableRuntime) {
      try {
        const operationId = await this.durableRuntime.enqueueFromQuoteMetadata({
          ownerId, quoteId: parsed.data.quoteId, requestHash: parsed.data.requestHash,
          generationIntentId: parsed.data.generationIntentId, idempotencyKey: idempotencyKey.trim(),
        });
        const operation = await this.durableRuntime.generationOperationView(operationId);
        const quote = await this.durableRuntime.quoteMetadata(operation.quoteId);
        if (!quote) throw new Error("durable_quote_metadata_not_found_or_mismatched");
        return this.customerEnvelope(quote.pricingSnapshot, operation);
      } catch (error) {
        throw this.durableError(error);
      }
    }

    const kind = this.quoteKinds.get(parsed.data.quoteId);
    if (!kind) throw new GenerationV2Error("QUOTE_NOT_FOUND", 404, "Quote not found.");
    const envelope = await this.service(kind).confirm(parsed.data.quoteId, {
      idempotencyKey: idempotencyKey.trim(), generationIntentId: parsed.data.generationIntentId, requestHash: parsed.data.requestHash,
    }) as OperationEnvelope;
    this.operationKinds.set(envelope.operation.id, kind);
    this.startExecution(kind, envelope.operation.id);
    return envelope;
  }

  async getOperation(operationId: string, ownerId = "local-user") {
    if (this.durableRuntime) {
      try {
        const operation = await this.durableRuntime.generationOperationView(operationId);
        if ((await this.durableRuntime.operation(operationId)).ownerId !== ownerId) throw new Error("durable_operation_not_found");
        const quote = await this.durableRuntime.quoteMetadata(operation.quoteId);
        if (!quote) throw new Error("durable_quote_metadata_not_found_or_mismatched");
        return this.customerEnvelope(quote.pricingSnapshot, operation);
      } catch (error) {
        throw this.durableError(error);
      }
    }
    const kind = this.operationKinds.get(operationId);
    if (!kind) throw new GenerationV2Error("OPERATION_NOT_FOUND", 404, "Operation not found.");
    return this.service(kind).recover(operationId);
  }

  async createAssetAccessGrant(assetId: string, rawInput: unknown, ownerId = "local-user") {
    if (!this.durableRuntime) throw new GenerationV2Error("ASSET_ACCESS_UNAVAILABLE", 404, "Asset access is unavailable.");
    if (!z.string().uuid().safeParse(assetId).success) throw new GenerationV2Error("ASSET_NOT_FOUND", 404, "Asset not found.");
    const parsed = AssetGrantRequestSchema.safeParse(rawInput ?? {});
    if (!parsed.success) throw new GenerationV2Error("INVALID_ASSET_GRANT", 400, "Asset grant request is invalid.");
    try {
      return await this.durableRuntime.issueAssetAccessGrant({ ownerId, assetId, ttlSeconds: parsed.data.ttlSeconds });
    } catch (error) {
      throw this.assetError(error);
    }
  }

  async readAsset(assetId: string, grantToken: string | undefined, ownerId = "local-user") {
    if (!this.durableRuntime) throw new GenerationV2Error("ASSET_ACCESS_UNAVAILABLE", 404, "Asset access is unavailable.");
    if (!z.string().uuid().safeParse(assetId).success || !grantToken?.trim()) {
      throw new GenerationV2Error("ASSET_ACCESS_DENIED", 403, "Asset access grant is required.");
    }
    try {
      return await this.durableRuntime.readAssetWithGrant({ ownerId, assetId, token: grantToken.trim() });
    } catch (error) {
      throw this.assetError(error);
    }
  }

  async waitForExecution(operationId: string): Promise<void> {
    await this.executions.get(operationId);
  }

  private providerRequestTemplate(kind: GenerationKind, rawInput: unknown, model: string): Omit<ProviderGenerationRequest, "operationId"> {
    if (kind === "IMAGE") {
      const request = ImageQuoteRequestSchema.parse(rawInput);
      return {
        model, mediaType: "image", scenario: "success",
        input: {
          quantity: 1, resolution: "720p", audio: false,
          ...(request.prompt.trim() ? { prompt: request.prompt } : {}),
          ...(typeof request.settings.aspectRatio === "string" ? { aspectRatio: request.settings.aspectRatio } : {}),
          ...(request.input ? { bindings: [{ assetId: request.input.assetId, role: "SOURCE" as const, ordinal: 0 }] } : {}),
        },
      };
    }
    if (kind === "VIDEO") {
      const request = VideoQuoteRequestSchema.parse(rawInput);
      return {
        model, mediaType: "video", scenario: "success",
        input: {
          prompt: request.prompt, quantity: 1, durationSeconds: request.settings.durationSeconds,
          resolution: request.settings.resolution, audio: request.settings.audio, aspectRatio: request.settings.aspectRatio,
          ...(request.bindings.length ? { bindings: request.bindings.map(({ assetId, slot, ordinal }) => ({ assetId, role: slot, ordinal })) } : {}),
        },
      };
    }
    const request = AdvancedQuoteRequestSchema.parse(rawInput);
    const isAudio = request.recipeId === "audio.tts";
    return {
      model, mediaType: isAudio ? "audio" : "video", scenario: "success",
      input: {
        quantity: 1,
        ...(request.prompt.trim() ? { prompt: request.prompt } : {}),
        ...(isAudio ? { characterCount: request.prompt.length, resolution: "720p" as const, audio: false } : {
          durationSeconds: Number(request.settings.durationSeconds), resolution: request.settings.resolution as "720p" | "1080p",
          audio: Boolean(request.settings.audio), ...(typeof request.settings.aspectRatio === "string" ? { aspectRatio: request.settings.aspectRatio } : {}),
        }),
        ...(typeof request.settings.voice === "string" ? { voice: request.settings.voice } : {}),
        ...(typeof request.settings.speed === "number" ? { speed: request.settings.speed } : {}),
        ...(request.bindings.length ? { bindings: request.bindings.map(({ assetId, role, ordinal }) => ({ assetId, role, ordinal })) } : {}),
      },
    };
  }

  /**
   * The browser may choose a recipe but never widens a released model's
   * capability.  This validation is deliberately server-side and uses only
   * the immutable, customer-safe capability projection derived from the
   * active Release Bundle.
   */
  private assertPublishedCapability(offer: CustomerPublishedOffer, request: Omit<ProviderGenerationRequest, "operationId">): void {
    const capability = offer.capability;
    const input = request.input;
    const reject = (message: string) => {
      throw new GenerationV2Error("PUBLISHED_OFFER_CAPABILITY_MISMATCH", 409, message);
    };
    if (capability.mediaType !== request.mediaType) reject("The published offer capability does not match this output type.");
    if (input.prompt?.trim() && !capability.inputModes.includes("text")) reject("The published offer does not accept text input.");
    if ((input.bindings?.length ?? 0) > capability.maxReferences) reject("The published offer does not accept this many reference assets.");
    if (input.bindings?.some((binding) => !capability.semanticSlots.includes(binding.role.toLowerCase()) && !capability.semanticSlots.includes(binding.role))) {
      reject("A bound asset role is not allowed by the published offer.");
    }
    if (!capability.resolutions.includes(input.resolution)) reject("The requested resolution is not published for this offer.");
    if (input.audio && !capability.supportsAudio) reject("The published offer does not support generated audio.");
    if (input.durationSeconds !== undefined) {
      const duration = capability.durationSeconds;
      if (!duration || input.durationSeconds < duration.min || input.durationSeconds > duration.max) reject("The requested duration is not published for this offer.");
    }
    if (input.characterCount !== undefined) {
      const characters = capability.characterCount;
      if (!characters || input.characterCount < characters.min || input.characterCount > characters.max) reject("The requested text length is not published for this offer.");
    }
  }

  /** Validates the released control profile before the legacy recipe parser
   * creates a provider request. This makes the published schema the authority
   * for allowed recipe IDs, fields, options, and binding roles. */
  private assertPublishedControlSchema(offer: CustomerPublishedOffer, request: Record<string, unknown>): void {
    const reject = (message: string) => {
      throw new GenerationV2Error("PUBLISHED_OFFER_CONTROL_SCHEMA_MISMATCH", 409, message);
    };
    const recipeId = typeof request.recipeId === "string" ? request.recipeId : "";
    const recipe = offer.capability.controlSchema.recipes.find((candidate) => candidate.recipeId === recipeId);
    if (!recipe) reject("This recipe is not published for the selected offer.");
    const prompt = request.prompt;
    if (typeof prompt !== "string" || prompt.length > recipe!.prompt.maxLength
      || (recipe!.prompt.required && !prompt.trim()) || (!recipe!.prompt.visible && prompt.trim())) {
      reject("The prompt does not match the published recipe contract.");
    }
    const rawBindings = Array.isArray(request.bindings)
      ? request.bindings
      : request.input && typeof request.input === "object" ? [{ ...(request.input as Record<string, unknown>), role: "SOURCE" }] : [];
    if (rawBindings.length < recipe!.bindings.min || rawBindings.length > recipe!.bindings.max) {
      reject("The number of bound assets is not published for this recipe.");
    }
    const roles = rawBindings.map((binding) => {
      if (!binding || typeof binding !== "object") reject("A bound asset is malformed.");
      const item = binding as Record<string, unknown>;
      const role = item.role ?? item.slot;
      if (typeof role !== "string" || !recipe!.bindings.roles.includes(role)) reject("A bound asset role is not published for this recipe.");
      const slot = recipe!.bindings.slots?.find((candidate) => candidate.role === role);
      if (!slot) {
        reject("A bound asset role has no typed published slot.");
        return role;
      }
      if (item.kind !== slot.kind || item.status !== "READY") reject("A bound asset does not match the published media type or readiness contract.");
      if (!Number.isSafeInteger(item.ordinal) || Number(item.ordinal) < 0) reject("A bound asset ordinal is invalid.");
      return role;
    });
    if (new Set(roles).size !== roles.length && recipe!.bindings.roles.length === recipe!.bindings.max) {
      reject("The published recipe does not allow duplicate binding roles.");
    }
    const settings = request.settings;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) reject("Recipe settings are invalid.");
    const values = settings as Record<string, unknown>;
    const controls = new Map(recipe!.controls.map((control) => [control.id, control]));
    if (Object.keys(values).some((key) => !controls.has(key)) || [...controls.keys()].some((key) => !(key in values))) {
      reject("A setting is missing or not published for this recipe.");
    }
    for (const [id, control] of controls) {
      const value = values[id];
      if (control.kind === "boolean" && typeof value !== "boolean") reject(`The ${id} setting must be boolean.`);
      if (control.kind === "number" && (typeof value !== "number" || !Number.isFinite(value)
        || control.min === undefined || control.max === undefined || value < control.min || value > control.max
        || (control.step !== undefined && (value - control.min) % control.step !== 0))) reject(`The ${id} setting is out of range.`);
      if (control.kind === "enum" && (!control.values || !control.values.some((candidate) => Object.is(candidate, value)))) {
        reject(`The ${id} setting is not a published option.`);
      }
    }
  }

  private offerId(rawInput: unknown): string | null {
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return null;
    const value = (rawInput as Record<string, unknown>).offerId;
    return typeof value === "string" && value.trim().length > 0 && value.length <= 200 ? value.trim() : null;
  }

  /** Reuses the strict recipe/binding validators while deliberately dropping
   * any browser model field.  The server re-injects the local validator model
   * only as a schema discriminator; the dispatched model always comes from
   * the active published offer. */
  private normalizedPublishedRequest(rawInput: unknown, kind: GenerationKind): Record<string, unknown> {
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
      throw new GenerationV2Error("INVALID_PUBLISHED_QUOTE", 400, "Published quote input is invalid.");
    }
    const { offerId: _offerId, modelId: _modelId, ...request } = rawInput as Record<string, unknown>;
    const recipeId = typeof request.recipeId === "string" ? request.recipeId : "";
    return {
      ...request,
      modelId: kind === "IMAGE" ? "local/test-image-v1"
        : kind === "VIDEO" ? "local/test-video-v1"
          : recipeId === "audio.tts" ? "local/test-audio-v1" : "local/test-video-v1",
    };
  }

  private projectIdOf(request: Record<string, unknown>): string {
    if (typeof request.projectId !== "string" || !request.projectId.trim() || request.projectId.length > 200) {
      throw new GenerationV2Error("INVALID_PUBLISHED_QUOTE", 400, "Project identity is invalid.");
    }
    return request.projectId.trim();
  }

  private safeCredits(value: bigint): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new GenerationV2Error("PUBLISHED_PRICE_INVALID", 409, "Published price is not a safe whole-credit amount.");
    }
    return parsed;
  }

  /** Creates the customer-visible record of what was quoted. It is assembled
   * after the published control contract is validated, and intentionally has
   * no provider cost, margin, route or private-asset identifiers. */
  private customerQuoteConfiguration(request: Record<string, unknown>): CustomerQuoteConfiguration {
    const rawSettings = request.settings;
    const settings = rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)
      ? Object.fromEntries(Object.entries(rawSettings).filter((entry): entry is [string, string | number | boolean] => customerSettingValue(entry[1])))
      : {};
    const rawBindings = Array.isArray(request.bindings)
      ? request.bindings
      : request.input && typeof request.input === "object" ? [{ ...(request.input as Record<string, unknown>), role: "SOURCE" }] : [];
    const bindingRoles = rawBindings.flatMap((binding) => {
      if (!binding || typeof binding !== "object") return [];
      const role = (binding as Record<string, unknown>).role ?? (binding as Record<string, unknown>).slot;
      return typeof role === "string" ? [role] : [];
    });
    return { recipeId: String(request.recipeId), settings, bindingCount: rawBindings.length, bindingRoles };
  }

  /** The durable metadata deliberately retains the full pricing evidence for
   * finance/audit. Customer endpoints receive only the price they will pay;
   * provider cost, margin, route pins and provider task identifiers never
   * cross this boundary for a published offer. */
  private customerQuoteView(quote: Record<string, unknown>): Record<string, unknown> {
    if (typeof quote.offerId !== "string") return quote;
    return {
      id: quote.id, projectId: quote.projectId, recipeId: quote.recipeId,
      modelId: quote.modelId, provider: quote.provider, offerId: quote.offerId,
      customerCredits: quote.customerCredits, requestHash: quote.requestHash,
      configuration: quote.configuration,
      createdAt: quote.createdAt, expiresAt: quote.expiresAt,
      durable: quote.durable, localOnly: quote.localOnly,
    };
  }

  private customerEnvelope(quote: Record<string, unknown>, operation: Record<string, unknown>) {
    const customerQuote = this.customerQuoteView(quote);
    if (typeof quote.offerId !== "string") return { quote: customerQuote, operation, localOnly: true, durable: true };
    const financials = operation.financials as Record<string, unknown> | undefined;
    return {
      quote: customerQuote,
      operation: {
        id: operation.id, quoteId: operation.quoteId, state: operation.state,
        stateVersion: operation.stateVersion, generationIntentId: operation.generationIntentId,
        financials: {
          customerQuotedCredits: financials?.customerQuotedCredits,
          customerChargedCredits: financials?.customerChargedCredits,
        },
        delivery: operation.delivery, events: operation.events,
        createdAt: operation.createdAt, updatedAt: operation.updatedAt,
        localOnly: false,
      },
      localOnly: false,
      durable: true,
    };
  }

  private durableError(error: unknown): GenerationV2Error {
    if (error instanceof PostgresAtomicError) {
      return new GenerationV2Error(error.code, error.code === "QUOTE_NOT_FOUND" ? 404 : 409, error.message);
    }
    const message = error instanceof Error ? error.message : "Durable operation could not be recovered.";
    if (message.includes("durable_quote_metadata_not_found_or_mismatched")) return new GenerationV2Error("QUOTE_NOT_FOUND", 404, "Quote not found.");
    if (message.includes("durable_operation_not_found") || message.includes("operation_not_found")) return new GenerationV2Error("OPERATION_NOT_FOUND", 404, "Operation not found.");
    return new GenerationV2Error("DURABLE_EXECUTION_UNAVAILABLE", 503, "Generation execution is temporarily unavailable; no new charge was made.");
  }

  private assetError(error: unknown): GenerationV2Error {
    const message = error instanceof Error ? error.message : "Asset access could not be verified.";
    if (message.includes("durable_asset_not_found_or_access_denied")) return new GenerationV2Error("ASSET_NOT_FOUND", 404, "Asset not found.");
    return new GenerationV2Error("ASSET_ACCESS_DENIED", 403, "Asset access grant is invalid or expired.");
  }

  private startExecution(kind: GenerationKind, operationId: string): void {
    if (this.executions.has(operationId)) return;
    const execution = Promise.resolve()
      .then(async () => { await this.service(kind).run(operationId); })
      .catch(() => { this.provider.markReconciliationRequired(operationId, "automatic_generation_execution_failed_with_protected_customer_hold"); })
      .finally(() => { this.executions.delete(operationId); });
    this.executions.set(operationId, execution);
  }

  private service(kind: GenerationKind): SpaceImageService | SpaceVideoService | SpaceAdvancedService {
    if (kind === "IMAGE") return this.image;
    if (kind === "VIDEO") return this.video;
    return this.advanced;
  }

  private recipeId(rawInput: unknown): string {
    if (!rawInput || typeof rawInput !== "object" || !("recipeId" in rawInput) || typeof rawInput.recipeId !== "string") {
      throw new GenerationV2Error("INVALID_RECIPE", 400, "A recipeId is required.");
    }
    return rawInput.recipeId;
  }

  private kindForRecipe(recipeId: string): GenerationKind {
    if (recipeId.startsWith("image.")) return "IMAGE";
    if (["audio.tts", "video.avatar", "video.motion-control", "video.edit", "video.extend"].includes(recipeId)) return "ADVANCED";
    if (recipeId.startsWith("video.")) return "VIDEO";
    throw new GenerationV2Error("UNSUPPORTED_RECIPE", 400, "Recipe is not supported.");
  }
}
