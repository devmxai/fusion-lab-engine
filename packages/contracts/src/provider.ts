import { z } from "zod";

// `text` is intentionally part of the provider-neutral vocabulary.  A text
// result is not an asset URL, so execution adapters must normalize it through
// the result contract rather than pretending it is a media file.
export const ProviderMediaTypeSchema = z.enum(["image", "video", "audio", "text"]);
export const ProviderScenarioSchema = z.enum([
  "success",
  "provider_failure",
  "submission_unknown_then_success",
  "delivery_failure",
  "cost_shock_success",
]);

export const ProviderBindingSchema = z.object({
  assetId: z.string().min(1).max(200),
  role: z.enum(["SOURCE", "FIRST_FRAME", "LAST_FRAME", "REFERENCE", "AUDIO", "VOICE_AUDIO", "MOTION"]),
  ordinal: z.number().int().min(0).max(15),
}).strict();

export const ProviderGenerationRequestSchema = z.object({
  operationId: z.string().min(1).max(100),
  model: z.string().min(1).max(200),
  mediaType: ProviderMediaTypeSchema,
  scenario: ProviderScenarioSchema.default("success"),
  input: z.object({
    prompt: z.string().min(1).max(20_000).optional(),
    quantity: z.number().int().min(1).max(4).default(1),
    durationSeconds: z.number().int().min(1).max(60).optional(),
    characterCount: z.number().int().min(1).max(100_000).optional(),
    resolution: z.enum(["720p", "1080p", "1K", "2K", "4K"]).default("720p"),
    // Provider-neutral customer-facing quality/mode.  Individual adapters
    // translate this to the provider's documented field (for example KIE
    // Kling 3.0 uses `mode: std | pro | 4K`).
    quality: z.string().min(1).max(40).optional(),
    audio: z.boolean().default(false),
    aspectRatio: z.string().min(3).max(20).optional(),
    // These fields are server-populated only.  They intentionally remain in
    // the durable request contract so an adapter can consume a private source
    // asset without trusting a browser supplied URL.
    sourceAssetId: z.string().uuid().optional(),
    providerInputUrl: z.string().url().optional(),
    bindings: z.array(ProviderBindingSchema).max(16).optional(),
    voice: z.string().min(1).max(100).optional(),
    speed: z.number().min(0.25).max(4).optional(),
  }).strict(),
}).strict();

export const ProviderSubmitResponseSchema = z.object({
  taskId: z.string().min(1),
  status: z.literal("submitted"),
  estimatedProviderCredits: z.number().int().nonnegative(),
});

export const ProviderTaskResponseSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum(["submitted", "running", "succeeded", "failed"]),
  actualProviderCredits: z.number().int().nonnegative().nullable(),
  resultUrl: z.string().url().nullable(),
  errorCode: z.string().nullable(),
  chargeStatus: z.enum(["ACTUAL", "CONFIRMED_NO_CHARGE", "UNKNOWN"]).optional(),
});

export const ProviderBalanceResponseSchema = z.object({
  provider: z.string().min(1),
  unit: z.literal("provider_credit"),
  available: z.number().int().nonnegative(),
  held: z.number().int().nonnegative(),
  spent: z.number().int().nonnegative(),
});

export const ProviderModelSchema = z.object({
  id: z.string().min(1),
  mediaType: ProviderMediaTypeSchema,
  nativeUnit: z.literal("provider_credit"),
});

export type ProviderMediaType = z.infer<typeof ProviderMediaTypeSchema>;
export type ProviderBinding = z.infer<typeof ProviderBindingSchema>;
export type ProviderScenario = z.infer<typeof ProviderScenarioSchema>;
export type ProviderGenerationRequest = z.infer<typeof ProviderGenerationRequestSchema>;
export type ProviderSubmitResponse = z.infer<typeof ProviderSubmitResponseSchema>;
export type ProviderTaskResponse = z.infer<typeof ProviderTaskResponseSchema>;
export type ProviderBalanceResponse = z.infer<typeof ProviderBalanceResponseSchema>;
export type ProviderModel = z.infer<typeof ProviderModelSchema>;
