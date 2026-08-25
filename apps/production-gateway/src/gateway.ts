import { hasAdminPermission } from "../../../packages/admin-control-plane/src/authorization.js";
import { loadProductionGatewayConfig, type ProductionGatewayConfig } from "./config.js";
import {
  ProductionAdminAuthenticationError,
  SupabaseProductionAdminAuthority,
} from "./supabase-admin-authority.js";
import { productionDatabaseReadiness } from "./database-readiness.js";
import { readProductionAdmin } from "./production-admin-read.js";
import { executeProductionAdminCommand, ProductionAdminCommandError } from "./production-admin-command.js";
import { AdminControlPlaneError } from "../../../packages/admin-control-plane/src/types.js";
import { changeProductionModelSelection, importProductionReferenceCatalog, ProductionCatalogCommandError, reviewProductionModelPresentation } from "./production-catalog-command.js";
import { executeProductionPricingCommand, ProductionPricingCommandError } from "./production-pricing-command.js";
import { activateInternalStarterSubscription, ProductionSubscriptionCommandError } from "./production-subscription-command.js";
import { publishProductionPlanVersion, ProductionPlanCommandError, retireProductionPlan } from "./production-plan-command.js";
import { generateSubscriptionActivationKey, ProductionActivationKeyError, readProductionCustomerAccount, redeemSubscriptionActivationKey, revokeSubscriptionActivationKey } from "./production-activation-key.js";
import { ProductionUserAuthenticationError, SupabaseProductionUserAuthority } from "./supabase-user-authority.js";
import { ProductionGenerationService, productionGenerationFailure, type ProductionGenerationResponse } from "./production-generation.js";
import { timingSafeEqual } from "node:crypto";

export type ProductionGatewayRequest = Readonly<{
  method: string;
  path: string;
  authorization?: string;
  idempotencyKey?: string;
  assetGrant?: string;
  webhookTimestamp?: string;
  webhookSignature?: string;
  rawBody?: Uint8Array;
  body?: unknown;
  query?: Readonly<Record<string, string | undefined>>;
}>;

export type ProductionGatewayResponse = ProductionGenerationResponse;

function capabilities(identity: Awaited<ReturnType<SupabaseProductionAdminAuthority["resolve"]>>["identity"]) {
  return {
    session: {
      actorId: identity.actorId,
      roles: [...identity.roles],
      assuranceLevel: identity.assuranceLevel,
      mode: "AUTHORIZED_ADMIN" as const,
    },
    permissions: {
      read: hasAdminPermission(identity, "READ"),
      providerCredentials: {
        write: hasAdminPermission(identity, "WRITE_SECRET", "PROVIDER_CREDENTIAL"),
        test: hasAdminPermission(identity, "TEST_SECRET", "PROVIDER_CREDENTIAL"),
        activate: hasAdminPermission(identity, "ACTIVATE_SECRET", "PROVIDER_CREDENTIAL"),
        revoke: hasAdminPermission(identity, "REVOKE_SECRET", "PROVIDER_CREDENTIAL"),
      },
      catalog: {
        import: hasAdminPermission(identity, "DRAFT", "REFERENCE_CATALOG_SNAPSHOT"),
        select: hasAdminPermission(identity, "DRAFT", "ROUTE_CANDIDATE"),
      },
      pricing: {
        sync: hasAdminPermission(identity, "DRAFT", "PRICING_POLICY"),
        configure: hasAdminPermission(identity, "DRAFT", "PRICING_POLICY"),
      },
    },
    safeguards: {
      secretValuesReadableInBrowser: false,
      providerCallsTriggeredByPageLoad: false,
      makerCheckerRequiredForCredentialActivation: !identity.roles.includes("SUPER_ADMIN"),
      superAdminSelfActivationAllowed: identity.roles.includes("SUPER_ADMIN"),
    },
  };
}

function readBatchPaths(body: unknown): Array<{ responseKey: string; enginePath: string }> | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as { paths?: unknown }).paths)) return null;
  const paths = [...new Set((body as { paths: unknown[] }).paths)];
  // Keep a single invocation inside the two-connection database budget. The
  // browser partitions larger page reads into parallel, bounded batches.
  if (!paths.length || paths.length > 4) return null;
  if (!paths.every((path): path is string => typeof path === "string" && path.startsWith("/") && path.length <= 256)) return null;
  const normalized = paths.map((path) => {
    const relative = path.startsWith("/v1/admin/") ? path : `/v1/admin${path}`;
    return { responseKey: path, enginePath: new URL(relative, "https://fusionlab.invalid").pathname };
  });
  if (normalized.some(({ enginePath }) => !enginePath.startsWith("/v1/admin/") || enginePath === "/v1/admin/read-batch")) return null;
  return normalized;
}

