import type { CreativeSpaceProject } from "./domain";
import type { ImageComposerDraft } from "./composer-draft";
import {
  defaultRecipeSettings,
  getImageRecipeManifest,
  type ImageRecipeId,
  type RecipeSettingManifest,
} from "./image-recipes";
import type { PublishedOffer } from "./published-offers-client";

export type ComposerIssueCode =
  | "INPUT_REQUIRED"
  | "ASSET_NOT_FOUND"
  | "INPUT_TYPE_UNSUPPORTED"
  | "ASSET_NOT_READY"
  | "PROMPT_REQUIRED"
  | "PROMPT_TOO_LONG"
  | "MODEL_NOT_CERTIFIED"
  | "MODEL_RECIPE_UNSUPPORTED"
  | "SETTING_INVALID"
  | "SETTING_NOT_ALLOWED";

export type ComposerValidationIssue = {
  code: ComposerIssueCode;
  field: "input" | "prompt" | "model" | "settings";
  message: string;
};

export type ComposerValidationResult = {
  valid: boolean;
  issues: ComposerValidationIssue[];
};

export type ImageModelCapability = {
  id: string;
  certified: boolean;
  supportedRecipes: readonly ImageRecipeId[];
  supportedSettings: readonly RecipeSettingManifest["id"][];
};

export const imageModelCapabilities: Readonly<Record<string, ImageModelCapability>> = Object.freeze({
  "local/test-image-v1": {
    id: "local/test-image-v1",
    certified: true,
    supportedRecipes: ["image.create", "image.edit", "image.remix", "image.inpaint", "image.upscale"],
    supportedSettings: ["aspectRatio", "strength", "upscaleFactor"],
  },
});

function isSettingValueValid(setting: RecipeSettingManifest, value: unknown): boolean {
  if (setting.kind === "SELECT") return typeof value === "string" && setting.options.includes(value);
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= setting.min
    && value <= setting.max
    && (value - setting.min) % setting.step === 0;
}

