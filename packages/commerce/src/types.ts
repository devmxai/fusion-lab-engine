export type CheckoutState = "CREATED" | "PAID" | "EXPIRED" | "REFUNDED" | "CHARGEBACK";

export type MoneySnapshot = Readonly<{
  amountMinor: string;
  currency: string;
  feeMinor: string;
}>;

export type CommerceProductSnapshot = Readonly<{
  id: string;
  version: number;
  kind: "CREDIT_PACK" | "SUBSCRIPTION";
  displayName: string;
  grantedCredits: number;
  amountMinor: string;
  currency: string;
  planVersionId: string | null;
}>;

export type PlanVersion = Readonly<{
  id: string;
  planKey: string;
  version: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  displayName: string;
  price: Readonly<{ amountMinor: string; currency: string; interval: "MONTH" }>;
  creditsPerPeriod: number;
  creditExpiry: "PERIOD_END";
  limits: Readonly<{ concurrency: number; queue: number; storageBytes: string; retentionDays: number }>;
  eligibility: Readonly<{ features: readonly string[]; models: readonly string[]; profiles: readonly string[] }>;
  renewal: Readonly<{ graceDays: number; cancellation: "AT_PERIOD_END" }>;
  termsVersion: string;
  effectiveFrom: string;
  publishedAt: string;
}>;

export type Subscription = Readonly<{
  id: string;
  userId: string;
  planVersionId: string;
  state: "ACTIVE" | "GRACE" | "CANCELED" | "EXPIRED";
  provider: string;
  providerSubscriptionId: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  createdAt: string;
  updatedAt: string;
}>;

export type SubscriptionPeriod = Readonly<{
  id: string;
  subscriptionId: string;
  paymentEventId: string;
  creditLotId: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}>;