export async function routeProductionGateway(
  input: ProductionGatewayRequest,
  options: { environment?: NodeJS.ProcessEnv; request?: typeof fetch; config?: ProductionGatewayConfig; databaseProbe?: (config: ProductionGatewayConfig) => Promise<boolean> } = {},
): Promise<ProductionGatewayResponse> {
  if (input.method === "GET" && input.path === "/healthz") {
    return { status: 200, body: { service: "fusionlab-production-gateway", status: "ok", runtime: "vercel" } };
  }

  let config: ProductionGatewayConfig;
  try {
    config = options.config ?? loadProductionGatewayConfig(options.environment);
  } catch {
    return { status: 503, body: { error: { code: "PRODUCTION_CONFIGURATION_UNAVAILABLE", message: "Production runtime is not configured." } } };
  }

  if (input.method === "GET" && input.path === "/readyz") {
    if (!config.SUPABASE_DATABASE_URL) {
      return { status: 503, body: { error: { code: "PRODUCTION_DATABASE_CONFIGURATION_UNAVAILABLE", message: "The Production database connection is not configured." } } };
    }
    try {
      const ready = await (options.databaseProbe ?? productionDatabaseReadiness)(config);
      return ready
        ? { status: 200, body: { service: "fusionlab-production-gateway", status: "ready", database: "fusion_engine" } }
        : { status: 503, body: { error: { code: "PRODUCTION_SCHEMA_UNAVAILABLE", message: "The Production Engine schema has not been released." } } };
    } catch {
      return { status: 503, body: { error: { code: "PRODUCTION_DATABASE_UNAVAILABLE", message: "The Production database is unavailable." } } };
    }
  }

  if (input.method === "GET" && input.path === "/v2/internal/recovery") {
    if (!config.RECOVERY_SECRET) {
      return { status: 503, body: { error: { code: "RECOVERY_NOT_CONFIGURED", message: "Background recovery is not configured." } } };
    }
    const expected = Buffer.from(`Bearer ${config.RECOVERY_SECRET}`);
    const actual = Buffer.from(input.authorization ?? "");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { status: 401, body: { error: { code: "RECOVERY_AUTHENTICATION_FAILED", message: "Recovery authentication failed." } } };
    }
    try {
      return await new ProductionGenerationService(config, options.request).recoverPending();
    } catch (error) {
      return productionGenerationFailure(error);
    }
  }

  if (input.method === "POST" && input.path === "/v2/provider-callbacks/kie") {
    if (!config.KIE_WEBHOOK_HMAC_KEY && !config.SUPABASE_DATABASE_URL) {
      return { status: 503, body: { error: { code: "KIE_WEBHOOK_NOT_CONFIGURED", message: "The verified KIE webhook is not configured." } } };
    }
    try {
      return await new ProductionGenerationService(config, options.request).handleKieWebhook({
        rawBody: input.rawBody ?? new Uint8Array(),
        timestamp: input.webhookTimestamp,
        signature: input.webhookSignature,
      });
    } catch (error) {
      return productionGenerationFailure(error);
    }
  }

  const providerInput = input.path.match(/^\/v2\/provider-inputs\/([0-9a-f-]+)\/([0-9a-f-]+)$/i);
  if (input.method === "GET" && providerInput) {
    try {
      return await new ProductionGenerationService(config, options.request).readProviderInput(providerInput[1]!, providerInput[2]!, input.query ?? {});
    } catch (error) {
      return productionGenerationFailure(error);
    }
  }

  if (input.method === "POST" && input.path === "/v1/admin/read-batch") {
    const paths = readBatchPaths(input.body);
    if (!paths) return { status: 400, body: { error: { code: "ADMIN_READ_BATCH_INVALID", message: "Admin read batch is invalid." } } };
    try {
      const session = await new SupabaseProductionAdminAuthority(config, options.request, options.request ? 0 : 10_000).resolve(input.authorization);
      if (!hasAdminPermission(session.identity, "READ")) {
        return { status: 403, body: { error: { code: "ADMIN_PERMISSION_DENIED", message: "Admin read permission is required." } } };
      }
      const entries = await Promise.all(paths.map(async ({ responseKey, enginePath }) => {
        if (enginePath === "/v1/admin/capabilities") return [responseKey, { status: 200, body: capabilities(session.identity) }] as const;
        return [responseKey, await readProductionAdmin(enginePath, config, options.request)] as const;
      }));
      return { status: 200, body: { results: Object.fromEntries(entries) } };
    } catch (error) {
      if (error instanceof ProductionAdminAuthenticationError) {
        const status = error.code === "ADMIN_MEMBERSHIP_REQUIRED" ? 403 : 401;
        return { status, body: { error: { code: error.code, message: status === 401 ? "A verified Admin session is required." : "Admin membership is required." } } };
      }
      return { status: 503, body: { error: { code: "ADMIN_READ_UNAVAILABLE", message: "Admin data is temporarily unavailable." } } };
    }
  }

  if (input.method === "GET" && input.path.startsWith("/v1/admin/")) {
    try {
      // A short read-only cache removes repeated Auth/role round-trips while
      // navigation remains server-authorized. Mutating commands never use it.
      const session = await new SupabaseProductionAdminAuthority(config, options.request, options.request ? 0 : 10_000).resolve(input.authorization);
      if (!hasAdminPermission(session.identity, "READ")) {
        return { status: 403, body: { error: { code: "ADMIN_PERMISSION_DENIED", message: "Admin read permission is required." } } };
      }
      if (input.path === "/v1/admin/capabilities") return { status: 200, body: capabilities(session.identity) };
      const result = await readProductionAdmin(input.path, config, options.request);
      return { status: result.status, body: result.body };
    } catch (error) {
      if (error instanceof ProductionAdminAuthenticationError) {
        const status = error.code === "ADMIN_MEMBERSHIP_REQUIRED" ? 403 : 401;
        return { status, body: { error: { code: error.code, message: status === 401 ? "A verified Admin session is required." : "Admin membership is required." } } };
      }
      return { status: 503, body: { error: { code: "ADMIN_READ_UNAVAILABLE", message: "Admin data is temporarily unavailable." } } };
    }
  }

  if (input.method === "POST" && input.path.startsWith("/v1/admin/credentials")) {
    try {
      const session = await new SupabaseProductionAdminAuthority(config, options.request).resolve(input.authorization);
      const result = await executeProductionAdminCommand({
        path: input.path,
        body: input.body,
        commandId: input.idempotencyKey,
        identity: session.identity,
        config,
        request: options.request,
      });
      return result;
    } catch (error) {
      if (error instanceof ProductionAdminAuthenticationError) {
        const status = error.code === "ADMIN_MEMBERSHIP_REQUIRED" ? 403 : 401;
        return { status, body: { error: { code: error.code, message: status === 401 ? "A verified Admin session is required." : "Admin membership is required." } } };
      }
      if (error instanceof AdminControlPlaneError) {
        const status = error.code === "AAL2_REQUIRED" || error.code === "ADMIN_PERMISSION_DENIED" ? 403 : 409;
        return { status, body: { error: { code: error.code, message: error.message } } };
      }
      if (error instanceof ProductionAdminCommandError) {
        return { status: error.status, body: { error: { code: error.code, message: error.message } } };
      }
      return { status: 503, body: { error: { code: "ADMIN_COMMAND_UNAVAILABLE", message: "The protected Admin command could not be completed." } } };
    }
  }

  if (input.method === "POST" && input.path.startsWith("/v1/admin/pricing/")) {
    try {
      const session = await new SupabaseProductionAdminAuthority(config, options.request).resolve(input.authorization);
      return await executeProductionPricingCommand({ path: input.path, body: input.body, commandId: input.idempotencyKey, identity: session.identity, config, request: options.request });
    } catch (error) {
      if (error instanceof ProductionAdminAuthenticationError) {
        const status = error.code === "ADMIN_MEMBERSHIP_REQUIRED" ? 403 : 401;
        return { status, body: { error: { code: error.code, message: status === 401 ? "A verified Admin session is required." : "Admin membership is required." } } };
      }
      if (error instanceof AdminControlPlaneError) {
        const status = error.code === "AAL2_REQUIRED" || error.code === "ADMIN_PERMISSION_DENIED" ? 403 : 409;
        return { status, body: { error: { code: error.code, message: error.message } } };
      }
      if (error instanceof ProductionPricingCommandError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
      return { status: 503, body: { error: { code: "PRICING_COMMAND_UNAVAILABLE", message: "The protected pricing command could not be completed." } } };
    }
  }

  if (input.method === "POST" && input.path === "/v1/admin/subscriptions/self/starter-test") {
    try {
      const session = await new SupabaseProductionAdminAuthority(config, options.request).resolve(input.authorization);
      return await activateInternalStarterSubscription({ commandId: input.idempotencyKey, identity: session.identity, config });
    } catch (error) {
      if (error instanceof ProductionAdminAuthenticationError) {
        const status = error.code === "ADMIN_MEMBERSHIP_REQUIRED" ? 403 : 401;
        return { status, body: { error: { code: error.code, message: status === 401 ? "A verified Admin session is required." : "Admin membership is required." } } };
      }
      if (error instanceof ProductionSubscriptionCommandError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
      return { status: 503, body: { error: { code: "SUBSCRIPTION_COMMAND_UNAVAILABLE", message: "The protected subscription command could not be completed." } } };
    }
  }

  if (input.method === "POST" && input.path === "/v1/admin/subscriptions/plans/publish") {
    try {
      const session = await new SupabaseProductionAdminAuthority(config, options.request).resolve(input.authorization);
      return await publishProductionPlanVersion({ commandId: input.idempotencyKey, identity: session.identity, config, body: input.body });
    } catch (error) {
      if (error instanceof ProductionAdminAuthenticationError) {
        const status = error.code === "ADMIN_MEMBERSHIP_REQUIRED" ? 403 : 401;
        return { status, body: { error: { code: error.code, message: status === 401 ? "A verified Admin session is required." : "Admin membership is required." } } };
      }
      if (error instanceof ProductionPlanCommandError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
      return { status: 503, body: { error: { code: "PLAN_COMMAND_UNAVAILABLE", message: "The protected plan command could not be completed." } } };
    }
  }

  const retirePlan = input.path.match(/^\/v1\/admin\/subscriptions\/plans\/([^/]+)\/retire$/);
  if (input.method === "POST" && retirePlan) {
    try {
      const session = await new SupabaseProductionAdminAuthority(config, options.request).resolve(input.authorization);
      return await retireProductionPlan({ commandId: input.idempotencyKey, identity: session.identity, config, planKey: decodeURIComponent(retirePlan[1]!) });
    } catch (error) {
      if (error instanceof ProductionAdminAuthenticationError) {
        const status = error.code === "ADMIN_MEMBERSHIP_REQUIRED" ? 403 : 401;
        return { status, body: { error: { code: error.code, message: status === 401 ? "A verified Admin session is required." : "Admin membership is required." } } };
      }
      if (error instanceof ProductionPlanCommandError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
      return { status: 503, body: { error: { code: "PLAN_COMMAND_UNAVAILABLE", message: "The protected plan command could not be completed." } } };
    }
  }

  if (input.method === "POST" && input.path === "/v1/admin/subscriptions/activation-keys") {
    try {
      const session = await new SupabaseProductionAdminAuthority(config, options.request).resolve(input.authorization);
      return await generateSubscriptionActivationKey({ commandId: input.idempotencyKey, identity: session.identity, config, body: input.body });
    } catch (error) {
      if (error instanceof ProductionAdminAuthenticationError) {
        const status = error.code === "ADMIN_MEMBERSHIP_REQUIRED" ? 403 : 401;
        return { status, body: { error: { code: error.code, message: status === 401 ? "A verified Admin session is required." : "Admin membership is required." } } };
      }
      if (error instanceof ProductionActivationKeyError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
      console.error("subscription_activation_key_generation_failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : "Unknown activation-key failure",
      });
      return { status: 503, body: { error: { code: "ACTIVATION_KEY_UNAVAILABLE", message: "The activation key could not be generated." } } };
    }
  }

  const revokeActivationKey = input.path.match(/^\/v1\/admin\/subscriptions\/activation-keys\/([0-9a-f-]+)\/revoke$/i);
  if (input.method === "POST" && revokeActivationKey) {
    try {
      const session = await new SupabaseProductionAdminAuthority(config, options.request).resolve(input.authorization);
      return await revokeSubscriptionActivationKey({ commandId: input.idempotencyKey, identity: session.identity, config, keyId: revokeActivationKey[1]!, });
    } catch (error) {
      if (error instanceof ProductionAdminAuthenticationError) {
        const status = error.code === "ADMIN_MEMBERSHIP_REQUIRED" ? 403 : 401;
        return { status, body: { error: { code: error.code, message: status === 401 ? "A verified Admin session is required." : "Admin membership is required." } } };
      }
      if (error instanceof ProductionActivationKeyError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
      return { status: 503, body: { error: { code: "ACTIVATION_KEY_UNAVAILABLE", message: "The activation key could not be revoked." } } };
    }
  }

  const catalogImport = input.path.match(/^\/v1\/admin\/catalog\/providers\/(kie|openrouter)\/import$/);
  if (input.method === "POST" && catalogImport) {
    try {
      const session = await new SupabaseProductionAdminAuthority(config, options.request).resolve(input.authorization);
      return await importProductionReferenceCatalog({
        providerId: catalogImport[1] as "kie" | "openrouter",
        commandId: input.idempotencyKey,
        identity: session.identity,
        config,
        request: options.request,
      });
    } catch (error) {
      if (error instanceof ProductionAdminAuthenticationError) {
        const status = error.code === "ADMIN_MEMBERSHIP_REQUIRED" ? 403 : 401;
        return { status, body: { error: { code: error.code, message: status === 401 ? "A verified Admin session is required." : "Admin membership is required." } } };
      }
      if (error instanceof AdminControlPlaneError) {
        const status = error.code === "AAL2_REQUIRED" || error.code === "ADMIN_PERMISSION_DENIED" ? 403 : 409;
        return { status, body: { error: { code: error.code, message: error.message } } };
      }
      if (error instanceof ProductionCatalogCommandError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
      console.error("catalog_import_failed", {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : "Unknown catalog import failure",
        code: error && typeof error === "object" && "code" in error ? String(error.code) : null,
      });
      return { status: 503, body: { error: { code: "CATALOG_IMPORT_UNAVAILABLE", message: "The official provider catalog could not be imported." } } };
    }
  }

  const modelSelection = input.path.match(/^\/v1\/admin\/catalog\/models\/([^/]+)\/(select|unselect)$/);
  if (input.method === "POST" && modelSelection) {
    try {
      const session = await new SupabaseProductionAdminAuthority(config, options.request).resolve(input.authorization);
      return await changeProductionModelSelection({
        referenceModelId: decodeURIComponent(modelSelection[1]!),
        action: modelSelection[2] === "select" ? "SELECT" : "UNSELECT",
        commandId: input.idempotencyKey,
        identity: session.identity,
        config,
      });
    } catch (error) {
      if (error instanceof ProductionAdminAuthenticationError) {
        const status = error.code === "ADMIN_MEMBERSHIP_REQUIRED" ? 403 : 401;
        return { status, body: { error: { code: error.code, message: status === 401 ? "A verified Admin session is required." : "Admin membership is required." } } };
      }
      if (error instanceof AdminControlPlaneError) {
        const status = error.code === "AAL2_REQUIRED" || error.code === "ADMIN_PERMISSION_DENIED" ? 403 : 409;
        return { status, body: { error: { code: error.code, message: error.message } } };
      }
      if (error instanceof ProductionCatalogCommandError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
      return { status: 503, body: { error: { code: "MODEL_SELECTION_UNAVAILABLE", message: "The model selection could not be changed." } } };
    }
  }

  const modelPresentation = input.path.match(/^\/v1\/admin\/catalog\/models\/([^/]+)\/presentation$/);
  if (input.method === "POST" && modelPresentation) {
    try {
      const session = await new SupabaseProductionAdminAuthority(config, options.request).resolve(input.authorization);
      return await reviewProductionModelPresentation({
        referenceModelId: decodeURIComponent(modelPresentation[1]!),
        presentation: input.body,
        commandId: input.idempotencyKey,
        identity: session.identity,
        config,
      });
    } catch (error) {
      if (error instanceof ProductionAdminAuthenticationError) {
        const status = error.code === "ADMIN_MEMBERSHIP_REQUIRED" ? 403 : 401;
        return { status, body: { error: { code: error.code, message: status === 401 ? "A verified Admin session is required." : "Admin membership is required." } } };
      }
      if (error instanceof AdminControlPlaneError) {
        const status = error.code === "AAL2_REQUIRED" || error.code === "ADMIN_PERMISSION_DENIED" ? 403 : 409;
        return { status, body: { error: { code: error.code, message: error.message } } };
      }
      if (error instanceof ProductionCatalogCommandError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
      return { status: 503, body: { error: { code: "MODEL_PRESENTATION_UNAVAILABLE", message: "The model presentation could not be saved." } } };
    }
  }

  if (input.path.startsWith("/v2/")) {
    try {
      const { ownerId } = await new SupabaseProductionUserAuthority(config, options.request).resolve(input.authorization);
      const service = new ProductionGenerationService(config, options.request);
      if (input.method === "GET" && input.path === "/v2/account") return await readProductionCustomerAccount(ownerId, config);
      if (input.method === "POST" && input.path === "/v2/subscriptions/activate") return await redeemSubscriptionActivationKey({ commandId: input.idempotencyKey, ownerId, config, body: input.body });
      if (input.method === "GET" && input.path === "/v2/catalog/offers") return await service.offers();
      if (input.method === "GET" && input.path === "/v2/projects") return await service.projects(ownerId);
      if (input.method === "POST" && input.path === "/v2/projects") return await service.createProject(ownerId, input.body, input.idempotencyKey);
      const project = input.path.match(/^\/v2\/projects\/([^/]+)$/);
      if (input.method === "GET" && project) return await service.project(ownerId, decodeURIComponent(project[1]!));
      if (input.method === "PUT" && project) return await service.saveProject(ownerId, decodeURIComponent(project[1]!), input.body);
      const projectAction = input.path.match(/^\/v2\/projects\/([^/]+)\/actions$/);
      if (input.method === "POST" && projectAction) return await service.projectAction(ownerId, decodeURIComponent(projectAction[1]!), input.body, input.idempotencyKey);
      if (input.method === "POST" && input.path === "/v2/quotes") return await service.createQuote(ownerId, input.body);
      if (input.method === "POST" && input.path === "/v2/operations") return await service.createOperation(ownerId, input.body, input.idempotencyKey);
      if (input.method === "POST" && input.path === "/v2/input-assets/uploads") return await service.createInputAssetUpload(ownerId, input.body);
      const inputAssetFinalize = input.path.match(/^\/v2\/input-assets\/([0-9a-f-]+)\/finalize$/i);
      if (input.method === "POST" && inputAssetFinalize) return await service.finalizeInputAssetUpload(ownerId, inputAssetFinalize[1]!, input.body);
      const inputAssetContent = input.path.match(/^\/v2\/input-assets\/([0-9a-f-]+)\/content$/i);
      if (input.method === "GET" && inputAssetContent) return await service.readInputAsset(ownerId, inputAssetContent[1]!);
      const operation = input.path.match(/^\/v2\/operations\/([0-9a-f-]+)$/i);
      if (input.method === "GET" && operation) return await service.operation(ownerId, operation[1]!);
      const grant = input.path.match(/^\/v2\/assets\/([0-9a-f-]+)\/access-grants$/i);
      if (input.method === "POST" && grant) return await service.createAssetGrant(ownerId, grant[1]!, input.body);
      const content = input.path.match(/^\/v2\/assets\/([0-9a-f-]+)\/content$/i);
      if (input.method === "GET" && content) return await service.readAsset(ownerId, content[1]!, input.assetGrant);
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "Engine route not found." } } };
    } catch (error) {
      if (error instanceof ProductionUserAuthenticationError) {
        return { status: 401, body: { error: { code: error.code, message: "A verified user session is required." } } };
      }
      if (error instanceof ProductionActivationKeyError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
      return productionGenerationFailure(error);
    }
  }

  // Production never falls through to local fixtures or legacy Edge writes.
  if (input.path.startsWith("/v1/admin/") || input.path.startsWith("/v2/")) {
    return { status: 503, body: { error: { code: "PRODUCTION_ENGINE_NOT_RELEASED", message: "This Engine route has not passed its Production release gate." } } };
  }
  return { status: 404, body: { error: { code: "NOT_FOUND", message: "Route not found." } } };
}
