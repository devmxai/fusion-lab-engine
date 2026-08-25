import { z } from "zod";
import type {
  PromotionBudget,
  PromotionEvaluationInput,
  PromotionReservation,
  PromotionSubsidyEntry,
  PromotionVersion,
} from "./types.ts";

const PromotionVersionSchema = z.object({
  id: z.string().min(1).max(200),
  campaignKey: z.string().min(1).max(100),
  version: z.number().int().positive(),
  code: z.string().regex(/^[A-Z0-9_-]{3,100}$/),
  lifecycle: z.enum(["PUBLISHED", "RETIRED"]),
  discountCredits: z.number().int().positive(),
  budget: z.object({ credits: z.number().int().positive(), microusd: z.string().regex(/^\d+$/) }).strict(),
  window: z.object({ startsAt: z.string().datetime(), endsAt: z.string().datetime() }).strict(),
  eligibility: z.object({
    products: z.array(z.string().min(1)).min(1),
    routes: z.array(z.string().min(1)).min(1),
    cohorts: z.array(z.string().min(1)).min(1),
  }).strict(),
  caps: z.object({ perUserRedemptions: z.number().int().positive(), globalRedemptions: z.number().int().positive() }).strict(),
  stacking: z.object({
    mode: z.enum(["EXCLUSIVE", "ALLOWLIST"]),
    allowedCampaignKeys: z.array(z.string().min(1)),
  }).strict(),
  fraudRules: z.object({
    blockedUserIds: z.array(z.string().min(1)),
    maxReservationsPerUserPerUtcDay: z.number().int().positive(),
  }).strict(),
  attribution: z.string().min(1).max(200),
  stopCondition: z.object({
    minimumRemainingCredits: z.number().int().nonnegative(),
    minimumRemainingMicrousd: z.string().regex(/^\d+$/),
  }).strict(),
  approvals: z.object({
    createdBy: z.string().min(1),
    approvedBy: z.tuple([z.string().min(1), z.string().min(1)]),
    publishedAt: z.string().datetime(),
  }).strict(),
  killSwitch: z.object({ enabled: z.boolean(), reasonCode: z.string().min(1).nullable() }).strict(),
}).strict();

type MutableBudget = {
  campaignVersionId: string;
  initialCredits: number;
  reservedCredits: number;
  redeemedCredits: number;
  initialMicrousd: bigint;
  reservedMicrousd: bigint;
  redeemedMicrousd: bigint;
};

type MutableReservation = Omit<PromotionReservation, "status" | "operationId" | "updatedAt" | "releaseReason"> & {
  status: PromotionReservation["status"];
  operationId: string | null;
  updatedAt: string;
  releaseReason: string | null;
};

export class PromotionDomainError extends Error {
  constructor(
    public readonly code:
      | "INVALID_PROMOTION_VERSION"
      | "DUPLICATE_PROMOTION_VERSION"
      | "PROMOTION_NOT_FOUND"
      | "PROMOTION_NOT_ACTIVE"
      | "PROMOTION_KILL_SWITCHED"
      | "PROMOTION_NOT_ELIGIBLE"
      | "PROMOTION_STACKING_FORBIDDEN"
      | "PROMOTION_FRAUD_BLOCKED"
      | "PROMOTION_CAP_REACHED"
      | "PROMOTION_BUDGET_EXHAUSTED"
      | "PROMOTION_RESERVATION_CONFLICT"
      | "PROMOTION_RESERVATION_NOT_FOUND"
      | "PROMOTION_RESERVATION_NOT_REDEEMABLE",
    message: string,
  ) {
    super(message);
    this.name = "PromotionDomainError";
  }
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function freezeVersion(version: PromotionVersion): PromotionVersion {
  return Object.freeze({
    ...structuredClone(version),
    budget: Object.freeze({ ...version.budget }),
    window: Object.freeze({ ...version.window }),
    eligibility: Object.freeze({
      products: Object.freeze([...version.eligibility.products]),
      routes: Object.freeze([...version.eligibility.routes]),
      cohorts: Object.freeze([...version.eligibility.cohorts]),
    }),
    caps: Object.freeze({ ...version.caps }),
    stacking: Object.freeze({
      mode: version.stacking.mode,
      allowedCampaignKeys: Object.freeze([...version.stacking.allowedCampaignKeys]),
    }),
    fraudRules: Object.freeze({
      blockedUserIds: Object.freeze([...version.fraudRules.blockedUserIds]),
      maxReservationsPerUserPerUtcDay: version.fraudRules.maxReservationsPerUserPerUtcDay,
    }),
    stopCondition: Object.freeze({ ...version.stopCondition }),
    approvals: Object.freeze({
      createdBy: version.approvals.createdBy,
      approvedBy: Object.freeze([...version.approvals.approvedBy]) as unknown as readonly [string, string],
      publishedAt: version.approvals.publishedAt,
    }),
    killSwitch: Object.freeze({ ...version.killSwitch }),
  });
}

export class InMemoryPromotionEngine {
  private readonly versions = new Map<string, PromotionVersion>();
  private readonly byCode = new Map<string, string>();
  private readonly budgets = new Map<string, MutableBudget>();
  private readonly reservations = new Map<string, MutableReservation>();
  private readonly reservationByQuote = new Map<string, string>();
  private readonly subsidyEntries: PromotionSubsidyEntry[] = [];

