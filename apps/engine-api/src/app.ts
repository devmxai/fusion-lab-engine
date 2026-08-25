import Fastify, { type FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  ErrorResponseSchema,
  HealthResponseSchema,
  ReadinessResponseSchema,
  engineServiceName,
  errorResponseJsonSchema,
  healthResponseJsonSchema,
  readinessResponseJsonSchema,
} from "../../../packages/contracts/src/system.ts";
import {
  loadLocalEngineConfig,
  type LocalEngineConfig,
} from "./config.ts";
import { openApiV2Document } from "../../../packages/contracts/src/openapi.ts";
import { registerLocalMockProviderRoutes } from "./local-provider/routes.ts";
import { ProviderRegistry } from "../../../packages/providers/src/registry.ts";
import { registerLocalTestRouteManifests } from "../../../packages/providers/src/local-test-route-catalog.ts";
import { TestProviderHttpAdapter } from "../../../packages/providers/src/test-provider-adapter.ts";
import { LocalMockProviderService } from "./local-provider/service.ts";
import { LocalAdminRuntimeControls } from "./admin-v2/runtime.ts";
import { LocalAdminV2Service } from "./admin-v2/service.ts";
import { registerAdminV2Routes } from "./admin-v2/routes.ts";
import { LocalAdminSessionAuthority, type AdminIdentityAuthority } from "./admin-v2/session.ts";
import { SpaceImageService } from "./space-image/service.ts";
import { registerSpaceImageRoutes } from "./space-image/routes.ts";
import { SpaceVideoService } from "./space-video/service.ts";
import { registerSpaceVideoRoutes } from "./space-video/routes.ts";
import { SpaceAdvancedService } from "./space-advanced/service.ts";
import { registerSpaceAdvancedRoutes } from "./space-advanced/routes.ts";
import { LocalPaymentSandboxAdapter } from "../../../packages/commerce/src/local-payment-adapter.ts";
import { LocalCommerceService } from "./commerce/service.ts";
import { registerCommerceRoutes } from "./commerce/routes.ts";
import { InMemoryPromotionEngine } from "../../../packages/commerce/src/promotion-engine.ts";
import { localPromotionVersions } from "../../../packages/commerce/src/local-promotion-fixture.ts";
import { GenerationV2Service } from "./generation-v2/service.ts";
import { registerGenerationV2Routes } from "./generation-v2/routes.ts";
import { LocalUserSessionAuthority, type EngineUserSessionAuthority } from "./generation-v2/session.ts";
import { LocalDurableRuntime } from "./durable-worker/runtime.ts";
import { LocalEncryptedFileSecretStore, UnavailableSecretStore, type SecretStore } from "../../../packages/admin-control-plane/src/secret-store.ts";
import { verifyProviderConnection } from "./provider-accounts/verification.ts";
import { PostgresProviderControlPlaneRepository } from "../../../packages/provider-control-plane/src/postgres-repository.ts";
import { ProviderControlPlaneChangePublisher } from "../../../packages/provider-control-plane/src/admin-change-publisher.ts";
import { DurablePublishedOfferQuoteEngine } from "../../../packages/commercial-engine/src/published-offer-quote.ts";
import { PostgresCommercialRegistryRepository } from "../../../packages/commercial-engine/src/durable-registry-repository.ts";

type BuildEngineAppOptions = {
  config?: LocalEngineConfig;
  now?: () => Date;
  providerRegistry?: ProviderRegistry;
  adminSessionAuthority?: AdminIdentityAuthority;
  userSessionAuthority?: EngineUserSessionAuthority;
  durableRuntime?: LocalDurableRuntime;
  adminRuntime?: LocalAdminRuntimeControls;
  secretStore?: SecretStore;
};

