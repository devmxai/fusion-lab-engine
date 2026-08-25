import { createHash, randomUUID } from "node:crypto";
import type {
  CommerceInvoice,
  CommerceReconciliationIssue,
  CommerceReconciliationReport,
  CommerceProductSnapshot,
  CommerceWebhookEvent,
  FinancialReversal,
  PaymentAdapter,
  PaymentEvent,
  PaymentReversalEvent,
  PaymentCheckout,
  PlanVersion,
  Subscription,
  SubscriptionPeriod,
  StoredCommerceEvent,
  StoredPaymentEvent,
  StoredReversalEvent,
} from "../../../../packages/commerce/src/types.ts";
import { parseVerifiedPaymentWebhook, PaymentWebhookError } from "../../../../packages/commerce/src/payment-webhook.ts";
import { InMemoryPlanRegistry } from "../../../../packages/commerce/src/plan-registry.ts";
import { InMemoryPromotionEngine, PromotionDomainError } from "../../../../packages/commerce/src/promotion-engine.ts";
import { localPromotionVersions } from "../../../../packages/commerce/src/local-promotion-fixture.ts";
import { CreateCheckoutInputSchema, localCommerceProducts, localPlanVersions } from "./domain.ts";

type MutableCheckout = Omit<PaymentCheckout, "state" | "paymentEventId" | "updatedAt"> & {
  state: PaymentCheckout["state"];
  paymentEventId: string | null;
  updatedAt: string;
};

type ProcessedDelivery = { rawBodySha256: string; eventId: string };
type MutableSubscription = Omit<Subscription, "state" | "currentPeriodStart" | "currentPeriodEnd" | "updatedAt"> & {
  state: Subscription["state"];
  currentPeriodStart: string;
  currentPeriodEnd: string;
  updatedAt: string;
};
type MutableInvoice = Omit<CommerceInvoice, "status" | "updatedAt"> & { status: CommerceInvoice["status"]; updatedAt: string };

export interface CommerceCreditGateway {
  grantPurchasedCredits(input: { paymentEventId: string; ownerId: string; credits: bigint }): { lot: { id: string } };
  grantSubscriptionCredits(input: { paymentEventId: string; ownerId: string; credits: bigint; expiresAt: string }): { lot: { id: string } };
  expireSubscriptionLots(input: { subscriptionId: string; lotIds: readonly string[]; evaluatedAt: string }): { expiredLotIds: string[] };
  reverseCreditLot(input: { reversalEventId: string; lotId: string; reasonCode: string }): {
    withdrawnCredits: bigint;
    lot: { granted: bigint; available: bigint; held: bigint; consumed: bigint; expired: bigint; withdrawn: bigint };
  };
  commerceLedgerEvidence(): {
    lots: readonly Readonly<{
      id: string;
      ownerId: string;
      source: string;
      granted: bigint;
      available: bigint;
      held: bigint;
      consumed: bigint;
      expired: bigint;
      withdrawn: bigint;
    }>[];
    journals: readonly Readonly<{
      commandId: string;
      kind: string;
      entries: readonly Readonly<{ accountId: string; amount: bigint }>[];
    }>[];
  };
}

export class LocalCommerceError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) {
    super(message);
    this.name = "LocalCommerceError";
  }
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function rawHash(rawBody: Uint8Array): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

