import { DurableExecutionError } from "./errors.ts";
import { InMemoryOutboxStore, type OutboxLease, type OutboxMessage } from "./outbox.ts";

type IdempotencyBinding = {
  actorId: string;
  route: string;
  key: string;
  requestHash: string;
  operationId: string;
};

function bindingKey(binding: Pick<IdempotencyBinding, "actorId" | "route" | "key">): string {
  return JSON.stringify([binding.actorId, binding.route, binding.key]);
}

export class InMemoryAtomicOperationStore<Operation extends { id: string }, Payload> {
  private readonly operations = new Map<string, Operation>();
  private readonly bindings = new Map<string, IdempotencyBinding>();
  private readonly outbox = new InMemoryOutboxStore<Payload>();

  commitCreate(input: {
    operation: Operation;
    binding: Omit<IdempotencyBinding, "operationId">;
    outboxMessage: OutboxMessage<Payload>;
    financialTransaction: <Result>(work: () => Result) => Result;
    reserve: () => void;
  }): { kind: "CREATED" | "REPLAY"; operation: Operation } {
    const key = bindingKey(input.binding);
    const existingBinding = this.bindings.get(key);
    if (existingBinding) {
      if (existingBinding.requestHash !== input.binding.requestHash) {
        throw new DurableExecutionError(
          "OPERATION_IDEMPOTENCY_CONFLICT",
          "The scoped operation key was already bound to different input.",
        );
      }
      return { kind: "REPLAY", operation: this.require(existingBinding.operationId) };
    }
    if (this.operations.has(input.operation.id)) {
      throw new DurableExecutionError("OPERATION_DUPLICATE_ID", "An operation ID can be created only once.");
    }
    if (this.outbox.has(input.outboxMessage.eventId)) {
      throw new DurableExecutionError("OUTBOX_DUPLICATE_EVENT", "An outbox event ID can be appended only once.");
    }

    const operation = structuredClone(input.operation);
    const outboxMessage = structuredClone(input.outboxMessage);
    const binding: IdempotencyBinding = { ...input.binding, operationId: operation.id };
    try {
      input.financialTransaction(() => {
        input.reserve();
        this.operations.set(operation.id, operation);
        this.bindings.set(key, binding);
        this.outbox.append(outboxMessage);
      });
    } catch (error) {
      this.operations.delete(operation.id);
      this.bindings.delete(key);
      this.outbox.rollbackAppend(outboxMessage.eventId);
      throw error;
    }
    return { kind: "CREATED", operation };
  }

  require(operationId: string): Operation {
    const operation = this.operations.get(operationId);
    if (!operation) throw new Error("operation_not_found");
    return operation;
  }

  claimQueued(workerId: string, operationId: string): OutboxLease<Payload> | null {
    return this.outbox.claimAggregate(workerId, operationId);
  }

  acknowledgeQueued(eventId: string, workerId: string): void {
    this.outbox.acknowledge(eventId, workerId);
  }

  rejectQueued(eventId: string, workerId: string, errorCode: string, maxAttempts: number): void {
    this.outbox.reject(eventId, workerId, errorCode, maxAttempts);
  }

  recoverRelay(workerId: string): number {
    return this.outbox.recoverWorker(workerId);
  }

  operationsSnapshot(): ReadonlyArray<Readonly<Operation>> {
    return structuredClone([...this.operations.values()]);
  }

  outboxSnapshot() {
    return this.outbox.snapshot();
  }
}
