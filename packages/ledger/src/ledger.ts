import { createHash, randomUUID } from "node:crypto";
import { requirePositiveWholeCredits } from "./amounts.ts";
import {
  type CreditAccount,
  type CreditJournal,
  type CreditLedgerEntry,
  type CreditLot,
  type CreditReservation,
  LedgerDomainError,
  type ReservationAllocation,
  type WalletProjection,
} from "./types.ts";

type CommandRecord = {
  commandType: string;
  commandHash: string;
  result: unknown;
};

type StateSnapshot = {
  accounts: Array<[string, CreditAccount]>;
  projection: Array<[string, bigint]>;
  journals: CreditJournal[];
  lots: Array<[string, CreditLot]>;
  reservations: Array<[string, CreditReservation]>;
  operationReservations: Array<[string, string]>;
  commands: Array<[string, CommandRecord]>;
};

export type JournalResult = { journal: CreditJournal };
export type GrantResult = JournalResult & { lot: CreditLot };
export type ReserveResult = JournalResult & { reservation: CreditReservation };
export type ReservationResult = JournalResult & { reservation: CreditReservation };
export type LotWithdrawalResult = { journal: CreditJournal | null; lot: CreditLot; withdrawnCredits: bigint };

function hashCommand(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? `${item.toString()}n` : item);
  return createHash("sha256").update(serialized).digest("hex");
}

