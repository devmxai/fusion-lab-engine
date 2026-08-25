import { createHash, randomUUID } from "node:crypto";
import type { ProviderGenerationRequest, ProviderTaskResponse } from "../../../../packages/contracts/src/provider.ts";
import { ProviderRegistry } from "../../../../packages/providers/src/registry.ts";
import {
  ProviderDefinitiveError,
  ProviderSubmissionUnknownError,
} from "../../../../packages/providers/src/types.ts";
import { InMemoryWholeCreditLedger } from "../../../../packages/ledger/src/ledger.ts";
import { LedgerDomainError } from "../../../../packages/ledger/src/types.ts";
import {
  createLocalTestRegistrySnapshot,
  DeterministicQuoteEngine,
  localFamilyVersionId,
  VersionedCommercialRegistry,
  type CommercialQuote,
} from "../../../../packages/commercial-engine/src/index.ts";
import {
  defaultLocalMediaPolicy,
  InMemoryPrivateObjectStore,
  LocalSignatureScanner,
  PrivateMediaPipeline,
  ProviderSourceUrlGuard,
} from "../../../../packages/media-pipeline/src/index.ts";
import {
  DurableExecutionError,
  InMemoryAtomicOperationStore,
  InMemoryAttemptStore,
  InMemoryInboxStore,
} from "../../../../packages/durable-execution/src/index.ts";
import {
  ExactEquivalenceRegistry,
  ProviderFundingBook,
  ProviderTreasury,
  ProviderTreasuryError,
} from "../../../../packages/provider-treasury/src/index.ts";
import {
  CreateMockOperationInputSchema,
  MockQuoteInputSchema,
  grossMarginBpsFromMarkup,
  providerCreditValueMicrousd,
  targetMarkupBps,
  type MockProvider,
  type MockQuoteInput,
  type MockScenario,
} from "./domain.ts";
import {
  InMemoryPromotionEngine,
  PromotionDomainError,
  localPromotionVersions,
  type PromotionReservation,
} from "../../../../packages/commerce/src/index.ts";
import {
  requireLegalTransition,
  type OperationState,
  type TransitionActor,
} from "../../../../packages/contracts/src/operation.ts";

type StoredQuote = {
  id: string;
  input: MockQuoteInput;
  provider: MockProvider;
  providerUnit: "provider_credit";
  providerScale: 1;
  providerAtomic: bigint;
  replacementCostMicrousd: bigint;
  baseCustomerCredits: bigint;
  customerCredits: bigint;
  promotionReservationId: string | null;
  targetMarkupBps: bigint;
  quotedGrossMarginBps: bigint;
  requestHash: string;
  createdAt: Date;
  expiresAt: Date;
  commercialQuote: CommercialQuote;
};

type Wallet = { available: bigint; held: bigint; spent: bigint };
type MockEvent = {
  sequence: number;
  state: OperationState | "RESERVED";
  version: number;
  evidence: string;
  at: string;
};
type StoredOperation = {
  id: string;
  userId: string;
  quote: StoredQuote;
  scenario: MockScenario;
  state: OperationState;
  stateVersion: number;
  generationIntentId: string;
  idempotencyKey: string;
  idempotencyHash: string;
  attemptId: string;
  unknownLookupCount: number;
  pollCount: number;
  providerTaskId: string | null;
  providerRequestHash: string;
  providerResponseHash: string | null;
  providerResultUrl: string | null;
  actualProviderAtomic: bigint | null;
  actualCostMicrousd: bigint | null;
  providerLossMicrousd: bigint;
  resultUrl: string | null;
  assetObjectId: string | null;
  assetChecksumSha256: string | null;
  events: MockEvent[];
  createdAt: Date;
  updatedAt: Date;
};

type OperationQueuePayload = {
  operationId: string;
  providerRequest: ProviderGenerationRequest;
};

export class LocalMockProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "LocalMockProviderError";
  }
}

type LocalMockProviderOptions = {
  providerRegistry: ProviderRegistry;
  now?: () => Date;
  id?: () => string;
  initialCustomerCredits?: bigint;
  markupBps?: bigint;
  promotionEngine?: InMemoryPromotionEngine;
  maxUnknownLookupsBeforeManualReview?: number;
  maxPollsBeforeManualReview?: number;
  routeDispatchGuard?: (
    providerId: string,
    modelId: MockQuoteInput["modelId"],
  ) => { allowed: boolean; reasonCode: string | null; versionId: string | null };
};

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function bigintToSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error("value_exceeds_safe_json_integer");
  }
  return Number(value);
}

export class LocalMockProviderService {
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly initialCustomerCredits: bigint;
  private readonly markupBps: bigint;
  private readonly providerRegistry: ProviderRegistry;
  private readonly commercialRegistry: VersionedCommercialRegistry;
  private readonly quoteEngine: DeterministicQuoteEngine;
  private readonly promotionEngine: InMemoryPromotionEngine;
  private readonly providerId = "provider-test";
  private readonly providerAccountId = "provider-test:local-account";
  private readonly maxUnknownLookupsBeforeManualReview: number;
  private readonly maxPollsBeforeManualReview: number;
  private readonly routeDispatchGuard: NonNullable<LocalMockProviderOptions["routeDispatchGuard"]>;
  private readonly quotes = new Map<string, StoredQuote>();
  private readonly operationIdByQuote = new Map<string, string>();
  private readonly initializedWallets = new Set<string>();
  private siteLedger: InMemoryWholeCreditLedger;
  private operationStore: InMemoryAtomicOperationStore<StoredOperation, OperationQueuePayload>;
  private attemptStore: InMemoryAttemptStore;
  private callbackInbox: InMemoryInboxStore<{ operationId: string; state: OperationState }>;
  private treasury: ProviderTreasury;
  private fundingBook: ProviderFundingBook;
  private equivalenceRegistry: ExactEquivalenceRegistry;
  private treasurySnapshotSequence = 0;
  private mediaStore: InMemoryPrivateObjectStore;
  private mediaPipeline: PrivateMediaPipeline;

