import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SpaceAdvancedError } from "../space-advanced/service.ts";
import { SpaceImageError } from "../space-image/service.ts";
import { SpaceVideoError } from "../space-video/service.ts";
import { GenerationV2Error, type GenerationV2Service } from "./service.ts";
import { type EngineUserSessionAuthority, localUserSessionCookieName } from "./session.ts";
import { DurableProjectConflictError, type LocalDurableRuntime } from "../durable-worker/runtime.ts";
import { createHash, randomUUID } from "node:crypto";

function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (
    error instanceof GenerationV2Error
    || error instanceof SpaceImageError
    || error instanceof SpaceVideoError
    || error instanceof SpaceAdvancedError
  ) {
    return reply.code(error.statusCode).send({
      error: { code: error.code, message: error.message, requestId: request.id },
    });
  }
  throw error;
}

export async function registerGenerationV2Routes(app: FastifyInstance, options: {
  service: GenerationV2Service;
  sessions?: EngineUserSessionAuthority;
  durableRuntime?: LocalDurableRuntime;
}) {
  const owner = async (request: FastifyRequest) => {
    if (!options.sessions) return "local-user";
    const authorization = request.headers.authorization;
    const identity = await options.sessions.resolve({
      cookie: request.headers.cookie,
      authorization: Array.isArray(authorization) ? authorization[0] : authorization,
    });
    if (!identity) throw new GenerationV2Error("AUTHENTICATION_REQUIRED", 401, "A signed Engine session is required.");
    return identity.ownerId;
  };
  app.post("/v1/dev/session/bootstrap", async (_request, reply) => {
    if (!options.sessions) return reply.code(404).send();
    if (!options.sessions.issueLocal) return reply.code(404).send();
    reply.header("set-cookie", `${localUserSessionCookieName}=${options.sessions.issueLocal("local-user")}; HttpOnly; Path=/; SameSite=Strict`);
    return reply.code(204).send();
  });
  const runtime = () => {
    if (!options.durableRuntime) throw new GenerationV2Error("PROJECT_PERSISTENCE_UNAVAILABLE", 503, "Project persistence requires the durable local Engine runtime.");
    return options.durableRuntime;
  };
  const projectId = (raw: string) => {
    if (!raw.trim() || raw.length > 200) throw new GenerationV2Error("INVALID_PROJECT_ID", 400, "Project identity is invalid.");
    return raw;
  };
  const projectSave = (raw: unknown) => {
    const input = raw as { document?: unknown; expectedVersion?: unknown } | null;
    if (!input || typeof input !== "object" || !input.document || typeof input.document !== "object" || Array.isArray(input.document)) {
      throw new GenerationV2Error("INVALID_PROJECT_DOCUMENT", 400, "A bounded project document is required.");
    }
    const serialized = JSON.stringify(input.document);
    if (serialized.length > 2_000_000) throw new GenerationV2Error("INVALID_PROJECT_DOCUMENT", 400, "Project document exceeds the local workspace limit.");
    if (input.expectedVersion !== undefined && (!Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 0)) {
      throw new GenerationV2Error("INVALID_PROJECT_VERSION", 400, "Project revision is invalid.");
    }
    return { document: input.document as Record<string, unknown>, expectedVersion: input.expectedVersion === undefined ? null : Number(input.expectedVersion) };
  };
  app.get("/v2/projects", async (request, reply) => {
    try {
      return reply.code(200).send({ items: await runtime().creativeProjects(await owner(request)), nextCursor: null });
    } catch (error) { return handleError(error, request, reply); }
  });
  app.post("/v2/projects", async (request, reply) => {
    try {
      const idempotencyKey = request.headers["idempotency-key"];
      const key = Array.isArray(idempotencyKey) ? idempotencyKey[0] : idempotencyKey;
      if (!key || key.length < 8 || key.length > 200) throw new GenerationV2Error("IDEMPOTENCY_KEY_REQUIRED", 400, "A valid Idempotency-Key is required.");
      const raw = request.body as { title?: unknown } | null;
      const title = raw && typeof raw.title === "string" ? raw.title.trim().replace(/\s+/g, " ") : "";
      if (!title || title.length > 120) throw new GenerationV2Error("INVALID_PROJECT_TITLE", 400, "Project title must contain between 1 and 120 characters.");
      const ownerId = await owner(request);
      const digest = createHash("sha256").update(`fusionlab-project:${ownerId}:${key}`).digest("hex");
      const id = `project-${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
      const existing = await runtime().creativeProject(ownerId, id);
      if (existing) return reply.code(200).send(existing);
      const timestamp = new Date().toISOString();
      return reply.code(200).send(await runtime().saveCreativeProject({
        ownerId,
        projectId: id,
        expectedVersion: 0,
        document: {
          schemaVersion: 1, projectId: id, title, assets: {}, operations: {}, bindings: {}, canvasItems: {},
          viewport: { x: 0, y: 0, zoom: 1 },
          activity: [{ id: randomUUID(), type: "PROJECT_CREATED", summary: "تم إنشاء مساحة المشروع", occurredAt: timestamp }],
          updatedAt: timestamp,
        },
      }));
    } catch (error) {
      if (error instanceof DurableProjectConflictError) return reply.code(409).send({ error: { code: "PROJECT_VERSION_CONFLICT", message: "Project creation conflicted with another session.", requestId: request.id } });
      return handleError(error, request, reply);
    }
  });
  app.post<{ Params: { projectId: string } }>("/v2/projects/:projectId/actions", async (request, reply) => {
    try {
      const idempotencyHeader = request.headers["idempotency-key"];
      const idempotencyKey = Array.isArray(idempotencyHeader) ? idempotencyHeader[0] : idempotencyHeader;
      if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) throw new GenerationV2Error("IDEMPOTENCY_KEY_REQUIRED", 400, "A valid Idempotency-Key is required.");
      const raw = request.body as { action?: unknown; title?: unknown; expectedVersion?: unknown } | null;
      const action = raw?.action;
      const title = typeof raw?.title === "string" ? raw.title.trim().replace(/\s+/g, " ") : "";
      const expectedVersion = raw?.expectedVersion;
      if (!["RENAME", "DUPLICATE", "ARCHIVE", "RESTORE", "DELETE"].includes(String(action))
        || !Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1
        || (action === "RENAME" && (!title || title.length > 120))
        || (action === "DUPLICATE" && title.length > 120)) {
        throw new GenerationV2Error("INVALID_PROJECT_COMMAND", 400, "Project lifecycle command is invalid.");
      }
      const ownerId = await owner(request);
      const sourceId = projectId(request.params.projectId);
      const source = await runtime().creativeProject(ownerId, sourceId);
      if (!source) throw new GenerationV2Error("PROJECT_NOT_FOUND", 404, "Project was not found.");
      const sourceLifecycle = source.document.lifecycle && typeof source.document.lifecycle === "object" && !Array.isArray(source.document.lifecycle)
        ? (source.document.lifecycle as { state?: unknown }).state : "ACTIVE";

      if (action === "DUPLICATE") {
        if (sourceLifecycle === "DELETED") throw new GenerationV2Error("PROJECT_DELETED", 409, "Restore the project before duplicating it.");
        const digest = createHash("sha256").update(`fusionlab-project:${ownerId}:duplicate:${sourceId}:${idempotencyKey}`).digest("hex");
        const duplicateId = `project-${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
        const replay = await runtime().creativeProject(ownerId, duplicateId);
        if (replay) return reply.code(200).send(replay);
        if (source.version !== Number(expectedVersion)) throw new GenerationV2Error("PROJECT_VERSION_CONFLICT", 409, "Project changed before the command was applied.");
        const timestamp = new Date().toISOString();
        const sourceTitle = typeof source.document.title === "string" ? source.document.title : "مشروع";
        return reply.code(200).send(await runtime().saveCreativeProject({
          ownerId, projectId: duplicateId, expectedVersion: 0,
          document: {
            schemaVersion: 1, projectId: duplicateId, title: title || `${sourceTitle} — نسخة`,
            lifecycle: { state: "ACTIVE", changedAt: timestamp }, duplicatedFromProjectId: sourceId,
            assets: {}, operations: {}, bindings: {}, canvasItems: {}, viewport: { x: 0, y: 0, zoom: 1 },
            activity: [
              { id: randomUUID(), type: "PROJECT_CREATED", summary: "تم إنشاء مساحة المشروع", occurredAt: timestamp },
              { id: randomUUID(), type: "PROJECT_DUPLICATED", summary: `تم إنشاء نسخة مستقلة من ${sourceTitle}`, occurredAt: timestamp },
            ],
            updatedAt: timestamp,
          },
        }));
      }

      const currentTitle = typeof source.document.title === "string" ? source.document.title : "مشروع";
      const alreadyApplied = (action === "RENAME" && sourceLifecycle !== "DELETED" && currentTitle === title)
        || (action === "ARCHIVE" && sourceLifecycle === "ARCHIVED")
        || (action === "DELETE" && sourceLifecycle === "DELETED")
        || (action === "RESTORE" && sourceLifecycle === "ACTIVE");
      if (alreadyApplied) return reply.code(200).send(source);
      if (source.version !== Number(expectedVersion)) throw new GenerationV2Error("PROJECT_VERSION_CONFLICT", 409, "Project changed before the command was applied.");
      if (sourceLifecycle === "DELETED" && action !== "RESTORE") throw new GenerationV2Error("PROJECT_DELETED", 409, "Restore the project before changing it.");
      const timestamp = new Date().toISOString();
      const activity = Array.isArray(source.document.activity) ? source.document.activity.slice(-499) : [];
      const state = action === "ARCHIVE" ? "ARCHIVED" : action === "DELETE" ? "DELETED" : "ACTIVE";
      const summary = action === "RENAME" ? `تم تغيير اسم المشروع إلى ${title}` : action === "ARCHIVE" ? "تمت أرشفة المشروع" : action === "DELETE" ? "تم نقل المشروع إلى المحذوفات" : "تمت استعادة المشروع";
      const type = action === "RENAME" ? "PROJECT_RENAMED" : action === "ARCHIVE" ? "PROJECT_ARCHIVED" : action === "DELETE" ? "PROJECT_DELETED" : "PROJECT_RESTORED";
      return reply.code(200).send(await runtime().saveCreativeProject({
        ownerId, projectId: sourceId, expectedVersion: source.version, allowInactive: true,
        document: {
          ...source.document,
          ...(action === "RENAME" ? { title } : {}),
          lifecycle: { state, changedAt: timestamp },
          activity: [...activity, { id: randomUUID(), type, summary, occurredAt: timestamp }],
          updatedAt: timestamp,
        },
      }));
    } catch (error) {
      if (error instanceof DurableProjectConflictError) {
        const status = error.message === "creative_project_not_found" ? 404 : 409;
        return reply.code(status).send({ error: { code: status === 404 ? "PROJECT_NOT_FOUND" : error.message === "creative_project_not_active" ? "PROJECT_NOT_ACTIVE" : "PROJECT_VERSION_CONFLICT", message: "Project changed before the command was applied.", requestId: request.id } });
      }
      return handleError(error, request, reply);
    }
  });
  app.get<{ Params: { projectId: string } }>("/v2/projects/:projectId", async (request, reply) => {
    try {
      const project = await runtime().creativeProject(await owner(request), projectId(request.params.projectId));
      if (!project) throw new GenerationV2Error("PROJECT_NOT_FOUND", 404, "Project was not found.");
      return reply.code(200).send(project);
    } catch (error) { return handleError(error, request, reply); }
  });
  app.put<{ Params: { projectId: string } }>("/v2/projects/:projectId", async (request, reply) => {
    try {
      const saved = projectSave(request.body);
      return reply.code(200).send(await runtime().saveCreativeProject({
        ownerId: await owner(request), projectId: projectId(request.params.projectId), ...saved,
      }));
    } catch (error) {
      if (error instanceof DurableProjectConflictError) {
        const status = error.message === "creative_project_not_found" ? 404 : 409;
        const code = status === 404 ? "PROJECT_NOT_FOUND" : error.message === "creative_project_not_active" ? "PROJECT_NOT_ACTIVE" : "PROJECT_VERSION_CONFLICT";
        return reply.code(status).send({ error: { code, message: error.message === "creative_project_not_active" ? "Restore the project before editing it." : "Project was changed in another session. Refresh before saving again.", requestId: request.id } });
      }
      return handleError(error, request, reply);
    }
  });
  app.get("/v2/catalog/offers", async (request, reply) => {
    try {
      // Authentication is intentional even though the projection is redacted:
      // it prevents this customer inventory from becoming an anonymous model
      // enumeration endpoint.
      await owner(request);
      return reply.code(200).send(await options.service.activePublishedOffers());
    } catch (error) {
      return handleError(error, request, reply);
    }
  });
  app.post("/v2/quotes", async (request, reply) => {
    try {
      return reply.code(201).send(await options.service.createQuote(request.body, await owner(request)));
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post("/v2/operations", async (request, reply) => {
    try {
      const header = request.headers["idempotency-key"];
      const idempotencyKey = Array.isArray(header) ? header[0] : header;
      return reply.code(202).send(await options.service.createOperation(request.body, idempotencyKey, await owner(request)));
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.get<{ Params: { operationId: string } }>("/v2/operations/:operationId", async (request, reply) => {
    try {
      return reply.code(200).send(await options.service.getOperation(request.params.operationId, await owner(request)));
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post<{ Params: { assetId: string } }>("/v2/assets/:assetId/access-grants", async (request, reply) => {
    try {
      return reply.code(201).send(await options.service.createAssetAccessGrant(request.params.assetId, request.body, await owner(request)));
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.get<{ Params: { assetId: string } }>("/v2/assets/:assetId/content", async (request, reply) => {
    try {
      const header = request.headers["x-fusion-asset-grant"];
      const grantToken = Array.isArray(header) ? header[0] : header;
      const asset = await options.service.readAsset(request.params.assetId, grantToken, await owner(request));
      reply.header("content-type", asset.contentType);
      reply.header("content-length", String(asset.bytes.byteLength));
      reply.header("content-disposition", "inline");
      return reply.code(200).send(Buffer.from(asset.bytes));
    } catch (error) {
      return handleError(error, request, reply);
    }
  });
}
