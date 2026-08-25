import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseMicrousd, parseWholeCredits } from "./amounts.ts";
import { InMemoryWholeCreditLedger } from "./ledger.ts";
import { LedgerDomainError } from "./types.ts";

const evidence = (value: string) => createHash("sha256").update(value).digest("hex");
const fixedNow = () => new Date("2026-08-12T12:00:00.000Z");

function fundedLedger(credits = 1_000n) {
  const ledger = new InMemoryWholeCreditLedger(fixedNow);
  ledger.grant({
    commandId: "grant-0001",
    ownerId: "user-1",
    lotId: "lot-0001",
    credits,
    source: "PURCHASED",
    reasonCode: "PURCHASE_CONFIRMED",
  });
  return ledger;
}

describe("whole-credit append-only ledger", () => {
  it("rolls back every financial mutation when an outer engine transaction fails", () => {
    const ledger = new InMemoryWholeCreditLedger();
    ledger.grant({
      commandId: "transaction-grant",
      ownerId: "transaction-user",
      lotId: "transaction-lot",
      credits: 10n,
      source: "PURCHASED",
      reasonCode: "TEST",
    });
    const before = ledger.journalsSnapshot();
    expect(() => ledger.transaction(() => {
      ledger.reserve({
        commandId: "transaction-reserve",
        reservationId: "transaction-reservation",
        operationId: "transaction-operation",
        ownerId: "transaction-user",
        quotedCredits: 4n,
      });
      throw new Error("outbox_write_failed");
    })).toThrow("outbox_write_failed");
    expect(ledger.wallet("transaction-user")).toEqual({ ownerId: "transaction-user", available: 10n, held: 0n });
    expect(ledger.journalsSnapshot()).toEqual(before);
    expect(ledger.reservationsSnapshot()).toEqual([]);
  });
  it("reserves four site credits and settles four while every journal remains balanced", () => {
    const ledger = fundedLedger();
    ledger.reserve({
      commandId: "reserve-0001",
      reservationId: "reservation-0001",
      operationId: "operation-0001",
      ownerId: "user-1",
      quotedCredits: 4n,
    });
    expect(ledger.wallet("user-1")).toEqual({ ownerId: "user-1", available: 996n, held: 4n });

    ledger.settle({
      commandId: "settle-0001",
      reservationId: "reservation-0001",
      captureCredits: 4n,
      reasonCode: "VERIFIED_DELIVERY",
    });
    expect(ledger.wallet("user-1")).toEqual({ ownerId: "user-1", available: 996n, held: 0n });
    expect(ledger.journalsSnapshot().every((journal) =>
      journal.entries.reduce((sum, entry) => sum + entry.amount, 0n) === 0n)).toBe(true);
    expect(ledger.lotsSnapshot("user-1")[0]).toMatchObject({ available: 996n, consumed: 4n, held: 0n });
    expect(() => ledger.verifyInvariants()).not.toThrow();
  });

  it("captures no more than requested and releases quote remainder atomically", () => {
    const ledger = fundedLedger();
    ledger.reserve({
      commandId: "reserve-0001",
      reservationId: "reservation-0001",
      operationId: "operation-0001",
      ownerId: "user-1",
      quotedCredits: 4n,
    });
    const settled = ledger.settle({
      commandId: "settle-0001",
      reservationId: "reservation-0001",
      captureCredits: 3n,
      reasonCode: "METERED_DELIVERY",
    });
    expect(settled.reservation).toMatchObject({ capturedCredits: 3n, releasedCredits: 1n, state: "SETTLED" });
    expect(ledger.wallet("user-1")).toEqual({ ownerId: "user-1", available: 997n, held: 0n });
  });

  it("rejects settlement above the quote without changing the protected hold", () => {
    const ledger = fundedLedger();
    ledger.reserve({ commandId: "reserve-cap", reservationId: "reservation-cap", operationId: "operation-cap", ownerId: "user-1", quotedCredits: 4n });
    expect(() => ledger.settle({ commandId: "settle-cap", reservationId: "reservation-cap", captureCredits: 5n, reasonCode: "INVALID" }))
      .toThrowError(expect.objectContaining<Partial<LedgerDomainError>>({ code: "CAPTURE_EXCEEDS_QUOTE" }));
    expect(ledger.wallet("user-1")).toMatchObject({ available: 996n, held: 4n });
    expect(ledger.journalsSnapshot()).toHaveLength(2);
  });

  it("releases only with evidence and preserves the original journal history", () => {
    const ledger = fundedLedger();
    ledger.reserve({
      commandId: "reserve-0001",
      reservationId: "reservation-0001",
      operationId: "operation-0001",
      ownerId: "user-1",
      quotedCredits: 4n,
    });
    ledger.release({
      commandId: "release-0001",
      reservationId: "reservation-0001",
      reasonCode: "PROVIDER_NO_CHARGE_CONFIRMED",
      evidenceHash: evidence("no-charge"),
    });
    expect(ledger.wallet("user-1")).toEqual({ ownerId: "user-1", available: 1_000n, held: 0n });
    expect(ledger.journalsSnapshot().map(({ kind }) => kind)).toEqual(["GRANT", "RESERVE", "RELEASE"]);
  });

  it("fails an insufficient reservation atomically without a partial hold or journal", () => {
    const ledger = fundedLedger(2n);
    expect(() => ledger.reserve({
      commandId: "reserve-too-large",
      reservationId: "reservation-too-large",
      operationId: "operation-too-large",
      ownerId: "user-1",
      quotedCredits: 4n,
    })).toThrowError(expect.objectContaining<Partial<LedgerDomainError>>({ code: "INSUFFICIENT_CREDITS" }));
    expect(ledger.wallet("user-1")).toEqual({ ownerId: "user-1", available: 2n, held: 0n });
    expect(ledger.journalsSnapshot()).toHaveLength(1);
    expect(ledger.reservationsSnapshot()).toEqual([]);
  });

  it("replays 100 identical reserve commands as one reservation and one debit", async () => {
    const ledger = fundedLedger();
    const command = {
      commandId: "reserve-repeat-0001",
      reservationId: "reservation-repeat-0001",
      operationId: "operation-repeat-0001",
      ownerId: "user-1",
      quotedCredits: 4n,
    };
    const results = await Promise.all(Array.from({ length: 100 }, async () => ledger.reserve(command)));
    expect(new Set(results.map(({ reservation }) => reservation.id))).toEqual(new Set(["reservation-repeat-0001"]));
    expect(ledger.wallet("user-1")).toMatchObject({ available: 996n, held: 4n });
    expect(ledger.journalsSnapshot()).toHaveLength(2);
    expect(ledger.reservationsSnapshot()).toHaveLength(1);
  });

  it("rejects command ID reuse with different financial intent", () => {
    const ledger = fundedLedger();
    const command = {
      commandId: "reserve-conflict-0001",
      reservationId: "reservation-conflict-0001",
      operationId: "operation-conflict-0001",
      ownerId: "user-1",
      quotedCredits: 4n,
    };
    ledger.reserve(command);
    expect(() => ledger.reserve({ ...command, quotedCredits: 5n }))
      .toThrowError(expect.objectContaining<Partial<LedgerDomainError>>({ code: "COMMAND_CONFLICT" }));
    expect(ledger.wallet("user-1")).toMatchObject({ available: 996n, held: 4n });
  });

  it("permits only one reservation identity per operation", () => {
    const ledger = fundedLedger();
    ledger.reserve({ commandId: "reserve-operation-a", reservationId: "reservation-a", operationId: "operation-unique", ownerId: "user-1", quotedCredits: 4n });
    expect(() => ledger.reserve({ commandId: "reserve-operation-b", reservationId: "reservation-b", operationId: "operation-unique", ownerId: "user-1", quotedCredits: 4n }))
      .toThrowError(expect.objectContaining<Partial<LedgerDomainError>>({ code: "DUPLICATE_OPERATION_RESERVATION" }));
    expect(ledger.wallet("user-1")).toMatchObject({ available: 996n, held: 4n });
  });

  it("allocates lots by earliest expiry and conserves every lot", () => {
    const ledger = new InMemoryWholeCreditLedger(fixedNow);
    ledger.grant({ commandId: "grant-late", ownerId: "user-1", lotId: "lot-late", credits: 5n, source: "SUBSCRIPTION", expiresAt: "2026-10-01T00:00:00.000Z", reasonCode: "PLAN" });
    ledger.grant({ commandId: "grant-early", ownerId: "user-1", lotId: "lot-early", credits: 3n, source: "PROMOTION", expiresAt: "2026-09-01T00:00:00.000Z", reasonCode: "PROMO" });
    const { reservation } = ledger.reserve({ commandId: "reserve-lots", reservationId: "reservation-lots", operationId: "operation-lots", ownerId: "user-1", quotedCredits: 4n });
    expect(reservation.allocations).toEqual([
      { lotId: "lot-early", credits: 3n },
      { lotId: "lot-late", credits: 1n },
    ]);
    expect(() => ledger.verifyInvariants()).not.toThrow();
  });

  it("expires only the available remainder of an eligible lot", () => {
    const ledger = new InMemoryWholeCreditLedger(fixedNow);
    ledger.grant({ commandId: "grant-expiring", ownerId: "user-1", lotId: "lot-expiring", credits: 10n, source: "SUBSCRIPTION", expiresAt: "2026-08-13T00:00:00.000Z", reasonCode: "PLAN" });
    expect(() => ledger.expire({ commandId: "expire-early", lotId: "lot-expiring", reasonCode: "LOT_EXPIRY", evaluatedAt: "2026-08-12T23:59:59.000Z" }))
      .toThrowError(expect.objectContaining<Partial<LedgerDomainError>>({ code: "LOT_NOT_EXPIRABLE" }));
    ledger.expire({ commandId: "expire-valid", lotId: "lot-expiring", reasonCode: "LOT_EXPIRY", evaluatedAt: "2026-08-13T00:00:00.000Z" });
    expect(ledger.wallet("user-1")).toMatchObject({ available: 0n, held: 0n });
    expect(ledger.lotsSnapshot()[0]).toMatchObject({ expired: 10n, available: 0n });
  });

  it("requires maker-checker for adjustments and represents a debit as a compensating journal", () => {
    const ledger = fundedLedger(10n);
    expect(() => ledger.adjust({ commandId: "adjust-invalid", ownerId: "user-1", direction: "DEBIT", credits: 2n, reasonCode: "SUPPORT_CORRECTION", makerId: "admin-1", approverId: "admin-1" }))
      .toThrowError(expect.objectContaining<Partial<LedgerDomainError>>({ code: "MAKER_CHECKER_REQUIRED" }));
    ledger.adjust({ commandId: "adjust-valid", ownerId: "user-1", direction: "DEBIT", credits: 2n, reasonCode: "SUPPORT_CORRECTION", makerId: "admin-1", approverId: "admin-2" });
    expect(ledger.wallet("user-1")).toMatchObject({ available: 8n, held: 0n });
    expect(ledger.lotsSnapshot()[0]).toMatchObject({ withdrawn: 2n });
    expect(ledger.journalsSnapshot().at(-1)?.kind).toBe("ADJUST_DEBIT");
  });

  it("withdraws only the available remainder of one exact refunded Lot", () => {
    const ledger = new InMemoryWholeCreditLedger(fixedNow);
    ledger.grant({ commandId: "grant-purchase", ownerId: "user-1", lotId: "lot-purchase", credits: 10n, source: "PURCHASED", reasonCode: "PAYMENT" });
    ledger.grant({ commandId: "grant-subscription", ownerId: "user-1", lotId: "lot-subscription", credits: 20n, source: "SUBSCRIPTION", expiresAt: "2026-10-01T00:00:00.000Z", reasonCode: "PLAN" });
    const result = ledger.withdrawAvailableFromLot({ commandId: "refund-withdraw", lotId: "lot-purchase", reasonCode: "VERIFIED_FULL_REFUND" });
    const replay = ledger.withdrawAvailableFromLot({ commandId: "refund-withdraw", lotId: "lot-purchase", reasonCode: "VERIFIED_FULL_REFUND" });
    expect(result.withdrawnCredits).toBe(10n);
    expect(replay.withdrawnCredits).toBe(10n);
    expect(ledger.wallet("user-1").available).toBe(20n);
    expect(ledger.lotsSnapshot().find(({ id }) => id === "lot-purchase")).toMatchObject({ available: 0n, withdrawn: 10n });
    expect(ledger.lotsSnapshot().find(({ id }) => id === "lot-subscription")).toMatchObject({ available: 20n, withdrawn: 0n });
    expect(ledger.journalsSnapshot().filter(({ kind }) => kind === "WITHDRAW_LOT")).toHaveLength(1);
  });

  it("rebuilds wallet projections exactly and protects internal history from snapshot mutation", () => {
    const ledger = fundedLedger(20n);
    ledger.reserve({ commandId: "reserve-rebuild", reservationId: "reservation-rebuild", operationId: "operation-rebuild", ownerId: "user-1", quotedCredits: 4n });
    const rebuilt = ledger.rebuildProjection();
    expect(rebuilt.get("user:user-1:available")).toBe(16n);
    expect(rebuilt.get("user:user-1:held")).toBe(4n);

    const external = ledger.journalsSnapshot() as unknown as CreditJournalForMutation[];
    external[0]!.entries[0]!.amount = 999n;
    expect(() => ledger.verifyInvariants()).not.toThrow();
    expect(ledger.journalsSnapshot()[0]?.entries[0]?.amount).toBe(-20n);
  });

  it("maintains invariants across a mixed deterministic command sequence", () => {
    const ledger = fundedLedger(500n);
    for (let index = 0; index < 40; index += 1) {
      const reservationId = `reservation-${index}`;
      ledger.reserve({ commandId: `reserve-${index}`, reservationId, operationId: `operation-${index}`, ownerId: "user-1", quotedCredits: 5n });
      if (index % 2 === 0) {
        ledger.settle({ commandId: `settle-${index}`, reservationId, captureCredits: 4n, reasonCode: "METERED_DELIVERY" });
      } else {
        ledger.release({ commandId: `release-${index}`, reservationId, reasonCode: "NO_CHARGE", evidenceHash: evidence(`release-${index}`) });
      }
      expect(() => ledger.verifyInvariants()).not.toThrow();
    }
    expect(ledger.wallet("user-1")).toEqual({ ownerId: "user-1", available: 420n, held: 0n });
  });

  it("parses credits and microusd as integer bigint values without floating point", () => {
    expect(parseWholeCredits("4")).toBe(4n);
    expect(parseMicrousd("20000")).toBe(20_000n);
    expect(() => parseWholeCredits("4.5")).toThrow("whole-number");
    expect(() => parseMicrousd("20.001")).toThrow("integer");
  });
});

type CreditJournalForMutation = Array<{
  entries: Array<{ amount: bigint }>;
}>[number];