  constructor(versions: readonly PromotionVersion[], private readonly now: () => Date = () => new Date()) {
    for (const version of versions) this.register(version);
  }

  register(rawVersion: PromotionVersion): PromotionVersion {
    const parsed = PromotionVersionSchema.safeParse(rawVersion);
    if (!parsed.success) throw new PromotionDomainError("INVALID_PROMOTION_VERSION", "Promotion Version is invalid.");
    const version = parsed.data as PromotionVersion;
    if (Date.parse(version.window.startsAt) >= Date.parse(version.window.endsAt)) {
      throw new PromotionDomainError("INVALID_PROMOTION_VERSION", "Promotion window end must be after its start.");
    }
    if (version.approvals.createdBy === version.approvals.approvedBy[0]
      || version.approvals.createdBy === version.approvals.approvedBy[1]
      || version.approvals.approvedBy[0] === version.approvals.approvedBy[1]) {
      throw new PromotionDomainError("INVALID_PROMOTION_VERSION", "Published promotions require two distinct approvers independent from the maker.");
    }
    if (this.versions.has(version.id) || this.byCode.has(version.code)) {
      throw new PromotionDomainError("DUPLICATE_PROMOTION_VERSION", "Promotion Version IDs and codes are immutable and unique.");
    }
    const frozen = freezeVersion(version);
    this.versions.set(frozen.id, frozen);
    this.byCode.set(frozen.code, frozen.id);
    this.budgets.set(frozen.id, this.initialBudget(frozen));
    return frozen;
  }

  list(): readonly PromotionVersion[] {
    return [...this.versions.values()];
  }

