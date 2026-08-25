import { z } from "zod";

const ProviderTestEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test"]).default("development"),
  TEST_PROVIDER_HOST: z.string().ip({ version: "v4" }).default("127.0.0.1"),
  TEST_PROVIDER_PORT: z.coerce.number().int().min(1024).max(65535).default(8790),
  TEST_PROVIDER_PUBLIC_URL: z.string().url().default("http://127.0.0.1:8790"),
  TEST_PROVIDER_API_KEY: z.string().min(16).default("fusionlab-local-test-key"),
  TEST_PROVIDER_LOG_LEVEL: z
    .enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

export type ProviderTestConfig = z.infer<typeof ProviderTestEnvironmentSchema>;

export function loadProviderTestConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ProviderTestConfig {
  if (environment.NODE_ENV === "production") {
    throw new Error("Provider For Test is forbidden in production mode.");
  }
  return ProviderTestEnvironmentSchema.parse(environment);
}
