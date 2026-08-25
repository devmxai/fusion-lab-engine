import { z } from "zod";
import { OperationStateSchema } from "./operation.ts";

const uuid = z.string().uuid();
export const GenerationIntentIdSchema = z.string().trim().min(8).max(200);

export const QuoteRequestV2Schema = z.object({
  projectId: uuid,
  product: z.string().min(1).max(100),
  mode: z.enum(["exact", "smart"]),
  familyVersionId: uuid,
  inputs: z.object({
    durationSeconds: z.number().int().positive().optional(),
    resolution: z.string().min(1).optional(),
    audio: z.boolean().optional(),
    references: z.array(z.object({
      assetId: uuid,
      role: z.enum(["first_frame", "last_frame", "reference", "audio", "motion"]),
    }).strict()).max(16).default([]),
  }).strict(),
  settings: z.record(z.string(), z.unknown()).default({}),
  promotionCode: z.string().max(100).nullable().default(null),
}).strict();

export const QuoteResponseV2Schema = z.object({
  quoteId: uuid,
  projectId: uuid,
  customerCredits: z.number().int().nonnegative(),
  discountCredits: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
  mode: z.enum(["exact", "smart"]),
  pinned: z.object({
    recipeVersionId: uuid,
    familyVersionId: uuid,
    customerPriceVersionId: uuid,
  }).strict(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const CreateOperationV2Schema = z.object({
  quoteId: uuid,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  generationIntentId: GenerationIntentIdSchema,
  inputSnapshot: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const PublicOperationV2Schema = z.object({
  operationId: uuid,
  generationIntentId: GenerationIntentIdSchema,
  projectId: uuid,
  quoteId: uuid,
  state: OperationStateSchema,
  stateVersion: z.number().int().nonnegative(),
  customerCredits: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resultAssetIds: z.array(uuid),
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }).strict().nullable(),
}).strict();

export const IdempotencyKeySchema = z.string().min(8).max(200);

export const PublicErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "QUOTE_EXPIRED",
  "IDEMPOTENCY_CONFLICT",
  "INSUFFICIENT_CREDITS",
  "OPERATION_NOT_CANCELLABLE",
  "INTERNAL_ERROR",
]);

export type QuoteRequestV2 = z.infer<typeof QuoteRequestV2Schema>;
export type QuoteResponseV2 = z.infer<typeof QuoteResponseV2Schema>;
export type CreateOperationV2 = z.infer<typeof CreateOperationV2Schema>;
export type PublicOperationV2 = z.infer<typeof PublicOperationV2Schema>;