  reserve(input: PromotionEvaluationInput): PromotionReservation {
    const existingId = this.reservationByQuote.get(input.quoteId);
    if (existingId) {
      const existing = this.requireReservation(existingId);
      if (existing.promotionCode !== input.promotionCode.toUpperCase() || existing.userId !== input.userId) {
        throw new PromotionDomainError("PROMOTION_RESERVATION_CONFLICT", "Quote promotion reservation was reused with different inputs.");
      }
      return structuredClone(existing);
    }
    const code = input.promotionCode.trim().toUpperCase();
    const versionId = this.byCode.get(code);
    if (!versionId) throw new PromotionDomainError("PROMOTION_NOT_FOUND", "Promotion code was not found.");
    const version = this.versions.get(versionId)!;
    const evaluatedAt = this.now();
    const evaluatedAtIso = evaluatedAt.toISOString();
    if (version.lifecycle !== "PUBLISHED" || evaluatedAtIso < version.window.startsAt || evaluatedAtIso >= version.window.endsAt) {
      throw new PromotionDomainError("PROMOTION_NOT_ACTIVE", "Promotion is outside its published active window.");
    }
    if (version.killSwitch.enabled) throw new PromotionDomainError("PROMOTION_KILL_SWITCHED", "Promotion is disabled by its kill switch.");
    if (!version.eligibility.products.includes(input.product)
      || !version.eligibility.routes.includes(input.routeId)
      || !version.eligibility.cohorts.includes(input.cohort)) {
      throw new PromotionDomainError("PROMOTION_NOT_ELIGIBLE", "Promotion is not eligible for this product, route, or cohort.");
    }
    if (version.fraudRules.blockedUserIds.includes(input.userId)) {
      throw new PromotionDomainError("PROMOTION_FRAUD_BLOCKED", "Promotion was blocked by a server-side fraud rule.");
    }
    const activeKeys = [...input.activeCampaignKeys];
    const stackingAllowed = activeKeys.length === 0 || (version.stacking.mode === "ALLOWLIST"
      && activeKeys.every((key) => version.stacking.allowedCampaignKeys.includes(key)));
    if (!stackingAllowed) throw new PromotionDomainError("PROMOTION_STACKING_FORBIDDEN", "Promotion stacking policy rejected the quote.");

    const activeReservations = [...this.reservations.values()].filter(({ status }) => status !== "RELEASED");
    const globalUse = activeReservations.filter(({ campaignVersionId }) => campaignVersionId === version.id).length;
    const userUse = activeReservations.filter(({ campaignVersionId, userId }) => campaignVersionId === version.id && userId === input.userId).length;
    if (globalUse >= version.caps.globalRedemptions || userUse >= version.caps.perUserRedemptions) {
      throw new PromotionDomainError("PROMOTION_CAP_REACHED", "Promotion redemption cap has been reached.");
    }
    const utcDay = evaluatedAtIso.slice(0, 10);
    const userDailyReservations = [...this.reservations.values()].filter((reservation) =>
      reservation.campaignVersionId === version.id
      && reservation.userId === input.userId
      && reservation.createdAt.startsWith(utcDay)).length;
    if (userDailyReservations >= version.fraudRules.maxReservationsPerUserPerUtcDay) {
      throw new PromotionDomainError("PROMOTION_FRAUD_BLOCKED", "Promotion reservation velocity exceeded its server-side UTC-day rule.");
    }

    const discountCredits = Math.min(version.discountCredits, Math.max(0, input.baseCustomerCredits - 1));
    if (discountCredits <= 0) throw new PromotionDomainError("PROMOTION_NOT_ELIGIBLE", "Promotion cannot reduce this quote below its minimum whole-credit charge.");
    const finalCustomerCredits = input.baseCustomerCredits - discountCredits;
    const marginDenominator = 10_000n - BigInt(input.hardFloorMarginBps);
    if (marginDenominator <= 0n) throw new PromotionDomainError("INVALID_PROMOTION_VERSION", "Hard floor margin must be below 10000 bps.");
    const minimumRevenueMicrousd = ceilDiv(BigInt(input.conservativeCostMicrousd) * 10_000n, marginDenominator);
    const postDiscountValueMicrousd = BigInt(finalCustomerCredits) * BigInt(input.creditValueFloorMicrousd);
    const subsidyMicrousd = minimumRevenueMicrousd > postDiscountValueMicrousd
      ? minimumRevenueMicrousd - postDiscountValueMicrousd
      : 0n;
    const budget = this.budgets.get(version.id)!;
    const availableCredits = budget.initialCredits - budget.reservedCredits - budget.redeemedCredits;
    const availableMicrousd = budget.initialMicrousd - budget.reservedMicrousd - budget.redeemedMicrousd;
    const remainingCredits = availableCredits - discountCredits;
    const remainingMicrousd = availableMicrousd - subsidyMicrousd;
    if (remainingCredits < version.stopCondition.minimumRemainingCredits
      || remainingMicrousd < BigInt(version.stopCondition.minimumRemainingMicrousd)) {
      throw new PromotionDomainError("PROMOTION_BUDGET_EXHAUSTED", "Promotion budget or stop-condition reserve is insufficient.");
    }
    budget.reservedCredits += discountCredits;
    budget.reservedMicrousd += subsidyMicrousd;
    const reservation: MutableReservation = {
      id: `promotion-reservation:${input.quoteId}`,
      quoteId: input.quoteId,
      campaignVersionId: version.id,
      campaignKey: version.campaignKey,
      promotionCode: version.code,
      userId: input.userId,
      product: input.product,
      routeId: input.routeId,
      cohort: input.cohort,
      baseCustomerCredits: input.baseCustomerCredits,
      discountCredits,
      finalCustomerCredits,
      subsidyMicrousd: subsidyMicrousd.toString(),
      status: "RESERVED",
      operationId: null,
      attribution: version.attribution,
      createdAt: evaluatedAtIso,
      expiresAt: input.quoteExpiresAt,
      updatedAt: evaluatedAtIso,
      releaseReason: null,
    };
    this.reservations.set(reservation.id, reservation);
    this.reservationByQuote.set(input.quoteId, reservation.id);
    this.subsidyEntries.push({
      id: `promotion-entry:${reservation.id}:reserve`,
      campaignVersionId: version.id,
      reservationId: reservation.id,
      operationId: null,
      kind: "RESERVE",
      reservedCreditsDelta: discountCredits,
      redeemedCreditsDelta: 0,
      reservedMicrousdDelta: subsidyMicrousd.toString(),
      redeemedMicrousdDelta: "0",
      reasonCode: "ELIGIBLE_QUOTE_BUDGET_RESERVED",
      createdAt: evaluatedAtIso,
    });
    return structuredClone(reservation);
  }

