import { evidenceHash } from "./canonical.ts";
import type {
  UnlimitedCohortBudgetEntry,
  UnlimitedCohortBudgetPolicyVersion,
  UnlimitedCohortBudgetReservation,
  UnlimitedCohortBudgetSnapshot,
  UnlimitedRelaxedPilotAuthorization,
  UnlimitedRelaxedUsageDecision,
} from "./types.ts";
import { UnlimitedRelaxedError } from "./types.ts";

type MutableReservation = {
  reservationId: string;
  operationId: string;
  cohortId: string;
  policyVersionId: string;
  authorizationId: string;
  userKeyHash: string;
  routeVersionId: string;
  familyVersionId: string;
  modelVersionId: string;
  reservedMaximumCogsMicrousd: bigint;
  settledActualCogsMicrousd: bigint;
  releasedCogsMicrousd: bigint;
  state: UnlimitedCohortBudgetReservation["state"];
  createdAt: string;
  terminalAt: string | null;
  customerCreditsCharged: false;
  externalDispatchPerformed: false;
};

function unsigned(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new UnlimitedRelaxedError("INVALID_COHORT_BUDGET_POLICY", "Cohort Budget money must use unsigned integer microusd strings.");
  }
  return BigInt(value);
}

function validatePolicy(policy: UnlimitedCohortBudgetPolicyVersion): void {
  const value = unsigned(policy.netCohortSubscriptionEconomicValueMicrousd);
  const maximum = unsigned(policy.maximumCogsPerOperationMicrousd);
  const startsAt = Date.parse(policy.periodStartsAt);
  const endsAt = Date.parse(policy.periodEndsAt);
  const allowed = value * BigInt(policy.approvedCogsRatioBps) / 10_000n;
  if (!policy.id
    || !policy.cohortId
    || !policy.offerPolicyVersionId
    || !Number.isInteger(policy.version)
    || policy.version <= 0
    || policy.lifecycle !== "PUBLISHED"
    || value <= 0n
    || !Number.isInteger(policy.approvedCogsRatioBps)
    || policy.approvedCogsRatioBps <= 0
    || policy.approvedCogsRatioBps >= 10_000
    || maximum <= 0n
    || maximum > allowed
    || allowed <= 0n
    || Number.isNaN(startsAt)
    || Number.isNaN(endsAt)
    || endsAt <= startsAt
    || policy.calculation !== "NET_COHORT_VALUE_TIMES_APPROVED_COGS_RATIO_FLOOR"
    || policy.budgetAuthority !== "LOCAL_SIMULATION_ONLY"
    || policy.pilotActivationAllowed !== false
    || Number.isNaN(Date.parse(policy.publishedAt))) {
    throw new UnlimitedRelaxedError("INVALID_COHORT_BUDGET_POLICY", "Cohort Budget Policy must exactly bound COGS to net cohort value times the approved ratio and cannot activate a Pilot.");
  }
}

function publicReservation(reservation: MutableReservation): UnlimitedCohortBudgetReservation {
  return {
    ...reservation,
    reservedMaximumCogsMicrousd: reservation.reservedMaximumCogsMicrousd.toString(),
    settledActualCogsMicrousd: reservation.settledActualCogsMicrousd.toString(),
    releasedCogsMicrousd: reservation.releasedCogsMicrousd.toString(),
  };
}

export class InMemoryUnlimitedCohortBudget {
  private readonly allowedCogsMicrousd: bigint;
  private availableCogsMicrousd: bigint;
  private reservedCogsMicrousd = 0n;
  private settledCogsMicrousd = 0n;
  private releasedCogsMicrousd = 0n;
  private readonly reservations = new Map<string, MutableReservation>();
  private readonly byOperation = new Map<string, { intentHash: string; reservationId: string }>();
  private readonly ledger: UnlimitedCohortBudgetEntry[] = [];

  constructor(
    private readonly policy: UnlimitedCohortBudgetPolicyVersion,
    private readonly now: () => Date = () => new Date(),
  ) {
    validatePolicy(policy);
    this.allowedCogsMicrousd = unsigned(policy.netCohortSubscriptionEconomicValueMicrousd)
      * BigInt(policy.approvedCogsRatioBps) / 10_000n;
    this.availableCogsMicrousd = this.allowedCogsMicrousd;
  }

