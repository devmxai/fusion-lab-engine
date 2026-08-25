export class DurableExecutionError extends Error {
  constructor(
    public readonly code:
      | "IDEMPOTENCY_CONFLICT"
      | "IDEMPOTENCY_LEASE_MISMATCH"
      | "OUTBOX_DUPLICATE_EVENT"
      | "OUTBOX_LEASE_MISMATCH"
      | "INBOX_DELIVERY_CONFLICT"
      | "ATTEMPT_CONFLICT"
      | "ATTEMPT_LEASE_MISMATCH"
      | "ATTEMPT_ILLEGAL_TRANSITION"
      | "OPERATION_DUPLICATE_ID"
      | "OPERATION_IDEMPOTENCY_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "DurableExecutionError";
  }
}
