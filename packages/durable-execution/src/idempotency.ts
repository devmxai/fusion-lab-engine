import { randomUUID } from "node:crypto";
import { DurableExecutionError } from "./errors.ts";

export type IdempotencyIdentity = {
  actorId: string;
  route: string;
  key: string;
  requestHash: string;
};

type InProgressRecord = IdempotencyIdentity & {
  status: "IN_PROGRESS";
  leaseToken: string;
};

type CompletedRecord<Response> = IdempotencyIdentity & {
  status: "COMPLETED";
  response: Response;
};

type IdempotencyRecord<Response> = InProgressRecord | CompletedRecord<Response>;

export type IdempotencyAcquireResult<Response> =
  | { kind: "ACQUIRED"; leaseToken: string }
  | { kind: "IN_PROGRESS" }
  | { kind: "REPLAY"; response: Response };

function scopeOf(identity: Pick<IdempotencyIdentity, "actorId" | "route" | "key">): string {
  return JSON.stringify([identity.actorId, identity.route, identity.key]);
}

function validateIdentity(identity: IdempotencyIdentity): void {
  if (identity.actorId.length === 0 || identity.route.length === 0) {
    throw new TypeError("Idempotency actor and route are required.");
  }
  if (identity.key.length < 8 || identity.key.length > 200) {
    throw new TypeError("Idempotency key must contain 8 to 200 characters.");
  }
  if (!/^[a-f0-9]{64}$/.test(identity.requestHash)) {
    throw new TypeError("Idempotency request hash must be a lowercase SHA-256 hex string.");
  }
}

export interface IdempotencyStore<Response> {
  acquire(identity: IdempotencyIdentity): IdempotencyAcquireResult<Response>;
  complete(identity: IdempotencyIdentity, leaseToken: string, response: Response): void;
}

export class InMemoryIdempotencyStore<Response> implements IdempotencyStore<Response> {
  private readonly records = new Map<string, IdempotencyRecord<Response>>();

  acquire(identity: IdempotencyIdentity): IdempotencyAcquireResult<Response> {
    validateIdentity(identity);
    const scope = scopeOf(identity);
    const existing = this.records.get(scope);
    if (!existing) {
      const leaseToken = randomUUID();
      this.records.set(scope, { ...identity, status: "IN_PROGRESS", leaseToken });
      return { kind: "ACQUIRED", leaseToken };
    }
    if (existing.requestHash !== identity.requestHash) {
      throw new DurableExecutionError(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key is already bound to a different request hash.",
      );
    }
    if (existing.status === "IN_PROGRESS") return { kind: "IN_PROGRESS" };
    return { kind: "REPLAY", response: structuredClone(existing.response) };
  }

  complete(identity: IdempotencyIdentity, leaseToken: string, response: Response): void {
    validateIdentity(identity);
    const scope = scopeOf(identity);
    const existing = this.records.get(scope);
    if (
      !existing
      || existing.status !== "IN_PROGRESS"
      || existing.leaseToken !== leaseToken
      || existing.requestHash !== identity.requestHash
    ) {
      throw new DurableExecutionError(
        "IDEMPOTENCY_LEASE_MISMATCH",
        "Only the current idempotency lease holder may complete the request.",
      );
    }
    this.records.set(scope, { ...identity, status: "COMPLETED", response: structuredClone(response) });
  }
}
