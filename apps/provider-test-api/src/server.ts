import { buildProviderTestApp } from "./app.ts";
import { loadProviderTestConfig } from "./config.ts";

const config = loadProviderTestConfig();
const app = buildProviderTestApp({ config });

try {
  await app.listen({ host: config.TEST_PROVIDER_HOST, port: config.TEST_PROVIDER_PORT });
} catch (error) {
  app.log.error({ err: error }, "Provider For Test failed to start");
  process.exitCode = 1;
}
