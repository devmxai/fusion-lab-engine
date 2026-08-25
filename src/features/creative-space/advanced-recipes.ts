import type { SpaceMediaKind } from "./domain";

export type AdvancedRecipeId =
  | "audio.tts"
  | "video.avatar"
  | "video.motion-control"
  | "video.edit"
  | "video.extend";

export type AdvancedSettingId = "voice" | "speed" | "durationSeconds" | "resolution" | "aspectRatio" | "audio";
export type AdvancedBindingRole = "SOURCE" | "REFERENCE" | "VOICE_AUDIO" | "MOTION";

export type AdvancedSettingManifest = {
  id: AdvancedSettingId;
  label: string;
  options: readonly (string | number | boolean)[];
  defaultValue: string | number | boolean;
};

export type AdvancedBindingManifest = {
  role: AdvancedBindingRole;
  kind: SpaceMediaKind;
  label: string;
  required: boolean;
};

export type AdvancedRecipeManifest = {
  id: AdvancedRecipeId;
  label: string;
  description: string;
  actionLabel: string;
  outputKind: "AUDIO" | "VIDEO";
  model: { id: "local/test-audio-v1" | "local/test-video-v1"; label: string; badge: "LOCAL" };
  bindings: readonly AdvancedBindingManifest[];
  prompt: { required: boolean; label: string; placeholder: string; maxLength: number };
  settings: readonly AdvancedSettingManifest[];
};

const videoSettings: readonly AdvancedSettingManifest[] = [
  { id: "durationSeconds", label: "المدة", options: [5, 10], defaultValue: 5 },
  { id: "resolution", label: "الدقة", options: ["720p", "1080p"], defaultValue: "720p" },
  { id: "aspectRatio", label: "نسبة الأبعاد", options: ["16:9", "9:16", "1:1"], defaultValue: "16:9" },
  { id: "audio", label: "الصوت", options: [false, true], defaultValue: false },
];

const avatarSettings: readonly AdvancedSettingManifest[] = videoSettings.map((setting) => setting.id === "audio"
  ? { ...setting, options: [true], defaultValue: true }
  : setting);

export const advancedRecipeManifests: Readonly<Record<AdvancedRecipeId, AdvancedRecipeManifest>> = Object.freeze({
  "audio.tts": {
    id: "audio.tts",
    label: "إنشاء صوت / TTS",
    description: "تحويل نص إلى Audio Output محلي عبر نفس Provider For Test وعقد المحاسبة.",
    actionLabel: "Text to Speech",
    outputKind: "AUDIO",
    model: { id: "local/test-audio-v1", label: "Provider For Test · Audio V1", badge: "LOCAL" },
    bindings: [],
    prompt: { required: true, label: "النص الصوتي", placeholder: "اكتب النص الذي تريد تحويله إلى صوت...", maxLength: 5_000 },
    settings: [
      { id: "voice", label: "الصوت", options: ["test-neutral", "test-warm"], defaultValue: "test-neutral" },
      { id: "speed", label: "السرعة", options: [0.75, 1, 1.25], defaultValue: 1 },
    ],
  },
  "video.avatar": {
    id: "video.avatar",
    label: "Avatar / Lip-sync",
    description: "صورة شخصية مع Voice Audio لإنتاج فيديو Avatar متزامن.",
    actionLabel: "Avatar",
    outputKind: "VIDEO",
    model: { id: "local/test-video-v1", label: "Provider For Test · Video V1", badge: "LOCAL" },
    bindings: [
      { role: "SOURCE", kind: "IMAGE", label: "صورة الشخصية", required: true },
      { role: "VOICE_AUDIO", kind: "AUDIO", label: "Voice Audio", required: true },
    ],
    prompt: { required: false, label: "توجيه الأداء", placeholder: "اختياري: صف تعبير الوجه أو أسلوب الأداء...", maxLength: 1_200 },
    settings: avatarSettings,
  },
  "video.motion-control": {
    id: "video.motion-control",
    label: "Motion Control",
    description: "صورة هدف مع Motion Video لنقل الحركة عبر Binding واضح.",
    actionLabel: "Motion Control",
    outputKind: "VIDEO",
    model: { id: "local/test-video-v1", label: "Provider For Test · Video V1", badge: "LOCAL" },
    bindings: [
      { role: "SOURCE", kind: "IMAGE", label: "الصورة الهدف", required: true },
      { role: "MOTION", kind: "VIDEO", label: "Motion Video", required: true },
    ],
    prompt: { required: false, label: "توجيه الحركة", placeholder: "اختياري: صف ما يجب الحفاظ عليه أثناء نقل الحركة...", maxLength: 1_200 },
    settings: videoSettings,
  },
  "video.edit": {
    id: "video.edit",
    label: "تحرير فيديو",
    description: "Video Source مع Reference Image اختيارية وتعليمات تحرير صريحة.",
    actionLabel: "Video Edit",
    outputKind: "VIDEO",
    model: { id: "local/test-video-v1", label: "Provider For Test · Video V1", badge: "LOCAL" },
    bindings: [
      { role: "SOURCE", kind: "VIDEO", label: "الفيديو المصدر", required: true },
      { role: "REFERENCE", kind: "IMAGE", label: "Reference Image", required: false },
    ],
    prompt: { required: true, label: "تعليمات التحرير", placeholder: "صف التعديل المطلوب على الفيديو...", maxLength: 1_200 },
    settings: videoSettings,
  },
  "video.extend": {
    id: "video.extend",
    label: "تمديد فيديو",
    description: "تمديد Video Source مع تثبيت المدة الجديدة والتكلفة قبل التنفيذ.",
    actionLabel: "Video Extend",
    outputKind: "VIDEO",
    model: { id: "local/test-video-v1", label: "Provider For Test · Video V1", badge: "LOCAL" },
    bindings: [{ role: "SOURCE", kind: "VIDEO", label: "الفيديو المصدر", required: true }],
    prompt: { required: true, label: "تعليمات التمديد", placeholder: "صف استمرار المشهد بعد نهاية الفيديو...", maxLength: 1_200 },
    settings: videoSettings,
  },
});

export const advancedRecipeList = Object.freeze(Object.values(advancedRecipeManifests));

export function isAdvancedRecipeId(value: string): value is AdvancedRecipeId {
  return value in advancedRecipeManifests;
}

export function getAdvancedRecipeManifest(recipeId: AdvancedRecipeId): AdvancedRecipeManifest {
  return advancedRecipeManifests[recipeId];
}

export function defaultAdvancedSettings(manifest: AdvancedRecipeManifest): Record<string, string | number | boolean> {
  return Object.fromEntries(manifest.settings.map(({ id, defaultValue }) => [id, defaultValue]));
}
