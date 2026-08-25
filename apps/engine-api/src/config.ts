import { z } from "zod";

const LocalEngineEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test"]).default("development"),
  ENGINE_MODE: z.literal("local").default("local"),
  ENGINE_HOST: z.string().ip({ version: "v4" }).default("127.0.0.1"),
  ENGINE_PORT: z.coerce.number().int().min(1024).max(65535).default(8787),
  ENGINE_LOG_LEVEL: z
    .enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  ENGINE_VERSION: z.string().min(1).default("dev"),
  ENGINE_LOCAL_PROVIDER_MARKUP_BPS: z.coerce
    .number()
    .int()
    .min(0)
    .max(100_000)
    .default(10_000),
  TEST_PROVIDER_BASE_URL: z.string().url().default("http://127.0.0.1:8790"),
  TEST_PROVIDER_API_KEY: z.string().min(16).default("fusionlab-local-test-key"),
  TEST_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(5_000),
  TEST_PAYMENT_WEBHOOK_SECRET: z.string().min(24).default("fusionlab-local-payment-webhook-secret"),
  ENGINE_DURABLE_RUNTIME_ENABLED: z.enum(["true", "false"]).default("true"),
  ENGINE_DURABLE_DB_PATH: z.string().min(1).default(".local/fusionlab-durable-pglite"),
  ENGINE_DURABLE_TICK_MS: z.coerce.number().int().min(100).max(60_000).default(500),
  ADMIN_LOCAL_SECRET_STORE_KEY: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
});

const productionOnlyCredentialNames = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "KIE_API_KEY",
  "KIE_AI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "INTERNAL_WORKER_HMAC_KEY",
  "VERCEL_TOKEN",
  "SUPABASE_ACCESS_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
] as const;

export type LocalEngineConfig = z.infer<typeof LocalEngineEnvironmentSchema>;

export class LocalEngineConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalEngineConfigurationError";
  }
}

export function loadLocalEngineConfig(
  environment: NodeJS.ProcessEnv = process.env,
): LocalEngineConfig {
  if (environment.NODE_ENV === "production" || environment.ENGINE_MODE === "production") {
    throw new LocalEngineConfigurationError(
      "Production mode is disabled in the local Engine API.",
    );
  }

  const exposedCredentials = productionOnlyCredentialNames.filter(
    (name) => Boolean(environment[name]?.trim()),
  );

  if (exposedCredentials.length > 0) {
    throw new LocalEngineConfigurationError(
      `Local Engine API refuses privileged credentials: ${exposedCredentials.join(", ")}`,
    );
  }

  const parsed = LocalEngineEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new LocalEngineConfigurationError(
      `Invalid local Engine configuration: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  return parsed.data;
}
