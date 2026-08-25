import { evidenceHash } from "./canonical.ts";
import type {
  ExplorationBudgetPolicyVersion,
  ExplorationBudgetSnapshot,
  ExplorationLedgerEntry,
  ExplorationPlan,
  ExplorationReservation,
} from "./types.ts";
import { SmartBetaError } from "./types.ts";

type MutableReservation = {
  reservationId: string;
  requestId: string;
  userKeyHash: string;
  profileVersionId: string;
  reservedIncrementalCostMicrousd: bigint;
  settledIncrementalCostMicrousd: bigint;
  releasedIncrementalCostMicrousd: bigint;
  state: ExplorationReservation["state"];
  createdAt: string;
  terminalAt: string | null;
};

function unsigned(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new SmartBetaError("INVALID_EXPLORATION_POLICY", "Exploration money must use unsigned integer microusd strings.");
  return BigInt(value);
}

function validatePolicy(policy: ExplorationBudgetPolicyVersion): void {
  const start = Date.parse(policy.windowStartsAt);
  const end = Date.parse(policy.windowEndsAt);
  const total = unsigned(policy.totalBudgetMicrousd);
  const maximum = unsigned(policy.maximumIncrementalCostPerOperationMicrousd);
  const profiles = new Set(policy.eligibleProfileVersionIds);
  if (!policy.id
    || policy.lifecycle !== "PUBLISHED"
    || !Number.isInteger(policy.version)
    || policy.version <= 0
    || !Number.isInteger(policy.allocationBps)
    || policy.allocationBps < 100
    || policy.allocationBps > 500
    || total <= 0n
    || maximum <= 0n
    || maximum > total
    || !Number.isInteger(policy.maximumSelectionsPerUser)
    || policy.maximumSelectionsPerUser <= 0
    || policy.eligibleProfileVersionIds.length === 0
    || profiles.size !== policy.eligibleProfileVersionIds.length
    || policy.eligibleProfileVersionIds.some((profile) => !profile.trim())
    || Number.isNaN(start)
    || Number.isNaN(end)
    || end <= start
    || policy.platformFunded !== true
    || policy.customerSurchargeAllowed !== false
    || policy.assignmentHash !== "SHA256_MOD_10000"
    || Number.isNaN(Date.parse(policy.publishedAt))) {
    throw new SmartBetaError("INVALID_EXPLORATION_POLICY", "Exploration Policy must be published, platform-funded and bounded to 1–5 percent.");
  }
}

function publicReservation(reservation: MutableReservation): ExplorationReservation {
  return {
    ...reservation,
    reservedIncrementalCostMicrousd: reservation.reservedIncrementalCostMicrousd.toString(),
    settledIncrementalCostMicrousd: reservation.settledIncrementalCostMicrousd.toString(),
    releasedIncrementalCostMicrousd: reservation.releasedIncrementalCostMicrousd.toString(),
  };
}

export class InMemoryExplorationBudget {
  private availableBudgetMicrousd: bigint;
  private reservedBudgetMicrousd = 0n;
  private settledBudgetMicrousd = 0n;
  private releasedBudgetMicrousd = 0n;
  private killSwitchActive = false;
  private readonly plans = new Map<string, { intentHash: string; plan: ExplorationPlan }>();
  private readonly reservations = new Map<string, MutableReservation>();
  private readonly selectionsByUser = new Map<string, number>();
  private readonly ledger: ExplorationLedgerEntry[] = [];

  constructor(
    private readonly policy: ExplorationBudgetPolicyVersion,
    private readonly now: () => Date = () => new Date(),
  ) {
    validatePolicy(policy);
    this.availableBudgetMicrousd = unsigned(policy.totalBudgetMicrousd);
  }

