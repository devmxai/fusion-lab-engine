// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { routeProductionGateway } from "./gateway.ts";
import type { ProductionGatewayConfig } from "./config.ts";

const config: ProductionGatewayConfig = {
  NODE_ENV: "production",
  ENGINE_ENVIRONMENT: "production",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_value",
  SUPABASE_SECRET_KEY: "sb_secret_test_value_long_enough",
  SUPABASE_DATABASE_URL: "postgresql://user:password@pooler.example.com:6543/postgres",
};

function token(aal: "aal1" | "aal2") {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "ES256" })}.${part({ sub: "admin-user", aal })}.signature`;
}

function authorityFetch(appRole: "user" | "admin" | "super_admin", valid = true) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return new Response(valid ? JSON.stringify({ id: "admin-user" }) : "{}", { status: valid ? 200 : 401 });
    if (url.includes("/rest/v1/user_roles")) return new Response(JSON.stringify([{ role: appRole }]), { status: 200 });
    return new Response("{}", { status: 404 });
  });
}

describe("production gateway", () => {
  it("keeps liveness non-sensitive and fails closed when Production config is absent", async () => {
    await expect(routeProductionGateway({ method: "GET", path: "/healthz" }, { environment: {} }))
      .resolves.toMatchObject({ status: 200, body: { runtime: "vercel" } });
    await expect(routeProductionGateway({ method: "GET", path: "/v1/admin/capabilities" }, { environment: {} }))
      .resolves.toMatchObject({ status: 503, body: { error: { code: "PRODUCTION_CONFIGURATION_UNAVAILABLE" } } });
  });

  it("requires a verified external Supabase session", async () => {
    await expect(routeProductionGateway({ method: "GET", path: "/v1/admin/capabilities", authorization: `Bearer ${token("aal2")}` }, { config, request: authorityFetch("super_admin", false) }))
      .resolves.toMatchObject({ status: 401, body: { error: { code: "AUTH_INVALID" } } });
  });

  it("reports database readiness without opening a paid Engine route", async () => {
    await expect(routeProductionGateway({ method: "GET", path: "/readyz" }, { config, databaseProbe: async () => true }))
      .resolves.toMatchObject({ status: 200, body: { status: "ready", database: "fusion_engine" } });
    await expect(routeProductionGateway({ method: "GET", path: "/readyz" }, { config, databaseProbe: async () => false }))
      .resolves.toMatchObject({ status: 503, body: { error: { code: "PRODUCTION_SCHEMA_UNAVAILABLE" } } });
  });

  it("keeps Admin authentication available while database-backed routes remain closed", async () => {
    const { SUPABASE_DATABASE_URL: _omitted, ...withoutDatabase } = config;
    await expect(routeProductionGateway({ method: "GET", path: "/readyz" }, { config: withoutDatabase }))
      .resolves.toMatchObject({ status: 503, body: { error: { code: "PRODUCTION_DATABASE_CONFIGURATION_UNAVAILABLE" } } });
    await expect(routeProductionGateway({ method: "GET", path: "/v1/admin/capabilities", authorization: `Bearer ${token("aal2")}` }, { config: withoutDatabase, request: authorityFetch("super_admin") }))
      .resolves.toMatchObject({ status: 200, body: { session: { assuranceLevel: 2 } } });
  });

  it("allows an authenticated AAL1 super admin to manage provider setup", async () => {
    await expect(routeProductionGateway({ method: "GET", path: "/v1/admin/capabilities", authorization: `Bearer ${token("aal1")}` }, { config, request: authorityFetch("super_admin") }))
      .resolves.toMatchObject({ status: 200, body: { session: { roles: ["SUPER_ADMIN"], assuranceLevel: 1 }, permissions: { read: true, providerCredentials: { write: true, test: true, activate: true, revoke: true }, catalog: { import: true, select: true } } } });
  });

  it("coalesces authorized Admin reads behind one authentication boundary", async () => {
    const request = authorityFetch("super_admin");
    await expect(routeProductionGateway({
      method: "POST",
      path: "/v1/admin/read-batch",
      authorization: `Bearer ${token("aal1")}`,
      body: { paths: ["/v1/admin/capabilities", "/v1/admin/capabilities"] },
    }, { config, request })).resolves.toMatchObject({
      status: 200,
      body: { results: { "/v1/admin/capabilities": { status: 200, body: { permissions: { read: true } } } } },
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("accepts the browser client's relative Admin read paths", async () => {
    await expect(routeProductionGateway({
      method: "POST",
      path: "/v1/admin/read-batch",
      authorization: `Bearer ${token("aal1")}`,
      body: { paths: ["/capabilities"] },
    }, { config, request: authorityFetch("super_admin") })).resolves.toMatchObject({
      status: 200,
      body: { results: { "/capabilities": { status: 200, body: { permissions: { read: true } } } } },
    });
  });

  it("normalizes query strings in Admin batches while preserving the response key", async () => {
    await expect(routeProductionGateway({
      method: "POST",
      path: "/v1/admin/read-batch",
      authorization: `Bearer ${token("aal1")}`,
      body: { paths: ["/capabilities?limit=50"] },
    }, { config, request: authorityFetch("super_admin") })).resolves.toMatchObject({
      status: 200,
      body: { results: { "/capabilities?limit=50": { status: 200, body: { permissions: { read: true } } } } },
    });
  });

  it("rejects malformed or recursively nested Admin read batches", async () => {
    await expect(routeProductionGateway({ method: "POST", path: "/v1/admin/read-batch", body: { paths: ["/v1/admin/read-batch"] } }, { config }))
      .resolves.toMatchObject({ status: 400, body: { error: { code: "ADMIN_READ_BATCH_INVALID" } } });
  });

  it("grants server-derived command capabilities only to aal2 super_admin", async () => {
    const request = authorityFetch("super_admin");
    await expect(routeProductionGateway({ method: "GET", path: "/v1/admin/capabilities", authorization: `Bearer ${token("aal2")}` }, { config, request }))
      .resolves.toMatchObject({ status: 200, body: { session: { roles: ["SUPER_ADMIN"], assuranceLevel: 2 }, permissions: { read: true, providerCredentials: { write: true, test: true, activate: true, revoke: true } } } });

    const authHeaders = new Headers(request.mock.calls[0]?.[1]?.headers);
    expect(authHeaders.get("apikey")).toBe(config.SUPABASE_PUBLISHABLE_KEY);
    expect(authHeaders.get("authorization")).toMatch(/^Bearer /);

    const membershipHeaders = new Headers(request.mock.calls[1]?.[1]?.headers);
    expect(membershipHeaders.get("apikey")).toBe(config.SUPABASE_SECRET_KEY);
    expect(membershipHeaders.get("authorization")).toBeNull();
  });

  it("allows AAL1 super-admin credential commands while retaining input and idempotency validation", async () => {
    await expect(routeProductionGateway({ method: "POST", path: "/v1/admin/credentials", authorization: `Bearer ${token("aal1")}`, idempotencyKey: "credential-command-001", body: { providerId: "kie", secret: "short" } }, { config, request: authorityFetch("super_admin") }))
      .resolves.toMatchObject({ status: 400, body: { error: { code: "ADMIN_COMMAND_INVALID" } } });
    await expect(routeProductionGateway({ method: "POST", path: "/v1/admin/credentials", authorization: `Bearer ${token("aal2")}`, body: { providerId: "kie", secret: "credential-value-long-enough" } }, { config, request: authorityFetch("super_admin") }))
      .resolves.toMatchObject({ status: 400, body: { error: { code: "ADMIN_COMMAND_INVALID" } } });
  });

  it("keeps plan publication typed and idempotent before any database mutation", async () => {
    await expect(routeProductionGateway({
      method: "POST",
      path: "/v1/admin/subscriptions/plans/publish",
      authorization: `Bearer ${token("aal1")}`,
      idempotencyKey: "publish-plan-command-001",
      body: { planKey: "Invalid Key", displayName: "P", amountMinor: "-1", currency: "usd", interval: "WEEK", creditsPerPeriod: 0, termsVersion: "x" },
    }, { config, request: authorityFetch("super_admin") })).resolves.toMatchObject({ status: 400, body: { error: { code: "PLAN_COMMAND_INVALID" } } });
  });

  it("fails subscription key generation closed until the server secret is configured", async () => {
    await expect(routeProductionGateway({
      method: "POST",
      path: "/v1/admin/subscriptions/activation-keys",
      authorization: `Bearer ${token("aal1")}`,
      idempotencyKey: "activation-key-command-001",
      body: { planVersionId: "pro-v1", expiresInDays: 30 },
    }, { config, request: authorityFetch("super_admin") })).resolves.toMatchObject({ status: 503, body: { error: { code: "ACTIVATION_KEY_CONFIGURATION_REQUIRED" } } });
  });

  it("requires a verified customer session to read or activate an account", async () => {
    await expect(routeProductionGateway({ method: "GET", path: "/v2/account" }, { config }))
      .resolves.toMatchObject({ status: 401, body: { error: { code: "AUTH_REQUIRED" } } });
    await expect(routeProductionGateway({ method: "POST", path: "/v2/subscriptions/activate", idempotencyKey: "redeem-command-001", body: { activationKey: "x".repeat(80) } }, { config }))
      .resolves.toMatchObject({ status: 401, body: { error: { code: "AUTH_REQUIRED" } } });
  });

  it("requires a verified customer session before Production generation routes", async () => {
    await expect(routeProductionGateway({ method: "POST", path: "/v2/operations" }, { config }))
      .resolves.toMatchObject({ status: 401, body: { error: { code: "AUTH_REQUIRED" } } });
  });

  it("keeps recovery and provider callbacks fail-closed until their independent secrets are configured", async () => {
    await expect(routeProductionGateway({ method: "GET", path: "/v2/internal/recovery" }, { config }))
      .resolves.toMatchObject({ status: 503, body: { error: { code: "RECOVERY_NOT_CONFIGURED" } } });
    const { SUPABASE_DATABASE_URL: _database, ...withoutDatabase } = config;
    await expect(routeProductionGateway({ method: "POST", path: "/v2/provider-callbacks/kie", rawBody: new Uint8Array() }, { config: withoutDatabase }))
      .resolves.toMatchObject({ status: 503, body: { error: { code: "KIE_WEBHOOK_NOT_CONFIGURED" } } });
  });
});
