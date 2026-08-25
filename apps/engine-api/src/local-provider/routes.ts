import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  LocalMockProviderError,
  LocalMockProviderService,
} from "./service.ts";
import type { ProviderRegistry } from "../../../../packages/providers/src/registry.ts";
import type { ProviderTaskResponse } from "../../../../packages/contracts/src/provider.ts";

const quoteBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["modelId"],
  properties: {
    userId: { type: "string", minLength: 1, maxLength: 100 },
    modelId: {
      type: "string",
      enum: [
        "local/test-image-v1",
        "local/test-video-v1",
        "local/test-audio-v1",
      ],
    },
    quantity: { type: "integer", minimum: 1, maximum: 4 },
    durationSeconds: { type: "integer", minimum: 1, maximum: 60 },
    characterCount: { type: "integer", minimum: 1, maximum: 100000 },
    resolution: { type: "string", enum: ["720p", "1080p"] },
    audio: { type: "boolean" },
    promotionCode: { type: ["string", "null"], minLength: 3, maxLength: 100 },
  },
} as const;

const operationBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["quoteId", "idempotencyKey"],
  properties: {
    userId: { type: "string", minLength: 1, maxLength: 100 },
    quoteId: { type: "string", format: "uuid" },
    idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
    scenario: {
      type: "string",
      enum: [
        "success",
        "provider_failure",
        "submission_unknown_then_success",
        "delivery_failure",
        "cost_shock_success",
      ],
    },
  },
} as const;

const callbackBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["operationId", "deliveryId", "task"],
  properties: {
    operationId: { type: "string", minLength: 1 },
    deliveryId: { type: "string", minLength: 1, maxLength: 200 },
    task: {
      type: "object",
      additionalProperties: false,
      required: ["taskId", "status", "actualProviderCredits", "resultUrl", "errorCode"],
      properties: {
        taskId: { type: "string", minLength: 1 },
        status: { type: "string", enum: ["submitted", "running", "succeeded", "failed"] },
        actualProviderCredits: { type: ["integer", "null"], minimum: 0 },
        resultUrl: { type: ["string", "null"] },
        errorCode: { type: ["string", "null"] },
        chargeStatus: { type: "string", enum: ["ACTUAL", "CONFIRMED_NO_CHARGE", "UNKNOWN"] },
      },
    },
  },
} as const;

function handleError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof LocalMockProviderError) {
    return reply.code(error.statusCode).send({
      error: { code: error.code, message: error.message, requestId: request.id },
    });
  }
  throw error;
}

export async function registerLocalMockProviderRoutes(
  app: FastifyInstance,
  options: {
    markupBps?: bigint;
    providerRegistry: ProviderRegistry;
    service?: LocalMockProviderService;
    onReset?: () => void | Promise<void>;
  },
): Promise<void> {
  const service = options.service ?? new LocalMockProviderService({
    markupBps: options.markupBps,
    providerRegistry: options.providerRegistry,
  });
  app.get("/v1/dev/mock/catalog", async () => service.getCatalog());

  app.post(
    "/v1/dev/mock/quotes",
    { schema: { body: quoteBodySchema } },
    async (request, reply) => {
      try {
        return reply.code(201).send(service.createQuote(request.body));
      } catch (error) {
        return handleError(error, request, reply);
      }
    },
  );

  app.post(
    "/v1/dev/mock/operations",
    { schema: { body: operationBodySchema } },
    async (request, reply) => {
      try {
        return reply.code(202).send(await service.createOperation(request.body));
      } catch (error) {
        return handleError(error, request, reply);
      }
    },
  );

  app.get<{ Params: { operationId: string } }>(
    "/v1/dev/mock/operations/:operationId",
    async (request, reply) => {
      try {
        return service.getOperation(request.params.operationId);
      } catch (error) {
        return handleError(error, request, reply);
      }
    },
  );

  app.post<{ Params: { operationId: string } }>(
    "/v1/dev/mock/operations/:operationId/advance",
    async (request, reply) => {
      try {
        return service.advance(request.params.operationId);
      } catch (error) {
        return handleError(error, request, reply);
      }
    },
  );

  app.get<{ Params: { userId: string } }>(
    "/v1/dev/mock/wallets/:userId",
    async (request) => service.getBalances(request.params.userId),
  );

  app.get("/v1/dev/mock/orchestration", async () => service.getOrchestrationAudit());
  app.get("/v1/dev/mock/reconciliation", async () => service.getReconciliationReport());
  app.get("/v1/dev/mock/treasury", async () => service.getTreasuryDashboard());
  app.post<{ Body: { operationId: string; deliveryId: string; task: ProviderTaskResponse } }>(
    "/v1/dev/mock/callbacks/provider-test",
    { schema: { body: callbackBodySchema } },
    async (request, reply) => {
      try {
        return service.consumeProviderCallback(request.body);
      } catch (error) {
        return handleError(error, request, reply);
      }
    },
  );

  app.post("/v1/dev/mock/reset", async (_request, reply) => {
    await service.reset();
    await options.onReset?.();
    return reply.code(204).send();
  });

  app.get<{ Params: { operationId: string }; Querystring: { token?: string } }>(
    "/v1/dev/mock/assets/:operationId",
    async (request, reply) => {
      try {
        const asset = service.getAsset(request.params.operationId, request.query.token ?? "");
        return reply
          .type(asset.contentType)
          .header("x-content-sha256", asset.checksumSha256)
          .send(Buffer.from(asset.bytes));
      } catch (error) {
        return handleError(error, request, reply);
      }
    },
  );
}
