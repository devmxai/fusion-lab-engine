export type TreasuryState = "HEALTHY" | "WARNING" | "CRITICAL" | "DISPATCH_STOP";

export type FundingLot = {
  id: string;
  providerAccountId: string;
  nativeReceivedAtomic: bigint;
  nativeRemainingAtomic: bigint;
  cashPaidMicrousd: bigint;
  cashAllocatedMicrousd: bigint;
  nativeFaceValueMicrousdPerAtomic: bigint;
  fundedAt: string;
  sourceEvidenceHash: string;
};

export type FundingAllocation = {
  fundingLotId: string;
  nativeAtomic: bigint;
  cashCostMicrousd: bigint;
};

export type ActualCostRecord = {
  usageId: string;
  operationId: string;
  providerAccountId: string;
  source: "usage.cost" | "creditsConsumed" | "balance_delta";
  sourceEvidenceHash: string;
  usageNativeAtomic: bigint;
  nativeBookValueMicrousd: bigint;
  cashCostMicrousd: bigint;
  fundingFeeEffectMicrousd: bigint;
  allocations: FundingAllocation[];
  recordedAt: string;
};

export type ProviderBalanceSnapshot = {
  id: string;
  providerAccountId: string;
  confirmedRemainingAtomic: bigint;
  capturedAt: string;
  sourceEvidenceHash: string;
};

export type ProviderCommitmentState =
  | "SUBMITTED"
  | "RUNNING"
  | "SUBMISSION_UNKNOWN"
  | "RECONCILIATION_UNCERTAINTY"
  | "TERMINAL";

export type ProviderCommitment = {
  operationId: string;
  providerAccountId: string;
  state: ProviderCommitmentState;
  maximumExposureAtomic: bigint;
  updatedAt: string;
};

export type SpendLimitPolicy = {
  perJobAtomic: bigint;
  dailyAtomic: bigint;
  monthlyAtomic: bigint;
};

export type TreasuryPolicy = {
  safetyReserveAtomic: bigint;
  largestAllowedJobAtomic: bigint;
  fundingLeadTimeDays: number;
  spendLimits: SpendLimitPolicy;
};

export class ProviderTreasuryError extends Error {
  constructor(
    public readonly code:
      | "INVALID_DECIMAL"
      | "DUPLICATE_FUNDING_LOT"
      | "INVALID_FUNDING_LOT"
      | "UNKNOWN_ACTUAL_COST"
      | "INSUFFICIENT_FUNDED_NATIVE_UNITS"
      | "ACTUAL_COST_CONFLICT"
      | "DUPLICATE_BALANCE_SNAPSHOT"
      | "COMMITMENT_CONFLICT"
      | "EXACT_EQUIVALENCE_REQUIRED"
      | "EQUIVALENCE_CONFLICT"
      | "CIRCUIT_OPEN"
      | "SPEND_LIMIT_EXCEEDED"
      | "INSUFFICIENT_SHADOW_BALANCE",
    message: string,
  ) {
    super(message);
    this.name = "ProviderTreasuryError";
  }
}
