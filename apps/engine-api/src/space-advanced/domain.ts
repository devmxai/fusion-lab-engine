import { z } from "zod";

export const AdvancedRecipeIdSchema = z.enum([
  "audio.tts",
  "video.avatar",
  "video.motion-control",
  "video.edit",
  "video.extend",
]);

const AdvancedBindingSchema = z.object({
  assetId: z.string().trim().min(1).max(200),
  kind: z.enum(["IMAGE", "VIDEO", "AUDIO"]),
  status: z.literal("READY"),
  role: z.enum(["SOURCE", "REFERENCE", "VOICE_AUDIO", "MOTION"]),
  ordinal: z.number().int().min(0).max(3),
}).strict();

const SettingValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const contracts = {
  "audio.tts": {
    modelId: "local/test-audio-v1",
    promptRequired: true,
    promptMax: 5_000,
    bindings: [],
    settings: { voice: ["test-neutral", "test-warm"], speed: [0.75, 1, 1.25] },
  },
  "video.avatar": {
    modelId: "local/test-video-v1",
    promptRequired: false,
    promptMax: 1_200,
    bindings: [
      { role: "SOURCE", kind: "IMAGE", required: true },
      { role: "VOICE_AUDIO", kind: "AUDIO", required: true },
    ],
    settings: { durationSeconds: [5, 10], resolution: ["720p", "1080p"], aspectRatio: ["16:9", "9:16", "1:1"], audio: [true] },
  },
  "video.motion-control": {
    modelId: "local/test-video-v1",
    promptRequired: false,
    promptMax: 1_200,
    bindings: [
      { role: "SOURCE", kind: "IMAGE", required: true },
      { role: "MOTION", kind: "VIDEO", required: true },
    ],
    settings: { durationSeconds: [5, 10], resolution: ["720p", "1080p"], aspectRatio: ["16:9", "9:16", "1:1"], audio: [false, true] },
  },
  "video.edit": {
    modelId: "local/test-video-v1",
    promptRequired: true,
    promptMax: 1_200,
    bindings: [
      { role: "SOURCE", kind: "VIDEO", required: true },
      { role: "REFERENCE", kind: "IMAGE", required: false },
    ],
    settings: { durationSeconds: [5, 10], resolution: ["720p", "1080p"], aspectRatio: ["16:9", "9:16", "1:1"], audio: [false, true] },
  },
  "video.extend": {
    modelId: "local/test-video-v1",
    promptRequired: true,
    promptMax: 1_200,
    bindings: [{ role: "SOURCE", kind: "VIDEO", required: true }],
    settings: { durationSeconds: [5, 10], resolution: ["720p", "1080p"], aspectRatio: ["16:9", "9:16", "1:1"], audio: [false, true] },
  },
} as const;

export const AdvancedQuoteRequestSchema = z.object({
  projectId: z.string().trim().min(1).max(200),
  recipeId: AdvancedRecipeIdSchema,
  bindings: z.array(AdvancedBindingSchema).max(4),
  prompt: z.string().max(5_000),
  modelId: z.enum(["local/test-audio-v1", "local/test-video-v1"]),
  settings: z.record(SettingValueSchema),
}).strict().superRefine((request, context) => {
  const contract = contracts[request.recipeId];
  if (request.modelId !== contract.modelId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["modelId"], message: "Model does not match the recipe." });
  }
  if (contract.promptRequired && !request.prompt.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["prompt"], message: "Prompt is required." });
  }
  if (request.prompt.length > contract.promptMax) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["prompt"], message: "Prompt is too long." });
  }

  const requiredCount = contract.bindings.filter(({ required }) => required).length;
  if (request.bindings.length < requiredCount || request.bindings.length > contract.bindings.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["bindings"], message: "Binding count does not match the recipe." });
  }
  const seen = new Set<string>();
  request.bindings.forEach((binding, index) => {
    const expected = contract.bindings[index];
    if (seen.has(binding.assetId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["bindings", index, "assetId"], message: "Duplicate assets are not allowed." });
    seen.add(binding.assetId);
    if (!expected || binding.ordinal !== index || binding.role !== expected.role || binding.kind !== expected.kind) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["bindings", index], message: "Binding does not match the semantic slot." });
    }
  });

  const settingRules = contract.settings as Readonly<Record<string, readonly (string | number | boolean)[]>>;
  for (const key of Object.keys(request.settings)) {
    if (!(key in settingRules)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["settings", key], message: "Setting is not allowed." });
  }
  for (const [key, values] of Object.entries(settingRules)) {
    if (!values.some((value) => Object.is(value, request.settings[key]))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["settings", key], message: "Setting value is invalid." });
    }
  }
});

export const ConfirmAdvancedQuoteRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  generationIntentId: z.string().trim().min(8).max(200).optional(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type AdvancedQuoteRequest = z.infer<typeof AdvancedQuoteRequestSchema>;
