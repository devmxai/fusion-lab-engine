import { createHash } from "node:crypto";
import {
  ProviderTreasuryError,
  type ActualCostRecord,
  type FundingAllocation,
  type FundingLot,
} from "./types.ts";

function canonicalHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item)).digest("hex");
}

export class ProviderFundingBook {
  private readonly lots = new Map<string, FundingLot>();
  private readonly actualCosts = new Map<string, { hash: string; record: ActualCostRecord }>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  addLot(input: Omit<FundingLot, "nativeRemainingAtomic" | "cashAllocatedMicrousd">): FundingLot {
    if (this.lots.has(input.id)) {
      throw new ProviderTreasuryError("DUPLICATE_FUNDING_LOT", "Funding lot IDs are immutable and unique.");
    }
    if (
      !input.id
      || !input.providerAccountId
      || input.nativeReceivedAtomic <= 0n
      || input.cashPaidMicrousd <= 0n
      || input.nativeFaceValueMicrousdPerAtomic <= 0n
      || !/^[a-f0-9]{64}$/.test(input.sourceEvidenceHash)
      || Number.isNaN(Date.parse(input.fundedAt))
    ) {
      throw new ProviderTreasuryError("INVALID_FUNDING_LOT", "Funding lot is incomplete or not auditable.");
    }
    const lot: FundingLot = {
      ...structuredClone(input),
      nativeRemainingAtomic: input.nativeReceivedAtomic,
      cashAllocatedMicrousd: 0n,
    };
    this.lots.set(lot.id, lot);
    return structuredClone(lot);
  }

  recordActualCost(input: {
    usageId: string;
    operationId: string;
    providerAccountId: string;
    source: ActualCostRecord["source"];
    sourceEvidenceHash: string;
    usageNativeAtomic: bigint | null;
  }): ActualCostRecord {
    if (input.usageNativeAtomic === null) {
      throw new ProviderTreasuryError("UNKNOWN_ACTUAL_COST", "Terminal provider usage must contain an exact actual cost.");
    }
    if (input.usageNativeAtomic < 0n || !/^[a-f0-9]{64}$/.test(input.sourceEvidenceHash)) {
      throw new ProviderTreasuryError("UNKNOWN_ACTUAL_COST", "Actual cost is invalid or lacks source evidence.");
    }
    const intentHash = canonicalHash(input);
    const existing = this.actualCosts.get(input.usageId);
    if (existing) {
      if (existing.hash !== intentHash) {
        throw new ProviderTreasuryError("ACTUAL_COST_CONFLICT", "Usage ID was replayed with different actual cost intent.");
      }
      return structuredClone(existing.record);
    }

    let remaining = input.usageNativeAtomic;
    const candidates = [...this.lots.values()]
      .filter((lot) => lot.providerAccountId === input.providerAccountId && lot.nativeRemainingAtomic > 0n)
      .sort((left, right) => left.fundedAt.localeCompare(right.fundedAt) || left.id.localeCompare(right.id));
    if (candidates.reduce((total, lot) => total + lot.nativeRemainingAtomic, 0n) < remaining) {
      throw new ProviderTreasuryError(
        "INSUFFICIENT_FUNDED_NATIVE_UNITS",
        "Actual usage exceeds the provider native units represented by funding lots.",
      );
    }

    const allocations: FundingAllocation[] = [];
    for (const lot of candidates) {
      if (remaining === 0n) break;
      const nativeAtomic = lot.nativeRemainingAtomic < remaining ? lot.nativeRemainingAtomic : remaining;
      const nativeConsumedBefore = lot.nativeReceivedAtomic - lot.nativeRemainingAtomic;
      const nativeConsumedAfter = nativeConsumedBefore + nativeAtomic;
      const cumulativeCashAfter = (
        nativeConsumedAfter * lot.cashPaidMicrousd + lot.nativeReceivedAtomic - 1n
      ) / lot.nativeReceivedAtomic;
      const cashCostMicrousd = cumulativeCashAfter - lot.cashAllocatedMicrousd;
      lot.nativeRemainingAtomic -= nativeAtomic;
      lot.cashAllocatedMicrousd = cumulativeCashAfter;
      allocations.push({ fundingLotId: lot.id, nativeAtomic, cashCostMicrousd });
      remaining -= nativeAtomic;
    }
    const cashCostMicrousd = allocations.reduce((total, allocation) => total + allocation.cashCostMicrousd, 0n);
    const nativeBookValueMicrousd = allocations.reduce((total, allocation) => {
      const lot = this.lots.get(allocation.fundingLotId)!;
      return total + allocation.nativeAtomic * lot.nativeFaceValueMicrousdPerAtomic;
    }, 0n);
    const record: ActualCostRecord = {
      usageId: input.usageId,
      operationId: input.operationId,
      providerAccountId: input.providerAccountId,
      source: input.source,
      sourceEvidenceHash: input.sourceEvidenceHash,
      usageNativeAtomic: input.usageNativeAtomic,
      nativeBookValueMicrousd,
      cashCostMicrousd,
      fundingFeeEffectMicrousd: cashCostMicrousd - nativeBookValueMicrousd,
      allocations,
      recordedAt: this.now().toISOString(),
    };
    this.actualCosts.set(input.usageId, { hash: intentHash, record });
    return structuredClone(record);
  }

  lotsSnapshot(providerAccountId?: string): ReadonlyArray<Readonly<FundingLot>> {
    return structuredClone([...this.lots.values()].filter((lot) => !providerAccountId || lot.providerAccountId === providerAccountId));
  }

  actualCostsSnapshot(): ReadonlyArray<Readonly<ActualCostRecord>> {
    return structuredClone([...this.actualCosts.values()].map(({ record }) => record));
  }
}
