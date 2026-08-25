import { UI_FUX_DIRECTIONS, type UiFuxLocale } from "./product-decisions";

export type StandardCopyKey =
  | "project" | "standard" | "space" | "image" | "video" | "audio" | "create" | "prompt" | "promptHint"
  | "basic" | "advanced" | "references" | "addReference" | "quote" | "credits" | "generate" | "generating"
  | "ready" | "result" | "history" | "mock" | "output" | "model" | "loading" | "empty" | "error" | "retry";

const catalog: Readonly<Record<UiFuxLocale, Readonly<Record<StandardCopyKey, string>>>> = {
  en: {
    project: "Untitled project", standard: "Standard", space: "Space", image: "Image", video: "Video", audio: "Audio",
    create: "Create image", prompt: "Prompt", promptHint: "Describe what you want to create", basic: "Essentials", advanced: "Advanced settings",
    references: "References", addReference: "Add reference", quote: "Estimated price", credits: "credits", generate: "Generate",
    generating: "Generating…", ready: "Ready to create", result: "Generated image", history: "Session", mock: "Prototype · no provider or credits",
    output: "Your result will appear here", model: "Model", loading: "Loading workspace…", empty: "Nothing here yet", error: "Could not load this section", retry: "Retry",
  },
  ar: {
    project: "مشروع بلا عنوان", standard: "Standard", space: "Space", image: "صورة", video: "فيديو", audio: "صوت",
    create: "إنشاء صورة", prompt: "الوصف", promptHint: "اكتب وصفاً لما تريد إنشاءه", basic: "الإعدادات الأساسية", advanced: "إعدادات متقدمة",
    references: "المراجع", addReference: "إضافة مرجع", quote: "السعر التقديري", credits: "كريدت", generate: "توليد",
    generating: "جارٍ الإنشاء…", ready: "جاهز للإنشاء", result: "الصورة المُنشأة", history: "الجلسة", mock: "نموذج تجريبي · لا مزود ولا كريدت",
    output: "ستظهر النتيجة هنا", model: "النموذج", loading: "جارٍ تحميل مساحة العمل…", empty: "لا توجد نتائج بعد", error: "تعذر تحميل هذا القسم", retry: "إعادة المحاولة",
  },
};

export function standardCopy(locale: UiFuxLocale) { return catalog[locale]; }
export function standardDirection(locale: UiFuxLocale) { return UI_FUX_DIRECTIONS[locale]; }
