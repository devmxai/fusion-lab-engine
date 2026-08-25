import type { CreativeSpaceProject } from "./domain";
import type { VideoComposerDraft, VideoDraftBinding } from "./video-composer-draft";
import { defaultVideoSettings, getVideoRecipeManifest, type VideoBindingSlot, type VideoRecipeId, type VideoSettingManifest } from "./video-recipes";
import type { PublishedOffer } from "./published-offers-client";

export type VideoComposerIssueCode =
  | "BINDING_COUNT_INVALID" | "BINDING_ASSET_MISSING" | "BINDING_TYPE_UNSUPPORTED"
  | "BINDING_ASSET_NOT_READY" | "BINDING_DUPLICATE" | "BINDING_SLOT_INVALID"
  | "BINDING_ORDINAL_INVALID" | "PROMPT_REQUIRED" | "PROMPT_TOO_LONG"
  | "MODEL_NOT_CERTIFIED" | "MODEL_RECIPE_UNSUPPORTED" | "SETTING_INVALID" | "SETTING_NOT_ALLOWED";

export type VideoComposerIssue = {
  code: VideoComposerIssueCode;
  field: "bindings" | "prompt" | "model" | "settings";
  message: string;
};

export type VideoValidationResult = { valid: boolean; issues: VideoComposerIssue[] };

export type VideoModelCapability = {
  id: string;
  certified: boolean;
  supportedRecipes: readonly VideoRecipeId[];
  supportedSettings: readonly string[];
};

export const videoModelCapabilities: Readonly<Record<string, VideoModelCapability>> = Object.freeze({
  "local/test-video-v1": {
    id: "local/test-video-v1",
    certified: true,
    supportedRecipes: ["video.text-to-video", "video.image-to-video", "video.first-last", "video.multi-reference"],
    supportedSettings: ["durationSeconds", "resolution", "aspectRatio", "audio"],
  },
});

function expectedSlot(recipeId: VideoRecipeId, ordinal: number): VideoBindingSlot | undefined {
  const slots = getVideoRecipeManifest(recipeId).bindings.slots;
  return slots.length === 1 ? slots[0] : slots[ordinal];
}

