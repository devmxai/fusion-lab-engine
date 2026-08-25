import { z } from "zod";

export const ImageRecipeIdSchema = z.enum([
  "image.create",
  "image.edit",
  "image.remix",
  "image.inpaint",
  "image.upscale",
]);

const ImageInputSchema = z.object({
  assetId: z.string().trim().min(1).max(200),
  kind: z.literal("IMAGE"),
  status: z.literal("READY"),
}).strict();

export const ImageQuoteRequestSchema = z.object({
  projectId: z.string().trim().min(1).max(200),
  recipeId: ImageRecipeIdSchema,
  input: ImageInputSchema.nullable(),
  prompt: z.string().max(1_200),
  modelId: z.literal("local/test-image-v1"),
  settings: z.record(z.union([z.string(), z.number()])),
}).strict().superRefine((request, context) => {
  const inputRequired = request.recipeId !== "image.create";
  if (inputRequired && !request.input) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["input"], message: "A ready image input is required." });
  }

  const promptRequired = request.recipeId !== "image.upscale";
  if (promptRequired && !request.prompt.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["prompt"], message: "A prompt is required." });
  }
  if (!promptRequired && request.prompt.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["prompt"], message: "This recipe does not accept a prompt." });
  }

  const expected = request.recipeId === "image.create"
    ? { aspectRatio: ["1:1", "4:5", "16:9", "9:16"] }
    : request.recipeId === "image.edit" || request.recipeId === "image.remix"
      ? { aspectRatio: ["1:1", "4:5", "16:9", "9:16"], strength: { min: 10, max: 100, step: 5 } }
      : request.recipeId === "image.inpaint"
        ? { strength: { min: 10, max: 100, step: 5 } }
        : { upscaleFactor: ["2x", "4x"] };

  for (const key of Object.keys(request.settings)) {
    if (!(key in expected)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["settings", key], message: "Setting is not allowed." });
  }
  for (const [key, rule] of Object.entries(expected)) {
    const value = request.settings[key];
    if (Array.isArray(rule)) {
      if (typeof value !== "string" || !rule.includes(value)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["settings", key], message: "Setting value is invalid." });
      }
    } else if (typeof value !== "number" || !Number.isFinite(value)
      || value < rule.min || value > rule.max || (value - rule.min) % rule.step !== 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["settings", key], message: "Setting value is invalid." });
    }
  }
});

export const ConfirmImageQuoteRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  generationIntentId: z.string().trim().min(8).max(200).optional(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type ImageQuoteRequest = z.infer<typeof ImageQuoteRequestSchema>;
