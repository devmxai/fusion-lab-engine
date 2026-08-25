import { loadProductionGatewayConfig } from "../apps/production-gateway/src/config.js";
import { productionDatabase } from "../apps/production-gateway/src/database-readiness.js";
import { importProductionReferenceCatalog } from "../apps/production-gateway/src/production-catalog-command.js";

if (process.env.ALLOW_PRODUCTION_CATALOG_BOOTSTRAP !== "1") {
  throw new Error("production_catalog_bootstrap_not_authorized");
}

const config = loadProductionGatewayConfig(process.env);
const identity = {
  actorId: "system.catalog.bootstrap",
  roles: ["SUPER_ADMIN" as const],
  assuranceLevel: 2 as const,
};

try {
  for (const providerId of ["openrouter", "kie"] as const) {
    const result = await importProductionReferenceCatalog({
      providerId,
      commandId: `catalog-bootstrap-${providerId}-20260823-v1`,
      identity,
      config,
    });
    process.stdout.write(`${JSON.stringify(result.body)}\n`);
  }
} finally {
  await productionDatabase(config).close();
}
