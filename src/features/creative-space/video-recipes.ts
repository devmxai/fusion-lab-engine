export type VideoRecipeId =
  | "video.text-to-video"
  | "video.image-to-video"
  | "video.first-last"
  | "video.multi-reference";

export type VideoBindingSlot = "FIRST_FRAME" | "LAST_FRAME" | "REFERENCE";

export type VideoSettingManifest = {
  id: "durationSeconds" | "resolution" | "aspectRatio" | "audio";
  label: string;
  options: readonly (string | number | boolean)[];
  defaultValue: string | number | boolean;
};

export type VideoRecipeManifest = {
  id: VideoRecipeId;
  label: string;
  description: string;
  actionLabel: string;
  bindings: {
    min: number;
    max: number;
    accepts: readonly ["IMAGE"];
    slots: readonly VideoBindingSlot[];
  };
  prompt: { required: true; placeholder: string };
  models: readonly [{ id: "local/test-video-v1"; label: "Provider For Test · Video V1"; badge: "LOCAL" }];
  settings: readonly VideoSettingManifest[];
};

const localVideoModel = [{ id: "local/test-video-v1", label: "Provider For Test · Video V1", badge: "LOCAL" }] as const;
const baseSettings: readonly VideoSettingManifest[] = [
  { id: "durationSeconds", label: "المدة", options: [5, 10], defaultValue: 5 },
  { id: "resolution", label: "الدقة", options: ["720p", "1080p"], defaultValue: "720p" },
  { id: "aspectRatio", label: "نسبة الأبعاد", options: ["16:9", "9:16", "1:1"], defaultValue: "16:9" },
  { id: "audio", label: "الصوت", options: [false, true], defaultValue: false },
];

export const videoRecipeManifests: Readonly<Record<VideoRecipeId, VideoRecipeManifest>> = Object.freeze({
  "video.text-to-video": {
    id: "video.text-to-video",
    label: "نص إلى فيديو",
    description: "إنشاء فيديو جديد من وصف نصي من دون أصل بصري.",
    actionLabel: "Text to Video",
    bindings: { min: 0, max: 0, accepts: ["IMAGE"], slots: [] },
    prompt: { required: true, placeholder: "صف المشهد والحركة والكاميرا..." },
    models: localVideoModel,
    settings: baseSettings,
  },
  "video.image-to-video": {
    id: "video.image-to-video",
    label: "تحريك صورة",
    description: "استخدام صورة واحدة كبداية واضحة للفيديو.",
    actionLabel: "Image to Video",
    bindings: { min: 1, max: 1, accepts: ["IMAGE"], slots: ["FIRST_FRAME"] },
    prompt: { required: true, placeholder: "صف الحركة التي تبدأ من هذه الصورة..." },
    models: localVideoModel,
    settings: baseSettings,
  },
  "video.first-last": {
    id: "video.first-last",
    label: "الإطار الأول والأخير",
    description: "تثبيت بداية الفيديو ونهايته بصورتين مرتبتين دلالياً.",
    actionLabel: "First / Last",
    bindings: { min: 2, max: 2, accepts: ["IMAGE"], slots: ["FIRST_FRAME", "LAST_FRAME"] },
    prompt: { required: true, placeholder: "صف الانتقال والحركة بين الإطارين..." },
    models: localVideoModel,
    settings: baseSettings,
  },
  "video.multi-reference": {
    id: "video.multi-reference",
    label: "مراجع متعددة",
    description: "بناء فيديو من مجموعة صور مرتبة بأسماء ثابتة @image1…@image4.",
    actionLabel: "Multi-reference",
    bindings: { min: 1, max: 4, accepts: ["IMAGE"], slots: ["REFERENCE"] },
    prompt: { required: true, placeholder: "استخدم @image1 و@image2 لوصف دور كل مرجع..." },
    models: localVideoModel,
    settings: baseSettings,
  },
});

export const videoRecipeList = Object.freeze(Object.values(videoRecipeManifests));

export function getVideoRecipeManifest(recipeId: VideoRecipeId): VideoRecipeManifest {
  return videoRecipeManifests[recipeId];
}

export function defaultVideoSettings(manifest: VideoRecipeManifest): Record<string, string | number | boolean> {
  return Object.fromEntries(manifest.settings.map(({ id, defaultValue }) => [id, defaultValue]));
}

