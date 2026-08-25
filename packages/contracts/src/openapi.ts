const authenticated = [{ bearerAuth: [] }];
const commonErrors = {
  "400": { $ref: "#/components/responses/BadRequest" },
  "401": { $ref: "#/components/responses/Unauthenticated" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "409": { $ref: "#/components/responses/Conflict" },
  "429": { $ref: "#/components/responses/RateLimited" },
};

function operation(summary: string, options: {
  idempotent?: boolean;
  privacy?: "INTERNAL" | "CONFIDENTIAL";
  paginated?: boolean;
} = {}) {
  return {
    summary,
    security: authenticated,
    "x-privacy-class": options.privacy ?? "CONFIDENTIAL",
    "x-rate-limit-policy": "authenticated-user-and-project",
    ...(options.paginated ? { "x-pagination": "opaque-cursor" } : {}),
    parameters: options.idempotent ? [{
      name: "Idempotency-Key",
      in: "header",
      required: true,
      schema: { type: "string", minLength: 8, maxLength: 200 },
    }] : [],
    responses: { "200": { description: "Success" }, ...commonErrors },
  };
}

export const openApiV2Document = {
  openapi: "3.1.0",
  info: {
    title: "FusionLab Engine Public API",
    version: "2.0.0-local-draft",
    description: "API-001 executable contract. Local draft; Gate approval required before production.",
    "x-contract-id": "API-001",
    "x-deprecation-window-days": 90,
  },
  jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
  paths: {
    "/v2/projects": {
      get: operation("List projects", { paginated: true }),
      post: operation("Create project", { idempotent: true }),
    },
    "/v2/projects/{projectId}": { get: operation("Get project") },
    "/v2/projects/{projectId}/layout": { patch: operation("Persist project layout", { idempotent: true }) },
    "/v2/assets/upload-intents": { post: operation("Create resumable upload intent", { idempotent: true }) },
    "/v2/assets/{assetId}/finalize-upload": { post: operation("Finalize verified upload", { idempotent: true }) },
    "/v2/catalog/recipes": { get: operation("List certified public recipes", { paginated: true, privacy: "INTERNAL" }) },
    "/v2/quotes": { post: operation("Issue immutable whole-credit quote", { idempotent: true }) },
    "/v2/operations": { post: operation("Confirm quote and reserve operation", { idempotent: true }) },
    "/v2/operations/{operationId}": { get: operation("Get public operation projection") },
    "/v2/operations/{operationId}/cancel": { post: operation("Request evidence-safe cancellation", { idempotent: true }) },
    "/v2/projects/{projectId}/activity": { get: operation("List project activity", { paginated: true }) },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      Error: {
        type: "object",
        additionalProperties: false,
        required: ["error"],
        properties: {
          error: {
            type: "object",
            additionalProperties: false,
            required: ["code", "message", "requestId"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
            },
          },
        },
      },
    },
    responses: {
      BadRequest: { description: "Invalid request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      Unauthenticated: { description: "Authentication required", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      Forbidden: { description: "Authorization denied", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      Conflict: { description: "State or idempotency conflict", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      RateLimited: { description: "Rate limit exceeded", headers: { "Retry-After": { schema: { type: "integer" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
    },
  },
} as const;

export const requiredPublicV2Paths = [
  "/v2/projects",
  "/v2/projects/{projectId}",
  "/v2/projects/{projectId}/layout",
  "/v2/assets/upload-intents",
  "/v2/assets/{assetId}/finalize-upload",
  "/v2/catalog/recipes",
  "/v2/quotes",
  "/v2/operations",
  "/v2/operations/{operationId}",
  "/v2/operations/{operationId}/cancel",
  "/v2/projects/{projectId}/activity",
] as const;