function compareLots(left: CreditLot, right: CreditLot): number {
  if (left.expiresAt === null && right.expiresAt !== null) return 1;
  if (left.expiresAt !== null && right.expiresAt === null) return -1;
  if (left.expiresAt !== right.expiresAt) return (left.expiresAt ?? "").localeCompare(right.expiresAt ?? "");
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export class InMemoryWholeCreditLedger {
  private readonly accounts = new Map<string, CreditAccount>();
  private readonly projection = new Map<string, bigint>();
  private readonly journals: CreditJournal[] = [];
  private readonly lots = new Map<string, CreditLot>();
  private readonly reservations = new Map<string, CreditReservation>();
  private readonly operationReservations = new Map<string, string>();
  private readonly commands = new Map<string, CommandRecord>();

  constructor(private readonly now: () => Date = () => new Date()) {
    this.ensurePlatformAccounts();
  }

  transaction<Result>(work: () => Result): Result {
    return this.atomic(() => {
      const result = work();
      this.verifyInvariants();
      return result;
    });
  }

  grant(input: {
    commandId: string;
    ownerId: string;
    lotId: string;
    credits: bigint;
    source: CreditLot["source"];
    expiresAt?: string | null;
    reasonCode: string;
  }): GrantResult {
    requirePositiveWholeCredits(input.credits);
    return this.execute("GRANT", input.commandId, input, () => {
      if (this.lots.has(input.lotId)) {
        throw new LedgerDomainError("DUPLICATE_LOT", "A credit lot ID can be created only once.");
      }
      const createdAt = this.now().toISOString();
      const lot: CreditLot = {
        id: input.lotId,
        ownerId: input.ownerId,
        source: input.source,
        granted: input.credits,
        available: input.credits,
        held: 0n,
        consumed: 0n,
        expired: 0n,
        withdrawn: 0n,
        expiresAt: input.expiresAt ?? null,
        createdAt,
      };
      this.ensureUserAccounts(input.ownerId);
      const journal = this.postJournal({
        commandId: input.commandId,
        kind: "GRANT",
        operationId: null,
        reasonCode: input.reasonCode,
        entries: [
          { accountId: "platform:issued", amount: -input.credits },
          { accountId: this.availableAccountId(input.ownerId), amount: input.credits },
        ],
      });
      this.lots.set(lot.id, lot);
      return { journal, lot };
    });
  }

  reserve(input: {
    commandId: string;
    reservationId: string;
    operationId: string;
    ownerId: string;
    quotedCredits: bigint;
  }): ReserveResult {
    requirePositiveWholeCredits(input.quotedCredits, "quotedCredits");
    return this.execute("RESERVE", input.commandId, input, () => {
      if (this.operationReservations.has(input.operationId)) {
        throw new LedgerDomainError(
          "DUPLICATE_OPERATION_RESERVATION",
          "An operation can own only one credit reservation.",
        );
      }
      const allocations = this.planAllocations(input.ownerId, input.quotedCredits);
      for (const allocation of allocations) {
        const lot = this.requireLot(allocation.lotId);
        lot.available -= allocation.credits;
        lot.held += allocation.credits;
      }
      const createdAt = this.now().toISOString();
      const reservation: CreditReservation = {
        id: input.reservationId,
        operationId: input.operationId,
        ownerId: input.ownerId,
        quotedCredits: input.quotedCredits,
        heldCredits: input.quotedCredits,
        capturedCredits: 0n,
        releasedCredits: 0n,
        state: "HELD",
        allocations,
        createdAt,
        updatedAt: createdAt,
      };
      const journal = this.postJournal({
        commandId: input.commandId,
        kind: "RESERVE",
        operationId: input.operationId,
        reasonCode: "OPERATION_QUOTE_RESERVED",
        entries: [
          { accountId: this.availableAccountId(input.ownerId), amount: -input.quotedCredits },
          { accountId: this.heldAccountId(input.ownerId), amount: input.quotedCredits },
        ],
      });
      this.reservations.set(reservation.id, reservation);
      this.operationReservations.set(input.operationId, reservation.id);
      return { journal, reservation };
    });
  }

  settle(input: {
    commandId: string;
    reservationId: string;
    captureCredits: bigint;
    reasonCode: string;
  }): ReservationResult {
    requirePositiveWholeCredits(input.captureCredits, "captureCredits");
    return this.execute("SETTLE", input.commandId, input, () => {
      const reservation = this.requireHeldReservation(input.reservationId);
      if (input.captureCredits > reservation.quotedCredits || input.captureCredits > reservation.heldCredits) {
        throw new LedgerDomainError("CAPTURE_EXCEEDS_QUOTE", "Settlement cannot exceed the quoted held credits.");
      }
      let remainingCapture = input.captureCredits;
      for (const allocation of reservation.allocations) {
        const lot = this.requireLot(allocation.lotId);
        const consumed = allocation.credits < remainingCapture ? allocation.credits : remainingCapture;
        const released = allocation.credits - consumed;
        lot.held -= allocation.credits;
        lot.consumed += consumed;
        lot.available += released;
        remainingCapture -= consumed;
      }
      const releasedCredits = reservation.heldCredits - input.captureCredits;
      const entries: CreditLedgerEntry[] = [
        { accountId: this.heldAccountId(reservation.ownerId), amount: -reservation.heldCredits },
        { accountId: "platform:earned", amount: input.captureCredits },
      ];
      if (releasedCredits > 0n) {
        entries.push({ accountId: this.availableAccountId(reservation.ownerId), amount: releasedCredits });
      }
      const journal = this.postJournal({
        commandId: input.commandId,
        kind: "SETTLE",
        operationId: reservation.operationId,
        reasonCode: input.reasonCode,
        entries,
      });
      reservation.heldCredits = 0n;
      reservation.capturedCredits = input.captureCredits;
      reservation.releasedCredits = releasedCredits;
      reservation.state = "SETTLED";
      reservation.updatedAt = this.now().toISOString();
      return { journal, reservation };
    });
  }

  release(input: {
    commandId: string;
    reservationId: string;
    reasonCode: string;
    evidenceHash: string;
  }): ReservationResult {
    if (!/^[a-f0-9]{64}$/.test(input.evidenceHash)) {
      throw new TypeError("Release evidence must be a lowercase SHA-256 hex string.");
    }
    return this.execute("RELEASE", input.commandId, input, () => {
      const reservation = this.requireHeldReservation(input.reservationId);
      for (const allocation of reservation.allocations) {
        const lot = this.requireLot(allocation.lotId);
        lot.held -= allocation.credits;
        lot.available += allocation.credits;
      }
      const releasedCredits = reservation.heldCredits;
      const journal = this.postJournal({
        commandId: input.commandId,
        kind: "RELEASE",
        operationId: reservation.operationId,
        reasonCode: input.reasonCode,
        entries: [
          { accountId: this.heldAccountId(reservation.ownerId), amount: -releasedCredits },
          { accountId: this.availableAccountId(reservation.ownerId), amount: releasedCredits },
        ],
      });
      reservation.heldCredits = 0n;
      reservation.releasedCredits = releasedCredits;
      reservation.state = "RELEASED";
      reservation.updatedAt = this.now().toISOString();
      return { journal, reservation };
    });
  }

  expire(input: {
    commandId: string;
    lotId: string;
    reasonCode: string;
    evaluatedAt: string;
  }): JournalResult {
    return this.execute("EXPIRE", input.commandId, input, () => {
      const lot = this.requireLot(input.lotId);
      if (!lot.expiresAt || input.evaluatedAt < lot.expiresAt || lot.available <= 0n) {
        throw new LedgerDomainError("LOT_NOT_EXPIRABLE", "Only an expired lot's available credits may expire.");
      }
      const credits = lot.available;
      lot.available = 0n;
      lot.expired += credits;
      const journal = this.postJournal({
        commandId: input.commandId,
        kind: "EXPIRE",
        operationId: null,
        reasonCode: input.reasonCode,
        entries: [
          { accountId: this.availableAccountId(lot.ownerId), amount: -credits },
          { accountId: "platform:expired", amount: credits },
        ],
      });
      return { journal };
    });
  }

  withdrawAvailableFromLot(input: {
    commandId: string;
    lotId: string;
    reasonCode: string;
  }): LotWithdrawalResult {
    return this.execute("WITHDRAW_LOT", input.commandId, input, () => {
      const lot = this.requireLot(input.lotId);
      const withdrawnCredits = lot.available;
      if (withdrawnCredits === 0n) return { journal: null, lot, withdrawnCredits };
      lot.available = 0n;
      lot.withdrawn += withdrawnCredits;
      const journal = this.postJournal({
        commandId: input.commandId,
        kind: "WITHDRAW_LOT",
        operationId: null,
        reasonCode: input.reasonCode,
        entries: [
          { accountId: this.availableAccountId(lot.ownerId), amount: -withdrawnCredits },
          { accountId: "platform:adjustments", amount: withdrawnCredits },
        ],
      });
      return { journal, lot, withdrawnCredits };
    });
  }

  adjust(input: {
    commandId: string;
    ownerId: string;
    direction: "CREDIT" | "DEBIT";
    credits: bigint;
    reasonCode: string;
    makerId: string;
    approverId: string;
    lotId?: string;
  }): GrantResult | JournalResult {
    requirePositiveWholeCredits(input.credits);
    if (input.makerId === input.approverId) {
      throw new LedgerDomainError("MAKER_CHECKER_REQUIRED", "Financial adjustments require distinct maker and approver identities.");
    }
    return this.execute(`ADJUST_${input.direction}`, input.commandId, input, () => {
      this.ensureUserAccounts(input.ownerId);
      if (input.direction === "CREDIT") {
        if (!input.lotId) throw new TypeError("Credit adjustment requires a lot ID.");
        if (this.lots.has(input.lotId)) {
          throw new LedgerDomainError("DUPLICATE_LOT", "A credit lot ID can be created only once.");
        }
        const createdAt = this.now().toISOString();
        const lot: CreditLot = {
          id: input.lotId,
          ownerId: input.ownerId,
          source: "ADMIN_ADJUSTMENT",
          granted: input.credits,
          available: input.credits,
          held: 0n,
          consumed: 0n,
          expired: 0n,
          withdrawn: 0n,
          expiresAt: null,
          createdAt,
        };
        const journal = this.postJournal({
          commandId: input.commandId,
          kind: "ADJUST_CREDIT",
          operationId: null,
          reasonCode: input.reasonCode,
          entries: [
            { accountId: "platform:adjustments", amount: -input.credits },
            { accountId: this.availableAccountId(input.ownerId), amount: input.credits },
          ],
        });
        this.lots.set(lot.id, lot);
        return { journal, lot };
      }

      const allocations = this.planAllocations(input.ownerId, input.credits);
      for (const allocation of allocations) {
        const lot = this.requireLot(allocation.lotId);
        lot.available -= allocation.credits;
        lot.withdrawn += allocation.credits;
      }
      const journal = this.postJournal({
        commandId: input.commandId,
        kind: "ADJUST_DEBIT",
        operationId: null,
        reasonCode: input.reasonCode,
        entries: [
          { accountId: this.availableAccountId(input.ownerId), amount: -input.credits },
          { accountId: "platform:adjustments", amount: input.credits },
        ],
      });
      return { journal };
    });
  }

  wallet(ownerId: string): WalletProjection {
    return {
      ownerId,
      available: this.projection.get(this.availableAccountId(ownerId)) ?? 0n,
      held: this.projection.get(this.heldAccountId(ownerId)) ?? 0n,
    };
  }

  journalsSnapshot(): ReadonlyArray<Readonly<CreditJournal>> {
    return structuredClone(this.journals);
  }

  lotsSnapshot(ownerId?: string): ReadonlyArray<Readonly<CreditLot>> {
    return structuredClone([...this.lots.values()].filter((lot) => ownerId === undefined || lot.ownerId === ownerId));
  }

  reservationsSnapshot(): ReadonlyArray<Readonly<CreditReservation>> {
    return structuredClone([...this.reservations.values()]);
  }

  rebuildProjection(): Map<string, bigint> {
    const rebuilt = new Map<string, bigint>();
    for (const accountId of this.accounts.keys()) rebuilt.set(accountId, 0n);
    for (const journal of this.journals) {
      for (const entry of journal.entries) {
        rebuilt.set(entry.accountId, (rebuilt.get(entry.accountId) ?? 0n) + entry.amount);
      }
    }
    return rebuilt;
  }

  verifyInvariants(): void {
    for (const journal of this.journals) {
      if (journal.entries.reduce((sum, entry) => sum + entry.amount, 0n) !== 0n) {
        throw new LedgerDomainError("INVARIANT_VIOLATION", `Journal ${journal.id} is not balanced.`);
      }
    }
    const rebuilt = this.rebuildProjection();
    for (const [accountId, expected] of rebuilt) {
      if (this.projection.get(accountId) !== expected) {
        throw new LedgerDomainError("INVARIANT_VIOLATION", `Projection mismatch for ${accountId}.`);
      }
      const account = this.accounts.get(accountId);
      if (account?.kind.startsWith("USER_") && expected < 0n) {
        throw new LedgerDomainError("INVARIANT_VIOLATION", `Negative protected account ${accountId}.`);
      }
    }
    for (const lot of this.lots.values()) {
      const conserved = lot.available + lot.held + lot.consumed + lot.expired + lot.withdrawn;
      if (conserved !== lot.granted || [lot.available, lot.held, lot.consumed, lot.expired, lot.withdrawn].some((v) => v < 0n)) {
        throw new LedgerDomainError("INVARIANT_VIOLATION", `Lot conservation failed for ${lot.id}.`);
      }
    }
    for (const reservation of this.reservations.values()) {
      if (reservation.capturedCredits > reservation.quotedCredits) {
        throw new LedgerDomainError("INVARIANT_VIOLATION", `Reservation ${reservation.id} exceeded its quote.`);
      }
      if (reservation.state === "HELD") {
        const allocated = reservation.allocations.reduce((sum, allocation) => sum + allocation.credits, 0n);
        if (allocated !== reservation.heldCredits) {
          throw new LedgerDomainError("INVARIANT_VIOLATION", `Reservation allocation mismatch for ${reservation.id}.`);
        }
      }
    }
  }

  private execute<Result>(
    commandType: string,
    commandId: string,
    input: unknown,
    work: () => Result,
  ): Result {
    if (commandId.length === 0) throw new TypeError("Command ID is required.");
    const commandHash = hashCommand({ commandType, input });
    const existing = this.commands.get(commandId);
    if (existing) {
      if (existing.commandType !== commandType || existing.commandHash !== commandHash) {
        throw new LedgerDomainError("COMMAND_CONFLICT", "A financial command ID cannot be reused with different intent.");
      }
      return structuredClone(existing.result) as Result;
    }
    return this.atomic(() => {
      const result = work();
      this.commands.set(commandId, { commandType, commandHash, result: structuredClone(result) });
      this.verifyInvariants();
      return structuredClone(result);
    });
  }

  private atomic<Result>(work: () => Result): Result {
    const snapshot = this.captureState();
    try {
      return work();
    } catch (error) {
      this.restoreState(snapshot);
      throw error;
    }
  }

  private postJournal(input: Omit<CreditJournal, "id" | "createdAt">): CreditJournal {
    if (input.entries.length < 2 || input.entries.some((entry) => entry.amount === 0n)) {
      throw new LedgerDomainError("UNBALANCED_JOURNAL", "A journal requires at least two non-zero entries.");
    }
    const sum = input.entries.reduce((total, entry) => total + entry.amount, 0n);
    if (sum !== 0n) throw new LedgerDomainError("UNBALANCED_JOURNAL", "Every credit journal must sum to zero.");
    for (const entry of input.entries) {
      if (!this.accounts.has(entry.accountId)) {
        throw new LedgerDomainError("INVARIANT_VIOLATION", `Unknown ledger account ${entry.accountId}.`);
      }
      const next = (this.projection.get(entry.accountId) ?? 0n) + entry.amount;
      const account = this.accounts.get(entry.accountId);
      if (account?.kind.startsWith("USER_") && next < 0n) {
        throw new LedgerDomainError("NEGATIVE_ACCOUNT", `Protected account ${entry.accountId} cannot become negative.`);
      }
    }
    const journal: CreditJournal = {
      ...structuredClone(input),
      id: randomUUID(),
      createdAt: this.now().toISOString(),
    };
    for (const entry of journal.entries) {
      this.projection.set(entry.accountId, (this.projection.get(entry.accountId) ?? 0n) + entry.amount);
    }
    this.journals.push(journal);
    return journal;
  }

  private planAllocations(ownerId: string, credits: bigint): ReservationAllocation[] {
    const candidates = [...this.lots.values()]
      .filter((lot) => lot.ownerId === ownerId && lot.available > 0n)
      .sort(compareLots);
    let remaining = credits;
    const allocations: ReservationAllocation[] = [];
    for (const lot of candidates) {
      if (remaining === 0n) break;
      const allocated = lot.available < remaining ? lot.available : remaining;
      allocations.push({ lotId: lot.id, credits: allocated });
      remaining -= allocated;
    }
    if (remaining > 0n) {
      throw new LedgerDomainError("INSUFFICIENT_CREDITS", "Available credit lots cannot fund the requested amount.");
    }
    return allocations;
  }

  private requireLot(lotId: string): CreditLot {
    const lot = this.lots.get(lotId);
    if (!lot) throw new LedgerDomainError("INVARIANT_VIOLATION", `Unknown credit lot ${lotId}.`);
    return lot;
  }

  private requireHeldReservation(reservationId: string): CreditReservation {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new LedgerDomainError("UNKNOWN_RESERVATION", "The reservation does not exist.");
    if (reservation.state !== "HELD") {
      throw new LedgerDomainError("RESERVATION_NOT_HELD", "Only a held reservation can settle or release.");
    }
    return reservation;
  }

  private ensurePlatformAccounts(): void {
    this.ensureAccount({ id: "platform:issued", kind: "PLATFORM_ISSUED", ownerId: null });
    this.ensureAccount({ id: "platform:earned", kind: "PLATFORM_EARNED", ownerId: null });
    this.ensureAccount({ id: "platform:expired", kind: "PLATFORM_EXPIRED", ownerId: null });
    this.ensureAccount({ id: "platform:adjustments", kind: "PLATFORM_ADJUSTMENTS", ownerId: null });
  }

  private ensureUserAccounts(ownerId: string): void {
    this.ensureAccount({ id: this.availableAccountId(ownerId), kind: "USER_AVAILABLE", ownerId });
    this.ensureAccount({ id: this.heldAccountId(ownerId), kind: "USER_HELD", ownerId });
  }

  private ensureAccount(account: CreditAccount): void {
    if (!this.accounts.has(account.id)) {
      this.accounts.set(account.id, account);
      this.projection.set(account.id, 0n);
    }
  }

  private availableAccountId(ownerId: string): string {
    return `user:${ownerId}:available`;
  }

  private heldAccountId(ownerId: string): string {
    return `user:${ownerId}:held`;
  }

  private captureState(): StateSnapshot {
    return structuredClone({
      accounts: [...this.accounts],
      projection: [...this.projection],
      journals: this.journals,
      lots: [...this.lots],
      reservations: [...this.reservations],
      operationReservations: [...this.operationReservations],
      commands: [...this.commands],
    });
  }

  private restoreState(snapshot: StateSnapshot): void {
    this.restoreMap(this.accounts, snapshot.accounts);
    this.restoreMap(this.projection, snapshot.projection);
    this.journals.length = 0;
    this.journals.push(...snapshot.journals);
    this.restoreMap(this.lots, snapshot.lots);
    this.restoreMap(this.reservations, snapshot.reservations);
    this.restoreMap(this.operationReservations, snapshot.operationReservations);
    this.restoreMap(this.commands, snapshot.commands);
  }

  private restoreMap<Key, Value>(target: Map<Key, Value>, values: Array<[Key, Value]>): void {
    target.clear();
    for (const [key, value] of values) target.set(key, value);
  }
}
