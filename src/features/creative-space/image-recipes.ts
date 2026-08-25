export type ImageRecipeId =
  | "image.create"
  | "image.edit"
  | "image.remix"
  | "image.inpaint"
  | "image.upscale";

export type RecipeSettingManifest =
  | { id: "aspectRatio"; kind: "SELECT"; label: string; options: readonly string[]; defaultValue: string }
  | { id: "strength"; kind: "RANGE"; label: string; min: number; max: number; step: number; defaultValue: number }
  | { id: "upscaleFactor"; kind: "SELECT"; label: string; options: readonly string[]; defaultValue: string };

export type ImageRecipeManifest = {
  id: ImageRecipeId;
  label: string;
  description: string;
  actionLabel: string;
  input: { required: boolean; accepts: readonly ["IMAGE"]; role: "SOURCE" | "REFERENCE" };
  prompt: { visible: boolean; required: boolean; placeholder: string };
  models: readonly [{ id: "local/test-image-v1"; label: "Provider For Test · Image V1"; badge: "LOCAL" }];
  settings: readonly RecipeSettingManifest[];
};

const localImageModel = [{
  id: "local/test-image-v1",
  label: "Provider For Test · Image V1",
  badge: "LOCAL",
}] as const;

const ratios = ["1:1", "4:5", "16:9", "9:16"] as const;
const ratioSetting: RecipeSettingManifest = {
  id: "aspectRatio",
  kind: "SELECT",
  label: "نسبة الأبعاد",
  options: ratios,
  defaultValue: "1:1",
};

export const imageRecipeManifests: Readonly<Record<ImageRecipeId, ImageRecipeManifest>> = Object.freeze({
  "image.create": {
    id: "image.create",
    label: "إنشاء صورة",
    description: "إنشاء أصل بصري جديد من وصف واضح.",
    actionLabel: "Create Image",
    input: { required: false, accepts: ["IMAGE"], role: "REFERENCE" },
    prompt: { visible: true, required: true, placeholder: "صف الصورة التي تريد إنشاءها..." },
    models: localImageModel,
    settings: [ratioSetting],
  },
  "image.edit": {
    id: "image.edit",
    label: "تعديل الصورة",
    description: "تعديل الأصل مع إبقائه محفوظاً وبناء نتيجة جديدة.",
    actionLabel: "Edit",
    input: { required: true, accepts: ["IMAGE"], role: "SOURCE" },
    prompt: { visible: true, required: true, placeholder: "ما التعديل المطلوب على الصورة؟" },
    models: localImageModel,
    settings: [ratioSetting, { id: "strength", kind: "RANGE", label: "قوة التعديل", min: 10, max: 100, step: 5, defaultValue: 65 }],
  },
  "image.remix": {
    id: "image.remix",
    label: "Remix",
    description: "إنشاء معالجة جديدة مستوحاة من الصورة المحددة.",
    actionLabel: "Remix",
    input: { required: true, accepts: ["IMAGE"], role: "REFERENCE" },
    prompt: { visible: true, required: true, placeholder: "صف الاتجاه الفني الجديد..." },
    models: localImageModel,
    settings: [ratioSetting, { id: "strength", kind: "RANGE", label: "قوة المرجع", min: 10, max: 100, step: 5, defaultValue: 75 }],
  },
  "image.inpaint": {
    id: "image.inpaint",
    label: "استبدال جزء",
    description: "واجهة الوصفة جاهزة؛ محرر القناع سيضاف بعد ربط الـMedia contract.",
    actionLabel: "Inpaint",
    input: { required: true, accepts: ["IMAGE"], role: "SOURCE" },
    prompt: { visible: true, required: true, placeholder: "صف ما يجب وضعه داخل المنطقة المحددة..." },
    models: localImageModel,
    settings: [{ id: "strength", kind: "RANGE", label: "قوة الدمج", min: 10, max: 100, step: 5, defaultValue: 70 }],
  },
  "image.upscale": {
    id: "image.upscale",
    label: "رفع الدقة",
    description: "تحسين دقة الصورة مع المحافظة على الأصل.",
    actionLabel: "Upscale",
    input: { required: true, accepts: ["IMAGE"], role: "SOURCE" },
    prompt: { visible: false, required: false, placeholder: "" },
    models: localImageModel,
    settings: [{ id: "upscaleFactor", kind: "SELECT", label: "معامل التكبير", options: ["2x", "4x"], defaultValue: "2x" }],
  },
});

export const imageRecipeList = Object.freeze(Object.values(imageRecipeManifests));

export function getImageRecipeManifest(recipeId: ImageRecipeId): ImageRecipeManifest {
  return imageRecipeManifests[recipeId];
}

export function defaultRecipeSettings(manifest: ImageRecipeManifest): Record<string, string | number> {
  return Object.fromEntries(manifest.settings.map((setting) => [setting.id, setting.defaultValue]));
}