  reserve(input: {
    operationId: string;
    authorization: UnlimitedRelaxedPilotAuthorization;
    usageDecision: UnlimitedRelaxedUsageDecision;
    maximumCogsMicrousd: string;
  }): UnlimitedCohortBudgetReservation {
    const evaluatedAt = this.now();
    const maximum = unsigned(input.maximumCogsMicrousd);
    const intentHash = evidenceHash(input);
    const previous = this.byOperation.get(input.operationId);
    if (previous) {
      if (previous.intentHash === intentHash) return publicReservation(this.reservations.get(previous.reservationId)!);
      throw new UnlimitedRelaxedError("COHORT_BUDGET_REQUEST_CONFLICT", "Operation ID was reused with a different Cohort COGS reservation intent.");
    }
    const decision = input.usageDecision;
    const authorization = input.authorization;
    const periodStart = Date.parse(this.policy.periodStartsAt);
    const periodEnd = Date.parse(this.policy.periodEndsAt);
    if (!input.operationId
      || Number.isNaN(evaluatedAt.getTime())
      || evaluatedAt.getTime() < periodStart
      || evaluatedAt.getTime() >= periodEnd
      || authorization.policyVersionId !== this.policy.offerPolicyVersionId
      || authorization.pilotCohortId !== this.policy.cohortId
      || decision.policyVersionId !== this.policy.offerPolicyVersionId
      || decision.authorizationId !== authorization.authorizationId
      || decision.decision !== "INCLUDED_RELAXED"
      || decision.reason !== "RELAXED_DRAFT_INCLUDED"
      || !decision.actualRouteVersionId
      || !decision.actualFamilyVersionId
      || !decision.actualModelVersionId
      || decision.customerCreditsReserved !== false
      || decision.dispatchMutationPerformed !== false
      || maximum <= 0n) {
      throw new UnlimitedRelaxedError("COHORT_BUDGET_NOT_ELIGIBLE", "Cohort COGS reservation requires an included pinned Relaxed decision, matching authorization and active budget period.");
    }
    const perOperationMaximum = unsigned(this.policy.maximumCogsPerOperationMicrousd);
    if (maximum > perOperationMaximum || maximum > this.availableCogsMicrousd) {
      throw new UnlimitedRelaxedError("COHORT_BUDGET_INSUFFICIENT", "Cohort COGS maximum exposure exceeds the per-operation or remaining aggregate budget.");
    }
    const reservationId = `unlimited-cohort-reservation:${input.operationId}`;
    const reservation: MutableReservation = {
      reservationId,
      operationId: input.operationId,
      cohortId: this.policy.cohortId,
      policyVersionId: this.policy.id,
      authorizationId: authorization.authorizationId,
      userKeyHash: authorization.userKeyHash,
      routeVersionId: decision.actualRouteVersionId,
      familyVersionId: decision.actualFamilyVersionId,
      modelVersionId: decision.actualModelVersionId,
      reservedMaximumCogsMicrousd: maximum,
      settledActualCogsMicrousd: 0n,
      releasedCogsMicrousd: 0n,
      state: "RESERVED",
      createdAt: evaluatedAt.toISOString(),
      terminalAt: null,
      customerCreditsCharged: false,
      externalDispatchPerformed: false,
    };
    this.availableCogsMicrousd -= maximum;
    this.reservedCogsMicrousd += maximum;
    this.reservations.set(reservationId, reservation);
    this.byOperation.set(input.operationId, { intentHash, reservationId });
    this.appendEntry(reservation, "RESERVE", maximum, "MAXIMUM_COGS_RESERVED", evaluatedAt);
    return publicReservation(reservation);
  }

  settle(reservationId: string, actualCogsMicrousd: string): UnlimitedCohortBudgetReservation {
    const reservation = this.requireReservation(reservationId);
    const actual = unsigned(actualCogsMicrousd);
    if (reservation.state === "SETTLED") {
      if (reservation.settledActualCogsMicrousd === actual) return publicReservation(reservation);
      throw new UnlimitedRelaxedError("COHORT_SETTLEMENT_CONFLICT", "Settled actual COGS is immutable.");
    }
    if (reservation.state !== "RESERVED" || actual > reservation.reservedMaximumCogsMicrousd) {
      throw new UnlimitedRelaxedError("COHORT_SETTLEMENT_CONFLICT", "Actual COGS must fit the active maximum reservation.");
    }
    const terminalAt = this.now();
    const release = reservation.reservedMaximumCogsMicrousd - actual;
    this.reservedCogsMicrousd -= reservation.reservedMaximumCogsMicrousd;
    this.settledCogsMicrousd += actual;
    this.availableCogsMicrousd += release;
    this.releasedCogsMicrousd += release;
    reservation.settledActualCogsMicrousd = actual;
    reservation.releasedCogsMicrousd = release;
    reservation.state = "SETTLED";
    reservation.terminalAt = terminalAt.toISOString();
    this.appendEntry(reservation, "SETTLE", actual, "ACTUAL_COGS_VERIFIED", terminalAt);
    if (release > 0n) this.appendEntry(reservation, "RELEASE", release, "UNUSED_RESERVE", terminalAt);
    return publicReservation(reservation);
  }

