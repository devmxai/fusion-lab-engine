import { createHash } from "node:crypto";
import {
  ProviderTreasuryError,
  type ProviderBalanceSnapshot,
  type ProviderCommitment,
  type ProviderCommitmentState,
  type TreasuryPolicy,
  type TreasuryState,
} from "./types.ts";

type BurnRecord = { id: string; providerAccountId: string; actualAtomic: bigint; occurredAt: string };
type SpendRecord = { id: string; providerAccountId: string; actualAtomic: bigint; occurredAt: string };

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item)).digest("hex");
}

export class ProviderTreasury {
  private readonly snapshots = new Map<string, ProviderBalanceSnapshot>();
  private readonly commitments = new Map<string, { hash: string; value: ProviderCommitment }>();
  private readonly burns = new Map<string, BurnRecord>();
  private readonly spend = new Map<string, SpendRecord>();
  private readonly circuits = new Map<string, { open: boolean; reasonCode: string | null }>();

  constructor(
    private readonly policies: ReadonlyMap<string, TreasuryPolicy>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  recordBalanceSnapshot(snapshot: ProviderBalanceSnapshot): ProviderBalanceSnapshot {
    if (this.snapshots.has(snapshot.id)) {
      throw new ProviderTreasuryError("DUPLICATE_BALANCE_SNAPSHOT", "Balance snapshot IDs are immutable.");
    }
    if (snapshot.confirmedRemainingAtomic < 0n || !/^[a-f0-9]{64}$/.test(snapshot.sourceEvidenceHash)) {
      throw new ProviderTreasuryError("DUPLICATE_BALANCE_SNAPSHOT", "Balance snapshot is invalid or unaudited.");
    }
    this.snapshots.set(snapshot.id, structuredClone(snapshot));
    return structuredClone(snapshot);
  }

  recordCommitment(input: Omit<ProviderCommitment, "updatedAt">): ProviderCommitment {
    if (input.maximumExposureAtomic < 0n) throw new TypeError("Maximum exposure cannot be negative.");
    const intentHash = hash(input);
    const existing = this.commitments.get(input.operationId);
    if (existing && existing.hash === intentHash) return structuredClone(existing.value);
    if (existing?.value.state === "TERMINAL") {
      throw new ProviderTreasuryError("COMMITMENT_CONFLICT", "A terminal provider commitment cannot be reopened.");
    }
    const value = { ...structuredClone(input), updatedAt: this.now().toISOString() };
    this.commitments.set(input.operationId, { hash: intentHash, value });
    return structuredClone(value);
  }

  recordActualSpend(record: SpendRecord): void {
    const existing = this.spend.get(record.id);
    if (existing && hash(existing) !== hash(record)) {
      throw new ProviderTreasuryError("COMMITMENT_CONFLICT", "Spend ID conflicts with existing evidence.");
    }
    if (record.actualAtomic < 0n || Number.isNaN(Date.parse(record.occurredAt))) throw new TypeError("Spend record is invalid.");
    this.spend.set(record.id, structuredClone(record));
    this.burns.set(record.id, structuredClone(record));
  }

  setCircuit(providerAccountId: string, open: boolean, reasonCode: string | null): void {
    if (open && !reasonCode) throw new TypeError("An open provider circuit requires a reason code.");
    this.circuits.set(providerAccountId, { open, reasonCode });
  }

  authorizeDispatch(providerAccountId: string, maximumExposureAtomic: bigint): void {
    const dashboard = this.dashboard(providerAccountId);
    const policy = this.requirePolicy(providerAccountId);
    if (dashboard.circuit.open) throw new ProviderTreasuryError("CIRCUIT_OPEN", "Provider circuit breaker is open.");
    if (dashboard.state === "CRITICAL" || dashboard.state === "DISPATCH_STOP") {
      throw new ProviderTreasuryError(
        "INSUFFICIENT_SHADOW_BALANCE",
        "Provider runway cannot cover the largest approved exposure.",
      );
    }
    if (maximumExposureAtomic <= 0n || maximumExposureAtomic > policy.spendLimits.perJobAtomic) {
      throw new ProviderTreasuryError("SPEND_LIMIT_EXCEEDED", "Maximum job exposure exceeds the per-job limit.");
    }
    if (
      dashboard.burn24hAtomic + maximumExposureAtomic > policy.spendLimits.dailyAtomic
      || dashboard.burnMonthAtomic + maximumExposureAtomic > policy.spendLimits.monthlyAtomic
    ) {
      throw new ProviderTreasuryError("SPEND_LIMIT_EXCEEDED", "Dispatch would exceed a provider spend limit.");
    }
    if (dashboard.shadowAvailableAtomic < maximumExposureAtomic) {
      throw new ProviderTreasuryError("INSUFFICIENT_SHADOW_BALANCE", "Shadow balance cannot cover the new maximum exposure.");
    }
  }

  dashboard(providerAccountId: string) {
    const policy = this.requirePolicy(providerAccountId);
    const snapshot = [...this.snapshots.values()]
      .filter((candidate) => candidate.providerAccountId === providerAccountId)
      .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt)).at(-1) ?? null;
    const active = [...this.commitments.values()].map(({ value }) => value)
      .filter((commitment) => commitment.providerAccountId === providerAccountId && commitment.state !== "TERMINAL");
    const submittedRunning = this.exposure(active, ["SUBMITTED", "RUNNING"]);
    const unknown = this.exposure(active, ["SUBMISSION_UNKNOWN"]);
    const uncertainty = this.exposure(active, ["RECONCILIATION_UNCERTAINTY"]);
    const commitmentsAtomic = submittedRunning + unknown + uncertainty;
    const confirmedRemainingAtomic = snapshot?.confirmedRemainingAtomic ?? 0n;
    const shadowAvailableAtomic = confirmedRemainingAtomic - commitmentsAtomic - policy.safetyReserveAtomic;
    const now = this.now().getTime();
    const burn1hAtomic = this.burn(providerAccountId, now - 60 * 60 * 1_000);
    const burn24hAtomic = this.burn(providerAccountId, now - 24 * 60 * 60 * 1_000);
    const burn7dAtomic = this.burn(providerAccountId, now - 7 * 24 * 60 * 60 * 1_000);
    const burnMonthAtomic = this.burn(providerAccountId, now - 31 * 24 * 60 * 60 * 1_000);
    const forecastDailyBurnAtomic = [burn1hAtomic * 24n, burn24hAtomic, (burn7dAtomic + 6n) / 7n]
      .reduce((maximum, value) => value > maximum ? value : maximum, 0n);
    const largestExposureAtomic = active.reduce(
      (maximum, commitment) => commitment.maximumExposureAtomic > maximum ? commitment.maximumExposureAtomic : maximum,
      policy.largestAllowedJobAtomic,
    );
    const fundingLeadBurnAtomic = forecastDailyBurnAtomic * BigInt(policy.fundingLeadTimeDays);
    const reorderPointAtomic = fundingLeadBurnAtomic
      + largestExposureAtomic
      + unknown
      + policy.safetyReserveAtomic;
    const circuit = this.circuits.get(providerAccountId) ?? { open: false, reasonCode: null };
    let state: TreasuryState;
    if (circuit.open || shadowAvailableAtomic <= 0n) state = "DISPATCH_STOP";
    else if (shadowAvailableAtomic < largestExposureAtomic) state = "CRITICAL";
    else if (shadowAvailableAtomic < reorderPointAtomic) state = "WARNING";
    else state = "HEALTHY";
    return {
      providerAccountId,
      state,
      confirmedBalanceSnapshotId: snapshot?.id ?? null,
      confirmedRemainingAtomic,
      submittedRunningExposureAtomic: submittedRunning,
      unknownExposureAtomic: unknown,
      reconciliationUncertaintyAtomic: uncertainty,
      safetyReserveAtomic: policy.safetyReserveAtomic,
      shadowAvailableAtomic,
      burn1hAtomic,
      burn24hAtomic,
      burn7dAtomic,
      burnMonthAtomic,
      forecastDailyBurnAtomic,
      largestExposureAtomic,
      reorderPointAtomic,
      runway: forecastDailyBurnAtomic > 0n
        ? { numeratorDays: shadowAvailableAtomic > 0n ? shadowAvailableAtomic : 0n, denominatorDailyBurn: forecastDailyBurnAtomic }
        : null,
      rechargeRecommendedAtomic: shadowAvailableAtomic < reorderPointAtomic ? reorderPointAtomic - shadowAvailableAtomic : 0n,
      circuit,
    };
  }

  snapshotsView(): ReadonlyArray<Readonly<ProviderBalanceSnapshot>> {
    return structuredClone([...this.snapshots.values()]);
  }

  commitmentsView(): ReadonlyArray<Readonly<ProviderCommitment>> {
    return structuredClone([...this.commitments.values()].map(({ value }) => value));
  }

  private exposure(commitments: ProviderCommitment[], states: ProviderCommitmentState[]): bigint {
    return commitments.filter(({ state }) => states.includes(state))
      .reduce((total, commitment) => total + commitment.maximumExposureAtomic, 0n);
  }

  private burn(providerAccountId: string, since: number): bigint {
    return [...this.burns.values()]
      .filter((record) => record.providerAccountId === providerAccountId && Date.parse(record.occurredAt) >= since)
      .reduce((total, record) => total + record.actualAtomic, 0n);
  }

  private requirePolicy(providerAccountId: string): TreasuryPolicy {
    const policy = this.policies.get(providerAccountId);
    if (!policy) throw new ProviderTreasuryError("CIRCUIT_OPEN", "Provider account has no approved Treasury policy.");
    return policy;
  }
}
