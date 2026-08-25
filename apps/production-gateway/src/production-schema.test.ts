// @vitest-environment node

import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../supabase/migrations/20260823070000_production_engine_foundation.sql",
  import.meta.url,
);

let database: PGlite | null = null;

afterEach(async () => {
  await database?.close();
  database = null;
});

describe("Production Engine schema", () => {
  it("installs the financial, idempotency, outbox, and control-plane foundation with browser roles revoked", async () => {
    database = await PGlite.create();
    await database.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    await database.exec(await readFile(migrationUrl, "utf8"));

    const tables = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'fusion_engine'
       ORDER BY table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(expect.arrayContaining([
      "wallets",
      "ledger_journals",
      "ledger_entries",
      "quotes",
      "operations",
      "idempotency_bindings",
      "credit_reservations",
      "operation_events",
      "operation_attempts",
      "outbox_events",
      "provider_webhook_inbox",
      "provider_control_versions",
    ]));

    const security = await database.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class
       JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
       WHERE pg_namespace.nspname = 'fusion_engine' AND relkind = 'r'`,
    );
    expect(security.rows.every((row) => row.relrowsecurity)).toBe(true);

    const privileges = await database.query<{ anon_usage: boolean; authenticated_usage: boolean }>(
      `SELECT
         has_schema_privilege('anon', 'fusion_engine', 'USAGE') AS anon_usage,
         has_schema_privilege('authenticated', 'fusion_engine', 'USAGE') AS authenticated_usage`,
    );
    expect(privileges.rows[0]).toEqual({ anon_usage: false, authenticated_usage: false });
  });
});

