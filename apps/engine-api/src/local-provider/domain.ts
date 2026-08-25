import { z } from "zod";

export const MockProviderSchema = z.literal("provider-test");
export const MockScenarioSchema = z.enum([
  "success",
  "provider_failure",
  "submission_unknown_then_success",
  "delivery_failure",
  "cost_shock_success",
]);
export const MockResolutionSchema = z.enum(["720p", "1080p"]);

const MockBindingSchema = z.object({
  assetId: z.string().trim().min(1).max(200),
  role: z.enum(["SOURCE", "FIRST_FRAME", "LAST_FRAME", "REFERENCE", "AUDIO", "VOICE_AUDIO", "MOTION"]),
  ordinal: z.number().int().min(0).max(15),
}).strict();

export const MockQuoteInputSchema = z.object({
  userId: z.string().trim().min(1).max(100).default("local-user"),
  modelId: z.enum([
    "local/test-image-v1",
    "local/test-video-v1",
    "local/test-audio-v1",
  ]),
  quantity: z.coerce.number().int().min(1).max(4).default(1),
  durationSeconds: z.coerce.number().int().min(1).max(60).optional(),
  characterCount: z.coerce.number().int().min(1).max(100_000).optional(),
  resolution: MockResolutionSchema.default("720p"),
  audio: z.boolean().default(false),
  prompt: z.string().trim().min(1).max(20_000).optional(),
  aspectRatio: z.string().trim().min(3).max(20).optional(),
  bindings: z.array(MockBindingSchema).max(16).default([]),
  voice: z.string().trim().min(1).max(100).optional(),
  speed: z.number().min(0.25).max(4).optional(),
  promotionCode: z.string().trim().min(3).max(100).nullable().default(null),
}).strict();

export const CreateMockOperationInputSchema = z.object({
  userId: z.string().trim().min(1).max(100).default("local-user"),
  quoteId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(200),
  generationIntentId: z.string().trim().min(8).max(200).optional(),
  scenario: MockScenarioSchema.default("success"),
});

export type MockProvider = z.infer<typeof MockProviderSchema>;
export type MockScenario = z.infer<typeof MockScenarioSchema>;
export type MockQuoteInput = z.infer<typeof MockQuoteInputSchema>;
export type CreateMockOperationInput = z.infer<typeof CreateMockOperationInputSchema>;

export const providerCreditValueMicrousd = 10_000n;
export const targetMarkupBps = 10_000n;

export function grossMarginBpsFromMarkup(markupBps: bigint): bigint {
  if (markupBps < 0n) throw new Error("markup_must_not_be_negative");
  return (markupBps * 10_000n) / (10_000n + markupBps);
}
