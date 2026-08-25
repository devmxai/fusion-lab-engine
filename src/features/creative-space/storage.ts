import { createCreativeSpaceProject, normalizeOperationFinancialEvidence, type CreativeSpaceProject } from "./domain";
import { isStandardProjectionV1 } from "./standard-projection-contract";

const storagePrefix = "fusionlab:creative-space:v1:";

export function creativeSpaceStorageKey(projectId: string): string {
  return `${storagePrefix}${encodeURIComponent(projectId)}`;
}

export function isCreativeSpaceProject(value: unknown): value is CreativeSpaceProject {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CreativeSpaceProject>;
  return candidate.schemaVersion === 1
    && typeof candidate.projectId === "string"
    && typeof candidate.title === "string"
    && (candidate.viewMode === undefined || candidate.viewMode === "STANDARD" || candidate.viewMode === "PROFESSIONAL")
    && (candidate.professionalGraph === undefined || (typeof candidate.professionalGraph === "object" && candidate.professionalGraph !== null))
    && (candidate.standardProjection === undefined || isStandardProjectionV1(candidate.standardProjection))
    && !!candidate.assets && typeof candidate.assets === "object"
    && !!candidate.operations && typeof candidate.operations === "object"
    && !!candidate.bindings && typeof candidate.bindings === "object"
    && !!candidate.canvasItems && typeof candidate.canvasItems === "object"
    && !!candidate.viewport && typeof candidate.viewport.zoom === "number"
    && candidate.viewport.zoom >= 0.25 && candidate.viewport.zoom <= 1.75
    && Array.isArray(candidate.activity);
}

export function loadCreativeSpaceProject(projectId: string, storage: Pick<Storage, "getItem"> = localStorage): CreativeSpaceProject {
  try {
    const raw = storage.getItem(creativeSpaceStorageKey(projectId));
    if (!raw) return createCreativeSpaceProject(projectId);
    const parsed: unknown = JSON.parse(raw);
    return isCreativeSpaceProject(parsed) && parsed.projectId === projectId
      ? normalizeOperationFinancialEvidence(parsed)
      : createCreativeSpaceProject(projectId);
  } catch {
    return createCreativeSpaceProject(projectId);
  }
}

export function saveCreativeSpaceProject(project: CreativeSpaceProject, storage: Pick<Storage, "setItem"> = localStorage): void {
  storage.setItem(creativeSpaceStorageKey(project.projectId), JSON.stringify(normalizeOperationFinancialEvidence(project)));
}