export function validateVideoComposerDraft(
  draft: VideoComposerDraft,
  project: CreativeSpaceProject,
  registry: Readonly<Record<string, VideoModelCapability>> = videoModelCapabilities,
  publishedOffer: PublishedOffer | null = null,
): VideoValidationResult {
  const manifest = getVideoRecipeManifest(draft.recipeId);
  const issues: VideoComposerIssue[] = [];
  const publishedRecipe = publishedOffer?.capability.controlSchema.recipes.find((recipe) => recipe.recipeId === draft.recipeId) ?? null;
  const bindingBounds = publishedRecipe?.bindings ?? manifest.bindings;
  if (draft.bindings.length < bindingBounds.min || draft.bindings.length > bindingBounds.max) {
    issues.push({ code: "BINDING_COUNT_INVALID", field: "bindings", message: `هذه الوصفة تحتاج من ${bindingBounds.min} إلى ${bindingBounds.max} صورة.` });
  }

  const seen = new Set<string>();
  draft.bindings.forEach((binding, index) => {
    const asset = project.assets[binding.assetId];
    if (seen.has(binding.assetId)) issues.push({ code: "BINDING_DUPLICATE", field: "bindings", message: "لا يمكن ربط الصورة نفسها مرتين في العملية الواحدة." });
    seen.add(binding.assetId);
    if (!asset) issues.push({ code: "BINDING_ASSET_MISSING", field: "bindings", message: `الصورة المرتبطة في الموضع ${index + 1} لم تعد موجودة.` });
    else if (asset.kind !== "IMAGE") issues.push({ code: "BINDING_TYPE_UNSUPPORTED", field: "bindings", message: "Video Recipe الحالية تقبل صوراً فقط في هذه الأدوار." });
    else if (asset.status !== "READY") issues.push({ code: "BINDING_ASSET_NOT_READY", field: "bindings", message: `${asset.name} ليست جاهزة للاستخدام.` });
    if (binding.ordinal !== index) issues.push({ code: "BINDING_ORDINAL_INVALID", field: "bindings", message: "ترتيب المراجع غير متصل أو لا يبدأ من الصفر." });
    const expectedRole = publishedRecipe
      ? (publishedRecipe.bindings.roles.length === 1 ? publishedRecipe.bindings.roles[0] : publishedRecipe.bindings.roles[index])
      : expectedSlot(draft.recipeId, index);
    if (binding.slot !== expectedRole) issues.push({ code: "BINDING_SLOT_INVALID", field: "bindings", message: `دور الصورة ${index + 1} لا يطابق عقد الوصفة.` });
  });

  const promptRequired = publishedRecipe?.prompt.required ?? manifest.prompt.required;
  const promptVisible = publishedRecipe?.prompt.visible ?? true;
  const promptMaxLength = publishedRecipe?.prompt.maxLength ?? 1_200;
  if (promptRequired && !draft.prompt.trim()) issues.push({ code: "PROMPT_REQUIRED", field: "prompt", message: "اكتب وصف الحركة والمشهد قبل طلب السعر." });
  if ((!promptVisible && draft.prompt.trim()) || draft.prompt.length > promptMaxLength) issues.push({ code: "PROMPT_TOO_LONG", field: "prompt", message: "الـPrompt لا يطابق العقد المنشور لهذه الوصفة." });

  const model = draft.offerId ? null : registry[draft.modelId];
  if (!draft.offerId && !model?.certified) issues.push({ code: "MODEL_NOT_CERTIFIED", field: "model", message: "نموذج الفيديو غير معتمد في Registry المحلي." });
  else if (draft.offerId && !publishedRecipe) issues.push({ code: "MODEL_RECIPE_UNSUPPORTED", field: "model", message: "العرض المنشور لا يدعم وصفة الفيديو المحددة." });
  else if (model && !model.supportedRecipes.includes(draft.recipeId)) issues.push({ code: "MODEL_RECIPE_UNSUPPORTED", field: "model", message: "النموذج لا يدعم وصفة الفيديو المحددة." });

  if (publishedRecipe) {
    const controls = new Map(publishedRecipe.controls.map((control) => [control.id, control]));
    for (const [id, value] of Object.entries(draft.settings)) {
      const control = controls.get(id);
      if (!control) {
        issues.push({ code: "SETTING_NOT_ALLOWED", field: "settings", message: `الإعداد ${id} غير منشور لهذا العرض.` });
      } else if (control.kind === "enum" && (!control.values || !control.values.some((option) => Object.is(option, value)))) {
        issues.push({ code: "SETTING_INVALID", field: "settings", message: `قيمة ${id} غير منشورة.` });
      } else if (control.kind === "number" && (typeof value !== "number" || control.min === undefined || control.max === undefined || value < control.min || value > control.max || (control.step !== undefined && (value - control.min) % control.step !== 0))) {
        issues.push({ code: "SETTING_INVALID", field: "settings", message: `قيمة ${id} خارج النطاق المنشور.` });
      } else if (control.kind === "boolean" && typeof value !== "boolean") {
        issues.push({ code: "SETTING_INVALID", field: "settings", message: `قيمة ${id} يجب أن تكون منطقية.` });
      }
    }
    for (const id of controls.keys()) {
      if (!(id in draft.settings)) issues.push({ code: "SETTING_INVALID", field: "settings", message: `الإعداد ${id} مفقود.` });
    }
    return { valid: issues.length === 0, issues };
  }

  const settings = new Map(manifest.settings.map((setting) => [setting.id, setting]));
  for (const [id, value] of Object.entries(draft.settings)) {
    const setting = settings.get(id as VideoSettingManifest["id"]);
    if (!setting || (model && !model.supportedSettings.includes(id))) {
      issues.push({ code: "SETTING_NOT_ALLOWED", field: "settings", message: `الإعداد ${id} غير مسموح لهذه الوصفة أو النموذج.` });
    } else if (!setting.options.some((option) => Object.is(option, value))) {
      issues.push({ code: "SETTING_INVALID", field: "settings", message: `قيمة ${setting.label} غير صالحة.` });
    }
  }
  for (const setting of manifest.settings) {
    if (!(setting.id in draft.settings)) issues.push({ code: "SETTING_INVALID", field: "settings", message: `الإعداد ${setting.label} مفقود.` });
  }
  return { valid: issues.length === 0, issues };
}