  redeem(reservationId: string, operationId: string): PromotionReservation {
    const reservation = this.requireReservation(reservationId);
    if (reservation.status === "REDEEMED") {
      if (reservation.operationId !== operationId) throw new PromotionDomainError("PROMOTION_RESERVATION_CONFLICT", "Promotion reservation is bound to another operation.");
      return structuredClone(reservation);
    }
    if (reservation.status !== "RESERVED" || reservation.expiresAt <= this.now().toISOString()) {
      throw new PromotionDomainError("PROMOTION_RESERVATION_NOT_REDEEMABLE", "Promotion reservation is released or expired.");
    }
    if (reservation.operationId !== null && reservation.operationId !== operationId) {
      throw new PromotionDomainError("PROMOTION_RESERVATION_CONFLICT", "Promotion reservation is bound to another operation.");
    }
    const budget = this.budgets.get(reservation.campaignVersionId)!;
    const subsidyMicrousd = BigInt(reservation.subsidyMicrousd);
    budget.reservedCredits -= reservation.discountCredits;
    budget.reservedMicrousd -= subsidyMicrousd;
    budget.redeemedCredits += reservation.discountCredits;
    budget.redeemedMicrousd += subsidyMicrousd;
    reservation.status = "REDEEMED";
    reservation.operationId = operationId;
    reservation.updatedAt = this.now().toISOString();
    this.subsidyEntries.push({
      id: `promotion-entry:${reservation.id}:redeem`,
      campaignVersionId: reservation.campaignVersionId,
      reservationId: reservation.id,
      operationId,
      kind: "REDEEM",
      reservedCreditsDelta: -reservation.discountCredits,
      redeemedCreditsDelta: reservation.discountCredits,
      reservedMicrousdDelta: (-subsidyMicrousd).toString(),
      redeemedMicrousdDelta: subsidyMicrousd.toString(),
      reasonCode: "OPERATION_CREATED_PROMOTION_REDEEMED",
      createdAt: reservation.updatedAt,
    });
    return structuredClone(reservation);
  }

  attach(reservationId: string, operationId: string): PromotionReservation {
    const reservation = this.requireReservation(reservationId);
    if (reservation.status !== "RESERVED" || reservation.expiresAt <= this.now().toISOString()) {
      throw new PromotionDomainError("PROMOTION_RESERVATION_NOT_REDEEMABLE", "Promotion reservation is released or expired.");
    }
    if (reservation.operationId !== null && reservation.operationId !== operationId) {
      throw new PromotionDomainError("PROMOTION_RESERVATION_CONFLICT", "Promotion reservation is bound to another operation.");
    }
    reservation.operationId = operationId;
    reservation.updatedAt = this.now().toISOString();
    return structuredClone(reservation);
  }

  release(reservationId: string, reason: string): PromotionReservation {
    const reservation = this.requireReservation(reservationId);
    if (reservation.status !== "RESERVED") return structuredClone(reservation);
    const budget = this.budgets.get(reservation.campaignVersionId)!;
    budget.reservedCredits -= reservation.discountCredits;
    budget.reservedMicrousd -= BigInt(reservation.subsidyMicrousd);
    reservation.status = "RELEASED";
    reservation.releaseReason = reason;
    reservation.updatedAt = this.now().toISOString();
    this.subsidyEntries.push({
      id: `promotion-entry:${reservation.id}:release`,
      campaignVersionId: reservation.campaignVersionId,
      reservationId: reservation.id,
      operationId: null,
      kind: "RELEASE",
      reservedCreditsDelta: -reservation.discountCredits,
      redeemedCreditsDelta: 0,
      reservedMicrousdDelta: (-BigInt(reservation.subsidyMicrousd)).toString(),
      redeemedMicrousdDelta: "0",
      reasonCode: reason,
      createdAt: reservation.updatedAt,
    });
    return structuredClone(reservation);
  }

  releaseExpired(): readonly PromotionReservation[] {
    const evaluatedAt = this.now().toISOString();
    return [...this.reservations.values()]
      .filter(({ status, expiresAt }) => status === "RESERVED" && expiresAt <= evaluatedAt)
      .map(({ id }) => this.release(id, "QUOTE_EXPIRED"));
  }

  reservation(reservationId: string): PromotionReservation {
    return structuredClone(this.requireReservation(reservationId));
  }

  reservationForQuote(quoteId: string): PromotionReservation | null {
    const id = this.reservationByQuote.get(quoteId);
    return id ? this.reservation(id) : null;
  }

