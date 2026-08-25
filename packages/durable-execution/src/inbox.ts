import { DurableExecutionError } from "./errors.ts";

export type InboxIdentity = {
  provider: string;
  deliveryId: string;
  payloadHash: string;
};

export type InboxConsumeResult<Result> =
  | { kind: "PROCESSED"; result: Result }
  | { kind: "DUPLICATE"; result: Result };

type InboxReceipt<Result> = InboxIdentity & {
  processedAt: string;
  result: Result;
};

type PendingConsumption<Result> = {
  payloadHash: string;
  completion: Promise<Result>;
};

function keyOf(identity: InboxIdentity): string {
  return JSON.stringify([identity.provider, identity.deliveryId]);
}

function validateIdentity(identity: InboxIdentity): void {
  if (identity.provider.length === 0 || identity.deliveryId.length === 0) {
    throw new TypeError("Inbox provider and delivery ID are required.");
  }
  if (!/^[a-f0-9]{64}$/.test(identity.payloadHash)) {
    throw new TypeError("Inbox payload hash must be a lowercase SHA-256 hex string.");
  }
}

export class InMemoryInboxStore<Result> {
  private readonly receipts = new Map<string, InboxReceipt<Result>>();
  private readonly pending = new Map<string, PendingConsumption<Result>>();

  async consume(
    identity: InboxIdentity,
    handler: () => Promise<Result> | Result,
    now: () => Date = () => new Date(),
  ): Promise<InboxConsumeResult<Result>> {
    validateIdentity(identity);
    const key = keyOf(identity);
    const receipt = this.receipts.get(key);
    if (receipt) {
      this.requireMatchingHash(receipt.payloadHash, identity.payloadHash);
      return { kind: "DUPLICATE", result: structuredClone(receipt.result) };
    }

    const inFlight = this.pending.get(key);
    if (inFlight) {
      this.requireMatchingHash(inFlight.payloadHash, identity.payloadHash);
      const result = await inFlight.completion;
      return { kind: "DUPLICATE", result: structuredClone(result) };
    }

    const completion = Promise.resolve().then(handler);
    this.pending.set(key, { payloadHash: identity.payloadHash, completion });
    try {
      const result = await completion;
      this.receipts.set(key, { ...identity, processedAt: now().toISOString(), result: structuredClone(result) });
      return { kind: "PROCESSED", result: structuredClone(result) };
    } finally {
      this.pending.delete(key);
    }
  }

  snapshot(): ReadonlyArray<Readonly<InboxReceipt<Result>>> {
    return structuredClone([...this.receipts.values()]);
  }

  private requireMatchingHash(existing: string, incoming: string): void {
    if (existing !== incoming) {
      throw new DurableExecutionError(
        "INBOX_DELIVERY_CONFLICT",
        "A provider delivery ID was replayed with different payload content.",
      );
    }
  }
}
