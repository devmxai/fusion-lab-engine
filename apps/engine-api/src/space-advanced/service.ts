import { createHash, randomUUID } from "node:crypto";
import type { LocalMockProviderService, MockOperationView, MockQuoteView } from "../local-provider/service.ts";
import { AdvancedQuoteRequestSchema, ConfirmAdvancedQuoteRequestSchema, type AdvancedQuoteRequest } from "./domain.ts";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

type StoredAdvancedQuote = { id: string; request: AdvancedQuoteRequest; requestHash: string; providerQuote: MockQuoteView };
type StoredAdvancedOperation = { quote: StoredAdvancedQuote; providerOperationId: string };

export class SpaceAdvancedError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) { super(message); }
}

export class SpaceAdvancedService {
  private readonly quotes = new Map<string, StoredAdvancedQuote>();
  private readonly operations = new Map<string, StoredAdvancedOperation>();

  constructor(private readonly provider: LocalMockProviderService, private readonly now: () => Date = () => new Date()) {}

  createQuote(rawInput: unknown) {
    const parsed = AdvancedQuoteRequestSchema.safeParse(rawInput);
    if (!parsed.success) throw new SpaceAdvancedError("INVALID_ADVANCED_RECIPE", 400, "Advanced recipe request is invalid.");
    const request = parsed.data;
    const isAudio = request.recipeId === "audio.tts";
    const providerQuote = this.provider.createQuote({
      userId: "local-user",
      modelId: request.modelId,
      quantity: 1,
      characterCount: isAudio ? request.prompt.length : undefined,
      durationSeconds: isAudio ? undefined : Number(request.settings.durationSeconds),
      resolution: isAudio ? "720p" : request.settings.resolution as "720p" | "1080p",
      audio: isAudio ? false : Boolean(request.settings.audio),
      prompt: request.prompt || undefined,
      aspectRatio: typeof request.settings.aspectRatio === "string" ? request.settings.aspectRatio : undefined,
      voice: typeof request.settings.voice === "string" ? request.settings.voice : undefined,
      speed: typeof request.settings.speed === "number" ? request.settings.speed : undefined,
      bindings: request.bindings.map(({ assetId, role, ordinal }) => ({ assetId, role, ordinal })),
    });
    const quote: StoredAdvancedQuote = { id: randomUUID(), request, requestHash: hash(request), providerQuote };
    this.quotes.set(quote.id, quote);
    return this.view(quote);
  }

  async confirm(quoteId: string, rawInput: unknown) {
    const parsed = ConfirmAdvancedQuoteRequestSchema.safeParse(rawInput);
    if (!parsed.success) throw new SpaceAdvancedError("INVALID_ADVANCED_CONFIRMATION", 400, "Advanced quote confirmation is invalid.");
    const quote = this.quotes.get(quoteId);
    if (!quote) throw new SpaceAdvancedError("ADVANCED_QUOTE_NOT_FOUND", 404, "Advanced quote not found.");
    if (new Date(quote.providerQuote.expiresAt).getTime() <= this.now().getTime()) throw new SpaceAdvancedError("ADVANCED_QUOTE_EXPIRED", 409, "Advanced quote expired.");
    if (quote.requestHash !== parsed.data.requestHash) throw new SpaceAdvancedError("STALE_ADVANCED_QUOTE", 409, "The recipe changed after this quote was created.");
    const operation = await this.provider.createOperation({ userId: "local-user", quoteId: quote.providerQuote.id, idempotencyKey: parsed.data.idempotencyKey, generationIntentId: parsed.data.generationIntentId, scenario: "success" });
    this.operations.set(operation.id, { quote, providerOperationId: operation.id });
    return { quote: this.view(quote), operation: this.operationView(operation), wallet: await this.provider.getBalances("local-user"), localOnly: true };
  }

  async run(operationId: string) {
    const stored = this.operations.get(operationId);
    if (!stored) throw new SpaceAdvancedError("ADVANCED_OPERATION_NOT_FOUND", 404, "Advanced operation not found.");
    const timeline = [this.operationView(this.provider.getOperation(stored.providerOperationId))];
    let current = timeline[0];
    for (let step = 0; step < 8 && !["SETTLED", "PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"].includes(current.state); step += 1) {
      current = this.operationView(await this.provider.advance(stored.providerOperationId));
      timeline.push(current);
    }
    if (!current || !["SETTLED", "PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"].includes(current.state)) {
      throw new SpaceAdvancedError("ADVANCED_OPERATION_INCOMPLETE", 409, "Advanced operation did not reach a terminal state.");
    }
    return { quote: this.view(stored.quote), operation: current, timeline: timeline.map(({ state, updatedAt }) => ({ state, at: updatedAt })), wallet: await this.provider.getBalances("local-user"), localOnly: true };
  }

  async recover(operationId: string) {
    const stored = this.operations.get(operationId);
    if (!stored) throw new SpaceAdvancedError("ADVANCED_OPERATION_NOT_FOUND", 404, "Advanced operation not found.");
    return { quote: this.view(stored.quote), operation: this.operationView(this.provider.getOperationForRecovery(stored.providerOperationId)), wallet: await this.provider.getBalances("local-user"), localOnly: true };
  }

  private view(quote: StoredAdvancedQuote) {
    return {
      id: quote.id,
      projectId: quote.request.projectId,
      recipeId: quote.request.recipeId,
      outputKind: quote.request.recipeId === "audio.tts" ? "AUDIO" : "VIDEO",
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
      id: operation.id, quoteId: operation.quoteId, provider: operation.provider, modelId: operation.modelId,
      state: operation.state, stateVersion: operation.stateVersion, generationIntentId: operation.generationIntentId,
      financials: operation.financials, resultUrl: operation.resultUrl,
      assetChecksumSha256: operation.assetChecksumSha256, events: operation.events,
      createdAt: operation.createdAt, updatedAt: operation.updatedAt, localOnly: true,
    };
  }
}
