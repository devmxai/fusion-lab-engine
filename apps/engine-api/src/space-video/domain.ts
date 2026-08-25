import { z } from "zod";

export const VideoRecipeIdSchema = z.enum([
  "video.text-to-video",
  "video.image-to-video",
  "video.first-last",
  "video.multi-reference",
]);

const VideoBindingSchema = z.object({
  assetId: z.string().trim().min(1).max(200),
  kind: z.literal("IMAGE"),
  status: z.literal("READY"),
  slot: z.enum(["FIRST_FRAME", "LAST_FRAME", "REFERENCE"]),
  ordinal: z.number().int().min(0).max(3),
}).strict();

const VideoSettingsSchema = z.object({
  durationSeconds: z.union([z.literal(5), z.literal(10)]),
  resolution: z.enum(["720p", "1080p"]),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
  audio: z.boolean(),
}).strict();

const bindingContracts = {
  "video.text-to-video": { min: 0, max: 0, slots: [] },
  "video.image-to-video": { min: 1, max: 1, slots: ["FIRST_FRAME"] },
  "video.first-last": { min: 2, max: 2, slots: ["FIRST_FRAME", "LAST_FRAME"] },
  "video.multi-reference": { min: 1, max: 4, slots: ["REFERENCE"] },
} as const;

export const VideoQuoteRequestSchema = z.object({
  projectId: z.string().trim().min(1).max(200),
  recipeId: VideoRecipeIdSchema,
  bindings: z.array(VideoBindingSchema).max(4),
  prompt: z.string().max(1_200),
  modelId: z.literal("local/test-video-v1"),
  settings: VideoSettingsSchema,
}).strict().superRefine((request, context) => {
  const contract = bindingContracts[request.recipeId];
  if (!request.prompt.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["prompt"], message: "A prompt is required." });
  }
  if (request.bindings.length < contract.min || request.bindings.length > contract.max) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["bindings"], message: "Binding count does not match the recipe." });
  }

  const seen = new Set<string>();
  request.bindings.forEach((binding, index) => {
    if (seen.has(binding.assetId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["bindings", index, "assetId"], message: "Duplicate assets are not allowed." });
    }
    seen.add(binding.assetId);
    if (binding.ordinal !== index) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["bindings", index, "ordinal"], message: "Binding ordinals must be contiguous." });
    }
    const expectedSlot = contract.slots.length === 1 ? contract.slots[0] : contract.slots[index];
    if (binding.slot !== expectedSlot) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["bindings", index, "slot"], message: "Binding slot does not match the recipe." });
    }
  });
});

export const ConfirmVideoQuoteRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  generationIntentId: z.string().trim().min(8).max(200).optional(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type VideoQuoteRequest = z.infer<typeof VideoQuoteRequestSchema>;
