import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AdminControlPlaneError,
  type AdminIdentity,
  type AdminResourceType,
} from "../../../../packages/admin-control-plane/src/index.ts";
import { SecretStoreError } from "../../../../packages/admin-control-plane/src/secret-store.ts";
import { ProviderConnectionVerificationError } from "../provider-accounts/verification.ts";
import { LocalAdminV2Service } from "./service.ts";
import { type AdminIdentityAuthority, localAdminSessionCookieName } from "./session.ts";
import type { CatalogSnapshotInput } from "../../../../packages/providers/src/catalog-snapshot.ts";
import type { PublicReferenceCatalogSnapshot } from "../../../../packages/providers/src/reference-catalog-importers.ts";
import { DurableAdminStateConflictError } from "../durable-worker/runtime.ts";

type CommandBody = { evidenceHash?: string; reasonCode?: string };

async function identityFrom(request: FastifyRequest, sessions: AdminIdentityAuthority): Promise<AdminIdentity> {
  // Never trust x-admin-* headers. They are intentionally ignored even in local mode.
  const authorization = request.headers.authorization;
  return await sessions.resolve({
    cookie: request.headers.cookie,
    authorization: Array.isArray(authorization) ? authorization[0] : authorization,
  }) ?? { actorId: "", roles: [], assuranceLevel: 1 };
}

function commandId(request: FastifyRequest): string {
  const header = request.headers["idempotency-key"];
  return Array.isArray(header) ? header[0] ?? "" : header ?? "";
}

function adminError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AdminControlPlaneError) {
    const status = error.code === "AAL2_REQUIRED" ? 401
      : error.code === "ADMIN_PERMISSION_DENIED" ? 403
      : ["CHANGE_NOT_FOUND", "CREDENTIAL_NOT_FOUND"].includes(error.code) ? 404
      : ["ADMIN_COMMAND_CONFLICT", "ILLEGAL_CHANGE_TRANSITION", "MAKER_CHECKER_REQUIRED", "IMMUTABLE_VERSION", "CREDENTIAL_ILLEGAL_TRANSITION"].includes(error.code) ? 409
      : 400;
    return reply.code(status).send({ error: { code: error.code, message: error.message, requestId: request.id } });
  }
  if (error instanceof TypeError) {
    return reply.code(400).send({ error: { code: "INVALID_ADMIN_COMMAND", message: error.message, requestId: request.id } });
  }
  if (error instanceof DurableAdminStateConflictError) {
    return reply.code(409).send({ error: { code: "ADMIN_STATE_VERSION_CONFLICT", message: "Admin state changed in another local Engine session. Reload before retrying.", requestId: request.id } });
  }
  if (error instanceof SecretStoreError) {
    return reply.code(error.code === "SECRET_NOT_FOUND" ? 404 : 503).send({ error: { code: error.code, message: error.message, requestId: request.id } });
  }
  if (error instanceof ProviderConnectionVerificationError) {
    const status = error.code === "CONNECTION_UNAUTHORIZED" ? 401
      : error.code === "UNSUPPORTED_PROVIDER" || error.code === "UNSUPPORTED_CREDENTIAL_PURPOSE" || error.code === "CONNECTION_PROTOCOL" ? 400 : 503;
    return reply.code(status).send({ error: { code: error.code, message: error.message, requestId: request.id } });
  }
  throw error;
}

async function execute(
  request: FastifyRequest,
  reply: FastifyReply,
  sessions: AdminIdentityAuthority,
  service: LocalAdminV2Service,
  mutating: boolean,
  work: (identity: AdminIdentity) => unknown | Promise<unknown>,
) {
  try {
    await service.hydrate();
    const result = await work(await identityFrom(request, sessions));
    if (mutating) await service.persist();
    return result;
  } catch (error) {
    return adminError(error, request, reply);
  }
}

