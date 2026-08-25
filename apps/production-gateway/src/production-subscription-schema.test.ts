// @vitest-environment node

import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrations = [
  "../../../supabase/migrations/20260823070000_production_engine_foundation.sql",
  "../../../supabase/migrations/20260823120000_production_subscriptions.sql",
  "../../../supabase/migrations/20260824113000_subscription_plan_admin.sql",
  "../../../supabase/migrations/20260824143000_subscription_activation_keys.sql",
  "../../../supabase/migrations/20260824150000_subscription_activation_runtime_access.sql",
].map((path) => new URL(path, import.meta.url));

describe("Production subscription plan schema", () => {
  it("applies forward and preserves immutable plan versions behind a mutable pointer", async () => {
    const database = new PGlite();
    try {
      await database.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
      for (const migration of migrations) await database.exec(await readFile(migration, "utf8"));
      await database.query(`INSERT INTO fusion_engine.subscription_plan_versions
        (id,plan_key,version,lifecycle,display_name,amount_minor,currency,billing_interval,credits_per_period,terms_version,entitlement_snapshot,effective_from,published_at)
        VALUES('pro-v1','pro',1,'PUBLISHED','Pro',9900,'USD','YEAR',1000,'terms-v1','{}',now(),now())`);
      await database.query(`INSERT INTO fusion_engine.subscription_plan_pointers(plan_key,current_plan_version_id,state,version,updated_by)
        VALUES('pro','pro-v1','PUBLISHED',1,'admin')`);
      await expect(database.query("UPDATE fusion_engine.subscription_plan_versions SET display_name='Changed' WHERE id='pro-v1'")).rejects.toThrow();
      await expect(database.query("UPDATE fusion_engine.subscription_plan_pointers SET state='RETIRED',version=2 WHERE plan_key='pro'")).resolves.toBeDefined();
      const activationTables = await database.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables
        WHERE table_schema='fusion_engine' AND table_name LIKE 'subscription_activation%' ORDER BY table_name`);
      expect(activationTables.rows.map((row) => row.table_name)).toEqual([
        "subscription_activation_admin_commands", "subscription_activation_audit", "subscription_activation_keys", "subscription_activation_redemptions",
      ]);
      const policies = await database.query<{ tablename: string }>(`SELECT tablename FROM pg_policies
        WHERE schemaname='fusion_engine' AND policyname='engine_runtime_access' AND tablename LIKE 'subscription_activation%'`);
      expect(policies.rows).toHaveLength(4);
    } finally { await database.close(); }
  });
});