  constructor(options: LocalMockProviderOptions) {
    this.providerRegistry = options.providerRegistry;
    this.providerRegistry.require(this.providerId);
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? randomUUID;
    this.initialCustomerCredits = options.initialCustomerCredits ?? 1_000n;
    this.markupBps = options.markupBps ?? targetMarkupBps;
    this.maxUnknownLookupsBeforeManualReview = options.maxUnknownLookupsBeforeManualReview ?? 3;
    this.maxPollsBeforeManualReview = options.maxPollsBeforeManualReview ?? 5;
    this.routeDispatchGuard = options.routeDispatchGuard ?? (() => ({ allowed: true, reasonCode: null, versionId: null }));
    this.siteLedger = new InMemoryWholeCreditLedger(this.now);
    this.operationStore = new InMemoryAtomicOperationStore();
    this.attemptStore = new InMemoryAttemptStore(this.now);
    this.callbackInbox = new InMemoryInboxStore();
    this.treasury = this.createTreasury();
    this.fundingBook = this.createFundingBook();
    this.equivalenceRegistry = new ExactEquivalenceRegistry();
    this.mediaStore = new InMemoryPrivateObjectStore(this.now, this.id);
    this.mediaPipeline = new PrivateMediaPipeline(
      this.mediaStore,
      new ProviderSourceUrlGuard(),
      new LocalSignatureScanner(),
      defaultLocalMediaPolicy,
    );
    if (this.markupBps < 0n || this.markupBps > 100_000n) {
      throw new Error("local_provider_markup_bps_out_of_range");
    }
    this.commercialRegistry = new VersionedCommercialRegistry();
    const snapshot = createLocalTestRegistrySnapshot({
      targetContributionMarginBps: grossMarginBpsFromMarkup(this.markupBps),
    });
    this.commercialRegistry.registerSnapshot(snapshot);
    this.commercialRegistry.activate(snapshot.id);
    this.quoteEngine = new DeterministicQuoteEngine(
      this.commercialRegistry,
      this.now,
      this.id,
    );
    this.promotionEngine = options.promotionEngine ?? new InMemoryPromotionEngine(localPromotionVersions, this.now);
  }

  async reset(): Promise<void> {
    this.quotes.clear();
    this.operationIdByQuote.clear();
    this.promotionEngine.reset();
    this.initializedWallets.clear();
    this.siteLedger = new InMemoryWholeCreditLedger(this.now);
    this.operationStore = new InMemoryAtomicOperationStore();
    this.attemptStore = new InMemoryAttemptStore(this.now);
    this.callbackInbox = new InMemoryInboxStore();
    this.treasury = this.createTreasury();
    this.fundingBook = this.createFundingBook();
    this.equivalenceRegistry = new ExactEquivalenceRegistry();
    this.treasurySnapshotSequence = 0;
    await this.providerRegistry.require(this.providerId).resetForDevelopment?.();
    this.mediaStore = new InMemoryPrivateObjectStore(this.now, this.id);
    this.mediaPipeline = new PrivateMediaPipeline(
      this.mediaStore,
      new ProviderSourceUrlGuard(),
      new LocalSignatureScanner(),
      defaultLocalMediaPolicy,
    );
  }

  async getCatalog() {
    const adapter = this.providerRegistry.require(this.providerId);
    const commercial = this.commercialRegistry.active();
    return {
      providers: this.providerRegistry.list(),
      models: await adapter.listModels(),
      registry: {
        snapshotId: commercial.id,
        version: commercial.version,
        families: commercial.families
          .filter(({ lifecycle }) => lifecycle === "PUBLISHED")
          .map(({ id, displayName, mediaType }) => ({ id, displayName, mediaType })),
        routes: commercial.routes
          .filter(({ lifecycle, killSwitch }) => lifecycle === "PUBLISHED" && !killSwitch.enabled)
          .map(({ id, familyVersionId, providerId, certification }) => ({
            id,
            familyVersionId,
            providerId,
            certificationScope: certification.scope,
          })),
      },
      localOnly: true,
    };
  }

  createQuote(rawInput: unknown) {
    const parsed = MockQuoteInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new LocalMockProviderError("INVALID_QUOTE_INPUT", 400, "Quote input is invalid.");
    }

    let commercialQuote: CommercialQuote;
    let product: string;
    try {
      const mediaType = this.mediaType(parsed.data.modelId);
      product = `${mediaType}.generate`;
      commercialQuote = this.quoteEngine.quote({
        projectId: `local-project:${parsed.data.userId}`,
        product,
        mode: "exact",
        familyVersionId: localFamilyVersionId(parsed.data.modelId),
        quantity: parsed.data.quantity,
        durationSeconds: parsed.data.durationSeconds,
        characterCount: parsed.data.characterCount,
        resolution: parsed.data.resolution,
        audio: parsed.data.audio,
        referenceCount: parsed.data.bindings.length,
      });
    } catch (error) {
      throw new LocalMockProviderError(
        "INVALID_QUOTE_INPUT",
        400,
        error instanceof Error ? error.message : "Invalid quote input",
      );
    }

    this.promotionEngine.releaseExpired();
    const baseCustomerCredits = commercialQuote.customerCredits;
    let promotion: PromotionReservation | null = null;
    if (parsed.data.promotionCode) {
      const snapshot = this.commercialRegistry.active();
      const price = snapshot.customerPriceVersions.find(({ id }) => id === commercialQuote.pins.customerPriceVersionId);
      if (!price) throw new LocalMockProviderError("INVALID_QUOTE_INPUT", 400, "Pinned customer price version is unavailable.");
      try {
        promotion = this.promotionEngine.reserve({
          quoteId: commercialQuote.id,
          quoteExpiresAt: commercialQuote.expiresAt,
          promotionCode: parsed.data.promotionCode,
          userId: parsed.data.userId,
          product,
          routeId: commercialQuote.pins.routeVersionId,
          cohort: "local-development",
          activeCampaignKeys: [],
          baseCustomerCredits: bigintToSafeNumber(baseCustomerCredits),
          conservativeCostMicrousd: commercialQuote.conservativeCostMicrousd.toString(),
          creditValueFloorMicrousd: price.creditValueFloorMicrousd.toString(),
          hardFloorMarginBps: bigintToSafeNumber(price.hardFloorMarginBps),
        });
      } catch (error) {
        if (error instanceof PromotionDomainError) {
          throw new LocalMockProviderError(error.code, 409, error.message);
        }
        throw error;
      }
      commercialQuote.customerCredits = BigInt(promotion.finalCustomerCredits);
      commercialQuote.discountCredits = BigInt(promotion.discountCredits);
      commercialQuote.requestHash = stableHash({
        baseRequestHash: commercialQuote.requestHash,
        promotionVersionId: promotion.campaignVersionId,
        promotionReservationId: promotion.id,
      });
      const effectiveValue = BigInt(promotion.finalCustomerCredits) * price.creditValueFloorMicrousd + BigInt(promotion.subsidyMicrousd);
      commercialQuote.quotedGrossMarginBps = effectiveValue > 0n
        ? ((effectiveValue - commercialQuote.conservativeCostMicrousd) * 10_000n) / effectiveValue
        : -10_000n;
    }

