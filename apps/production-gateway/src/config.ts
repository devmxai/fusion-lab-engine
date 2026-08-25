import { z } from "zod";

const ProductionGatewayEnvironmentSchema = z.object({
  NODE_ENV: z.literal("production"),
  SUPABASE_URL: z.string().url().refine((value) => value.startsWith("https://"), "SUPABASE_URL must use HTTPS"),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SECRET_KEY: z.string().min(20),
  SUPABASE_DATABASE_URL: z.string().url().superRefine((value, context) => {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "SUPABASE_DATABASE_URL must use postgres:// or postgresql://" });
    }
    if (url.port !== "6543") {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "SUPABASE_DATABASE_URL must use the transaction pooler on port 6543" });
    }
  }).optional(),
  RECOVERY_SECRET: z.string().min(32).optional(),
  KIE_WEBHOOK_HMAC_KEY: z.string().min(16).optional(),
  SUBSCRIPTION_ACTIVATION_SECRET: z.string().min(32).optional(),
  ENGINE_ENVIRONMENT: z.literal("production"),
});

export type ProductionGatewayConfig = z.infer<typeof ProductionGatewayEnvironmentSchema>;

export class ProductionGatewayConfigurationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Production gateway configuration is invalid: ${issues.join(", ")}`);
    this.name = "ProductionGatewayConfigurationError";
  }
}

export function loadProductionGatewayConfig(environment: NodeJS.ProcessEnv = process.env): ProductionGatewayConfig {
  const parsed = ProductionGatewayEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new ProductionGatewayConfigurationError(parsed.error.issues.map((issue) => (
      `${issue.path.join(".") || "environment"}: ${issue.message}`
    )));
  }
  return parsed.data;
}