export function validateImageComposerDraft(
  draft: ImageComposerDraft,
  project: CreativeSpaceProject,
  modelRegistry: Readonly<Record<string, ImageModelCapability>> = imageModelCapabilities,
  publishedOffer: PublishedOffer | null = null,
): ComposerValidationResult {
  const manifest = getImageRecipeManifest(draft.recipeId);
  const issues: ComposerValidationIssue[] = [];
  const asset = draft.inputAssetId ? project.assets[draft.inputAssetId] : null;
  const publishedRecipe = publishedOffer?.capability.controlSchema.recipes.find((recipe) => recipe.recipeId === draft.recipeId) ?? null;
  const publishedBindings = publishedRecipe?.bindings;

  if ((publishedBindings ? publishedBindings.min > 0 : manifest.input.required) && !draft.inputAssetId) {
    issues.push({ code: "INPUT_REQUIRED", field: "input", message: "هذه الوصفة تحتاج صورة مدخلة." });
  } else if (draft.inputAssetId && !asset) {
    issues.push({ code: "ASSET_NOT_FOUND", field: "input", message: "الصورة المرتبطة لم تعد موجودة في المشروع." });
  } else if (asset && !manifest.input.accepts.includes(asset.kind as "IMAGE")) {
    issues.push({ code: "INPUT_TYPE_UNSUPPORTED", field: "input", message: "نوع الملف غير متوافق مع وصفة Image-first." });
  } else if (asset && asset.status !== "READY") {
    issues.push({ code: "ASSET_NOT_READY", field: "input", message: "يجب أن تكون الصورة جاهزة قبل المتابعة." });
  }

  const prompt = draft.prompt.trim();
  const promptRequired = publishedRecipe?.prompt.required ?? manifest.prompt.required;
  const promptVisible = publishedRecipe?.prompt.visible ?? manifest.prompt.visible;
  const promptMax = publishedRecipe?.prompt.maxLength ?? 1_200;
  if (promptRequired && !prompt) {
    issues.push({ code: "PROMPT_REQUIRED", field: "prompt", message: "اكتب وصفاً واضحاً قبل طلب السعر." });
  }
  if ((!promptVisible && prompt) || draft.prompt.length > promptMax) {
    issues.push({ code: "PROMPT_TOO_LONG", field: "prompt", message: "الـPrompt لا يطابق الحد المنشور لهذه الوصفة." });
  }

  const model = draft.offerId ? null : modelRegistry[draft.modelId];
  if (!draft.offerId && !model?.certified) {
    issues.push({ code: "MODEL_NOT_CERTIFIED", field: "model", message: "النموذج غير معتمد في سجل المسارات المحلي." });
  } else if (draft.offerId && !publishedRecipe) {
    issues.push({ code: "MODEL_RECIPE_UNSUPPORTED", field: "model", message: "العرض المنشور لا يدعم هذه الوصفة." });
  } else if (model && !model.supportedRecipes.includes(draft.recipeId)) {
    issues.push({ code: "MODEL_RECIPE_UNSUPPORTED", field: "model", message: "النموذج لا يدعم الوصفة المحددة." });
  }

  if (publishedRecipe) {
    const controls = new Map(publishedRecipe.controls.map((control) => [control.id, control]));
    for (const [settingId, value] of Object.entries(draft.settings)) {
      const control = controls.get(settingId);
      if (!control) {
        issues.push({ code: "SETTING_NOT_ALLOWED", field: "settings", message: `الإعداد ${settingId} غير منشور لهذا العرض.` });
      } else if (control.kind === "enum" && (!control.values || !control.values.some((option) => Object.is(option, value)))) {
        issues.push({ code: "SETTING_INVALID", field: "settings", message: `قيمة ${settingId} غير منشورة.` });
      } else if (control.kind === "number" && (typeof value !== "number" || control.min === undefined || control.max === undefined || value < control.min || value > control.max || (control.step !== undefined && (value - control.min) % control.step !== 0))) {
        issues.push({ code: "SETTING_INVALID", field: "settings", message: `قيمة ${settingId} خارج النطاق المنشور.` });
      } else if (control.kind === "boolean" && typeof value !== "boolean") {
        issues.push({ code: "SETTING_INVALID", field: "settings", message: `قيمة ${settingId} يجب أن تكون منطقية.` });
      }
    }
    for (const settingId of controls.keys()) {
      if (!(settingId in draft.settings)) issues.push({ code: "SETTING_INVALID", field: "settings", message: `الإعداد ${settingId} مفقود.` });
    }
    return { valid: issues.length === 0, issues };
  }

  const settingsById = new Map(manifest.settings.map((setting) => [setting.id, setting]));
  for (const [settingId, value] of Object.entries(draft.settings)) {
    const setting = settingsById.get(settingId as RecipeSettingManifest["id"]);
    if (!setting || (model && !model.supportedSettings.includes(setting.id))) {
      issues.push({ code: "SETTING_NOT_ALLOWED", field: "settings", message: `الإعداد ${settingId} غير مسموح لهذه الوصفة أو النموذج.` });
    } else if (!isSettingValueValid(setting, value)) {
      issues.push({ code: "SETTING_INVALID", field: "settings", message: `قيمة ${setting.label} غير صالحة.` });
    }
  }
  for (const setting of manifest.settings) {
    if (!(setting.id in draft.settings)) {
      issues.push({ code: "SETTING_INVALID", field: "settings", message: `الإعداد ${setting.label} مفقود.` });
    }
  }

  return { valid: issues.length === 0, issues };
}

export type CompatibilityChange = {
  code: "INPUT_REQUIRED" | "INPUT_ROLE_CHANGED" | "PROMPT_REMOVED" | "SETTING_REMOVED" | "SETTING_ADDED" | "SETTING_RESET" | "MODEL_NOT_CERTIFIED" | "MODEL_RECIPE_UNSUPPORTED";
  severity: "INFO" | "WARNING" | "BLOCKING";
  message: string;
};

export type RecipeCompatibilityDiff = {
  fromRecipeId: ImageRecipeId;
  toRecipeId: ImageRecipeId;
  canApply: boolean;
  requiresConfirmation: boolean;
  changes: CompatibilityChange[];
  nextDraft: ImageComposerDraft;
};

