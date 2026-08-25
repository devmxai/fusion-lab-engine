import Fastify, { type FastifyInstance } from "fastify";
import type { ProviderTestConfig } from "./config.ts";
import { loadProviderTestConfig } from "./config.ts";
import { ProviderTestError, ProviderTestService } from "./service.ts";

type BuildProviderTestAppOptions = {
  config?: ProviderTestConfig;
  service?: ProviderTestService;
};

export function buildProviderTestApp(
  options: BuildProviderTestAppOptions = {},
): FastifyInstance {
  const config = options.config ?? loadProviderTestConfig();
  const service = options.service ?? new ProviderTestService(config.TEST_PROVIDER_PUBLIC_URL);
  const app = Fastify({
    logger: config.TEST_PROVIDER_LOG_LEVEL === "silent"
      ? false
      : { level: config.TEST_PROVIDER_LOG_LEVEL },
    bodyLimit: 1_048_576,
    requestTimeout: 10_000,
  });

  app.get("/healthz", async () => ({ status: "ok", provider: "provider-test" }));

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/v1/")) return;
    if (request.headers.authorization !== `Bearer ${config.TEST_PROVIDER_API_KEY}`) {
      return reply.code(401).send({
        error: { code: "UNAUTHORIZED", message: "Invalid Provider For Test API key." },
      });
    }
  });

  app.get("/v1/models", async () => ({ models: service.listModels() }));
  app.get("/v1/credits", async () => service.getBalance());
  app.post("/v1/generations", async (request, reply) => {
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8) {
      return reply.code(400).send({
        error: { code: "INVALID_IDEMPOTENCY_KEY", message: "Idempotency-Key is required." },
      });
    }
    const result = service.submit(request.body, idempotencyKey);
    if (result.submissionUnknown) {
      return reply.code(504).send({
        error: { code: "SUBMISSION_UNKNOWN", message: "Simulated response timeout." },
      });
    }
    return reply.code(202).send(result.task);
  });
  app.get<{ Params: { idempotencyKey: string } }>(
    "/v1/generations/by-idempotency/:idempotencyKey",
    async (request, reply) => {
      const task = service.lookup(request.params.idempotencyKey);
      return task ? task : reply.code(404).send({
        error: { code: "TASK_NOT_FOUND", message: "Task not found." },
      });
    },
  );
  app.get<{ Params: { taskId: string } }>(
    "/v1/generations/:taskId",
    async (request) => service.poll(request.params.taskId),
  );
  app.get<{ Params: { taskId: string } }>(
    "/v1/assets/:taskId",
    async (request, reply) => {
      const asset = service.getAsset(request.params.taskId);
      return reply.type(asset.contentType).send(Buffer.from(asset.bytes));
    },
  );
  app.post("/v1/dev/reset", async (_request, reply) => {
    service.reset();
    return reply.code(204).send();
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ProviderTestError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }
    if (typeof error === "object" && error !== null && "issues" in error) {
      return reply.code(400).send({
        error: { code: "INVALID_REQUEST", message: "Request contract is invalid." },
      });
    }
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Provider For Test failed." },
    });
  });

  return app;
}
