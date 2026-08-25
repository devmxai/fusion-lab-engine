import { z } from "zod";

export const engineServiceName = "fusionlab-engine" as const;

export const HealthResponseSchema = z.object({
  service: z.literal(engineServiceName),
  status: z.literal("ok"),
  mode: z.literal("local"),
  version: z.string().min(1),
  timestamp: z.string().datetime(),
});

export const ReadinessResponseSchema = z.object({
  service: z.literal(engineServiceName),
  status: z.enum(["ready", "not_ready"]),
  mode: z.literal("local"),
  checks: z.object({
    config: z.boolean(),
  }),
  timestamp: z.string().datetime(),
});

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const healthResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["service", "status", "mode", "version", "timestamp"],
  properties: {
    service: { type: "string", const: engineServiceName },
    status: { type: "string", const: "ok" },
    mode: { type: "string", const: "local" },
    version: { type: "string", minLength: 1 },
    timestamp: { type: "string", format: "date-time" },
  },
} as const;

export const readinessResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["service", "status", "mode", "checks", "timestamp"],
  properties: {
    service: { type: "string", const: engineServiceName },
    status: { type: "string", enum: ["ready", "not_ready"] },
    mode: { type: "string", const: "local" },
    checks: {
      type: "object",
      additionalProperties: false,
      required: ["config"],
      properties: { config: { type: "boolean" } },
    },
    timestamp: { type: "string", format: "date-time" },
  },
} as const;

export const errorResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message", "requestId"],
      properties: {
        code: { type: "string", minLength: 1 },
        message: { type: "string", minLength: 1 },
        requestId: { type: "string", minLength: 1 },
      },
    },
  },
} as const;
