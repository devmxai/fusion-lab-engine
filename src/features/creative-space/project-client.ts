import { engineAuthorizationHeaders, ensureEngineSession } from "./engine-session";
import { isCreativeSpaceProject } from "./storage";
import { normalizeOperationFinancialEvidence, type CreativeSpaceProject } from "./domain";

export type PersistedCreativeSpaceProject = {
  projectId: string;
  document: CreativeSpaceProject;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CreativeProjectSummary = {
  projectId: string;
  title: string;
  lifecycleState: "ACTIVE" | "ARCHIVED" | "DELETED";
  assetCount: number;
  operationCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export class ProjectPersistenceError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "ProjectPersistenceError"; }
}

/** Removes browser-session presentation URLs while retaining the durable asset identity. */
export function projectDocumentForPersistence(project: CreativeSpaceProject): CreativeSpaceProject {
  const normalized = normalizeOperationFinancialEvidence(project);
  const assets = Object.fromEntries(Object.entries(normalized.assets).map(([id, asset]) => {
    if (!asset.resultUrl?.startsWith("blob:")) return [id, asset];
    const { resultUrl: _ephemeralUrl, ...durableAsset } = asset;
    return [id, durableAsset];
  }));
  return { ...normalized, assets };
}

async function request<T>(path: string, init: RequestInit): Promise<T | null> {
  await ensureEngineSession();
  const response = await fetch(`/api/engine${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(await engineAuthorizationHeaders()), ...init.headers },
  });
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new ProjectPersistenceError(payload?.error?.message ?? `Project request failed (${response.status}).`, response.status);
  return payload as T;
}

function valid(value: unknown, projectId: string): value is PersistedCreativeSpaceProject {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedCreativeSpaceProject>;
  return candidate.projectId === projectId
    && Number.isSafeInteger(candidate.version) && (candidate.version ?? 0) > 0
    && isCreativeSpaceProject(candidate.document) && candidate.document.projectId === projectId
    && typeof candidate.createdAt === "string" && typeof candidate.updatedAt === "string";
}

export async function loadPersistedCreativeSpaceProject(projectId: string): Promise<PersistedCreativeSpaceProject | null> {
  const value = await request<unknown>(`/v2/projects/${encodeURIComponent(projectId)}`, { method: "GET" });
  if (value === null) return null;
  if (!valid(value, projectId)) throw new ProjectPersistenceError("The Engine returned an invalid project document.", 502);
  return { ...value, document: normalizeOperationFinancialEvidence(value.document) };
}

export async function savePersistedCreativeSpaceProject(project: CreativeSpaceProject, expectedVersion: number): Promise<PersistedCreativeSpaceProject> {
  const value = await request<unknown>(`/v2/projects/${encodeURIComponent(project.projectId)}`, {
    method: "PUT",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ document: projectDocumentForPersistence(project), expectedVersion }),
  });
  if (!valid(value, project.projectId)) throw new ProjectPersistenceError("The Engine did not confirm the project save.", 502);
  return { ...value, document: normalizeOperationFinancialEvidence(value.document) };
}

function validProjectSummary(value: unknown): value is CreativeProjectSummary {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CreativeProjectSummary>;
  return typeof candidate.projectId === "string" && !!candidate.projectId
    && typeof candidate.title === "string" && !!candidate.title
    && ["ACTIVE", "ARCHIVED", "DELETED"].includes(String(candidate.lifecycleState))
    && Number.isSafeInteger(candidate.assetCount) && (candidate.assetCount ?? -1) >= 0
    && Number.isSafeInteger(candidate.operationCount) && (candidate.operationCount ?? -1) >= 0
    && Number.isSafeInteger(candidate.version) && (candidate.version ?? 0) > 0
    && typeof candidate.createdAt === "string" && typeof candidate.updatedAt === "string";
}

export async function listCreativeProjects(): Promise<CreativeProjectSummary[]> {
  const value = await request<unknown>("/v2/projects", { method: "GET" });
  if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items)
    || !(value as { items: unknown[] }).items.every(validProjectSummary)) {
    throw new ProjectPersistenceError("The Engine returned an invalid project list.", 502);
  }
  return (value as { items: CreativeProjectSummary[] }).items;
}

export async function createPersistedCreativeProject(title: string): Promise<PersistedCreativeSpaceProject> {
  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  if (!normalizedTitle || normalizedTitle.length > 120) throw new ProjectPersistenceError("Project title is invalid.", 400);
  const value = await request<unknown>("/v2/projects", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ title: normalizedTitle }),
  });
  if (!value || typeof value !== "object" || typeof (value as { projectId?: unknown }).projectId !== "string") {
    throw new ProjectPersistenceError("The Engine did not confirm project creation.", 502);
  }
  const projectId = (value as { projectId: string }).projectId;
  if (!valid(value, projectId)) throw new ProjectPersistenceError("The Engine returned an invalid project document.", 502);
  return { ...value, document: normalizeOperationFinancialEvidence(value.document) };
}

export type CreativeProjectAction =
  | { action: "RENAME"; title: string }
  | { action: "DUPLICATE"; title?: string }
  | { action: "ARCHIVE" | "RESTORE" | "DELETE" };

export async function executeCreativeProjectAction(
  project: Pick<CreativeProjectSummary, "projectId" | "version">,
  command: CreativeProjectAction,
): Promise<PersistedCreativeSpaceProject> {
  const value = await request<unknown>(`/v2/projects/${encodeURIComponent(project.projectId)}/actions`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ ...command, expectedVersion: project.version }),
  });
  if (!value || typeof value !== "object" || typeof (value as { projectId?: unknown }).projectId !== "string") {
    throw new ProjectPersistenceError("The Engine did not confirm the project command.", 502);
  }
  const resultProjectId = (value as { projectId: string }).projectId;
  if (!valid(value, resultProjectId)) throw new ProjectPersistenceError("The Engine returned an invalid project document.", 502);
  return { ...value, document: normalizeOperationFinancialEvidence(value.document) };
}