export async function registerAdminV2Routes(
  app: FastifyInstance,
  options: { service: LocalAdminV2Service; sessions: AdminIdentityAuthority },
): Promise<void> {
  const { service, sessions } = options;
  const executeWithSession = (request: FastifyRequest, reply: FastifyReply, work: (identity: AdminIdentity) => unknown | Promise<unknown>, mutating = false) => (
    execute(request, reply, sessions, service, mutating, work)
  );

  app.post("/v1/dev/admin-v2/session/bootstrap", (_request, reply) => {
    if (!sessions.issueLocalViewer) return reply.code(404).send();
    const session = sessions.issueLocalViewer();
    // Path=/ is intentional: the browser reaches the local engine through the
    // Vite /api/engine proxy, whose public path differs from the engine path.
    reply.header("set-cookie", `${localAdminSessionCookieName}=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900`);
    return reply.code(204).send();
  });

  app.get("/v1/dev/admin-v2/overview", (request, reply) => executeWithSession(request, reply, (identity) => service.overview(identity)));
  app.get("/v1/dev/admin-v2/changes", (request, reply) => executeWithSession(request, reply, (identity) => service.changes.list(identity)));
  app.get("/v1/dev/admin-v2/approval-inbox", (request, reply) => executeWithSession(request, reply, (identity) => service.approvalInbox(identity)));
  app.get("/v1/dev/admin-v2/workflow-policies", (request, reply) => executeWithSession(request, reply, (identity) => service.workflowPolicies(identity)));
  app.get("/v1/dev/admin-v2/capabilities", (request, reply) => executeWithSession(request, reply, (identity) => service.capabilities(identity)));
  app.get("/v1/dev/admin-v2/audit", (request, reply) => executeWithSession(request, reply, (identity) => {
    service.changes.list(identity);
    return { chainValid: service.audit.verify(), records: service.audit.snapshot() };
  }));
  app.get("/v1/dev/admin-v2/credentials", (request, reply) => executeWithSession(request, reply, (identity) => service.vault.metadata(identity)));
  app.get("/v1/dev/admin-v2/catalog/routes", (request, reply) => executeWithSession(request, reply, (identity) => service.catalogRoutes(identity)));
  app.get("/v1/dev/admin-v2/catalog/offline", (request, reply) => executeWithSession(request, reply, (identity) => service.offlineCatalog(identity)));
  app.get("/v1/dev/admin-v2/catalog/providers", (request, reply) => executeWithSession(request, reply, (identity) => service.providerReadiness(identity)));
  app.get("/v1/dev/admin-v2/provider-accounts/health", (request, reply) => executeWithSession(request, reply, (identity) => service.providerAccountHealth(identity)));
  app.get("/v1/dev/admin-v2/catalog/release-gates", (request, reply) => executeWithSession(request, reply, (identity) => service.routeReleaseGates(identity)));
  app.get("/v1/dev/admin-v2/catalog/snapshots", (request, reply) => executeWithSession(request, reply, (identity) => service.snapshotHistory(identity)));
  app.get("/v1/dev/admin-v2/catalog/reference-snapshots", (request, reply) => executeWithSession(request, reply, (identity) => service.referenceSnapshotHistory(identity)));
  app.get("/v1/dev/admin-v2/catalog/reference-models", (request, reply) => executeWithSession(request, reply, (identity) => service.referenceCatalogModels(identity)));
  app.get("/v1/dev/admin-v2/durable/overview", (request, reply) => executeWithSession(request, reply, (identity) => service.durableOverview(identity)));
  app.get("/v1/dev/admin-v2/commerce/overview", (request, reply) => executeWithSession(request, reply, (identity) => service.commerceOverview(identity)));
  app.get<{ Querystring: { limit?: string } }>("/v1/dev/admin-v2/durable/operations", (request, reply) => executeWithSession(request, reply, (identity) => service.durableOperations(identity, request.query.limit === undefined ? undefined : Number(request.query.limit))));
  app.get<{ Querystring: { limit?: string } }>("/v1/dev/admin-v2/durable/owners", (request, reply) => executeWithSession(request, reply, (identity) => service.durableOwners(identity, request.query.limit === undefined ? undefined : Number(request.query.limit))));
  app.get<{ Querystring: { limit?: string } }>("/v1/dev/admin-v2/durable/exceptions", (request, reply) => executeWithSession(request, reply, (identity) => service.durableExceptionQueue(identity, request.query.limit === undefined ? undefined : Number(request.query.limit))));
  app.get<{ Params: { ownerId: string } }>("/v1/dev/admin-v2/durable/owners/:ownerId", (request, reply) => executeWithSession(request, reply, async (identity) => {
    const profile = await service.durableOwnerFinance(identity, request.params.ownerId);
    if (!profile) return reply.code(404).send({ error: { code: "DURABLE_OWNER_NOT_FOUND", message: "Durable owner was not found.", requestId: request.id } });
    return profile;
  }));
  app.get<{ Params: { operationId: string } }>("/v1/dev/admin-v2/durable/operations/:operationId", (request, reply) => executeWithSession(request, reply, async (identity) => {
    const history = await service.durableOperationHistory(identity, request.params.operationId);
    if (!history) return reply.code(404).send({ error: { code: "DURABLE_OPERATION_NOT_FOUND", message: "Durable operation was not found.", requestId: request.id } });
    return history;
  }));
  app.post<{ Body: { snapshot: CatalogSnapshotInput; reasonCode: string } }>(
    "/v1/dev/admin-v2/catalog/snapshots",
    (request, reply) => executeWithSession(request, reply, (identity) => reply.code(201).send(service.stageCatalogSnapshot(identity, commandId(request), request.body.snapshot, request.body.reasonCode)), true),
  );
  app.post<{ Body: { snapshot: PublicReferenceCatalogSnapshot; reasonCode: string } }>(
    "/v1/dev/admin-v2/catalog/reference-snapshots",
    (request, reply) => executeWithSession(request, reply, (identity) => reply.code(201).send(service.stageReferenceCatalogSnapshot(identity, commandId(request), request.body.snapshot, request.body.reasonCode)), true),
  );

  app.post<{ Body: { resourceType: AdminResourceType; resourceId: string; payload: Record<string, unknown>; reasonCode: string } }>(
    "/v1/dev/admin-v2/changes",
    (request, reply) => executeWithSession(request, reply, (identity) => reply.code(201).send(service.changes.createDraft(
      identity,
      commandId(request),
      request.body,
    )), true),
  );

  const transition = (
    path: "validate" | "simulate" | "approve" | "reject",
    action: (identity: AdminIdentity, command: string, changeId: string, evidenceHash: string) => unknown,
  ) => app.post<{ Params: { changeId: string }; Body: CommandBody }>(
    `/v1/dev/admin-v2/changes/:changeId/${path}`,
    (request, reply) => executeWithSession(request, reply, (identity) => action(
      identity,
      commandId(request),
      request.params.changeId,
      request.body?.evidenceHash ?? "",
    ), true),
  );
  transition("validate", service.changes.validate.bind(service.changes));
  transition("simulate", service.changes.simulate.bind(service.changes));
  transition("approve", service.changes.approve.bind(service.changes));
  transition("reject", service.changes.reject.bind(service.changes));

  app.post<{ Params: { changeId: string } }>(
    "/v1/dev/admin-v2/changes/:changeId/publish",
    (request, reply) => executeWithSession(request, reply, async (identity) => service.publishChange(identity, commandId(request), request.params.changeId), true),
  );
  app.post<{ Params: { changeId: string }; Body: CommandBody }>(
    "/v1/dev/admin-v2/changes/:changeId/rollback",
    (request, reply) => executeWithSession(request, reply, (identity) => reply.code(201).send(service.changes.createRollbackDraft(
      identity,
      commandId(request),
      request.params.changeId,
      request.body?.reasonCode ?? "",
    )), true),
  );

  app.post<{ Body: { providerId: string; accountId: string; environment: "LOCAL" | "STAGING" | "PRODUCTION"; purpose?: "PROVIDER_GENERATION_KEY" | "PROVIDER_WEBHOOK_HMAC" | "PROVIDER_MANAGEMENT_KEY"; secret: string } }>(
    "/v1/dev/admin-v2/credentials",
    (request, reply) => executeWithSession(request, reply, async (identity) => reply.code(201).send(
      await service.writeCredential(identity, commandId(request), request.body),
    ), true),
  );
  app.post<{ Params: { credentialId: string } }>(
    "/v1/dev/admin-v2/credentials/:credentialId/test",
    (request, reply) => executeWithSession(request, reply, async (identity) => service.testCredential(identity, commandId(request), request.params.credentialId), true),
  );
  app.post<{ Params: { credentialId: string } }>(
    "/v1/dev/admin-v2/credentials/:credentialId/activate",
    (request, reply) => executeWithSession(request, reply, async (identity) => service.activateCredential(identity, commandId(request), request.params.credentialId), true),
  );
  app.post<{ Params: { credentialId: string } }>(
    "/v1/dev/admin-v2/credentials/:credentialId/revoke",
    (request, reply) => executeWithSession(request, reply, async (identity) => service.revokeCredential(identity, commandId(request), request.params.credentialId), true),
  );
}
