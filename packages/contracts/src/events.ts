import { z } from "zod";

export const EventNameSchema = z.enum([
  "quote.issued.v1",
  "operation.reserved.v1",
  "operation.queued.v1",
  "attempt.dispatching.v1",
  "provider.submitted.v1",
  "provider.submission_unknown.v1",
  "provider.running.v1",
  "provider.succeeded.v1",
  "provider.failed.v1",
  "asset.stored.v1",
  "asset.delivery_failed.v1",
  "operation.delivered.v1",
  "operation.cancelled.v1",
  "operation.reconciliation_required.v1",
  "ledger.settled.v1",
  "ledger.released.v1",
]);

export const PrivacyClassSchema = z.enum([
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED",
]);

const AggregateSchema = z.object({
  type: z.enum(["quote", "operation", "attempt", "asset", "ledger"]),
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
}).strict();

const baseEnvelopeShape = {
  eventId: z.string().uuid(),
  schemaVersion: z.literal(1),
  occurredAt: z.string().datetime(),
  producer: z.enum([
    "engine-api",
    "engine-transaction",
    "outbox-relay",
    "worker",
    "provider-adapter",
    "provider-poller",
    "media-worker",
    "delivery-worker",
    "finance-worker",
    "reconciler",
  ]),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().nullable(),
  aggregate: AggregateSchema,
  privacyClass: PrivacyClassSchema,
} as const;

function eventSchema<Name extends z.infer<typeof EventNameSchema>>(
  name: Name,
  payload: z.ZodTypeAny,
) {
  return z.object({
    ...baseEnvelopeShape,
    name: z.literal(name),
    payload,
  }).strict();
}

const operationId = z.string().uuid();
const evidenceHash = z.string().regex(/^[a-f0-9]{64}$/);

export const CanonicalEventSchema = z.discriminatedUnion("name", [
  eventSchema("quote.issued.v1", z.object({ quoteId: z.string().uuid(), customerCredits: z.number().int().nonnegative(), requestHash: evidenceHash }).strict()),
  eventSchema("operation.reserved.v1", z.object({ operationId, reservationId: z.string().uuid(), customerCredits: z.number().int().positive() }).strict()),
  eventSchema("operation.queued.v1", z.object({ operationId, outboxMessageId: z.string().uuid() }).strict()),
  eventSchema("attempt.dispatching.v1", z.object({ operationId, attemptId: z.string().uuid(), routeVersionId: z.string().uuid() }).strict()),
  eventSchema("provider.submitted.v1", z.object({ operationId, attemptId: z.string().uuid(), providerTaskHash: evidenceHash }).strict()),
  eventSchema("provider.submission_unknown.v1", z.object({ operationId, attemptId: z.string().uuid(), reasonCode: z.string().min(1) }).strict()),
  eventSchema("provider.running.v1", z.object({ operationId, attemptId: z.string().uuid(), providerEventHash: evidenceHash }).strict()),
  eventSchema("provider.succeeded.v1", z.object({ operationId, attemptId: z.string().uuid(), actualProviderCredits: z.number().int().nonnegative(), resultReferenceHash: evidenceHash }).strict()),
  eventSchema("provider.failed.v1", z.object({ operationId, attemptId: z.string().uuid(), errorCode: z.string().min(1), noChargeConfirmed: z.boolean() }).strict()),
  eventSchema("asset.stored.v1", z.object({ operationId, assetId: z.string().uuid(), checksumSha256: evidenceHash, contentType: z.string().min(1) }).strict()),
  eventSchema("asset.delivery_failed.v1", z.object({ operationId, reasonCode: z.string().min(1), providerLossMicrousd: z.string().regex(/^\d+$/) }).strict()),
  eventSchema("operation.delivered.v1", z.object({ operationId, assetId: z.string().uuid() }).strict()),
  eventSchema("operation.cancelled.v1", z.object({ operationId, reasonCode: z.string().min(1), noProviderAcceptanceEvidenceHash: evidenceHash.nullable() }).strict()),
  eventSchema("operation.reconciliation_required.v1", z.object({ operationId, reasonCode: z.string().min(1), evidenceHash }).strict()),
  eventSchema("ledger.settled.v1", z.object({ operationId, journalGroupId: z.string().uuid(), capturedCredits: z.number().int().positive() }).strict()),
  eventSchema("ledger.released.v1", z.object({ operationId, journalGroupId: z.string().uuid(), releasedCredits: z.number().int().positive(), reasonCode: z.string().min(1), evidenceHash }).strict()),
]);

export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>;

export const eventCatalog = EventNameSchema.options.map((name) => ({
  name,
  schemaVersion: 1 as const,
  compatibility: "BACKWARD_ADD_OPTIONAL_ONLY" as const,
  forbids: ["secret", "rawPrompt", "longLivedSignedUrl", "rawProviderPayload"] as const,
}));
