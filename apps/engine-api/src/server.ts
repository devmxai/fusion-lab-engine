import { buildEngineApp } from "./app.ts";
import { loadLocalEngineConfig } from "./config.ts";
import { ProviderRegistry } from "../../../packages/providers/src/registry.ts";
import { TestProviderHttpAdapter } from "../../../packages/providers/src/test-provider-adapter.ts";
import { LocalDurableRuntime } from "./durable-worker/runtime.ts";
import { LocalAdminRuntimeControls } from "./admin-v2/runtime.ts";

const config = loadLocalEngineConfig();
const adminRuntime = new LocalAdminRuntimeControls();
const durableProviders = new ProviderRegistry();
durableProviders.register(new TestProviderHttpAdapter({
  baseUrl: config.TEST_PROVIDER_BASE_URL,
  apiKey: config.TEST_PROVIDER_API_KEY,
  timeoutMs: config.TEST_PROVIDER_TIMEOUT_MS,
}));
const durableRuntime = config.ENGINE_DURABLE_RUNTIME_ENABLED === "true"
  ? await LocalDurableRuntime.create({
    dataDir: config.ENGINE_DURABLE_DB_PATH,
    providers: durableProviders,
    tickMilliseconds: config.ENGINE_DURABLE_TICK_MS,
    routeDispatchGuard: adminRuntime.routeDispatch.bind(adminRuntime),
  })
  : undefined;
durableRuntime?.start();
const app = buildEngineApp({ config, durableRuntime, adminRuntime });

let stopping = false;

async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, "stopping local Engine API");
  await app.close();
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));

try {
  await app.listen({ host: config.ENGINE_HOST, port: config.ENGINE_PORT });
} catch (error) {
  app.log.error({ err: error }, "failed to start local Engine API");
  process.exitCode = 1;
}