export function buildEngineApp(options: BuildEngineAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadLocalEngineConfig();
  const now = options.now ?? (() => new Date());
  const providerRegistry = options.providerRegistry ?? (() => {
    const registry = new ProviderRegistry();
    registry.register(new TestProviderHttpAdapter({
      baseUrl: config.TEST_PROVIDER_BASE_URL,
      apiKey: config.TEST_PROVIDER_API_KEY,
      timeoutMs: config.TEST_PROVIDER_TIMEOUT_MS,
    }));
    return registry;
  })();
  registerLocalTestRouteManifests(providerRegistry);

  const app = Fastify({
    logger: config.ENGINE_LOG_LEVEL === "silent"
      ? false
      : { level: config.ENGINE_LOG_LEVEL },
    bodyLimit: 1_048_576,
    connectionTimeout: 10_000,
    requestTimeout: 15_000,
    trustProxy: false,
    requestIdHeader: "x-request-id",
  });
  const adminRuntime = options.adminRuntime ?? new LocalAdminRuntimeControls();
  const promotionEngine = new InMemoryPromotionEngine(localPromotionVersions, now);
  const localProviderService = new LocalMockProviderService({
    markupBps: BigInt(config.ENGINE_LOCAL_PROVIDER_MARKUP_BPS),
    providerRegistry,
    now,
    routeDispatchGuard: adminRuntime.routeDispatch.bind(adminRuntime),
    promotionEngine,
  });
  const adminSessionAuthority = options.adminSessionAuthority ?? new LocalAdminSessionAuthority(
    randomBytes(32).toString("hex"),
    now,
  );
  const spaceImageService = new SpaceImageService(localProviderService, now);
  const spaceVideoService = new SpaceVideoService(localProviderService, now);
  const spaceAdvancedService = new SpaceAdvancedService(localProviderService, now);
  const providerControlRepository = options.durableRuntime
    ? new PostgresProviderControlPlaneRepository(options.durableRuntime.providerControlSqlClient(), now)
    : undefined;
  const commercialRegistryRepository = options.durableRuntime
    ? new PostgresCommercialRegistryRepository(options.durableRuntime.providerControlSqlClient(), now)
    : undefined;
  const publishedOfferGateway = providerControlRepository && commercialRegistryRepository
    ? {
      offers: () => providerControlRepository.activeCustomerPublishedOffers(),
      quote: (input: Parameters<DurablePublishedOfferQuoteEngine["quote"]>[0]) => new DurablePublishedOfferQuoteEngine(
        providerControlRepository,
        commercialRegistryRepository,
        now,
      ).quote(input),
      executionEvidence: (offerId: string) => providerControlRepository.activePublishedOfferExecutionEvidence(offerId),
    }
    : undefined;
  const generationV2Service = new GenerationV2Service(
    spaceImageService,
    spaceVideoService,
    spaceAdvancedService,
    localProviderService,
    options.durableRuntime,
    publishedOfferGateway,
    // An explicitly injected registry belongs to the deterministic test
    // harness. The normal local server never exposes fixture quotes.
    config.NODE_ENV === "test" || options.providerRegistry !== undefined,
  );
  const userSessions = options.userSessionAuthority ?? (config.NODE_ENV === "test" ? undefined : new LocalUserSessionAuthority(randomBytes(32).toString("hex"), now));
  const commerceService = new LocalCommerceService({
    paymentAdapter: new LocalPaymentSandboxAdapter(),
    webhookSecret: config.TEST_PAYMENT_WEBHOOK_SECRET,
    creditGateway: localProviderService,
    now,
    promotionEngine,
  });
  const secretStore = options.secretStore ?? (config.ADMIN_LOCAL_SECRET_STORE_KEY
    ? new LocalEncryptedFileSecretStore(join(config.ENGINE_DURABLE_DB_PATH, "admin-secrets.json"), Buffer.from(config.ADMIN_LOCAL_SECRET_STORE_KEY, "hex"), now)
    : new UnavailableSecretStore());
  const providerControlPublisher = providerControlRepository
    ? new ProviderControlPlaneChangePublisher(providerControlRepository)
    : undefined;
  const adminV2Service = new LocalAdminV2Service(
    adminRuntime, localProviderService, providerRegistry, options.durableRuntime, commerceService, secretStore,
    async ({ providerId, purpose, secret }) => {
      if (providerId === "provider-test") return secret.byteLength >= 12 ? {
        providerId: "provider-test", credentialPurpose: purpose, connected: true, observedAt: now().toISOString(), accountLabel: "Provider For Test", balance: null, keyLimit: null,
      } : null;
      return verifyProviderConnection({ providerId, credentialPurpose: purpose, secret, now });
    },
    providerControlPublisher,
  );

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    return payload;
  });

  app.get(
    "/healthz",
    {
      schema: {
        response: { 200: healthResponseJsonSchema },
      },
    },
    async () => HealthResponseSchema.parse({
      service: engineServiceName,
      status: "ok",
      mode: config.ENGINE_MODE,
      version: config.ENGINE_VERSION,
      timestamp: now().toISOString(),
    }),
  );

  app.get(
    "/readyz",
    {
      schema: {
        response: { 200: readinessResponseJsonSchema },
      },
    },
    async () => ReadinessResponseSchema.parse({
      service: engineServiceName,
      status: "ready",
      mode: config.ENGINE_MODE,
      checks: { config: true },
      timestamp: now().toISOString(),
    }),
  );

  app.get("/openapi/v2.json", async (_request, reply) => {
    reply.type("application/json; charset=utf-8");
    return openApiV2Document;
  });

  if (options.durableRuntime) {
    app.get("/v1/dev/durable/status", async () => options.durableRuntime!.status());
    app.addHook("onClose", async () => options.durableRuntime!.close());
  }

  void app.register(registerLocalMockProviderRoutes, {
    markupBps: BigInt(config.ENGINE_LOCAL_PROVIDER_MARKUP_BPS),
    providerRegistry,
    service: localProviderService,
    onReset: () => commerceService.reset(),
  });
  // These compatibility routes exercise the former in-memory space services.
  // Creative Space uses /v2 exclusively; keep them test-only so a normal local
  // server cannot expose a second reservation/settlement path.
  if (config.NODE_ENV === "test") {
    void app.register(registerSpaceImageRoutes, { service: spaceImageService });
    void app.register(registerSpaceVideoRoutes, { service: spaceVideoService });
    void app.register(registerSpaceAdvancedRoutes, { service: spaceAdvancedService });
  }
  void app.register(registerGenerationV2Routes, { service: generationV2Service, sessions: userSessions, durableRuntime: options.durableRuntime });
  void app.register(registerCommerceRoutes, { service: commerceService });
  void app.register(registerAdminV2Routes, { service: adminV2Service, sessions: adminSessionAuthority });

  app.setNotFoundHandler((request, reply) => {
    const response = ErrorResponseSchema.parse({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
        requestId: request.id,
      },
    });
    return reply.code(404).send(response);
  });

  app.setErrorHandler((error, request, reply) => {
    if (
      typeof error === "object"
      && error !== null
      && "validation" in error
      && error.validation
    ) {
      const response = ErrorResponseSchema.parse({
        error: {
          code: "INVALID_REQUEST",
          message: "The request does not match the local Engine contract.",
          requestId: request.id,
        },
      });
      return reply.type("application/json").code(400).send(response);
    }

    const statusCode = typeof error === "object"
      && error !== null
      && "statusCode" in error
      && typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
    if (statusCode >= 400 && statusCode < 500) {
      const response = ErrorResponseSchema.parse({
        error: {
          code: statusCode === 415 ? "UNSUPPORTED_MEDIA_TYPE" : "INVALID_REQUEST",
          message: "The request is not accepted by the local Engine API.",
          requestId: request.id,
        },
      });
      return reply.type("application/json").code(statusCode).send(response);
    }

    request.log.error({ err: error, requestId: request.id }, "engine request failed");
    const response = ErrorResponseSchema.parse({
      error: {
        code: "INTERNAL_ERROR",
        message: "The local Engine API could not process the request.",
        requestId: request.id,
      },
    });
    return reply
      .type("application/json")
      .code(500)
      .serializer((payload) => JSON.stringify(payload))
      .send(response);
  });

  app.addSchema({ $id: "error-response", ...errorResponseJsonSchema });

  return app;
}
