import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./engine-session", () => ({
  ensureEngineSession: vi.fn(async () => undefined),
  engineAuthorizationHeaders: vi.fn(async () => ({ authorization: "Bearer test" })),
}));

import { createPersistedCreativeProject, executeCreativeProjectAction, listCreativeProjects, savePersistedCreativeSpaceProject } from "./project-client";

const document = (projectId: string, title = "مشروع جديد") => ({
  schemaVersion: 1 as const,
  projectId,
  title,
  assets: {},
  operations: {},
  bindings: {},
  canvasItems: {},
  viewport: { x: 0, y: 0, zoom: 1 },
  activity: [],
  updatedAt: "2026-08-24T00:00:00.000Z",
});

describe("Creative project client", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists isolated project summaries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      items: [{ projectId: "project-1", title: "الأول", lifecycleState: "ACTIVE", assetCount: 2, operationCount: 1, version: 3, createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z" }],
      nextCursor: null,
    }), { status: 200 })));

    await expect(listCreativeProjects()).resolves.toMatchObject([{ projectId: "project-1", assetCount: 2 }]);
    expect(fetch).toHaveBeenCalledWith("/api/engine/v2/projects", expect.objectContaining({ method: "GET", credentials: "same-origin" }));
  });

  it("creates a new empty project through an idempotent server command", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/i);
      expect(JSON.parse(String(init?.body))).toEqual({ title: "حملة جديدة" });
      return new Response(JSON.stringify({
        projectId: "project-2",
        document: document("project-2", "حملة جديدة"),
        version: 1,
        createdAt: "2026-08-24T00:00:00.000Z",
        updatedAt: "2026-08-24T00:00:00.000Z",
      }), { status: 200 });
    }));

    await expect(createPersistedCreativeProject("  حملة   جديدة  ")).resolves.toMatchObject({
      projectId: "project-2",
      document: { title: "حملة جديدة", assets: {} },
    });
  });

  it("sends versioned lifecycle commands with an idempotency identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      expect(url).toBe("/api/engine/v2/projects/project-1/actions");
      expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/i);
      expect(JSON.parse(String(init?.body))).toEqual({ action: "RENAME", title: "الاسم الجديد", expectedVersion: 3 });
      return new Response(JSON.stringify({
        projectId: "project-1", document: document("project-1", "الاسم الجديد"), version: 4,
        createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T01:00:00.000Z",
      }), { status: 200 });
    }));

    await expect(executeCreativeProjectAction({ projectId: "project-1", version: 3 }, { action: "RENAME", title: "الاسم الجديد" }))
      .resolves.toMatchObject({ version: 4, document: { title: "الاسم الجديد" } });
  });

  it("saves with optimistic version and a fresh idempotency identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      expect(url).toBe("/api/engine/v2/projects/project-1");
      expect(init?.method).toBe("PUT");
      expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/i);
      expect(JSON.parse(String(init?.body))).toMatchObject({ expectedVersion: 4, document: { projectId: "project-1", schemaVersion: 1 } });
      return new Response(JSON.stringify({
        projectId: "project-1", document: document("project-1"), version: 5,
        createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T01:00:00.000Z",
      }), { status: 200 });
    }));

    await expect(savePersistedCreativeSpaceProject(document("project-1"), 4))
      .resolves.toMatchObject({ version: 5 });
  });
});
