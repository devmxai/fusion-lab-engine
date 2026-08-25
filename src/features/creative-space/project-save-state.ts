export type ProjectSaveState = "LOADING" | "DIRTY" | "SAVING" | "SAVED" | "OFFLINE" | "CONFLICT" | "ERROR" | "READ_ONLY";

export type ProjectSaveEvent =
  | { type: "LOAD_STARTED" }
  | { type: "LOAD_SUCCEEDED" }
  | { type: "LOCAL_CHANGE"; online: boolean }
  | { type: "SAVE_STARTED" }
  | { type: "SAVE_SUCCEEDED" }
  | { type: "NETWORK_OFFLINE" }
  | { type: "NETWORK_ONLINE"; hasUnsavedChanges: boolean }
  | { type: "VERSION_CONFLICT" }
  | { type: "SAVE_FAILED" }
  | { type: "SECONDARY_TAB" };

export function reduceProjectSaveState(_state: ProjectSaveState, event: ProjectSaveEvent): ProjectSaveState {
  switch (event.type) {
    case "LOAD_STARTED": return "LOADING";
    case "LOAD_SUCCEEDED": return "SAVED";
    case "LOCAL_CHANGE": return event.online ? "DIRTY" : "OFFLINE";
    case "SAVE_STARTED": return "SAVING";
    case "SAVE_SUCCEEDED": return "SAVED";
    case "NETWORK_OFFLINE": return "OFFLINE";
    case "NETWORK_ONLINE": return event.hasUnsavedChanges ? "DIRTY" : "SAVED";
    case "VERSION_CONFLICT": return "CONFLICT";
    case "SAVE_FAILED": return "ERROR";
    case "SECONDARY_TAB": return "READ_ONLY";
  }
}

export const PROJECT_SAVE_LABELS = Object.freeze({
  en: Object.freeze({ LOADING: "Loading…", DIRTY: "Unsaved", SAVING: "Saving…", SAVED: "Saved", OFFLINE: "Offline draft", CONFLICT: "Conflict", ERROR: "Save failed", READ_ONLY: "Read-only tab" }),
  ar: Object.freeze({ LOADING: "جارٍ التحميل…", DIRTY: "غير محفوظ", SAVING: "جارٍ الحفظ…", SAVED: "محفوظ", OFFLINE: "مسودة دون اتصال", CONFLICT: "تعارض", ERROR: "فشل الحفظ", READ_ONLY: "تبويب للقراءة فقط" }),
}) satisfies Readonly<Record<"en" | "ar", Readonly<Record<ProjectSaveState, string>>>>;