  plan(input: {
    requestId: string;
    userKey: string;
    assignmentKey: string;
    profileVersionId: string;
    smartOptInActive: boolean;
    evaluationReadiness: "READY" | "INSUFFICIENT_SAMPLES";
    baselineExpectedCostMicrousd: string;
    explorationMaximumCostMicrousd: string;
    customerEconomicValueMicrousd: string;
    hardFloorMarginBps: number;
  }): ExplorationPlan {
    const evaluatedAt = this.now();
    const baselineCost = unsigned(input.baselineExpectedCostMicrousd);
    const explorationCost = unsigned(input.explorationMaximumCostMicrousd);
    const customerValue = unsigned(input.customerEconomicValueMicrousd);
    if (!input.requestId
      || !input.userKey
      || !input.assignmentKey
      || !input.profileVersionId
      || Number.isNaN(evaluatedAt.getTime())
      || !Number.isInteger(input.hardFloorMarginBps)
      || input.hardFloorMarginBps < 0
      || input.hardFloorMarginBps >= 10_000
      || customerValue <= 0n) {
      throw new SmartBetaError("EXPLORATION_NOT_ELIGIBLE", "Exploration requires a valid server-owned request and economic snapshot.");
    }
    const intentHash = evidenceHash(input);
    const prior = this.plans.get(input.requestId);
    if (prior) {
      if (prior.intentHash === intentHash) return structuredClone(prior.plan);
      throw new SmartBetaError("EXPLORATION_REQUEST_CONFLICT", "Exploration Request ID was reused with different intent.");
    }
    const windowStart = Date.parse(this.policy.windowStartsAt);
    const windowEnd = Date.parse(this.policy.windowEndsAt);
    if (!input.smartOptInActive
      || input.evaluationReadiness !== "READY"
      || !this.policy.eligibleProfileVersionIds.includes(input.profileVersionId)
      || evaluatedAt.getTime() < windowStart
      || evaluatedAt.getTime() >= windowEnd) {
      throw new SmartBetaError("EXPLORATION_NOT_ELIGIBLE", "Exploration requires active consent, ready evaluation, eligible Profile and active window.");
    }
    const assignmentKeyHash = evidenceHash(input.assignmentKey);
    const userKeyHash = evidenceHash(input.userKey);
    const bucketBps = Number(BigInt(`0x${assignmentKeyHash.slice(0, 16)}`) % 10_000n);
    if (this.killSwitchActive || bucketBps >= this.policy.allocationBps) {
      const plan: ExplorationPlan = {
        requestId: input.requestId,
        policyVersionId: this.policy.id,
        assignmentKeyHash,
        bucketBps,
        selection: "CONTROL",
        reservationId: null,
        reservedIncrementalCostMicrousd: "0",
        customerQuotedCreditsUnchanged: true,
        customerSurchargeMicrousd: "0",
        platformFunded: true,
        dispatchMutationPerformed: false,
        reason: this.killSwitchActive ? "KILL_SWITCH_ACTIVE" : "BUCKET_CONTROL",
      };
      this.plans.set(input.requestId, { intentHash, plan });
      return structuredClone(plan);
    }
    if ((this.selectionsByUser.get(userKeyHash) ?? 0) >= this.policy.maximumSelectionsPerUser) {
      throw new SmartBetaError("EXPLORATION_NOT_ELIGIBLE", "Per-user Exploration selection cap was reached.");
    }
    const projectedMarginNumerator = customerValue - explorationCost;
    if (projectedMarginNumerator * 10_000n < customerValue * BigInt(input.hardFloorMarginBps)) {
      throw new SmartBetaError("EXPLORATION_MARGIN_FLOOR_BREACH", "Exploration maximum cost would breach the customer contract Margin Floor.");
    }
    const incrementalCost = explorationCost > baselineCost ? explorationCost - baselineCost : 0n;
    const maximumIncremental = unsigned(this.policy.maximumIncrementalCostPerOperationMicrousd);
    if (incrementalCost <= 0n || incrementalCost > maximumIncremental || incrementalCost > this.availableBudgetMicrousd) {
      throw new SmartBetaError("EXPLORATION_BUDGET_INSUFFICIENT", "Platform Exploration budget cannot cover the incremental maximum exposure.");
    }
    const reservationId = `exploration-reservation:${input.requestId}`;
    const reservation: MutableReservation = {
      reservationId,
      requestId: input.requestId,
      userKeyHash,
      profileVersionId: input.profileVersionId,
      reservedIncrementalCostMicrousd: incrementalCost,
      settledIncrementalCostMicrousd: 0n,
      releasedIncrementalCostMicrousd: 0n,
      state: "RESERVED",
      createdAt: evaluatedAt.toISOString(),
      terminalAt: null,
    };
    this.availableBudgetMicrousd -= incrementalCost;
    this.reservedBudgetMicrousd += incrementalCost;
    this.reservations.set(reservationId, reservation);
    this.selectionsByUser.set(userKeyHash, (this.selectionsByUser.get(userKeyHash) ?? 0) + 1);
    this.appendEntry(reservationId, "RESERVE", incrementalCost, evaluatedAt);
    const plan: ExplorationPlan = {
      requestId: input.requestId,
      policyVersionId: this.policy.id,
      assignmentKeyHash,
      bucketBps,
      selection: "EXPLORATION",
      reservationId,
      reservedIncrementalCostMicrousd: incrementalCost.toString(),
      customerQuotedCreditsUnchanged: true,
      customerSurchargeMicrousd: "0",
      platformFunded: true,
      dispatchMutationPerformed: false,
      reason: "EXPLORATION_RESERVED",
    };
    this.plans.set(input.requestId, { intentHash, plan });
    return structuredClone(plan);
  }