export type PaymentCheckout = Readonly<{
  id: string;
  userId: string;
  idempotencyKey: string;
  product: CommerceProductSnapshot;
  provider: string;
  providerSessionId: string;
  checkoutUrl: string;
  successUrl: string;
  cancelUrl: string;
  state: CheckoutState;
  paymentEventId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type CreateProviderCheckoutInput = Readonly<{
  checkoutId: string;
  userId: string;
  product: CommerceProductSnapshot;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}>;

export type ProviderCheckoutSession = Readonly<{
  provider: string;
  providerSessionId: string;
  checkoutUrl: string;
}>;

export interface PaymentAdapter {
  readonly id: string;
  createCheckout(input: CreateProviderCheckoutInput): Promise<ProviderCheckoutSession>;
}

export type PaymentSucceededEvent = Readonly<{
  schemaVersion: 1;
  eventId: string;
  type: "PAYMENT_SUCCEEDED";
  checkoutId: string;
  providerPaymentId: string;
  money: MoneySnapshot;
  occurredAt: string;
  billingPeriod?: Readonly<{ start: string; end: string }> | null;
}>;

export type SubscriptionRenewedEvent = Readonly<{
  schemaVersion: 1;
  eventId: string;
  type: "SUBSCRIPTION_RENEWED";
  subscriptionId: string;
  planVersionId: string;
  providerPaymentId: string;
  money: MoneySnapshot;
  billingPeriod: Readonly<{ start: string; end: string }>;
  occurredAt: string;
}>;

export type PaymentEvent = PaymentSucceededEvent | SubscriptionRenewedEvent;

export type PaymentReversalEvent = Readonly<{
  schemaVersion: 1;
  eventId: string;
  type: "PAYMENT_REFUNDED" | "PAYMENT_CHARGEBACK";
  originalPaymentEventId: string;
  providerReversalId: string;
  money: MoneySnapshot;
  reasonCode: string;
  occurredAt: string;
}>;

export type CommerceWebhookEvent = PaymentEvent | PaymentReversalEvent;

export type CommerceInvoice = Readonly<{
  id: string;
  paymentEventId: string;
  ownerId: string;
  productId: string;
  productVersion: number;
  planVersionId: string | null;
  originalAmountMinor: string;
  currency: string;
  paymentFeeMinor: string;
  netEconomicValueMicrousd: string;
  grantedCredits: number;
  allocatedValue: Readonly<{ numeratorMicrousd: string; denominatorCredits: string }>;
  status: "PAID" | "REFUNDED" | "CHARGEBACK";
  createdAt: string;
  updatedAt: string;
}>;

export type FinancialReversal = Readonly<{
  id: string;
  eventId: string;
  originalPaymentEventId: string;
  invoiceId: string;
  ownerId: string;
  creditLotId: string;
  kind: "REFUND" | "CHARGEBACK";
  originalAmountMinor: string;
  reversalAmountMinor: string;
  currency: string;
  withdrawnCredits: number;
  unrecoveredCredits: number;
  unrecoveredEconomicValue: Readonly<{ numeratorMicrousd: string; denominatorCredits: string }>;
  receivableState: "NONE" | "OPEN";
  fraudReviewState: "NOT_REQUIRED" | "OPEN";
  reasonCode: string;
  createdAt: string;
}>;

export type StoredPaymentEvent = Readonly<{
  event: PaymentEvent;
  deliveryId: string;
  rawBodySha256: string;
  creditLotId: string;
  subscriptionId: string | null;
  ownerId: string;
  grantedCredits: number;
  invoiceId: string;
  processedAt: string;
}>;

export type StoredReversalEvent = Readonly<{
  event: PaymentReversalEvent;
  deliveryId: string;
  rawBodySha256: string;
  reversalId: string;
  processedAt: string;
}>;

export type StoredCommerceEvent = StoredPaymentEvent | StoredReversalEvent;

export type PromotionVersion = Readonly<{
  id: string;
  campaignKey: string;
  version: number;
  code: string;
  lifecycle: "PUBLISHED" | "RETIRED";
  discountCredits: number;
  budget: Readonly<{ credits: number; microusd: string }>;
  window: Readonly<{ startsAt: string; endsAt: string }>;
  eligibility: Readonly<{
    products: readonly string[];
    routes: readonly string[];
    cohorts: readonly string[];
  }>;
  caps: Readonly<{ perUserRedemptions: number; globalRedemptions: number }>;
  stacking: Readonly<{
    mode: "EXCLUSIVE" | "ALLOWLIST";
    allowedCampaignKeys: readonly string[];
  }>;
  fraudRules: Readonly<{
    blockedUserIds: readonly string[];
    maxReservationsPerUserPerUtcDay: number;
  }>;
  attribution: string;
  stopCondition: Readonly<{
    minimumRemainingCredits: number;
    minimumRemainingMicrousd: string;
  }>;
  approvals: Readonly<{
    createdBy: string;
    approvedBy: readonly [string, string];
    publishedAt: string;
  }>;
  killSwitch: Readonly<{ enabled: boolean; reasonCode: string | null }>;
}>;

export type PromotionBudget = Readonly<{
  campaignVersionId: string;
  initialCredits: number;
  reservedCredits: number;
  redeemedCredits: number;
  initialMicrousd: string;
  reservedMicrousd: string;
  redeemedMicrousd: string;
}>;

export type PromotionReservation = Readonly<{
  id: string;
  quoteId: string;
  campaignVersionId: string;
  campaignKey: string;
  promotionCode: string;
  userId: string;
  product: string;
  routeId: string;
  cohort: string;
  baseCustomerCredits: number;
  discountCredits: number;
  finalCustomerCredits: number;
  subsidyMicrousd: string;
  status: "RESERVED" | "REDEEMED" | "RELEASED";
  operationId: string | null;
  attribution: string;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  releaseReason: string | null;
}>;

export type PromotionEvaluationInput = Readonly<{
  quoteId: string;
  quoteExpiresAt: string;
  promotionCode: string;
  userId: string;
  product: string;
  routeId: string;
  cohort: string;
  activeCampaignKeys: readonly string[];
  baseCustomerCredits: number;
  conservativeCostMicrousd: string;
  creditValueFloorMicrousd: string;
  hardFloorMarginBps: number;
}>;

export type PromotionSubsidyEntry = Readonly<{
  id: string;
  campaignVersionId: string;
  reservationId: string;
  operationId: string | null;
  kind: "RESERVE" | "REDEEM" | "RELEASE";
  reservedCreditsDelta: number;
  redeemedCreditsDelta: number;
  reservedMicrousdDelta: string;
  redeemedMicrousdDelta: string;
  reasonCode: string;
  createdAt: string;
}>;

export type CommerceReconciliationIssue = Readonly<{
  code: string;
  entityId: string;
  detail: string;
}>;

export type CommerceReconciliationReport = Readonly<{
  evaluatedAt: string;
  counts: Readonly<{
    paidEvents: number;
    reversalEvents: number;
    invoices: number;
    financialReversals: number;
    commerceCreditLots: number;
    commerceLedgerJournals: number;
    promotionCampaigns: number;
    promotionSubsidyEntries: number;
  }>;
  financials: Readonly<{
    paidNetEconomicValueMicrousd: string;
    reversedNetEconomicValueMicrousd: string;
    openReceivableEconomicValue: Readonly<{ numeratorMicrousd: string; denominatorBasis: string }>;
    promotionRedeemedMicrousd: string;
  }>;
  issues: readonly CommerceReconciliationIssue[];
  reconciliationRateBps: number;
  targetBps: number;
  targetMet: boolean;
  localImplementationDecision: "PASS" | "HOLD";
  formalGateDecision: "HOLD";
  formalBlockers: readonly string[];
  localOnly: true;
}>;
