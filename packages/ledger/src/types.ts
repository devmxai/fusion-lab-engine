export type CreditAccountKind =
  | "USER_AVAILABLE"
  | "USER_HELD"
  | "PLATFORM_ISSUED"
  | "PLATFORM_EARNED"
  | "PLATFORM_EXPIRED"
  | "PLATFORM_ADJUSTMENTS";

export type CreditAccount = {
  id: string;
  kind: CreditAccountKind;
  ownerId: string | null;
};

export type CreditLedgerEntry = {
  accountId: string;
  amount: bigint;
};

export type CreditJournal = {
  id: string;
  commandId: string;
  kind: "GRANT" | "RESERVE" | "SETTLE" | "RELEASE" | "EXPIRE" | "WITHDRAW_LOT" | "ADJUST_CREDIT" | "ADJUST_DEBIT";
  operationId: string | null;
  entries: CreditLedgerEntry[];
  reasonCode: string;
  createdAt: string;
};

export type CreditLot = {
  id: string;
  ownerId: string;
  source: "PURCHASED" | "SUBSCRIPTION" | "PROMOTION" | "ADMIN_ADJUSTMENT" | "LEGACY_OPENING";
  granted: bigint;
  available: bigint;
  held: bigint;
  consumed: bigint;
  expired: bigint;
  withdrawn: bigint;
  expiresAt: string | null;
  createdAt: string;
};

export type ReservationAllocation = {
  lotId: string;
  credits: bigint;
};

export type CreditReservation = {
  id: string;
  operationId: string;
  ownerId: string;
  quotedCredits: bigint;
  heldCredits: bigint;
  capturedCredits: bigint;
  releasedCredits: bigint;
  state: "HELD" | "SETTLED" | "RELEASED";
  allocations: ReservationAllocation[];
  createdAt: string;
  updatedAt: string;
};

export type WalletProjection = {
  ownerId: string;
  available: bigint;
  held: bigint;
};

export class LedgerDomainError extends Error {
  constructor(
    public readonly code:
      | "COMMAND_CONFLICT"
      | "DUPLICATE_LOT"
      | "DUPLICATE_OPERATION_RESERVATION"
      | "INSUFFICIENT_CREDITS"
      | "UNKNOWN_RESERVATION"
      | "RESERVATION_NOT_HELD"
      | "CAPTURE_EXCEEDS_QUOTE"
      | "LOT_NOT_EXPIRABLE"
      | "MAKER_CHECKER_REQUIRED"
      | "UNBALANCED_JOURNAL"
      | "NEGATIVE_ACCOUNT"
      | "INVARIANT_VIOLATION",
    message: string,
  ) {
    super(message);
    this.name = "LedgerDomainError";
  }
}
