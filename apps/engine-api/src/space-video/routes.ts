import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SpaceVideoError, SpaceVideoService } from "./service.ts";

function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof SpaceVideoError) {
    return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } });
  }
  throw error;
}

export async function registerSpaceVideoRoutes(app: FastifyInstance, options: { service: SpaceVideoService }) {
  app.post("/v1/dev/space/video-quotes", async (request, reply) => {
    try {
      return reply.code(201).send(options.service.createQuote(request.body));
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post<{ Params: { quoteId: string } }>("/v1/dev/space/video-quotes/:quoteId/confirm", async (request, reply) => {
    try {
      return reply.code(202).send(await options.service.confirm(request.params.quoteId, request.body));
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.post<{ Params: { operationId: string } }>("/v1/dev/space/video-operations/:operationId/run", async (request, reply) => {
    try {
      return reply.code(200).send(await options.service.run(request.params.operationId));
    } catch (error) {
      return handleError(error, request, reply);
    }
  });

  app.get<{ Params: { operationId: string } }>("/v1/dev/space/video-operations/:operationId", async (request, reply) => {
    try {
      return reply.code(200).send(await options.service.recover(request.params.operationId));
    } catch (error) {
      return handleError(error, request, reply);
    }
  });
}