  settle(reservationId: string, actualIncrementalCostMicrousd: string): ExplorationReservation {
    const reservation = this.requireReservation(reservationId);
    const actual = unsigned(actualIncrementalCostMicrousd);
    if (reservation.state === "SETTLED") {
      if (reservation.settledIncrementalCostMicrousd === actual) return publicReservation(reservation);
      throw new SmartBetaError("EXPLORATION_SETTLEMENT_CONFLICT", "Settled Exploration cost cannot be changed.");
    }
    if (reservation.state !== "RESERVED" || actual > reservation.reservedIncrementalCostMicrousd) {
      throw new SmartBetaError("EXPLORATION_SETTLEMENT_CONFLICT", "Actual incremental cost must fit the active reservation.");
    }
    const terminalAt = this.now();
    const release = reservation.reservedIncrementalCostMicrousd - actual;
    this.reservedBudgetMicrousd -= reservation.reservedIncrementalCostMicrousd;
    this.settledBudgetMicrousd += actual;
    this.availableBudgetMicrousd += release;
    this.releasedBudgetMicrousd += release;
    reservation.settledIncrementalCostMicrousd = actual;
    reservation.releasedIncrementalCostMicrousd = release;
    reservation.state = "SETTLED";
    reservation.terminalAt = terminalAt.toISOString();
    this.appendEntry(reservationId, "SETTLE", actual, terminalAt);
    if (release > 0n) this.appendEntry(reservationId, "RELEASE", release, terminalAt);
    return publicReservation(reservation);
  }

  release(reservationId: string): ExplorationReservation {
    const reservation = this.requireReservation(reservationId);
    if (reservation.state === "RELEASED") return publicReservation(reservation);
    if (reservation.state !== "RESERVED") {
      throw new SmartBetaError("EXPLORATION_SETTLEMENT_CONFLICT", "Only an active Exploration reservation can be released.");
    }
    const terminalAt = this.now();
    const amount = reservation.reservedIncrementalCostMicrousd;
    this.reservedBudgetMicrousd -= amount;
    this.availableBudgetMicrousd += amount;
    this.releasedBudgetMicrousd += amount;
    reservation.releasedIncrementalCostMicrousd = amount;
    reservation.state = "RELEASED";
    reservation.terminalAt = terminalAt.toISOString();
    this.appendEntry(reservationId, "RELEASE", amount, terminalAt);
    return publicReservation(reservation);
  }

  activateKillSwitch(): ExplorationBudgetSnapshot {
    this.killSwitchActive = true;
    return this.snapshot();
  }

  snapshot(): ExplorationBudgetSnapshot {
    return {
      policyVersionId: this.policy.id,
      allocationBps: this.policy.allocationBps,
      totalBudgetMicrousd: this.policy.totalBudgetMicrousd,
      availableBudgetMicrousd: this.availableBudgetMicrousd.toString(),
      reservedBudgetMicrousd: this.reservedBudgetMicrousd.toString(),
      settledBudgetMicrousd: this.settledBudgetMicrousd.toString(),
      releasedBudgetMicrousd: this.releasedBudgetMicrousd.toString(),
      killSwitchActive: this.killSwitchActive,
      reservationCount: this.reservations.size,
      ledgerEntryCount: this.ledger.length,
      ledgerChainValid: this.verifyLedgerChain(),
      customerSurchargeMicrousd: "0",
      externalDispatchPerformed: false,
    };
  }

  entries(): readonly ExplorationLedgerEntry[] {
    return structuredClone(this.ledger);
  }

  private requireReservation(reservationId: string): MutableReservation {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new SmartBetaError("EXPLORATION_RESERVATION_NOT_FOUND", "Exploration reservation was not found.");
    return reservation;
  }

  private appendEntry(
    reservationId: string,
    type: ExplorationLedgerEntry["type"],
    amount: bigint,
    occurredAt: Date,
  ): void {
    const sequence = this.ledger.length + 1;
    const previousEntryHash = this.ledger.at(-1)?.entryHash ?? null;
    const intent = {
      sequence,
      entryId: `exploration-entry:${sequence}`,
      reservationId,
      type,
      amountMicrousd: amount.toString(),
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
}