    const createdAt = new Date(commercialQuote.createdAt);
    const quote: StoredQuote = {
      id: commercialQuote.id,
      input: parsed.data,
      provider: "provider-test",
      providerUnit: "provider_credit",
      providerScale: 1,
      providerAtomic: commercialQuote.providerAtomicUnits,
      replacementCostMicrousd: commercialQuote.replacementCostMicrousd,
      baseCustomerCredits,
      customerCredits: commercialQuote.customerCredits,
      promotionReservationId: promotion?.id ?? null,
      targetMarkupBps: this.markupBps,
      quotedGrossMarginBps: commercialQuote.quotedGrossMarginBps,
      requestHash: commercialQuote.requestHash,
      createdAt,
      expiresAt: new Date(commercialQuote.expiresAt),
      commercialQuote,
    };
    this.quotes.set(quote.id, quote);
    this.ensureWallet(quote.input.userId);
    return this.quoteView(quote);
  }

  async createOperation(rawInput: unknown) {
    const parsed = CreateMockOperationInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new LocalMockProviderError("INVALID_OPERATION_INPUT", 400, "Operation input is invalid.");
    }

    const input = parsed.data;
    const generationIntentId = input.generationIntentId ?? input.idempotencyKey;
    const inputHash = stableHash({
      userId: input.userId,
      quoteId: input.quoteId,
      scenario: input.scenario,
    });

    const quote = this.quotes.get(input.quoteId);
    if (!quote || quote.input.userId !== input.userId) {
      throw new LocalMockProviderError("QUOTE_NOT_FOUND", 404, "Quote not found.");
    }
    const consumedOperationId = this.operationIdByQuote.get(quote.id);
    if (consumedOperationId) {
      const consumed = this.requireOperation(consumedOperationId);
      if (consumed.idempotencyHash !== inputHash) {
        throw new LocalMockProviderError(
          "QUOTE_ALREADY_CONSUMED",
          409,
          "The quote was already consumed by a different generation intent payload.",
        );
      }
      return this.operationView(consumed);
    }
    if (quote.expiresAt.getTime() <= this.now().getTime()) {
      if (quote.promotionReservationId) this.promotionEngine.release(quote.promotionReservationId, "QUOTE_EXPIRED");
      throw new LocalMockProviderError("QUOTE_EXPIRED", 409, "Quote expired.");
    }

    const createdAt = this.now();
    const operationId = this.id();
    this.ensureWallet(input.userId);
    const providerRequest = {
      operationId,
      model: quote.commercialQuote.internalRoute.providerModelId,
      mediaType: this.mediaType(quote.input.modelId),
      scenario: input.scenario,
      input: {
        quantity: quote.input.quantity,
        durationSeconds: quote.input.durationSeconds,
        characterCount: quote.input.characterCount,
        resolution: quote.input.resolution,
        audio: quote.input.audio,
        prompt: quote.input.prompt,
        aspectRatio: quote.input.aspectRatio,
        bindings: quote.input.bindings,
        voice: quote.input.voice,
        speed: quote.input.speed,
      },
    } as const;
    const operation: StoredOperation = {
      id: operationId,
      userId: input.userId,
      quote,
      scenario: input.scenario,
      state: "RESERVED",
      stateVersion: 0,
      generationIntentId,
      idempotencyKey: input.idempotencyKey,
      idempotencyHash: inputHash,
      attemptId: `attempt:${operationId}:1`,
      unknownLookupCount: 0,
      pollCount: 0,
      providerTaskId: null,
      providerRequestHash: stableHash(providerRequest),
      providerResponseHash: null,
      providerResultUrl: null,
      actualProviderAtomic: null,
      actualCostMicrousd: null,
      providerLossMicrousd: 0n,
      resultUrl: null,
      assetObjectId: null,
      assetChecksumSha256: null,
      events: [{
        sequence: 1,
        state: "RESERVED",
        version: 0,
        evidence: "customer_credit_hold_committed_before_dispatch",
        at: createdAt.toISOString(),
      }],
      createdAt,
      updatedAt: createdAt,
    };
    try {
      const committed = this.operationStore.commitCreate({
        operation,
        binding: {
          actorId: input.userId,
          route: "POST /v2/operations",
          key: generationIntentId,
          requestHash: inputHash,
        },
        outboxMessage: {
          eventId: `operation-queued:${operationId}`,
          aggregateId: operationId,
          aggregateVersion: 1,
          eventName: "operation.queued.v1",
          payload: { operationId, providerRequest },
          occurredAt: createdAt.toISOString(),
        },
        financialTransaction: (work) => this.siteLedger.transaction(work),
        reserve: () => {
          this.siteLedger.reserve({
            commandId: `operation-reserve:${operationId}`,
            reservationId: `reservation:${operationId}`,
            operationId,
            ownerId: input.userId,
            quotedCredits: quote.customerCredits,
          });
        },
      });
      if (quote.promotionReservationId) {
        this.promotionEngine.attach(quote.promotionReservationId, committed.operation.id);
      }
      this.operationIdByQuote.set(quote.id, committed.operation.id);
      return this.operationView(committed.operation);
    } catch (error) {
      if (error instanceof LedgerDomainError && error.code === "INSUFFICIENT_CREDITS") {
        throw new LocalMockProviderError("INSUFFICIENT_CREDITS", 409, "The local wallet has insufficient credits.");
      }
      if (error instanceof Error && "code" in error && error.code === "OPERATION_IDEMPOTENCY_CONFLICT") {
        throw new LocalMockProviderError(
          "IDEMPOTENCY_CONFLICT",
          409,
          "The idempotency key was already used with different input.",
        );
      }
      throw error;
    }
  }

  getOperation(operationId: string) {
    return this.operationView(this.requireOperation(operationId));
  }

  getOperationForRecovery(operationId: string) {
    const operation = this.requireOperation(operationId);
    if (operation.assetObjectId) {
      const accessToken = this.mediaPipeline.refreshAccessGrant(operation.assetObjectId, operation.userId, 15 * 60);
      operation.resultUrl = `/v1/dev/mock/assets/${operation.id}?token=${encodeURIComponent(accessToken)}`;
    }
    return this.operationView(operation);
  }

  markReconciliationRequired(operationId: string, evidence: string) {
    const operation = this.requireOperation(operationId);
    if (["PROVIDER_FAILED", "DELIVERY_FAILED", "SETTLED", "RECONCILIATION_REQUIRED"].includes(operation.state)) {
      return this.operationView(operation);
    }
    this.transition(operation, "RECONCILIATION_REQUIRED", evidence);
    return this.operationView(operation);
  }

  async advance(operationId: string) {
    const operation = this.requireOperation(operationId);
    if (["PROVIDER_FAILED", "DELIVERY_FAILED", "SETTLED", "RECONCILIATION_REQUIRED"].includes(operation.state)) {
      return this.operationView(operation);
    }
    const adapter = this.providerRegistry.require(this.providerId);

    if (operation.state === "RESERVED") {
      await this.dispatchQueuedOperation(operation);
    } else if (operation.state === "SUBMISSION_UNKNOWN") {
      const found = await adapter.lookupByIdempotency(operation.idempotencyKey);
      if (found) {
        operation.providerTaskId = found.taskId;
        operation.providerResponseHash = stableHash(found);
        this.attemptStore.resolveUnknown(operation.attemptId, found.taskId);
        this.treasury.recordCommitment({
          operationId: operation.id,
          providerAccountId: this.providerAccountId,
          state: "SUBMITTED",
          maximumExposureAtomic: operation.quote.providerAtomic,
        });
        this.transition(operation, "SUBMITTED", "provider_idempotency_lookup_matched_task");
      } else {
        operation.unknownLookupCount += 1;
        if (operation.unknownLookupCount >= this.maxUnknownLookupsBeforeManualReview) {
          this.attemptStore.markManualReview(operation.attemptId, "submission_unknown_lookup_budget_exhausted");
          this.treasury.recordCommitment({
            operationId: operation.id,
            providerAccountId: this.providerAccountId,
            state: "RECONCILIATION_UNCERTAINTY",
            maximumExposureAtomic: operation.quote.providerAtomic,
          });
          this.transition(operation, "RECONCILIATION_REQUIRED", "submission_unknown_requires_manual_review_protected_hold");
        }
      }
    } else if (operation.state === "SUBMITTED" || operation.state === "RUNNING") {
      operation.pollCount += 1;
      if (operation.pollCount > this.maxPollsBeforeManualReview) {
        this.attemptStore.markManualReview(operation.attemptId, "provider_poll_budget_exhausted");
        this.treasury.recordCommitment({
          operationId: operation.id,
          providerAccountId: this.providerAccountId,
          state: "RECONCILIATION_UNCERTAINTY",
          maximumExposureAtomic: operation.quote.providerAtomic,
        });
        this.transition(operation, "RECONCILIATION_REQUIRED", "provider_timeout_requires_manual_review_protected_hold");
        return this.operationView(operation);
      }
      if (!operation.providerTaskId) throw new Error("provider_task_id_missing");
      const task = await adapter.getTask(operation.providerTaskId);
      this.applyProviderTask(operation, task);
    } else if (operation.state === "PROVIDER_SUCCEEDED") {
      try {
        if (!operation.providerResultUrl) throw new Error("provider_result_url_missing");
        const sourceUrl = operation.providerResultUrl;
        const asset = await this.mediaPipeline.ingestProviderResult({
          sourceUrl,
          sourcePolicy: adapter.assetSourcePolicy,
          expectedMediaType: this.mediaType(operation.quote.input.modelId),
          ownerId: operation.userId,
          projectId: `local-project:${operation.userId}`,
          operationId: operation.id,
          fetchAsset: () => adapter.fetchAsset(sourceUrl),
        });
        operation.assetObjectId = asset.id;
        operation.assetChecksumSha256 = asset.checksumSha256;
        const accessToken = this.mediaPipeline.createAccessGrant(asset, operation.userId, 15 * 60);
        operation.resultUrl = `/v1/dev/mock/assets/${operation.id}?token=${encodeURIComponent(accessToken)}`;
        this.transition(operation, "ASSET_STORED", "provider_asset_ssrf_checked_scanned_privately_stored_and_hashed");
      } catch {
        this.releaseCustomerHold(operation, "PROVIDER_ASSET_INGEST_FAILED");
        operation.providerLossMicrousd = operation.actualCostMicrousd ?? 0n;
        this.transition(operation, "DELIVERY_FAILED", "provider_asset_ingest_failed");
      }
    } else if (operation.state === "ASSET_STORED") {
      this.transition(operation, "DELIVERED", "engine_asset_read_contract_ready");
    } else if (operation.state === "DELIVERED") {
      this.settleCustomerHold(operation);
      this.transition(operation, "SETTLED", "quote_bounded_customer_settlement");
    }

    return this.operationView(operation);
  }

  async getBalances(userId = "local-user") {
    const wallet = this.ensureWallet(userId);
    const provider = await this.providerRegistry.require(this.providerId).getBalance();
    return {
      userId,
      customerCredits: {
        available: bigintToSafeNumber(wallet.available),
        held: bigintToSafeNumber(wallet.held),
        spent: bigintToSafeNumber(wallet.spent),
        displayUnit: "whole_credit",
      },
      providerTreasury: {
        localProvider: {
          provider: provider.provider,
          nativeUnit: provider.unit,
          nativeScale: 1,
          availableAtomic: String(provider.available),
          heldAtomic: String(provider.held),
          spentAtomic: String(provider.spent),
        },
      },
    };
  }

  grantPurchasedCredits(input: {
    paymentEventId: string;
    ownerId: string;
    credits: bigint;
  }) {
    this.ensureWallet(input.ownerId);
    return this.siteLedger.grant({
      commandId: `payment-event:${input.paymentEventId}`,
      ownerId: input.ownerId,
      lotId: `payment-lot:${input.paymentEventId}`,
      credits: input.credits,
      source: "PURCHASED",
      reasonCode: "VERIFIED_PAYMENT_WEBHOOK",
    });
  }

  grantSubscriptionCredits(input: {
    paymentEventId: string;
    ownerId: string;
    credits: bigint;
    expiresAt: string;
  }) {
    this.ensureWallet(input.ownerId);
    return this.siteLedger.grant({
      commandId: `subscription-payment-event:${input.paymentEventId}`,
      ownerId: input.ownerId,
      lotId: `subscription-lot:${input.paymentEventId}`,
      credits: input.credits,
      source: "SUBSCRIPTION",
      expiresAt: input.expiresAt,
      reasonCode: "VERIFIED_SUBSCRIPTION_PAYMENT_WEBHOOK",
    });
  }

  expireSubscriptionLots(input: {
    subscriptionId: string;
    lotIds: readonly string[];
    evaluatedAt: string;
  }) {
    const lots = new Map(this.siteLedger.lotsSnapshot().map((lot) => [lot.id, lot]));
    const requested = input.lotIds.map((lotId) => {
      const lot = lots.get(lotId);
      if (!lot || lot.source !== "SUBSCRIPTION") {
        throw new LocalMockProviderError("INVALID_SUBSCRIPTION_LOT", 409, "Subscription expiry can target only known Subscription Lots.");
      }
      return lot;
    });
    const expirable = requested.filter((lot) => lot.expiresAt && lot.expiresAt <= input.evaluatedAt && lot.available > 0n);
    this.siteLedger.transaction(() => {
      for (const lot of expirable) {
        this.siteLedger.expire({
          commandId: `subscription-expiry:${input.subscriptionId}:${lot.id}`,
          lotId: lot.id,
          reasonCode: "SUBSCRIPTION_PERIOD_ENDED",
          evaluatedAt: input.evaluatedAt,
        });
      }
    });
    return { expiredLotIds: expirable.map(({ id }) => id) };
  }

  reverseCreditLot(input: {
    reversalEventId: string;
    lotId: string;
    reasonCode: string;
  }) {
    const before = this.siteLedger.lotsSnapshot().find(({ id }) => id === input.lotId);
    if (!before) throw new LocalMockProviderError("CREDIT_LOT_NOT_FOUND", 404, "Credit Lot was not found for reversal.");
    const result = this.siteLedger.withdrawAvailableFromLot({
      commandId: `payment-reversal:${input.reversalEventId}`,
      lotId: input.lotId,
      reasonCode: input.reasonCode,
    });
    return {
      withdrawnCredits: result.withdrawnCredits,
      lot: result.lot,
    };
  }

  commerceLedgerEvidence() {
    return {
      lots: this.siteLedger.lotsSnapshot(),
      journals: this.siteLedger.journalsSnapshot(),
    };
  }

  getAsset(operationId: string, accessToken: string) {
    const operation = this.requireOperation(operationId);
    if (!operation.assetObjectId) {
      throw new LocalMockProviderError("ASSET_NOT_READY", 409, "Local asset is not ready.");
    }
    try {
      const asset = this.mediaPipeline.readWithGrant(operation.assetObjectId, accessToken);
      return {
        bytes: asset.bytes,
        contentType: asset.object.contentType,
        checksumSha256: asset.object.checksumSha256,
      };
    } catch {
      throw new LocalMockProviderError("ASSET_ACCESS_DENIED", 403, "A valid short-lived private media grant is required.");
    }
  }

  getLedgerAudit() {
    return {
      journals: this.siteLedger.journalsSnapshot(),
      lots: this.siteLedger.lotsSnapshot(),
      reservations: this.siteLedger.reservationsSnapshot(),
      operations: this.operationStore.operationsSnapshot().map((operation) => this.operationView(operation)),
      outbox: this.operationStore.outboxSnapshot(),
      attempts: this.attemptStore.snapshot(),
      callbackInbox: this.callbackInbox.snapshot(),
    };
  }

  applyAdminFinancialAdjustment(change: Readonly<{
    id: string;
    payload: Record<string, unknown>;
    makerId: string;
    approverId: string | null;
    reasonCode: string;
  }>) {
    const ownerId = String(change.payload.ownerId ?? "");
    const direction = change.payload.direction;
    const credits = change.payload.credits;
    if (!ownerId || (direction !== "CREDIT" && direction !== "DEBIT") || !Number.isInteger(credits) || Number(credits) <= 0) {
      throw new LocalMockProviderError("INVALID_FINANCIAL_ADJUSTMENT", 400, "Financial adjustment payload is invalid.");
    }
    if (!change.approverId) throw new Error("approved_financial_adjustment_missing_approver");
    this.ensureWallet(ownerId);
    return this.siteLedger.adjust({
      commandId: `admin-adjustment:${change.id}`,
      ownerId,
      direction,
      credits: BigInt(Number(credits)),
      reasonCode: change.reasonCode,
      makerId: change.makerId,
      approverId: change.approverId,
      lotId: direction === "CREDIT" ? `admin-adjustment-lot:${change.id}` : undefined,
    });
  }

  getOrchestrationAudit() {
    return JSON.parse(JSON.stringify(
      this.getLedgerAudit(),
      (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value,
    )) as Record<string, unknown>;
  }

  async consumeProviderCallback(input: {
    operationId: string;
    deliveryId: string;
    task: ProviderTaskResponse;
  }) {
    const operation = this.requireOperation(input.operationId);
    if (operation.state !== "SUBMISSION_UNKNOWN" && (!operation.providerTaskId || operation.providerTaskId !== input.task.taskId)) {
      throw new LocalMockProviderError("CALLBACK_TASK_MISMATCH", 409, "Provider callback task does not match the operation.");
    }
    try {
      const consumed = await this.callbackInbox.consume({
        provider: this.providerId,
        deliveryId: input.deliveryId,
        payloadHash: stableHash(input.task),
      }, () => {
        if (operation.state === "SUBMISSION_UNKNOWN") {
          // A verified callback only recovers the provider task identity. It
          // never settles, releases, or trusts callback usage/result fields.
          operation.providerTaskId = input.task.taskId;
          operation.providerResponseHash = stableHash({ taskId: input.task.taskId, deliveryId: input.deliveryId });
          this.attemptStore.resolveUnknown(operation.attemptId, input.task.taskId);
          this.treasury.recordCommitment({ operationId: operation.id, providerAccountId: this.providerAccountId, state: "SUBMITTED", maximumExposureAtomic: operation.quote.providerAtomic });
          this.transition(operation, "SUBMITTED", "verified_callback_recovered_submission_unknown_task_identity");
          return { operationId: operation.id, state: operation.state };
        }
        if (["SETTLED", "PROVIDER_FAILED", "DELIVERY_FAILED"].includes(operation.state)) {
          return { operationId: operation.id, state: operation.state };
        }
        if (!["SUBMITTED", "RUNNING"].includes(operation.state)) {
          throw new LocalMockProviderError(
            "CALLBACK_OUT_OF_ORDER",
            409,
            "Provider callback is not legal for the current operation state.",
          );
        }
        this.applyProviderTask(operation, input.task);
        return { operationId: operation.id, state: operation.state };
      }, this.now);
      return { delivery: consumed.kind, operation: this.operationView(operation) };
    } catch (error) {
      if (error instanceof DurableExecutionError && error.code === "INBOX_DELIVERY_CONFLICT") {
        throw new LocalMockProviderError("CALLBACK_REPLAY_CONFLICT", 409, "Delivery ID was replayed with different content.");
      }
      throw error;
    }
  }

  getReconciliationReport() {
    const operations = this.operationStore.operationsSnapshot();
    const reservations = this.siteLedger.reservationsSnapshot();
    const issues: Array<{ operationId: string; code: string }> = [];
    for (const operation of operations) {
      const reservation = reservations.find((candidate) => candidate.operationId === operation.id);
      if (!reservation) {
        issues.push({ operationId: operation.id, code: "RESERVATION_MISSING" });
        continue;
      }
      if (operation.state === "SETTLED" && (
        reservation.state !== "SETTLED"
        || operation.actualProviderAtomic === null
        || !operation.assetObjectId
      )) {
        issues.push({ operationId: operation.id, code: "SETTLEMENT_EVIDENCE_MISMATCH" });
      } else if (["PROVIDER_FAILED", "DELIVERY_FAILED"].includes(operation.state) && reservation.state !== "RELEASED") {
        issues.push({ operationId: operation.id, code: "RELEASE_MISMATCH" });
      } else if (![
        "SETTLED",
        "PROVIDER_FAILED",
        "DELIVERY_FAILED",
      ].includes(operation.state) && reservation.state !== "HELD") {
        issues.push({ operationId: operation.id, code: "ACTIVE_HOLD_MISMATCH" });
      }
    }
    const reconciled = operations.length - issues.length;
    return {
      totalOperations: operations.length,
      reconciledOperations: reconciled,
      reconciliationRateBps: operations.length === 0 ? 10_000 : Math.floor((reconciled * 10_000) / operations.length),
      targetBps: 9_900,
      targetMet: operations.length === 0 || reconciled * 10_000 >= operations.length * 9_900,
      issues,
      localOnly: true,
    };
  }

  async getTreasuryDashboard() {
    await this.syncTreasuryBalance();
    return JSON.parse(JSON.stringify({
      treasury: this.treasury.dashboard(this.providerAccountId),
      fundingLots: this.fundingBook.lotsSnapshot(this.providerAccountId),
      actualCosts: this.fundingBook.actualCostsSnapshot(),
      exactEquivalenceGroups: this.equivalenceRegistry.snapshot(),
      crossProviderExactEnabled: this.equivalenceRegistry.snapshot().length > 0,
      localOnly: true,
    }, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value)) as Record<string, unknown>;
  }

  private async dispatchQueuedOperation(operation: StoredOperation): Promise<void> {
    const workerId = `local-worker:${operation.id}`;
    const lease = this.operationStore.claimQueued(workerId, operation.id);
    if (!lease) return;
    this.transition(operation, "QUEUED", "outbox_relay_lease_acquired");
    this.attemptStore.create({
      id: operation.attemptId,
      operationId: operation.id,
      evidenceCode: "operation_queue_message_delivered",
    });
    this.attemptStore.claim(operation.attemptId, workerId);
    this.transition(operation, "DISPATCHING", "attempt_worker_lease_acquired_before_provider_call");
    const adapter = this.providerRegistry.require(this.providerId);
    const routeGate = this.routeDispatchGuard(this.providerId, operation.quote.input.modelId);
    if (!routeGate.allowed) {
      this.attemptStore.markFailed(operation.attemptId, `admin_route_kill_switch:${routeGate.reasonCode ?? "unspecified"}`);
      this.releaseCustomerHold(operation, "ADMIN_ROUTE_KILL_SWITCH");
      this.transition(operation, "PROVIDER_FAILED", `admin_route_kill_switch:${routeGate.versionId ?? "unknown_version"}`);
      this.operationStore.acknowledgeQueued(lease.eventId, workerId);
      return;
    }
    try {
      await this.syncTreasuryBalance();
      this.treasury.authorizeDispatch(this.providerAccountId, operation.quote.providerAtomic);
    } catch (error) {
      if (!(error instanceof ProviderTreasuryError)) throw error;
      this.attemptStore.markFailed(operation.attemptId, `treasury_gate:${error.code}`);
      this.releaseCustomerHold(operation, `TREASURY_${error.code}`);
      this.transition(operation, "PROVIDER_FAILED", `treasury_dispatch_blocked:${error.code}`);
      this.operationStore.acknowledgeQueued(lease.eventId, workerId);
      return;
    }
    try {
      const submitted = await adapter.submit(lease.payload.providerRequest, operation.idempotencyKey);
      operation.providerTaskId = submitted.taskId;
      operation.providerResponseHash = stableHash(submitted);
      this.attemptStore.markSubmitted(operation.attemptId, workerId, submitted.taskId);
      this.treasury.recordCommitment({
        operationId: operation.id,
        providerAccountId: this.providerAccountId,
        state: "SUBMITTED",
        maximumExposureAtomic: operation.quote.providerAtomic,
      });
      const evidence = BigInt(submitted.estimatedProviderCredits) === operation.quote.providerAtomic
        ? "provider_http_202_task_accepted"
        : "provider_http_202_with_estimate_variance";
      this.transition(operation, "SUBMITTED", evidence);
      this.operationStore.acknowledgeQueued(lease.eventId, workerId);
    } catch (error) {
      if (error instanceof ProviderSubmissionUnknownError) {
        this.attemptStore.markSubmissionUnknown(operation.attemptId, workerId);
        this.treasury.recordCommitment({
          operationId: operation.id,
          providerAccountId: this.providerAccountId,
          state: "SUBMISSION_UNKNOWN",
          maximumExposureAtomic: operation.quote.providerAtomic,
        });
        this.transition(operation, "SUBMISSION_UNKNOWN", "provider_transport_outcome_unknown");
        this.operationStore.acknowledgeQueued(lease.eventId, workerId);
        return;
      }
      if (error instanceof ProviderDefinitiveError) {
        this.attemptStore.markFailed(operation.attemptId, `provider_rejected:${error.code}`);
        this.closeTreasuryCommitment(operation);
        this.releaseCustomerHold(operation, "PROVIDER_SUBMIT_DEFINITIVELY_REJECTED");
        this.transition(operation, "PROVIDER_FAILED", "provider_submit_definitively_rejected");
        this.operationStore.acknowledgeQueued(lease.eventId, workerId);
        return;
      }
      this.attemptStore.markSubmissionUnknown(operation.attemptId, workerId);
      this.treasury.recordCommitment({
        operationId: operation.id,
        providerAccountId: this.providerAccountId,
        state: "SUBMISSION_UNKNOWN",
        maximumExposureAtomic: operation.quote.providerAtomic,
      });
      this.transition(operation, "SUBMISSION_UNKNOWN", "unclassified_transport_outcome_protected_hold");
      this.operationStore.acknowledgeQueued(lease.eventId, workerId);
    }
  }

  private applyProviderTask(operation: StoredOperation, task: ProviderTaskResponse): void {
    operation.providerResponseHash = stableHash(task);
    if (task.status === "submitted" || task.status === "running") {
      this.attemptStore.markRunning(operation.attemptId);
      this.treasury.recordCommitment({
        operationId: operation.id,
        providerAccountId: this.providerAccountId,
        state: "RUNNING",
        maximumExposureAtomic: operation.quote.providerAtomic,
      });
      this.transition(operation, "RUNNING", "canonical_provider_task_running");
      return;
    }
    if (task.status === "failed") {
      if (task.chargeStatus !== "CONFIRMED_NO_CHARGE") {
        if (task.chargeStatus === "ACTUAL" && task.actualProviderCredits !== null) {
          operation.actualProviderAtomic = BigInt(task.actualProviderCredits);
          operation.actualCostMicrousd = operation.actualProviderAtomic * providerCreditValueMicrousd;
          operation.providerLossMicrousd = operation.actualCostMicrousd;
        }
        this.attemptStore.markManualReview(operation.attemptId, "provider_failure_charge_not_proven_zero");
        this.treasury.recordCommitment({
          operationId: operation.id,
          providerAccountId: this.providerAccountId,
          state: "RECONCILIATION_UNCERTAINTY",
          maximumExposureAtomic: operation.actualProviderAtomic ?? operation.quote.providerAtomic,
        });
        this.transition(operation, "RECONCILIATION_REQUIRED", "provider_failure_cost_requires_reconciliation_protected_hold");
        return;
      }
      this.attemptStore.markFailed(operation.attemptId, `provider_terminal_failure:${task.errorCode || "unknown"}`);
      this.closeTreasuryCommitment(operation);
      this.releaseCustomerHold(operation, "PROVIDER_TERMINAL_FAILURE_NO_CHARGE");
      this.transition(operation, "PROVIDER_FAILED", `canonical_provider_failure:${task.errorCode || "unknown"}`);
      return;
    }
    if (task.actualProviderCredits === null || !task.resultUrl) {
      throw new Error("provider_success_contract_incomplete");
    }
    operation.actualProviderAtomic = BigInt(task.actualProviderCredits);
    operation.actualCostMicrousd = operation.actualProviderAtomic * providerCreditValueMicrousd;
    operation.providerResultUrl = task.resultUrl;
    this.fundingBook.recordActualCost({
      usageId: `provider-usage:${operation.id}`,
      operationId: operation.id,
      providerAccountId: this.providerAccountId,
      source: "creditsConsumed",
      sourceEvidenceHash: stableHash(task),
      usageNativeAtomic: operation.actualProviderAtomic,
    });
    this.treasury.recordActualSpend({
      id: `provider-spend:${operation.id}`,
      providerAccountId: this.providerAccountId,
      actualAtomic: operation.actualProviderAtomic,
      occurredAt: this.now().toISOString(),
    });
    this.closeTreasuryCommitment(operation);
    this.attemptStore.markSucceeded(operation.attemptId);
    this.transition(operation, "PROVIDER_SUCCEEDED", "canonical_provider_success_received");
  }

  private mediaType(modelId: MockQuoteInput["modelId"]): "image" | "video" | "audio" {
    if (modelId.includes("video")) return "video";
    if (modelId.includes("audio")) return "audio";
    return "image";
  }

  private createTreasury(): ProviderTreasury {
    return new ProviderTreasury(new Map([[
      this.providerAccountId,
      {
        safetyReserveAtomic: 100n,
        largestAllowedJobAtomic: 120n,
        fundingLeadTimeDays: 2,
        spendLimits: { perJobAtomic: 200n, dailyAtomic: 5_000n, monthlyAtomic: 100_000n },
      },
    ]]), this.now);
  }

  private createFundingBook(): ProviderFundingBook {
    const book = new ProviderFundingBook(this.now);
    book.addLot({
      id: "local-provider-opening-funding-lot",
      providerAccountId: this.providerAccountId,
      nativeReceivedAtomic: 1_000n,
      cashPaidMicrousd: 10_000_000n,
      nativeFaceValueMicrousdPerAtomic: 10_000n,
      fundedAt: "2026-01-01T00:00:00.000Z",
      sourceEvidenceHash: stableHash({ source: "LOCAL_PROVIDER_OPENING_FUNDING", native: "1000", cashMicrousd: "10000000" }),
    });
    return book;
  }

  private async syncTreasuryBalance(): Promise<void> {
    const balance = await this.providerRegistry.require(this.providerId).getBalance();
    this.treasurySnapshotSequence += 1;
    this.treasury.recordBalanceSnapshot({
      id: `local-balance-snapshot:${this.treasurySnapshotSequence}`,
      providerAccountId: this.providerAccountId,
      confirmedRemainingAtomic: BigInt(balance.available + balance.held),
      capturedAt: this.now().toISOString(),
      sourceEvidenceHash: stableHash(balance),
    });
  }

  private closeTreasuryCommitment(operation: StoredOperation): void {
    this.treasury.recordCommitment({
      operationId: operation.id,
      providerAccountId: this.providerAccountId,
      state: "TERMINAL",
      maximumExposureAtomic: operation.actualProviderAtomic ?? operation.quote.providerAtomic,
    });
  }

  private ensureWallet(userId: string): Wallet {
    if (!this.initializedWallets.has(userId)) {
      const walletKey = createHash("sha256").update(userId).digest("hex");
      this.siteLedger.grant({
        commandId: `opening-grant:${walletKey}`,
        ownerId: userId,
        lotId: `opening-lot:${walletKey}`,
        credits: this.initialCustomerCredits,
        source: "LEGACY_OPENING",
        reasonCode: "LOCAL_DEVELOPMENT_OPENING_BALANCE",
      });
      this.initializedWallets.add(userId);
    }
    const projection = this.siteLedger.wallet(userId);
    const spent = this.siteLedger.lotsSnapshot(userId)
      .reduce((total, lot) => total + lot.consumed, 0n);
    return { available: projection.available, held: projection.held, spent };
  }

  private requireOperation(operationId: string): StoredOperation {
    try {
      return this.operationStore.require(operationId);
    } catch {
      throw new LocalMockProviderError("OPERATION_NOT_FOUND", 404, "Operation not found.");
    }
  }

  private transition(operation: StoredOperation, state: OperationState, evidence: string): void {
    if (operation.state === state) return;
    const authority = this.transitionAuthority(operation.state, state);
    const next = requireLegalTransition({
      currentState: operation.state,
      currentVersion: operation.stateVersion,
      expectedState: operation.state,
      expectedVersion: operation.stateVersion,
      event: authority.event,
      actor: authority.actor,
      hasEvidence: evidence.trim().length > 0,
    });
    operation.state = next.state;
    operation.stateVersion = next.version;
    operation.updatedAt = this.now();
    operation.events.push({
      sequence: operation.events.length + 1,
      state: next.state,
      version: next.version,
      evidence,
      at: operation.updatedAt.toISOString(),
    });
  }

  private transitionAuthority(from: OperationState, to: OperationState): { event: string; actor: TransitionActor } {
    if (to === "RECONCILIATION_REQUIRED") {
      return { event: "operation.reconciliation_required.v1", actor: "reconciler" };
    }
    const transitions: Record<string, readonly [string, TransitionActor]> = {
      "RESERVED->QUEUED": ["operation.queued.v1", "outbox-relay"],
      "QUEUED->DISPATCHING": ["attempt.dispatching.v1", "worker"],
      "DISPATCHING->SUBMITTED": ["provider.submitted.v1", "provider-adapter"],
      "DISPATCHING->SUBMISSION_UNKNOWN": ["provider.submission_unknown.v1", "provider-adapter"],
      "DISPATCHING->PROVIDER_FAILED": ["attempt.dispatch_rejected.v1", "worker"],
      "SUBMISSION_UNKNOWN->SUBMITTED": ["provider.submitted.v1", "reconciler"],
      "SUBMITTED->RUNNING": ["provider.running.v1", "provider-poller"],
      "SUBMITTED->PROVIDER_SUCCEEDED": ["provider.succeeded.v1", "provider-poller"],
      "RUNNING->PROVIDER_SUCCEEDED": ["provider.succeeded.v1", "provider-poller"],
      "SUBMITTED->PROVIDER_FAILED": ["provider.failed.v1", "provider-poller"],
      "RUNNING->PROVIDER_FAILED": ["provider.failed.v1", "provider-poller"],
      "PROVIDER_SUCCEEDED->ASSET_STORED": ["asset.stored.v1", "media-worker"],
      "PROVIDER_SUCCEEDED->DELIVERY_FAILED": ["asset.delivery_failed.v1", "media-worker"],
      "ASSET_STORED->DELIVERED": ["operation.delivered.v1", "delivery-worker"],
      "DELIVERED->SETTLED": ["ledger.settled.v1", "finance-worker"],
    };
    const transition = transitions[`${from}->${to}`];
    if (!transition) throw new Error(`unsupported_runtime_transition:${from}->${to}`);
    return { event: transition[0], actor: transition[1] };
  }

  private releaseCustomerHold(operation: StoredOperation, reasonCode: string): void {
    this.siteLedger.release({
      commandId: `operation-release:${operation.id}`,
      reservationId: `reservation:${operation.id}`,
      reasonCode,
      evidenceHash: stableHash({ operationId: operation.id, reasonCode, providerResponseHash: operation.providerResponseHash }),
    });
    if (operation.quote.promotionReservationId) {
      this.promotionEngine.release(operation.quote.promotionReservationId, reasonCode);
    }
  }

  private settleCustomerHold(operation: StoredOperation): void {
    this.siteLedger.settle({
      commandId: `operation-settle:${operation.id}`,
      reservationId: `reservation:${operation.id}`,
      captureCredits: operation.quote.customerCredits,
      reasonCode: "VERIFIED_ASSET_DELIVERY",
    });
    if (operation.quote.promotionReservationId) {
      this.promotionEngine.redeem(operation.quote.promotionReservationId, operation.id);
    }
  }

  private quoteView(quote: StoredQuote) {
    const promotion = quote.promotionReservationId
      ? this.promotionEngine.reservation(quote.promotionReservationId)
      : null;
    return {
      id: quote.id,
      userId: quote.input.userId,
      modelId: quote.input.modelId,
      provider: this.providerId,
      input: quote.input,
      baseCustomerCredits: bigintToSafeNumber(quote.baseCustomerCredits),
      discountCredits: bigintToSafeNumber(quote.baseCustomerCredits - quote.customerCredits),
      customerCredits: bigintToSafeNumber(quote.customerCredits),
      promotion: promotion ? {
        reservationId: promotion.id,
        campaignVersionId: promotion.campaignVersionId,
        code: promotion.promotionCode,
        status: promotion.status,
        subsidyMicrousd: promotion.subsidyMicrousd,
        attribution: promotion.attribution,
      } : null,
      providerEstimate: {
        unit: quote.providerUnit,
        scale: quote.providerScale,
        atomic: quote.providerAtomic.toString(),
      },
      replacementCostMicrousd: quote.replacementCostMicrousd.toString(),
      pricingPolicy: {
        providerToSiteCreditRatio: "1:1",
        markupBps: bigintToSafeNumber(quote.targetMarkupBps),
        quotedGrossMarginBps: bigintToSafeNumber(quote.quotedGrossMarginBps),
        quotedGrossProfitCredits: bigintToSafeNumber(quote.customerCredits - quote.providerAtomic),
      },
      pinnedVersions: {
        registrySnapshotId: quote.commercialQuote.registrySnapshotId,
        ...quote.commercialQuote.pins,
      },
      requestHash: quote.requestHash,
      createdAt: quote.createdAt.toISOString(),
      expiresAt: quote.expiresAt.toISOString(),
      localOnly: true,
    };
  }

  private operationView(operation: StoredOperation) {
    const customerCharged = operation.state === "SETTLED" ? operation.quote.customerCredits : 0n;
    const providerCharged = operation.actualProviderAtomic ?? 0n;
    const isTerminal = ["SETTLED", "PROVIDER_FAILED", "DELIVERY_FAILED"].includes(operation.state);
    const realizedGrossProfit = customerCharged - providerCharged;
    const realizedGrossMargin = customerCharged > 0n
      ? (realizedGrossProfit * 10_000n) / customerCharged
      : null;
    return {
      id: operation.id,
      userId: operation.userId,
      quoteId: operation.quote.id,
      provider: this.providerId,
      providerTaskId: operation.providerTaskId,
      attemptId: operation.attemptId,
      attempts: this.attemptStore.forOperation(operation.id),
      providerRequestHash: operation.providerRequestHash,
      providerResponseHash: operation.providerResponseHash,
      modelId: operation.quote.input.modelId,
      scenario: operation.scenario,
      state: operation.state,
      stateVersion: operation.stateVersion,
      generationIntentId: operation.generationIntentId,
      customerCredits: bigintToSafeNumber(operation.quote.customerCredits),
      promotion: operation.quote.promotionReservationId
        ? this.promotionEngine.reservation(operation.quote.promotionReservationId)
        : null,
      actualProviderAtomic: operation.actualProviderAtomic?.toString() ?? null,
      actualCostMicrousd: operation.actualCostMicrousd?.toString() ?? null,
      providerLossMicrousd: operation.providerLossMicrousd.toString(),
      financials: {
        customerQuotedCredits: bigintToSafeNumber(operation.quote.customerCredits),
        customerChargedCredits: bigintToSafeNumber(customerCharged),
        providerEstimatedCredits: bigintToSafeNumber(operation.quote.providerAtomic),
        providerChargedCredits: bigintToSafeNumber(providerCharged),
        quotedGrossProfitCredits: bigintToSafeNumber(operation.quote.customerCredits - operation.quote.providerAtomic),
        quotedMarkupBps: bigintToSafeNumber(operation.quote.targetMarkupBps),
        quotedGrossMarginBps: bigintToSafeNumber(operation.quote.quotedGrossMarginBps),
        realizedGrossProfitCredits: isTerminal ? bigintToSafeNumber(realizedGrossProfit) : null,
        realizedGrossMarginBps: isTerminal && realizedGrossMargin !== null
          ? bigintToSafeNumber(realizedGrossMargin)
          : null,
      },
      resultUrl: operation.resultUrl,
      assetChecksumSha256: operation.assetChecksumSha256,
      events: operation.events,
      createdAt: operation.createdAt.toISOString(),
      updatedAt: operation.updatedAt.toISOString(),
      localOnly: true,
    };
  }
}

export type MockQuoteView = ReturnType<LocalMockProviderService["createQuote"]>;
export type MockOperationView = Awaited<ReturnType<LocalMockProviderService["createOperation"]>>;