export type VideoCompatibilityChange = {
  code: "INPUT_REQUIRED" | "BINDING_DROPPED" | "BINDING_ROLE_CHANGED" | "BINDING_ADDED" | "SETTING_REMOVED" | "SETTING_ADDED" | "SETTING_RESET";
  severity: "INFO" | "WARNING" | "BLOCKING";
  message: string;
};

export type VideoRecipeCompatibilityDiff = {
  fromRecipeId: VideoRecipeId;
  toRecipeId: VideoRecipeId;
  canApply: boolean;
  requiresConfirmation: boolean;
  changes: VideoCompatibilityChange[];
  nextDraft: VideoComposerDraft;
};

export function planVideoRecipeCompatibility(
  draft: VideoComposerDraft,
  toRecipeId: VideoRecipeId,
  candidateAssetId: string | null = null,
  now = new Date(),
): VideoRecipeCompatibilityDiff {
  const target = getVideoRecipeManifest(toRecipeId);
  const changes: VideoCompatibilityChange[] = [];
  let sourceBindings = [...draft.bindings];

  if (sourceBindings.length < target.bindings.min && candidateAssetId && target.bindings.max > sourceBindings.length
    && !sourceBindings.some(({ assetId }) => assetId === candidateAssetId)) {
    const ordinal = sourceBindings.length;
    sourceBindings = [...sourceBindings, { assetId: candidateAssetId, slot: expectedSlot(toRecipeId, ordinal)!, ordinal }];
    changes.push({ code: "BINDING_ADDED", severity: "INFO", message: `ستُربط الصورة المحددة في الدور ${ordinal + 1} للوصفة الجديدة.` });
  }
  if (sourceBindings.length > target.bindings.max) {
    const dropped = sourceBindings.slice(target.bindings.max);
    dropped.forEach((binding) => changes.push({ code: "BINDING_DROPPED", severity: "WARNING", message: `سيُزال Binding للصورة ${binding.assetId} لأن الوصفة الجديدة تقبل ${target.bindings.max} فقط.` }));
    sourceBindings = sourceBindings.slice(0, target.bindings.max);
  }

  const nextBindings: VideoDraftBinding[] = sourceBindings.map((binding, ordinal) => {
    const slot = expectedSlot(toRecipeId, ordinal)!;
    if (binding.slot !== slot) changes.push({ code: "BINDING_ROLE_CHANGED", severity: "WARNING", message: `سيتغير دور الصورة ${ordinal + 1} من ${binding.slot} إلى ${slot}.` });
    return { assetId: binding.assetId, slot, ordinal };
  });
  if (nextBindings.length < target.bindings.min) {
    changes.push({ code: "INPUT_REQUIRED", severity: "BLOCKING", message: `${target.label} تحتاج ${target.bindings.min} صورة؛ المتوفر حالياً ${nextBindings.length}.` });
  }

  const defaults = defaultVideoSettings(target);
  const targetSettings = new Map(target.settings.map((setting) => [setting.id, setting]));
  const nextSettings: Record<string, string | number | boolean> = {};
  for (const [id, value] of Object.entries(draft.settings)) {
    const setting = targetSettings.get(id as "durationSeconds");
    if (!setting) changes.push({ code: "SETTING_REMOVED", severity: "WARNING", message: `سيُزال الإعداد ${id} لأنه غير منشور في الوصفة الجديدة.` });
    else if (setting.options.some((option) => Object.is(option, value))) nextSettings[id] = value;
    else {
      nextSettings[id] = defaults[id];
      changes.push({ code: "SETTING_RESET", severity: "WARNING", message: `سيُعاد ${setting.label} إلى القيمة الافتراضية.` });
    }
  }
  for (const setting of target.settings) {
    if (setting.id in nextSettings) continue;
    nextSettings[setting.id] = defaults[setting.id];
    changes.push({ code: "SETTING_ADDED", severity: "INFO", message: `سيُضاف ${setting.label} بقيمته الافتراضية.` });
  }

  const nextDraft: VideoComposerDraft = { ...draft, recipeId: toRecipeId, bindings: nextBindings, modelId: draft.offerId ? draft.modelId : target.models[0].id, settings: nextSettings, updatedAt: now.toISOString() };
  return {
    fromRecipeId: draft.recipeId,
    toRecipeId,
    canApply: !changes.some(({ severity }) => severity === "BLOCKING"),
    requiresConfirmation: changes.some(({ severity }) => severity === "WARNING"),
    changes,
    nextDraft,
  };
}
