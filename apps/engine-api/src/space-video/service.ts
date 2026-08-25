import { createHash, randomUUID } from "node:crypto";
import type { LocalMockProviderService, MockOperationView, MockQuoteView } from "../local-provider/service.ts";
import { ConfirmVideoQuoteRequestSchema, VideoQuoteRequestSchema, type VideoQuoteRequest } from "./domain.ts";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

type StoredVideoQuote = {
  id: string;
  request: VideoQuoteRequest;
  requestHash: string;
  providerQuote: MockQuoteView;
};

type StoredVideoOperation = {
  quote: StoredVideoQuote;
  providerOperationId: string;
};

export class SpaceVideoError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) {
    super(message);
  }
}

export class SpaceVideoService {
  private readonly quotes = new Map<string, StoredVideoQuote>();
  private readonly operations = new Map<string, StoredVideoOperation>();

  constructor(
    private readonly provider: LocalMockProviderService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  createQuote(rawInput: unknown) {
    const parsed = VideoQuoteRequestSchema.safeParse(rawInput);
    if (!parsed.success) throw new SpaceVideoError("INVALID_VIDEO_RECIPE", 400, "Video recipe request is invalid.");

    const request = parsed.data;
    const providerQuote = this.provider.createQuote({
      userId: "local-user",
      modelId: request.modelId,
      quantity: 1,
      durationSeconds: request.settings.durationSeconds,
      resolution: request.settings.resolution,
      audio: request.settings.audio,
      prompt: request.prompt,
      aspectRatio: request.settings.aspectRatio,
      bindings: request.bindings.map(({ assetId, slot: role, ordinal }) => ({ assetId, role, ordinal })),
    });
    const quote: StoredVideoQuote = {
      id: randomUUID(),
      request,
      requestHash: hash(request),
      providerQuote,
    };
    this.quotes.set(quote.id, quote);
    return this.view(quote);
  }

  async confirm(quoteId: string, rawInput: unknown) {
    const parsed = ConfirmVideoQuoteRequestSchema.safeParse(rawInput);
    if (!parsed.success) throw new SpaceVideoError("INVALID_VIDEO_CONFIRMATION", 400, "Video quote confirmation is invalid.");
    const quote = this.quotes.get(quoteId);
    if (!quote) throw new SpaceVideoError("VIDEO_QUOTE_NOT_FOUND", 404, "Video quote not found.");
    if (new Date(quote.providerQuote.expiresAt).getTime() <= this.now().getTime()) {
      throw new SpaceVideoError("VIDEO_QUOTE_EXPIRED", 409, "Video quote expired.");
    }
    if (quote.requestHash !== parsed.data.requestHash) {
      throw new SpaceVideoError("STALE_VIDEO_QUOTE", 409, "The video recipe changed after this quote was created.");
    }

    const operation = await this.provider.createOperation({
      userId: "local-user",
      quoteId: quote.providerQuote.id,
      idempotencyKey: parsed.data.idempotencyKey,
      generationIntentId: parsed.data.generationIntentId,
      scenario: "success",
    });
    this.operations.set(operation.id, { quote, providerOperationId: operation.id });
    return {
      quote: this.view(quote),
      operation: this.operationView(operation),
      wallet: await this.provider.getBalances("local-user"),
      localOnly: true,
    };
  }

  async run(operationId: string) {
    const stored = this.operations.get(operationId);
    if (!stored) throw new SpaceVideoError("VIDEO_OPERATION_NOT_FOUND", 404, "Video operation not found.");

    const timeline = [this.operationView(this.provider.getOperation(stored.providerOperationId))];
    let current = timeline[0];
    for (let step = 0; step < 8 && !["SETTLED", "PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"].includes(current.state); step += 1) {
      current = this.operationView(await this.provider.advance(stored.providerOperationId));
      timeline.push(current);
    }
    if (!current || !["SETTLED", "PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"].includes(current.state)) {
      throw new SpaceVideoError("VIDEO_OPERATION_INCOMPLETE", 409, "Video operation did not reach a terminal state.");
    }
    return {
      quote: this.view(stored.quote),
      operation: current,
      timeline: timeline.map(({ state, updatedAt }) => ({ state, at: updatedAt })),
      wallet: await this.provider.getBalances("local-user"),
      localOnly: true,
    };
  }

  async recover(operationId: string) {
    const stored = this.operations.get(operationId);
    if (!stored) throw new SpaceVideoError("VIDEO_OPERATION_NOT_FOUND", 404, "Video operation not found.");
    return {
      quote: this.view(stored.quote),
      operation: this.operationView(this.provider.getOperationForRecovery(stored.providerOperationId)),
      wallet: await this.provider.getBalances("local-user"),
      localOnly: true,
    };
  }

  private view(quote: StoredVideoQuote) {
    return {
      id: quote.id,
      projectId: quote.request.projectId,
      recipeId: quote.request.recipeId,
      modelId: quote.request.modelId,
      requestHash: quote.requestHash,
      customerCredits: quote.providerQuote.customerCredits,
      providerEstimate: quote.providerQuote.providerEstimate,
      pricingPolicy: quote.providerQuote.pricingPolicy,
      pinnedVersions: quote.providerQuote.pinnedVersions,
      createdAt: quote.providerQuote.createdAt,
      expiresAt: quote.providerQuote.expiresAt,
      provider: quote.providerQuote.provider,
      localOnly: true,
    };
  }

  private operationView(operation: MockOperationView) {
    return {
      id: operation.id,
      quoteId: operation.quoteId,
      provider: operation.provider,
      modelId: operation.modelId,
      state: operation.state,
      stateVersion: operation.stateVersion,
      generationIntentId: operation.generationIntentId,
      financials: operation.financials,
      resultUrl: operation.resultUrl,
      assetChecksumSha256: operation.assetChecksumSha256,
      events: operation.events,
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt,
      localOnly: true,
    };
  }
}
