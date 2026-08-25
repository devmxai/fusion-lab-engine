import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SpaceAdvancedError, SpaceAdvancedService } from "./service.ts";

function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof SpaceAdvancedError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } });
  throw error;
}

export async function registerSpaceAdvancedRoutes(app: FastifyInstance, options: { service: SpaceAdvancedService }) {
  app.post("/v1/dev/space/advanced-quotes", async (request, reply) => {
    try { return reply.code(201).send(options.service.createQuote(request.body)); } catch (error) { return handleError(error, request, reply); }
  });
  app.post<{ Params: { quoteId: string } }>("/v1/dev/space/advanced-quotes/:quoteId/confirm", async (request, reply) => {
    try { return reply.code(202).send(await options.service.confirm(request.params.quoteId, request.body)); } catch (error) { return handleError(error, request, reply); }
  });
  app.post<{ Params: { operationId: string } }>("/v1/dev/space/advanced-operations/:operationId/run", async (request, reply) => {
    try { return reply.code(200).send(await options.service.run(request.params.operationId)); } catch (error) { return handleError(error, request, reply); }
  });
  app.get<{ Params: { operationId: string } }>("/v1/dev/space/advanced-operations/:operationId", async (request, reply) => {
    try { return reply.code(200).send(await options.service.recover(request.params.operationId)); } catch (error) { return handleError(error, request, reply); }
  });
}