export function planRecipeCompatibility(
  draft: ImageComposerDraft,
  toRecipeId: ImageRecipeId,
  now = new Date(),
): RecipeCompatibilityDiff {
  const current = getImageRecipeManifest(draft.recipeId);
  const target = getImageRecipeManifest(toRecipeId);
  const changes: CompatibilityChange[] = [];
  const targetDefaults = defaultRecipeSettings(target);
  const nextSettings: Record<string, string | number | boolean> = {};

  if (target.input.required && !draft.inputAssetId) {
    changes.push({ code: "INPUT_REQUIRED", severity: "BLOCKING", message: `${target.label} تحتاج صورة مدخلة قبل التبديل.` });
  }
  if (draft.inputAssetId && current.input.role !== target.input.role) {
    changes.push({ code: "INPUT_ROLE_CHANGED", severity: "WARNING", message: `سيتغير دور الصورة من ${current.input.role} إلى ${target.input.role}.` });
  }
  if (draft.prompt.trim() && current.prompt.visible && !target.prompt.visible) {
    changes.push({ code: "PROMPT_REMOVED", severity: "WARNING", message: "الوصفة الجديدة لا تستخدم Prompt؛ سيُزال النص من المسودة الجديدة." });
  }

  const targetSettings = new Map(target.settings.map((setting) => [setting.id, setting]));
  for (const [settingId, value] of Object.entries(draft.settings)) {
    const targetSetting = targetSettings.get(settingId as RecipeSettingManifest["id"]);
    if (!targetSetting) {
      changes.push({ code: "SETTING_REMOVED", severity: "WARNING", message: `سيُزال الإعداد ${settingId} لأنه غير مدعوم في الوصفة الجديدة.` });
      continue;
    }
    if (isSettingValueValid(targetSetting, value)) nextSettings[settingId] = value;
    else {
      nextSettings[settingId] = targetDefaults[settingId];
      changes.push({ code: "SETTING_RESET", severity: "WARNING", message: `سيُعاد ${targetSetting.label} إلى القيمة الافتراضية.` });
    }
  }
  for (const setting of target.settings) {
    if (setting.id in nextSettings) continue;
    nextSettings[setting.id] = targetDefaults[setting.id];
    changes.push({ code: "SETTING_ADDED", severity: "INFO", message: `سيُضاف الإعداد ${setting.label} بقيمته الافتراضية.` });
  }

  const nextDraft: ImageComposerDraft = {
    ...draft,
    recipeId: toRecipeId,
    prompt: target.prompt.visible ? draft.prompt : "",
    modelId: draft.offerId ? draft.modelId : target.models[0].id,
    settings: nextSettings,
    updatedAt: now.toISOString(),
  };
  return {
    fromRecipeId: draft.recipeId,
    toRecipeId,
    canApply: !changes.some(({ severity }) => severity === "BLOCKING"),
    requiresConfirmation: changes.some(({ severity }) => severity === "WARNING"),
    changes,
    nextDraft,
  };
}

export function compareModelCompatibility(
  draft: ImageComposerDraft,
  targetModelId: string,
  modelRegistry: Readonly<Record<string, ImageModelCapability>> = imageModelCapabilities,
): CompatibilityChange[] {
  const target = modelRegistry[targetModelId];
  if (!target?.certified) {
    return [{ code: "MODEL_NOT_CERTIFIED", severity: "BLOCKING", message: "النموذج المطلوب غير معتمد، لذلك لا يمكن إسقاط إعدادات المسودة عليه." }];
  }
  if (!target.supportedRecipes.includes(draft.recipeId)) {
    return [{ code: "MODEL_RECIPE_UNSUPPORTED", severity: "BLOCKING", message: "النموذج المطلوب لا يدعم الوصفة الحالية." }];
  }
  return Object.keys(draft.settings)
    .filter((settingId) => !target.supportedSettings.includes(settingId as RecipeSettingManifest["id"]))
    .map((settingId) => ({ code: "SETTING_REMOVED" as const, severity: "WARNING" as const, message: `النموذج سيزيل الإعداد ${settingId}.` }));
}