  budget(campaignVersionId: string): PromotionBudget {
    const budget = this.budgets.get(campaignVersionId);
    if (!budget) throw new PromotionDomainError("PROMOTION_NOT_FOUND", "Promotion budget was not found.");
    return {
      campaignVersionId: budget.campaignVersionId,
      initialCredits: budget.initialCredits,
      reservedCredits: budget.reservedCredits,
      redeemedCredits: budget.redeemedCredits,
      initialMicrousd: budget.initialMicrousd.toString(),
      reservedMicrousd: budget.reservedMicrousd.toString(),
      redeemedMicrousd: budget.redeemedMicrousd.toString(),
    };
  }

  budgetsSnapshot(): readonly PromotionBudget[] {
    return [...this.budgets.keys()].map((id) => this.budget(id));
  }

  subsidyEntriesSnapshot(campaignVersionId?: string): readonly PromotionSubsidyEntry[] {
    return this.subsidyEntries
      .filter((entry) => !campaignVersionId || entry.campaignVersionId === campaignVersionId)
      .map((entry) => structuredClone(entry));
  }

  reconciliationIssues(): readonly { code: string; entityId: string; detail: string }[] {
    const issues: { code: string; entityId: string; detail: string }[] = [];
    for (const budget of this.budgets.values()) {
      const entries = this.subsidyEntries.filter(({ campaignVersionId }) => campaignVersionId === budget.campaignVersionId);
      const reconstructed = entries.reduce((total, entry) => ({
        reservedCredits: total.reservedCredits + entry.reservedCreditsDelta,
        redeemedCredits: total.redeemedCredits + entry.redeemedCreditsDelta,
        reservedMicrousd: total.reservedMicrousd + BigInt(entry.reservedMicrousdDelta),
        redeemedMicrousd: total.redeemedMicrousd + BigInt(entry.redeemedMicrousdDelta),
      }), { reservedCredits: 0, redeemedCredits: 0, reservedMicrousd: 0n, redeemedMicrousd: 0n });
      if (reconstructed.reservedCredits !== budget.reservedCredits
        || reconstructed.redeemedCredits !== budget.redeemedCredits
        || reconstructed.reservedMicrousd !== budget.reservedMicrousd
        || reconstructed.redeemedMicrousd !== budget.redeemedMicrousd) {
        issues.push({ code: "PROMOTION_BUDGET_PROJECTION_DRIFT", entityId: budget.campaignVersionId, detail: "Subsidy entries do not reconstruct the budget projection." });
      }
      if (budget.reservedCredits < 0 || budget.redeemedCredits < 0
        || budget.reservedCredits + budget.redeemedCredits > budget.initialCredits
        || budget.reservedMicrousd < 0n || budget.redeemedMicrousd < 0n
        || budget.reservedMicrousd + budget.redeemedMicrousd > budget.initialMicrousd) {
        issues.push({ code: "PROMOTION_BUDGET_INVARIANT", entityId: budget.campaignVersionId, detail: "Promotion budget exceeds its immutable initial allocation or became negative." });
      }
    }
    for (const reservation of this.reservations.values()) {
      const entries = this.subsidyEntries.filter(({ reservationId }) => reservationId === reservation.id);
      const reserveCount = entries.filter(({ kind }) => kind === "RESERVE").length;
      const terminalCount = entries.filter(({ kind }) => kind === "REDEEM" || kind === "RELEASE").length;
      if (reserveCount !== 1 || (reservation.status === "RESERVED" ? terminalCount !== 0 : terminalCount !== 1)) {
        issues.push({ code: "PROMOTION_RESERVATION_EVIDENCE_MISMATCH", entityId: reservation.id, detail: "Reservation lifecycle does not match its append-only Subsidy entries." });
      }
    }
    return issues;
  }

  reset(): void {
    this.reservations.clear();
    this.reservationByQuote.clear();
    this.subsidyEntries.splice(0);
    for (const version of this.versions.values()) this.budgets.set(version.id, this.initialBudget(version));
  }

  private initialBudget(version: PromotionVersion): MutableBudget {
    return {
      campaignVersionId: version.id,
      initialCredits: version.budget.credits,
      reservedCredits: 0,
      redeemedCredits: 0,
      initialMicrousd: BigInt(version.budget.microusd),
      reservedMicrousd: 0n,
      redeemedMicrousd: 0n,
    };
  }

  private requireReservation(reservationId: string): MutableReservation {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new PromotionDomainError("PROMOTION_RESERVATION_NOT_FOUND", "Promotion reservation was not found.");
    return reservation;
  }
}
