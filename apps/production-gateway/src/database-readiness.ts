import type { ProductionGatewayConfig } from "./config.js";
import { ProductionPostgresClient } from "./postgres-client.js";

let client: ProductionPostgresClient | null = null;
let databaseUrl: string | null = null;

export function productionDatabase(config: ProductionGatewayConfig): ProductionPostgresClient {
  if (!config.SUPABASE_DATABASE_URL) {
    throw new Error("production_database_url_unavailable");
  }
  if (!client || databaseUrl !== config.SUPABASE_DATABASE_URL) {
    client = new ProductionPostgresClient(config.SUPABASE_DATABASE_URL);
    databaseUrl = config.SUPABASE_DATABASE_URL;
  }
  return client;
}

export async function productionDatabaseReadiness(config: ProductionGatewayConfig): Promise<boolean> {
  const result = await productionDatabase(config).query<{ operations_table_exists: boolean }>(
    "SELECT to_regclass('fusion_engine.operations') IS NOT NULL AS operations_table_exists",
  );
  return result.rows[0]?.operations_table_exists === true;
}