function isReversalEvent(event: CommerceWebhookEvent): event is PaymentReversalEvent {
  return event.type === "PAYMENT_REFUNDED" || event.type === "PAYMENT_CHARGEBACK";
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function addRational(
  left: { numerator: bigint; denominator: bigint },
  right: { numerator: bigint; denominator: bigint },
) {
  const numerator = left.numerator * right.denominator + right.numerator * left.denominator;
  const denominator = left.denominator * right.denominator;
  const divisor = gcd(numerator, denominator) || 1n;
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

export class LocalCommerceService {
  private readonly products = new Map(localCommerceProducts.map((product) => [product.id, product]));
  private readonly checkouts = new Map<string, MutableCheckout>();
  private readonly checkoutCommands = new Map<string, { requestHash: string; checkoutId: string }>();
  private readonly deliveries = new Map<string, ProcessedDelivery>();
  private readonly events = new Map<string, StoredCommerceEvent>();
  private readonly invoices = new Map<string, MutableInvoice>();
  private readonly reversals = new Map<string, FinancialReversal>();
  private readonly planRegistry = new InMemoryPlanRegistry();
  private readonly subscriptions = new Map<string, MutableSubscription>();
  private readonly periods = new Map<string, SubscriptionPeriod[]>();
  private readonly promotionEngine: InMemoryPromotionEngine;

  constructor(private readonly options: {
    paymentAdapter: PaymentAdapter;
    webhookSecret: string;
    creditGateway: CommerceCreditGateway;
    now?: () => Date;
    id?: () => string;
    promotionEngine?: InMemoryPromotionEngine;
  }) {
    for (const plan of localPlanVersions) this.planRegistry.register(plan);
    this.promotionEngine = options.promotionEngine ?? new InMemoryPromotionEngine(localPromotionVersions, options.now);
  }

  catalog() {
    return {
      provider: this.options.paymentAdapter.id,
      sandboxOnly: true,
      products: [...this.products.values()],
      plans: this.planRegistry.list(),
    };
  }

  /**
   * Redacted aggregate used only by the server-authorized Admin read model.
   * It intentionally contains no checkout URL, payment provider identifiers,
   * user identity, webhook body, signature or billing address.
   */
  adminReadModel() {
    const catalog = this.catalog();
    const reconciliation = this.reconciliation();
    const countByState = <T extends { state: string }>(values: Iterable<T>) => Object.fromEntries(
      [...values].reduce((counts, value) => counts.set(value.state, (counts.get(value.state) ?? 0) + 1), new Map<string, number>()),
    );
    return {
      sandboxOnly: true,
      paymentProvider: catalog.provider,
      products: catalog.products.map((product) => ({
        id: product.id, version: product.version, kind: product.kind, displayName: product.displayName,
        grantedCredits: product.grantedCredits, amountMinor: product.amountMinor, currency: product.currency, planVersionId: product.planVersionId,
      })),
      plans: catalog.plans.map((plan) => ({
        id: plan.id, planKey: plan.planKey, version: plan.version, lifecycle: plan.lifecycle, displayName: plan.displayName,
        amountMinor: plan.price.amountMinor, currency: plan.price.currency, interval: plan.price.interval,
        creditsPerPeriod: plan.creditsPerPeriod, termsVersion: plan.termsVersion,
      })),
      activity: {
        checkoutsByState: countByState(this.checkouts.values()),
        subscriptionsByState: countByState(this.subscriptions.values()),
        invoicesByState: countByState([...this.invoices.values()].map((invoice) => ({ state: invoice.status }))),
        reversalsByKind: Object.fromEntries([...this.reversals.values()].reduce((counts, reversal) => counts.set(reversal.kind, (counts.get(reversal.kind) ?? 0) + 1), new Map<string, number>())),
      },
      reconciliation: {
        issueCount: reconciliation.issues.length,
        targetMet: reconciliation.targetMet,
        localImplementationDecision: reconciliation.localImplementationDecision,
        formalGateDecision: reconciliation.formalGateDecision,
      },
    };
  }

  async createCheckout(rawInput: unknown): Promise<PaymentCheckout> {
    const parsed = CreateCheckoutInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new LocalCommerceError("INVALID_CHECKOUT_REQUEST", 400, "Checkout request is invalid.");
    const input = parsed.data;
    const commandKey = `${input.userId}:${input.idempotencyKey}`;
    const requestHash = stableHash({ userId: input.userId, productId: input.productId });
    const existingCommand = this.checkoutCommands.get(commandKey);
    if (existingCommand) {
      if (existingCommand.requestHash !== requestHash) throw new LocalCommerceError("CHECKOUT_IDEMPOTENCY_CONFLICT", 409, "Checkout idempotency key was reused with a different request.");
      return this.requireCheckout(existingCommand.checkoutId);
    }
    const product = this.products.get(input.productId);
    if (!product) throw new LocalCommerceError("COMMERCE_PRODUCT_NOT_FOUND", 404, "Commerce product is not published in the local sandbox catalog.");

    const checkoutId = (this.options.id ?? randomUUID)();
    const createdAt = (this.options.now ?? (() => new Date()))().toISOString();
    const successUrl = `/v1/dev/commerce/checkouts/${checkoutId}/success`;
    const cancelUrl = `/v1/dev/commerce/checkouts/${checkoutId}/cancel`;
    const providerSession = await this.options.paymentAdapter.createCheckout({
      checkoutId,
      userId: input.userId,
      product,
      successUrl,
      cancelUrl,
      idempotencyKey: input.idempotencyKey,
    });
    const checkout: MutableCheckout = {
      id: checkoutId,
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      product: { ...product },
      provider: providerSession.provider,
      providerSessionId: providerSession.providerSessionId,
      checkoutUrl: providerSession.checkoutUrl,
      successUrl,
      cancelUrl,
      state: "CREATED",
      paymentEventId: null,
      createdAt,
      updatedAt: createdAt,
    };
    this.checkouts.set(checkout.id, checkout);
    this.checkoutCommands.set(commandKey, { requestHash, checkoutId });
    return checkout;
  }

  success(checkoutId: string) {
    const checkout = this.requireCheckout(checkoutId);
    return {
      checkoutId: checkout.id,
      state: checkout.state,
      creditGrantState: checkout.state === "PAID" ? "GRANTED_BY_VERIFIED_WEBHOOK" : "AWAITING_VERIFIED_WEBHOOK",
      mutationPerformed: false,
      message: "This success URL is read-only and never grants credits.",
    };
  }

  processWebhook(input: { rawBody: Uint8Array; deliveryId: string; timestamp: string; signature: string }) {
    if (!input.deliveryId || input.deliveryId.length > 200) throw new LocalCommerceError("MISSING_PAYMENT_DELIVERY_ID", 400, "Payment delivery id is required.");
    const now = this.options.now ?? (() => new Date());
    let event;
    try {
      event = parseVerifiedPaymentWebhook({
        rawBody: input.rawBody,
        timestamp: input.timestamp,
        signature: input.signature,
        secret: this.options.webhookSecret,
        nowEpochSeconds: Math.floor(now().getTime() / 1000),
      });
    } catch (error) {
      if (error instanceof PaymentWebhookError) throw new LocalCommerceError(error.code, 401, error.message);
      throw error;
    }

    const bodyHash = rawHash(input.rawBody);
    const priorDelivery = this.deliveries.get(input.deliveryId);
    if (priorDelivery) {
      if (priorDelivery.rawBodySha256 !== bodyHash) throw new LocalCommerceError("PAYMENT_DELIVERY_CONFLICT", 409, "Payment delivery id was reused with different raw bytes.");
      return { accepted: true, replay: true, duplicateEvent: true, event: this.requireEvent(priorDelivery.eventId) };
    }
    const priorEvent = this.events.get(event.eventId);
    if (priorEvent) {
      if (priorEvent.rawBodySha256 !== bodyHash) throw new LocalCommerceError("PAYMENT_EVENT_CONFLICT", 409, "Payment event id was reused with a different payload.");
      this.deliveries.set(input.deliveryId, { rawBodySha256: bodyHash, eventId: event.eventId });
      return { accepted: true, replay: false, duplicateEvent: true, event: priorEvent };
    }

    if (BigInt(event.money.feeMinor) > BigInt(event.money.amountMinor)) {
      throw new LocalCommerceError("PAYMENT_FEE_INVALID", 409, "Payment fee cannot exceed the original amount.");
    }
    const processedAt = now().toISOString();
    const storedEvent = isReversalEvent(event)
      ? this.applyPaymentReversal(event, input.deliveryId, bodyHash, processedAt)
      : this.applyPaidEvent(event, input.deliveryId, bodyHash, processedAt);
    this.events.set(event.eventId, storedEvent);
    this.deliveries.set(input.deliveryId, { rawBodySha256: bodyHash, eventId: event.eventId });
    return { accepted: true, replay: false, duplicateEvent: false, event: storedEvent };
  }

  paymentEvent(eventId: string) {
    return this.requireEvent(eventId);
  }

  invoice(invoiceId: string): CommerceInvoice {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new LocalCommerceError("INVOICE_NOT_FOUND", 404, "Commerce invoice was not found.");
    return structuredClone(invoice);
  }

  userInvoices(ownerId: string): readonly CommerceInvoice[] {
    return [...this.invoices.values()].filter((invoice) => invoice.ownerId === ownerId).map((invoice) => structuredClone(invoice));
  }

  financialReversal(reversalId: string): FinancialReversal {
    const reversal = this.reversals.get(reversalId);
    if (!reversal) throw new LocalCommerceError("FINANCIAL_REVERSAL_NOT_FOUND", 404, "Financial reversal was not found.");
    return structuredClone(reversal);
  }

  promotionCatalog() {
    this.promotionEngine.releaseExpired();
    return {
      campaigns: this.promotionEngine.list().map((campaign) => ({
        id: campaign.id,
        campaignKey: campaign.campaignKey,
        version: campaign.version,
        code: campaign.code,
        lifecycle: campaign.lifecycle,
        discountCredits: campaign.discountCredits,
        window: campaign.window,
        eligibility: campaign.eligibility,
        stacking: campaign.stacking,
        attribution: campaign.attribution,
        killSwitch: campaign.killSwitch,
      })),
      budgets: this.promotionEngine.budgetsSnapshot(),
      sandboxOnly: true,
    };
  }

  promotionBudget(campaignVersionId: string) {
    try { return this.promotionEngine.budget(campaignVersionId); }
    catch (error) {
      if (error instanceof PromotionDomainError) throw new LocalCommerceError(error.code, 404, error.message);
      throw error;
    }
  }

  promotionReservation(reservationId: string) {
    try { return this.promotionEngine.reservation(reservationId); }
    catch (error) {
      if (error instanceof PromotionDomainError) throw new LocalCommerceError(error.code, 404, error.message);
      throw error;
    }
  }

  promotionSubsidyEntries(campaignVersionId?: string) {
    return this.promotionEngine.subsidyEntriesSnapshot(campaignVersionId);
  }

  reconciliation(): CommerceReconciliationReport {
    const evaluatedAt = (this.options.now ?? (() => new Date()))().toISOString();
    const paidEvents = [...this.events.values()].filter((event): event is StoredPaymentEvent => "creditLotId" in event);
    const reversalEvents = [...this.events.values()].filter((event): event is StoredReversalEvent => "reversalId" in event);
    const ledger = this.options.creditGateway.commerceLedgerEvidence();
    const lots = new Map(ledger.lots.map((lot) => [lot.id, lot]));
    const journals = new Map(ledger.journals.map((journal) => [journal.commandId, journal]));
    const issues: CommerceReconciliationIssue[] = [...this.promotionEngine.reconciliationIssues()];

    for (const stored of paidEvents) {
      const invoice = this.invoices.get(stored.invoiceId);
      if (!invoice || invoice.paymentEventId !== stored.event.eventId || invoice.ownerId !== stored.ownerId) {
        issues.push({ code: "PAYMENT_INVOICE_MISMATCH", entityId: stored.event.eventId, detail: "Paid event is missing its exact Invoice snapshot." });
      }
      const lot = lots.get(stored.creditLotId);
      const expectedSource = invoice?.planVersionId ? "SUBSCRIPTION" : "PURCHASED";
      if (!lot || lot.ownerId !== stored.ownerId || lot.source !== expectedSource || lot.granted !== BigInt(stored.grantedCredits)) {
        issues.push({ code: "PAYMENT_CREDIT_LOT_MISMATCH", entityId: stored.event.eventId, detail: "Paid event does not match its exact Credit Lot grant." });
      }
      const grantCommand = expectedSource === "SUBSCRIPTION"
        ? `subscription-payment-event:${stored.event.eventId}`
        : `payment-event:${stored.event.eventId}`;
      if (journals.get(grantCommand)?.kind !== "GRANT") {
        issues.push({ code: "PAYMENT_GRANT_JOURNAL_MISSING", entityId: stored.event.eventId, detail: "Paid event is missing its balanced grant Journal." });
      }
    }

    for (const invoice of this.invoices.values()) {
      const event = this.events.get(invoice.paymentEventId);
      if (!event || !("creditLotId" in event) || event.invoiceId !== invoice.id) {
        issues.push({ code: "INVOICE_PAYMENT_EVENT_MISMATCH", entityId: invoice.id, detail: "Invoice does not map back to one paid event." });
      }
    }

    for (const stored of reversalEvents) {
      const reversal = this.reversals.get(stored.reversalId);
      const original = this.events.get(stored.event.originalPaymentEventId);
      const invoice = original && "creditLotId" in original ? this.invoices.get(original.invoiceId) : undefined;
      const expectedStatus = stored.event.type === "PAYMENT_CHARGEBACK" ? "CHARGEBACK" : "REFUNDED";
      if (!reversal || reversal.eventId !== stored.event.eventId || reversal.originalPaymentEventId !== stored.event.originalPaymentEventId) {
        issues.push({ code: "REVERSAL_RECORD_MISMATCH", entityId: stored.event.eventId, detail: "Reversal event is missing its exact financial record." });
      }
      if (!invoice || invoice.status !== expectedStatus) {
        issues.push({ code: "REVERSAL_INVOICE_STATUS_MISMATCH", entityId: stored.event.eventId, detail: "Reversal did not move its Invoice to the matching terminal status." });
      }
      if (reversal && reversal.withdrawnCredits + reversal.unrecoveredCredits !== (original && "creditLotId" in original ? original.grantedCredits : -1)) {
        issues.push({ code: "REVERSAL_CREDIT_CONSERVATION_MISMATCH", entityId: stored.event.eventId, detail: "Withdrawn and unrecovered Credits do not equal the original grant." });
      }
      if (reversal && reversal.withdrawnCredits > 0 && journals.get(`payment-reversal:${stored.event.eventId}`)?.kind !== "WITHDRAW_LOT") {
        issues.push({ code: "REVERSAL_JOURNAL_MISSING", entityId: stored.event.eventId, detail: "Financial reversal is missing its exact-Lot withdrawal Journal." });
      }
    }

    const paidNetEconomicValue = [...this.invoices.values()].reduce((total, invoice) => total + BigInt(invoice.netEconomicValueMicrousd), 0n);
    const reversedNetEconomicValue = [...this.invoices.values()]
      .filter(({ status }) => status !== "PAID")
      .reduce((total, invoice) => total + BigInt(invoice.netEconomicValueMicrousd), 0n);
    const openReceivable = [...this.reversals.values()]
      .filter(({ receivableState }) => receivableState === "OPEN")
      .reduce((total, reversal) => addRational(total, {
        numerator: BigInt(reversal.unrecoveredEconomicValue.numeratorMicrousd),
        denominator: BigInt(reversal.unrecoveredEconomicValue.denominatorCredits),
      }), { numerator: 0n, denominator: 1n });
    const promotionRedeemedMicrousd = this.promotionEngine.budgetsSnapshot()
      .reduce((total, budget) => total + BigInt(budget.redeemedMicrousd), 0n);
    const commerceLots = ledger.lots.filter(({ id }) => id.startsWith("payment-lot:") || id.startsWith("subscription-lot:"));
    const commerceJournals = ledger.journals.filter(({ commandId }) =>
      commandId.startsWith("payment-event:")
      || commandId.startsWith("subscription-payment-event:")
      || commandId.startsWith("payment-reversal:"));
    const totalChecks = Math.max(1, paidEvents.length * 4 + reversalEvents.length * 4 + this.invoices.size + this.promotionEngine.list().length);
    const reconciledChecks = Math.max(0, totalChecks - issues.length);
    const targetBps = 10_000;
    const reconciliationRateBps = Math.floor((reconciledChecks * 10_000) / totalChecks);
    return {
      evaluatedAt,
      counts: {
        paidEvents: paidEvents.length,
        reversalEvents: reversalEvents.length,
        invoices: this.invoices.size,
        financialReversals: this.reversals.size,
        commerceCreditLots: commerceLots.length,
        commerceLedgerJournals: commerceJournals.length,
        promotionCampaigns: this.promotionEngine.list().length,
        promotionSubsidyEntries: this.promotionEngine.subsidyEntriesSnapshot().length,
      },
      financials: {
        paidNetEconomicValueMicrousd: paidNetEconomicValue.toString(),
        reversedNetEconomicValueMicrousd: reversedNetEconomicValue.toString(),
        openReceivableEconomicValue: {
          numeratorMicrousd: openReceivable.numerator.toString(),
          denominatorBasis: openReceivable.denominator.toString(),
        },
        promotionRedeemedMicrousd: promotionRedeemedMicrousd.toString(),
      },
      issues,
      reconciliationRateBps,
      targetBps,
      targetMet: issues.length === 0 && reconciliationRateBps === targetBps,
      localImplementationDecision: issues.length === 0 ? "PASS" : "HOLD",
      formalGateDecision: "HOLD",
      formalBlockers: [
        "LEGAL_GATE_NOT_APPROVED",
        "FORMAL_GATE_3_NOT_PASSED",
        "FORMAL_GATE_8_NOT_PASSED",
        "PRODUCTION_PAYMENT_PROVIDER_NOT_SELECTED",
        "TAX_AND_ACCOUNTING_POLICY_NOT_APPROVED",
      ],
      localOnly: true,
    };
  }

  plans(): readonly PlanVersion[] {
    return this.planRegistry.list();
  }

  userSubscriptions(userId: string) {
    return [...this.subscriptions.values()]
      .filter((subscription) => subscription.userId === userId)
      .map((subscription) => ({ ...subscription, periods: [...(this.periods.get(subscription.id) ?? [])] }));
  }

  subscription(subscriptionId: string) {
    const subscription = this.requireSubscription(subscriptionId);
    return { ...subscription, plan: this.planRegistry.require(subscription.planVersionId), periods: [...(this.periods.get(subscription.id) ?? [])] };
  }

  expireSubscription(subscriptionId: string) {
    const subscription = this.requireSubscription(subscriptionId);
    const evaluatedAt = (this.options.now ?? (() => new Date()))().toISOString();
    if (evaluatedAt < subscription.currentPeriodEnd) {
      throw new LocalCommerceError("SUBSCRIPTION_NOT_EXPIRABLE", 409, "Subscription period has not ended.");
    }
    if (subscription.state === "EXPIRED") return { ...this.subscription(subscriptionId), expiredLotIds: [], mutationPerformed: false };
    const periods = this.periods.get(subscription.id) ?? [];
    const expired = this.options.creditGateway.expireSubscriptionLots({
      subscriptionId,
      lotIds: periods.map(({ creditLotId }) => creditLotId),
      evaluatedAt,
    });
    subscription.state = "EXPIRED";
    subscription.updatedAt = evaluatedAt;
    return { ...this.subscription(subscriptionId), expiredLotIds: expired.expiredLotIds, mutationPerformed: true };
  }

  reset() {
    this.checkouts.clear();
    this.checkoutCommands.clear();
    this.deliveries.clear();
    this.events.clear();
    this.invoices.clear();
    this.reversals.clear();
    this.subscriptions.clear();
    this.periods.clear();
    this.promotionEngine.reset();
  }

  private applyPaidEvent(
    event: PaymentEvent,
    deliveryId: string,
    rawBodySha256: string,
    processedAt: string,
  ): StoredPaymentEvent {
    const applied = event.type === "PAYMENT_SUCCEEDED"
      ? this.applyCheckoutPayment(event)
      : this.applySubscriptionRenewal(event);
    const invoice = this.createInvoice(event, applied.ownerId, applied.product, processedAt);
    this.invoices.set(invoice.id, invoice);
    return {
      event,
      deliveryId,
      rawBodySha256,
      creditLotId: applied.creditLotId,
      subscriptionId: applied.subscriptionId,
      ownerId: applied.ownerId,
      grantedCredits: applied.product.grantedCredits,
      invoiceId: invoice.id,
      processedAt,
    };
  }

  private applyPaymentReversal(
    event: Extract<CommerceWebhookEvent, { type: "PAYMENT_REFUNDED" | "PAYMENT_CHARGEBACK" }>,
    deliveryId: string,
    rawBodySha256: string,
    processedAt: string,
  ): StoredReversalEvent {
    const original = this.events.get(event.originalPaymentEventId);
    if (!original || !("creditLotId" in original)) {
      throw new LocalCommerceError("ORIGINAL_PAYMENT_EVENT_NOT_FOUND", 404, "Original paid event was not found for reversal.");
    }
    const invoice = this.invoices.get(original.invoiceId);
    if (!invoice) throw new LocalCommerceError("INVOICE_NOT_FOUND", 404, "Original invoice was not found for reversal.");
    if (invoice.status !== "PAID") throw new LocalCommerceError("PAYMENT_ALREADY_REVERSED", 409, "Original payment already has a terminal financial reversal.");
    if (event.money.amountMinor !== invoice.originalAmountMinor || event.money.currency !== invoice.currency) {
      throw new LocalCommerceError("PARTIAL_REVERSAL_NOT_SUPPORTED", 409, "Local sandbox accepts only an exact full-amount reversal.");
    }
    if (event.money.feeMinor !== "0") throw new LocalCommerceError("REVERSAL_FEE_INVALID", 409, "Reversal event fee must be zero; original payment fee remains historical evidence.");

    const reversed = this.options.creditGateway.reverseCreditLot({
      reversalEventId: event.eventId,
      lotId: original.creditLotId,
      reasonCode: event.type === "PAYMENT_CHARGEBACK" ? "VERIFIED_PAYMENT_CHARGEBACK" : "VERIFIED_FULL_REFUND",
    });
    const withdrawnCredits = Number(reversed.withdrawnCredits);
    const unrecoveredCredits = original.grantedCredits - withdrawnCredits;
    const reversalId = `reversal:${event.eventId}`;
    const kind = event.type === "PAYMENT_CHARGEBACK" ? "CHARGEBACK" : "REFUND";
    const reversal: FinancialReversal = {
      id: reversalId,
      eventId: event.eventId,
      originalPaymentEventId: event.originalPaymentEventId,
      invoiceId: invoice.id,
      ownerId: original.ownerId,
      creditLotId: original.creditLotId,
      kind,
      originalAmountMinor: invoice.originalAmountMinor,
      reversalAmountMinor: event.money.amountMinor,
      currency: event.money.currency,
      withdrawnCredits,
      unrecoveredCredits,
      unrecoveredEconomicValue: {
        numeratorMicrousd: (BigInt(invoice.netEconomicValueMicrousd) * BigInt(unrecoveredCredits)).toString(),
        denominatorCredits: String(original.grantedCredits),
      },
      receivableState: unrecoveredCredits > 0 ? "OPEN" : "NONE",
      fraudReviewState: kind === "CHARGEBACK" ? "OPEN" : "NOT_REQUIRED",
      reasonCode: event.reasonCode,
      createdAt: processedAt,
    };
    this.reversals.set(reversal.id, reversal);
    const terminalStatus = kind === "REFUND" ? "REFUNDED" : "CHARGEBACK";
    invoice.status = terminalStatus;
    invoice.updatedAt = processedAt;
    if (original.event.type === "PAYMENT_SUCCEEDED") {
      const checkout = this.requireCheckout(original.event.checkoutId);
      checkout.state = terminalStatus;
      checkout.updatedAt = processedAt;
    }
    return { event, deliveryId, rawBodySha256, reversalId, processedAt };
  }

  private createInvoice(event: PaymentEvent, ownerId: string, product: CommerceProductSnapshot, createdAt: string): MutableInvoice {
    if (event.money.currency !== "USD") throw new LocalCommerceError("LOCAL_FX_RATE_NOT_PUBLISHED", 409, "Local sandbox has no published FX snapshot outside USD.");
    const netMinor = BigInt(event.money.amountMinor) - BigInt(event.money.feeMinor);
    if (netMinor < 0n) throw new LocalCommerceError("PAYMENT_FEE_INVALID", 409, "Payment fee cannot exceed original amount.");
    const netEconomicValueMicrousd = netMinor * 10_000n;
    return {
      id: `invoice:${event.eventId}`,
      paymentEventId: event.eventId,
      ownerId,
      productId: product.id,
      productVersion: product.version,
      planVersionId: product.planVersionId,
      originalAmountMinor: event.money.amountMinor,
      currency: event.money.currency,
      paymentFeeMinor: event.money.feeMinor,
      netEconomicValueMicrousd: netEconomicValueMicrousd.toString(),
      grantedCredits: product.grantedCredits,
      allocatedValue: {
        numeratorMicrousd: netEconomicValueMicrousd.toString(),
        denominatorCredits: String(product.grantedCredits),
      },
      status: "PAID",
      createdAt,
      updatedAt: createdAt,
    };
  }

  private applyCheckoutPayment(event: Extract<PaymentEvent, { type: "PAYMENT_SUCCEEDED" }>) {
    const checkout = this.requireCheckout(event.checkoutId);
    if (checkout.state !== "CREATED") throw new LocalCommerceError("CHECKOUT_NOT_PAYABLE", 409, "Checkout is not awaiting a payment event.");
    this.requireMatchingMoney(event.money, checkout.product.amountMinor, checkout.product.currency);
    const processedAt = (this.options.now ?? (() => new Date()))().toISOString();
    let creditLotId: string;
    let subscriptionId: string | null = null;

    if (checkout.product.kind === "SUBSCRIPTION") {
      if (!checkout.product.planVersionId || !event.billingPeriod) {
        throw new LocalCommerceError("SUBSCRIPTION_PERIOD_REQUIRED", 400, "Initial subscription payment requires an exact billing period.");
      }
      this.requireChronologicalPeriod(event.billingPeriod.start, event.billingPeriod.end);
      const plan = this.planRegistry.require(checkout.product.planVersionId);
      this.requireProductMatchesPlan(checkout.product, plan);
      subscriptionId = `subscription:${checkout.id}`;
      if (this.subscriptions.has(subscriptionId)) throw new LocalCommerceError("SUBSCRIPTION_ALREADY_EXISTS", 409, "Initial payment already created a Subscription.");
      const grant = this.options.creditGateway.grantSubscriptionCredits({
        paymentEventId: event.eventId,
        ownerId: checkout.userId,
        credits: BigInt(plan.creditsPerPeriod),
        expiresAt: event.billingPeriod.end,
      });
      creditLotId = grant.lot.id;
      const subscription: MutableSubscription = {
        id: subscriptionId,
        userId: checkout.userId,
        planVersionId: plan.id,
        state: "ACTIVE",
        provider: checkout.provider,
        providerSubscriptionId: `paytest-sub:${checkout.id}`,
        currentPeriodStart: event.billingPeriod.start,
        currentPeriodEnd: event.billingPeriod.end,
        createdAt: processedAt,
        updatedAt: processedAt,
      };
      this.subscriptions.set(subscription.id, subscription);
      this.periods.set(subscription.id, [this.createPeriod(subscription.id, event.eventId, creditLotId, event.billingPeriod.start, event.billingPeriod.end, processedAt)]);
    } else {
      const grant = this.options.creditGateway.grantPurchasedCredits({
        paymentEventId: event.eventId,
        ownerId: checkout.userId,
        credits: BigInt(checkout.product.grantedCredits),
      });
      creditLotId = grant.lot.id;
    }
    checkout.state = "PAID";
    checkout.paymentEventId = event.eventId;
    checkout.updatedAt = processedAt;
    return { creditLotId, subscriptionId, ownerId: checkout.userId, product: checkout.product };
  }

  private applySubscriptionRenewal(event: Extract<PaymentEvent, { type: "SUBSCRIPTION_RENEWED" }>) {
    const subscription = this.requireSubscription(event.subscriptionId);
    if (!new Set(["ACTIVE", "GRACE"]).has(subscription.state)) {
      throw new LocalCommerceError("SUBSCRIPTION_NOT_RENEWABLE", 409, "Subscription is not eligible for renewal.");
    }
    if (subscription.planVersionId !== event.planVersionId) {
      throw new LocalCommerceError("PLAN_VERSION_MISMATCH", 409, "Renewal cannot silently move a subscriber to another Plan Version.");
    }
    const plan = this.planRegistry.require(subscription.planVersionId);
    this.requireMatchingMoney(event.money, plan.price.amountMinor, plan.price.currency);
    this.requireChronologicalPeriod(event.billingPeriod.start, event.billingPeriod.end);
    if (event.billingPeriod.start !== subscription.currentPeriodEnd) {
      throw new LocalCommerceError("OUT_OF_ORDER_SUBSCRIPTION_PERIOD", 409, "Renewal period must continue exactly from the current period end.");
    }
    const grant = this.options.creditGateway.grantSubscriptionCredits({
      paymentEventId: event.eventId,
      ownerId: subscription.userId,
      credits: BigInt(plan.creditsPerPeriod),
      expiresAt: event.billingPeriod.end,
    });
    const processedAt = (this.options.now ?? (() => new Date()))().toISOString();
    const period = this.createPeriod(subscription.id, event.eventId, grant.lot.id, event.billingPeriod.start, event.billingPeriod.end, processedAt);
    this.periods.set(subscription.id, [...(this.periods.get(subscription.id) ?? []), period]);
    subscription.currentPeriodStart = event.billingPeriod.start;
    subscription.currentPeriodEnd = event.billingPeriod.end;
    subscription.state = "ACTIVE";
    subscription.updatedAt = processedAt;
    return {
      creditLotId: grant.lot.id,
      subscriptionId: subscription.id,
      ownerId: subscription.userId,
      product: {
        id: `renewal:${plan.id}`,
        version: plan.version,
        kind: "SUBSCRIPTION" as const,
        displayName: `${plan.displayName} Renewal`,
        grantedCredits: plan.creditsPerPeriod,
        amountMinor: plan.price.amountMinor,
        currency: plan.price.currency,
        planVersionId: plan.id,
      },
    };
  }

  private requireMatchingMoney(money: { amountMinor: string; currency: string }, amountMinor: string, currency: string) {
    if (money.amountMinor !== amountMinor || money.currency !== currency) {
      throw new LocalCommerceError("PAYMENT_AMOUNT_MISMATCH", 409, "Signed payment amount or currency does not match the immutable commercial snapshot.");
    }
  }

  private requireProductMatchesPlan(product: PaymentCheckout["product"], plan: PlanVersion) {
    if (product.amountMinor !== plan.price.amountMinor || product.currency !== plan.price.currency || product.grantedCredits !== plan.creditsPerPeriod) {
      throw new LocalCommerceError("PLAN_PRODUCT_SNAPSHOT_MISMATCH", 409, "Subscription product and Plan Version snapshots disagree.");
    }
  }

  private requireChronologicalPeriod(start: string, end: string) {
    if (Date.parse(start) >= Date.parse(end)) throw new LocalCommerceError("INVALID_BILLING_PERIOD", 400, "Billing period end must be after its start.");
  }

  private createPeriod(subscriptionId: string, paymentEventId: string, creditLotId: string, periodStart: string, periodEnd: string, createdAt: string): SubscriptionPeriod {
    return { id: `period:${paymentEventId}`, subscriptionId, paymentEventId, creditLotId, periodStart, periodEnd, createdAt };
  }

  private requireCheckout(checkoutId: string): MutableCheckout {
    const checkout = this.checkouts.get(checkoutId);
    if (!checkout) throw new LocalCommerceError("CHECKOUT_NOT_FOUND", 404, "Checkout was not found.");
    return checkout;
  }

  private requireEvent(eventId: string): StoredCommerceEvent {
    const event = this.events.get(eventId);
    if (!event) throw new LocalCommerceError("PAYMENT_EVENT_NOT_FOUND", 404, "Payment event was not found.");
    return event;
  }

  private requireSubscription(subscriptionId: string): MutableSubscription {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) throw new LocalCommerceError("SUBSCRIPTION_NOT_FOUND", 404, "Subscription was not found.");
    return subscription;
  }
}