  release(reservationId: string): UnlimitedCohortBudgetReservation {
    const reservation = this.requireReservation(reservationId);
    if (reservation.state === "RELEASED") return publicReservation(reservation);
    if (reservation.state !== "RESERVED") {
      throw new UnlimitedRelaxedError("COHORT_SETTLEMENT_CONFLICT", "Only an active Cohort reservation can be released after no-charge failure.");
    }
    const terminalAt = this.now();
    const amount = reservation.reservedMaximumCogsMicrousd;
    this.reservedCogsMicrousd -= amount;
    this.availableCogsMicrousd += amount;
    this.releasedCogsMicrousd += amount;
    reservation.releasedCogsMicrousd = amount;
    reservation.state = "RELEASED";
    reservation.terminalAt = terminalAt.toISOString();
    this.appendEntry(reservation, "RELEASE", amount, "NO_CHARGE_FAILURE", terminalAt);
    return publicReservation(reservation);
  }

  entries(): readonly UnlimitedCohortBudgetEntry[] {
    return structuredClone(this.ledger);
  }

  snapshot(): UnlimitedCohortBudgetSnapshot {
    return {
      policyVersionId: this.policy.id,
      offerPolicyVersionId: this.policy.offerPolicyVersionId,
      cohortId: this.policy.cohortId,
      netCohortSubscriptionEconomicValueMicrousd: this.policy.netCohortSubscriptionEconomicValueMicrousd,
      approvedCogsRatioBps: this.policy.approvedCogsRatioBps,
      allowedCohortCogsMicrousd: this.allowedCogsMicrousd.toString(),
      availableCohortCogsMicrousd: this.availableCogsMicrousd.toString(),
      reservedCohortCogsMicrousd: this.reservedCogsMicrousd.toString(),
      settledCohortCogsMicrousd: this.settledCogsMicrousd.toString(),
      releasedCohortCogsMicrousd: this.releasedCogsMicrousd.toString(),
      reservationCount: this.reservations.size,
      ledgerEntryCount: this.ledger.length,
      ledgerChainValid: this.verifyLedgerChain(),
      projectionReconciled: this.verifyProjection(),
      customerCreditsCharged: "0",
      externalDispatchPerformed: false,
      pilotActivationAllowed: false,
    };
  }

  private requireReservation(reservationId: string): MutableReservation {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new UnlimitedRelaxedError("COHORT_RESERVATION_NOT_FOUND", "Cohort COGS reservation was not found.");
    return reservation;
  }

  private appendEntry(
    reservation: MutableReservation,
    type: UnlimitedCohortBudgetEntry["type"],
    amount: bigint,
    reason: UnlimitedCohortBudgetEntry["reason"],
    occurredAt: Date,
  ): void {
    const sequence = this.ledger.length + 1;
    const previousEntryHash = this.ledger.at(-1)?.entryHash ?? null;
    const intent = {
      sequence,
      entryId: `unlimited-cohort-entry:${sequence}`,
      reservationId: reservation.reservationId,
      operationId: reservation.operationId,
      type,
      amountMicrousd: amount.toString(),
      reason,
      occurredAt: occurredAt.toISOString(),
      previousEntryHash,
    };
    this.ledger.push({ ...intent, entryHash: evidenceHash(intent) });
  }

  private verifyLedgerChain(): boolean {
    let previousEntryHash: string | null = null;
    return this.ledger.every((entry, index) => {
      const { entryHash, ...intent } = entry;
      const valid = entry.sequence === index + 1
        && entry.previousEntryHash === previousEntryHash
        && entryHash === evidenceHash(intent);
      previousEntryHash = entryHash;
      return valid;
    });
  }

  private verifyProjection(): boolean {
    const reconstructed = this.ledger.reduce((total, entry) => {
      const amount = BigInt(entry.amountMicrousd);
      if (entry.type === "RESERVE") total.reserved += amount;
      else if (entry.type === "SETTLE") {
        total.reserved -= amount;
        total.settled += amount;
      } else {
        total.reserved -= amount;
        total.released += amount;
      }
      return total;
    }, { reserved: 0n, settled: 0n, released: 0n });
    return reconstructed.reserved === this.reservedCogsMicrousd
      && reconstructed.settled === this.settledCogsMicrousd
      && reconstructed.released === this.releasedCogsMicrousd
      && this.allowedCogsMicrousd - reconstructed.reserved - reconstructed.settled === this.availableCogsMicrousd;
  }
}
