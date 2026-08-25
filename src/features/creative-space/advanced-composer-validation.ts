import { getAdvancedRecipeManifest } from "./advanced-recipes";
import type { AdvancedComposerDraft } from "./advanced-composer-draft";
import type { CreativeSpaceProject } from "./domain";
import type { PublishedOffer } from "./published-offers-client";

export type AdvancedComposerIssue = {
  code: "BINDING_REQUIRED" | "BINDING_DUPLICATE" | "BINDING_INVALID" | "PROMPT_REQUIRED" | "PROMPT_TOO_LONG" | "MODEL_INVALID" | "SETTING_INVALID" | "SETTING_NOT_ALLOWED";
  message: string;
};

export function validateAdvancedComposerDraft(draft: AdvancedComposerDraft, project: CreativeSpaceProject, publishedOffer: PublishedOffer | null = null) {
  const manifest = getAdvancedRecipeManifest(draft.recipeId);
  const issues: AdvancedComposerIssue[] = [];
  const seen = new Set<string>();
  const publishedRecipe = publishedOffer?.capability.controlSchema.recipes.find((recipe) => recipe.recipeId === draft.recipeId) ?? null;
  const publishedSlots = publishedRecipe?.bindings.slots;
  const slots = publishedRecipe ? (publishedSlots ?? []) : manifest.bindings;

  if (draft.offerId && (!publishedRecipe || !publishedSlots)) {
    issues.push({ code: "MODEL_INVALID", message: "العرض المنشور لا يحتوي عقد Bindings صالحاً لهذه الوصفة." });
  }

  for (const slot of slots) {
    const binding = draft.bindings.find(({ role }) => role === slot.role);
    if (slot.required && !binding) {
      issues.push({ code: "BINDING_REQUIRED", message: `${slot.role} مطلوب لهذه الوصفة.` });
    }
  }
  if (draft.bindings.length < (publishedRecipe?.bindings.min ?? manifest.bindings.filter((slot) => slot.required).length)
    || draft.bindings.length > (publishedRecipe?.bindings.max ?? manifest.bindings.length)) {
    issues.push({ code: "BINDING_INVALID", message: "عدد الـBindings لا يطابق العقد المنشور." });
  }
  draft.bindings.forEach((binding) => {
    const slotIndex = slots.findIndex(({ role }) => role === binding.role);
    const slot = slots[slotIndex];
    const asset = project.assets[binding.assetId];
    if (seen.has(binding.assetId)) issues.push({ code: "BINDING_DUPLICATE", message: "لا يمكن استخدام الأصل نفسه في دورين داخل العملية." });
    seen.add(binding.assetId);
    if (!slot || binding.ordinal !== slotIndex || !asset || asset.kind !== slot.kind || asset.status !== "READY") {
      issues.push({ code: "BINDING_INVALID", message: `Binding ${binding.role} لا يطابق نوع الأصل أو ترتيبه المنشور.` });
    }
  });

  const prompt = publishedRecipe?.prompt ?? { required: manifest.prompt.required, maxLength: manifest.prompt.maxLength, visible: true };
  if (prompt.required && !draft.prompt.trim()) issues.push({ code: "PROMPT_REQUIRED", message: `${manifest.prompt.label} مطلوب قبل التسعير.` });
  if ((!prompt.visible && draft.prompt.trim()) || draft.prompt.length > prompt.maxLength) issues.push({ code: "PROMPT_TOO_LONG", message: `النص لا يطابق الحد المنشور لهذه الوصفة.` });
  if (!draft.offerId && draft.modelId !== manifest.model.id) issues.push({ code: "MODEL_INVALID", message: "الموديل لا يطابق الوصفة المنشورة." });

  if (publishedRecipe) {
    const controls = new Map(publishedRecipe.controls.map((control) => [control.id, control]));
    for (const [id, value] of Object.entries(draft.settings)) {
      const control = controls.get(id);
      if (!control) issues.push({ code: "SETTING_NOT_ALLOWED", message: `الإعداد ${id} غير منشور.` });
      else if (control.kind === "enum" && (!control.values || !control.values.some((option) => Object.is(option, value)))) issues.push({ code: "SETTING_INVALID", message: `قيمة ${id} غير منشورة.` });
      else if (control.kind === "number" && (typeof value !== "number" || control.min === undefined || control.max === undefined || value < control.min || value > control.max || (control.step !== undefined && (value - control.min) % control.step !== 0))) issues.push({ code: "SETTING_INVALID", message: `قيمة ${id} خارج النطاق المنشور.` });
      else if (control.kind === "boolean" && typeof value !== "boolean") issues.push({ code: "SETTING_INVALID", message: `قيمة ${id} يجب أن تكون منطقية.` });
    }
    for (const id of controls.keys()) if (!(id in draft.settings)) issues.push({ code: "SETTING_INVALID", message: `الإعداد ${id} مفقود.` });
    return { valid: issues.length === 0, issues };
  }

  const settings = new Map(manifest.settings.map((setting) => [setting.id, setting]));
  for (const [id, value] of Object.entries(draft.settings)) {
    const setting = settings.get(id as never);
    if (!setting) issues.push({ code: "SETTING_NOT_ALLOWED", message: `الإعداد ${id} غير مسموح.` });
    else if (!setting.options.some((option) => Object.is(option, value))) issues.push({ code: "SETTING_INVALID", message: `قيمة ${setting.label} غير صالحة.` });
  }
  for (const setting of manifest.settings) {
    if (!(setting.id in draft.settings)) issues.push({ code: "SETTING_INVALID", message: `الإعداد ${setting.label} مفقود.` });
  }
  return { valid: issues.length === 0, issues };
}
