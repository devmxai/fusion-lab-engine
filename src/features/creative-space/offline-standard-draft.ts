import { isStandardProjectionV1, type StandardProjectionV1 } from "./standard-projection-contract";

export type OfflineStandardDraftV1 = Readonly<{
  schemaVersion: 1;
  projectId: string;
  baseProjectVersion: number;
  projection: StandardProjectionV1;
  savedAt: string;
}>;

const prefix = "fusionlab:standard-offline-draft:v1:";

export function offlineStandardDraftKey(projectId: string): string {
  return `${prefix}${encodeURIComponent(projectId)}`;
}

export function saveOfflineStandardDraft(
  draft: OfflineStandardDraftV1,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  if (!draft.projectId || draft.schemaVersion !== 1 || !Number.isSafeInteger(draft.baseProjectVersion) || draft.baseProjectVersion < 0
    || !isStandardProjectionV1(draft.projection) || !Number.isFinite(Date.parse(draft.savedAt))) {
    throw new TypeError("Offline Standard draft v1 is invalid.");
  }
  storage.setItem(offlineStandardDraftKey(draft.projectId), JSON.stringify(draft));
}

export function loadOfflineStandardDraft(
  projectId: string,
  storage: Pick<Storage, "getItem"> = localStorage,
): OfflineStandardDraftV1 | null {
  try {
    const raw = storage.getItem(offlineStandardDraftKey(projectId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<OfflineStandardDraftV1>;
    if (draft.schemaVersion !== 1 || draft.projectId !== projectId || !Number.isSafeInteger(draft.baseProjectVersion) || Number(draft.baseProjectVersion) < 0
      || !isStandardProjectionV1(draft.projection) || typeof draft.savedAt !== "string" || !Number.isFinite(Date.parse(draft.savedAt))) return null;
    return draft as OfflineStandardDraftV1;
  } catch {
    return null;
  }
}

export function clearOfflineStandardDraft(
  projectId: string,
  storage: Pick<Storage, "removeItem"> = localStorage,
): void {
  storage.removeItem(offlineStandardDraftKey(projectId));
}
