// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { buildEngineApp } from "../app.ts";
import { loadLocalEngineConfig } from "../config.ts";
import { createFakeProviderRegistry } from "../test/fake-provider-adapter.ts";
import { LocalAdminSessionAuthority } from "./session.ts";
import type { AdminRole } from "../../../../packages/admin-control-plane/src/types.ts";
import { localTestRouteManifests } from "../../../../packages/providers/src/local-test-route-catalog.ts";

const apps: ReturnType<typeof buildEngineApp>[] = [];
const evidenceHash = "a".repeat(64);
const sessions = new LocalAdminSessionAuthority("s".repeat(32));

function createApp() {
  const app = buildEngineApp({
    config: loadLocalEngineConfig({ NODE_ENV: "test", ENGINE_MODE: "local", ENGINE_LOG_LEVEL: "silent", ADMIN_LOCAL_SECRET_STORE_KEY: "1".repeat(64) }),
    providerRegistry: createFakeProviderRegistry(),
    adminSessionAuthority: sessions,
  });
  apps.push(app);
  return app;
}

function adminHeaders(actor: string, roles: string, command?: string) {
  return {
    cookie: `fl_admin_session=${sessions.issue({ actorId: actor, roles: roles.split(",") as AdminRole[], assuranceLevel: 2 })}`,
    ...(command ? { "idempotency-key": command } : {}),
  };
}

async function advanceWorkflow(
  app: ReturnType<typeof buildEngineApp>,
  changeId: string,
  scope: "ROUTE" | "FINANCE",
) {
  const approverRole = scope === "ROUTE" ? "ROUTE_APPROVER" : "FINANCE_APPROVER";
  for (const [stage, command] of [["validate", "validate"], ["simulate", "simulate"], ["approve", "approve"]] as const) {
    const response = await app.inject({
      method: "POST",
      url: `/v1/dev/admin-v2/changes/${changeId}/${stage}`,
      headers: adminHeaders(`${scope.toLowerCase()}-checker`, approverRole, `${command}-${changeId}`),
      payload: { evidenceHash },
    });
    expect(response.statusCode).toBe(200);
  }
  const published = await app.inject({
    method: "POST",
    url: `/v1/dev/admin-v2/changes/${changeId}/publish`,
    headers: adminHeaders("independent-publisher", "PUBLISHER", `publish-${changeId}`),
  });
  expect(published.statusCode).toBe(200);
  expect(published.json().state).toBe("PUBLISHED");
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("local Admin Control Plane V2 API", () => {
  it("bootstraps only a signed read-only local session", async () => {
    const app = createApp();
    const bootstrap = await app.inject({ method: "POST", url: "/v1/dev/admin-v2/session/bootstrap" });
    expect(bootstrap.statusCode).toBe(204);
    const setCookie = bootstrap.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";")[0];
    expect(cookie).toMatch(/^fl_admin_session=v1\./);
    const overview = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/overview", headers: { cookie: cookie! } });
    expect(overview.statusCode).toBe(200);
    const catalog = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/catalog/routes", headers: { cookie: cookie! } });
    expect(catalog.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: "provider-test", certification: { lifecycle: "VALIDATED", scope: "LOCAL_TEST_ONLY" },
        providerAccount: expect.objectContaining({ scope: "LOCAL_TEST_ONLY" }),
        endpoint: expect.objectContaining({ reference: expect.any(String) }),
        providerCost: expect.objectContaining({ nativeUnit: "provider_credit", pricingKind: expect.any(String) }),
        capability: expect.objectContaining({ inputSchemaVersion: expect.any(String), supportsAsync: expect.any(Boolean) }),
      }),
    ]));
    const blockedCommand = await app.inject({
      method: "POST",
      url: "/v1/dev/admin-v2/changes",
      headers: { cookie: cookie!, "idempotency-key": "viewer-cannot-write" },
      payload: { resourceType: "ROUTE_CONTROL", resourceId: "provider-test:model", payload: {}, reasonCode: "TEST" },
    });
    expect(blockedCommand.statusCode).toBe(403);
    const blockedSnapshot = await app.inject({
      method: "POST", url: "/v1/dev/admin-v2/catalog/snapshots",
      headers: { cookie: cookie!, "idempotency-key": "viewer-cannot-stage-catalog" },
      payload: { reasonCode: "TEST", snapshot: {} },
    });
    expect(blockedSnapshot.statusCode).toBe(403);
    const snapshots = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/catalog/snapshots", headers: { cookie: cookie! } });
    expect(snapshots.json()).toEqual([]);
  });

  it("requires AAL2 and scoped RBAC for every Admin read", async () => {
    const app = createApp();
    const missing = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/overview" });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe("AAL2_REQUIRED");

    const denied = await app.inject({
      method: "GET",
      url: "/v1/dev/admin-v2/overview",
      headers: adminHeaders("route-maker", "ROUTE_MAKER"),
    });
    expect(denied.statusCode).toBe(403);

    const spoofed = await app.inject({
      method: "GET",
      url: "/v1/dev/admin-v2/overview",
      headers: { "x-admin-actor": "forged", "x-admin-roles": "SUPER_ADMIN", "x-admin-aal": "2" },
    });
    expect(spoofed.statusCode).toBe(401);
  });

  it("projects server-owned workflow roles without granting command authority", async () => {
    const app = createApp();
    const bootstrap = await app.inject({ method: "POST", url: "/v1/dev/admin-v2/session/bootstrap" });
    const policies = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/workflow-policies", headers: { cookie: bootstrap.headers["set-cookie"] as string } });
    expect(policies.statusCode).toBe(200);
    expect(policies.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceType: "PRICING_POLICY", makerRoles: expect.arrayContaining(["PRICING_MAKER"]), approverRoles: expect.arrayContaining(["PRICING_APPROVER"]), publisherRoles: expect.arrayContaining(["PUBLISHER"]) }),
      expect.objectContaining({ resourceType: "FINANCIAL_ADJUSTMENT", makerRoles: expect.arrayContaining(["FINANCE_MAKER"]), approverRoles: expect.arrayContaining(["FINANCE_APPROVER"]) }),
    ]));
    const blocked = await app.inject({
      method: "POST", url: "/v1/dev/admin-v2/changes", headers: { cookie: bootstrap.headers["set-cookie"] as string, "idempotency-key": "viewer-workflow-command" },
      payload: { resourceType: "PRICING_POLICY", resourceId: "route:viewer", payload: { customerCredits: 4 }, reasonCode: "VIEWER_MUST_NOT_WRITE" },
    });
    expect(blocked.statusCode).toBe(403);
  });

  it("projects command capabilities from the server policy without trusting browser roles", async () => {
    const app = createApp();
    const bootstrap = await app.inject({ method: "POST", url: "/v1/dev/admin-v2/session/bootstrap" });
    const viewer = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/capabilities", headers: { cookie: bootstrap.headers["set-cookie"] as string } });
    expect(viewer.statusCode).toBe(200);
    expect(viewer.json()).toMatchObject({
      session: { mode: "LOCAL_VIEWER", roles: ["ADMIN_VIEWER"], assuranceLevel: 2 },
      permissions: { read: true, providerCredentials: { write: false, test: false, activate: false, revoke: false } },
      safeguards: { secretValuesReadableInBrowser: false, providerCallsTriggeredByPageLoad: false, makerCheckerRequiredForCredentialActivation: true },
    });

    const operator = await app.inject({
      method: "GET", url: "/v1/dev/admin-v2/capabilities",
      headers: adminHeaders("security-operator", "SECURITY_OPERATOR"),
    });
    expect(operator.statusCode).toBe(200);
    expect(operator.json()).toMatchObject({
      session: { mode: "AUTHORIZED_ADMIN", roles: ["SECURITY_OPERATOR"], assuranceLevel: 2 },
      permissions: { read: false, providerCredentials: { write: true, test: true, activate: true, revoke: true } },
    });
  });

  it("stages a hashed local catalog snapshot and creates a route-maker approval draft", async () => {
    const app = createApp();
    const staged = await app.inject({
      method: "POST",
      url: "/v1/dev/admin-v2/catalog/snapshots",
      headers: adminHeaders("catalog-maker", "ROUTE_MAKER", "catalog-snapshot-command"),
      payload: {
        reasonCode: "LOCAL_FIXTURE_REVIEW",
        snapshot: {
          snapshotId: "snapshot.provider-test.local-review-1",
          providerId: "provider-test",
          scope: "LOCAL_TEST_ONLY",
          sourceLabel: "Provider For Test fixture bundle",
          observedAt: "2026-08-21T00:00:00.000Z",
          rawPayloadSha256: "e".repeat(64),
          parserVersion: "fixture-parser-1",
          routes: localTestRouteManifests(),
        },
      },
    });
    expect(staged.statusCode).toBe(201);
    expect(staged.json()).toMatchObject({
      snapshot: { diff: expect.arrayContaining([expect.objectContaining({ kind: "ADDED" })]) },
      change: { resourceType: "CATALOG_SNAPSHOT", state: "DRAFT", payload: { scope: "LOCAL_TEST_ONLY" } },
    });
    const projectedCatalog = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/catalog/offline", headers: adminHeaders("auditor", "AUDITOR") });
    expect(projectedCatalog.statusCode).toBe(200);
    expect(projectedCatalog.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: "provider-test", snapshotId: "snapshot.provider-test.local-review-1", status: "SNAPSHOT_STAGED" }),
    ]));
    const inbox = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/approval-inbox", headers: adminHeaders("auditor", "AUDITOR") });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        changeId: staged.json().change.id, state: "DRAFT", nextAction: "VALIDATE",
        requiredRoles: expect.arrayContaining(["ROUTE_APPROVER"]), makerCheckerRequired: false,
      }),
    ]));
  });

  it("stages public reference models as inactive evidence and publishes no route or customer offer", async () => {
    const app = createApp();
    const staged = await app.inject({
      method: "POST", url: "/v1/dev/admin-v2/catalog/reference-snapshots",
      headers: adminHeaders("reference-maker", "ROUTE_MAKER", "reference-catalog-stage-001"),
      payload: {
        reasonCode: "OFFICIAL_CATALOG_CAPTURE",
        snapshot: {
          id: "snapshot.openrouter.public.001", providerId: "openrouter", observedAt: "2026-08-22T00:00:00.000Z",
          sourceUrls: ["https://openrouter.ai/api/v1/models"], rawPayloadSha256: "b".repeat(64), manifestSha256: "c".repeat(64),
          parserVersion: "openrouter-public-models.v1", sourceScope: "PUBLIC_REFERENCE",
          models: [{
            id: "reference.openrouter.gpt-image-1", providerId: "openrouter", providerModelId: "openai/gpt-image-1",
            canonicalSlug: "openai-gpt-image-1", familyId: "family.openrouter.openai", displayName: "GPT Image 1",
            modalities: ["image", "text"], supportedParameters: ["prompt", "size"], sourceUrls: ["https://openrouter.ai/api/v1/models"],
            sourceEvidenceSha256: "d".repeat(64), state: "REFERENCE_ACTIVE",
          }],
        },
      },
    });
    expect(staged.statusCode).toBe(201);
    expect(staged.json()).toMatchObject({
      snapshot: { diff: [{ providerModelId: "openai/gpt-image-1", kind: "ADDED" }] },
      change: { resourceType: "REFERENCE_CATALOG_SNAPSHOT", state: "DRAFT" },
    });
    const history = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/catalog/reference-snapshots", headers: adminHeaders("auditor", "AUDITOR") });
    expect(history.json()).toEqual([expect.objectContaining({ snapshotId: "snapshot.openrouter.public.001", providerId: "openrouter", modelCount: 1, diff: { added: 1, changed: 0, removed: 0 } })]);
    const models = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/catalog/reference-models", headers: adminHeaders("auditor", "AUDITOR") });
    expect(models.json()).toEqual([expect.objectContaining({ providerId: "openrouter", providerModelId: "openai/gpt-image-1", state: "REFERENCE_ACTIVE", snapshotChangeState: "DRAFT" })]);
    await advanceWorkflow(app, staged.json().change.id, "ROUTE");
    const routes = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/catalog/routes", headers: adminHeaders("auditor", "AUDITOR") });
    expect(routes.json()).not.toEqual(expect.arrayContaining([expect.objectContaining({ providerId: "openrouter" })]));
  });

  it("registers KIE and OpenRouter without presenting test fixtures as provider models", async () => {
    const app = createApp();
    expect((await app.inject({ method: "GET", url: "/v1/dev/admin-v2/catalog/offline" })).statusCode).toBe(401);
    const bootstrap = await app.inject({ method: "POST", url: "/v1/dev/admin-v2/session/bootstrap" });
    const catalog = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/catalog/offline", headers: { cookie: bootstrap.headers["set-cookie"] as string } });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json()).toEqual([]);
    const providers = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/catalog/providers", headers: { cookie: bootstrap.headers["set-cookie"] as string } });
    expect(providers.statusCode).toBe(200);
    expect(providers.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: "kie", displayName: "KIE.ai", status: "CATALOG_NOT_IMPORTED", routeCount: 0, credentialMetadataCount: 0, catalogUrl: "https://kie.ai/market" }),
      expect.objectContaining({ providerId: "openrouter", displayName: "OpenRouter", status: "CATALOG_NOT_IMPORTED", routeCount: 0, credentialMetadataCount: 0, catalogUrl: "https://openrouter.ai/models" }),
    ]));
    const gates = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/catalog/release-gates", headers: { cookie: bootstrap.headers["set-cookie"] as string } });
    expect(gates.statusCode).toBe(200);
    expect(gates.json()).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: "kie" }),
      expect.objectContaining({ providerId: "openrouter" }),
    ]));
  });

  it("exposes only a redacted local Commerce read model through Admin", async () => {
    const app = createApp();
    const bootstrap = await app.inject({ method: "POST", url: "/v1/dev/admin-v2/session/bootstrap" });
    const commerce = await app.inject({ method: "GET", url: "/v1/dev/admin-v2/commerce/overview", headers: { cookie: bootstrap.headers["set-cookie"] as string } });
    expect(commerce.statusCode).toBe(200);
    expect(commerce.json()).toMatchObject({
      enabled: true,
      sandboxOnly: true,
      paymentProvider: expect.any(String),
      products: expect.arrayContaining([expect.objectContaining({ kind: "CREDIT_PACK", grantedCredits: 100 })]),
      plans: expect.arrayContaining([expect.objectContaining({ planKey: "pro", creditsPerPeriod: 200 })]),
      reconciliation: { formalGateDecision: "HOLD" },
    });
    expect(commerce.body).not.toContain("checkoutUrl");
    expect(commerce.body).not.toContain("webhookSecret");
    expect(commerce.body).not.toContain("local-user");
  });

  it("publishes a route kill switch only after maker-checker workflow and blocks dispatch safely", async () => {
    const app = createApp();
    const draft = await app.inject({
      method: "POST",
      url: "/v1/dev/admin-v2/changes",
      headers: adminHeaders("route-maker", "ROUTE_MAKER", "route-draft-command"),
      payload: {
        resourceType: "ROUTE_CONTROL",
        resourceId: "provider-test:local/test-image-v1",
        payload: { enabled: true, reasonCode: "SECURITY_HOLD" },
        reasonCode: "SECURITY_HOLD",
      },
    });
    expect(draft.statusCode).toBe(201);

    const premature = await app.inject({
      method: "POST",
      url: `/v1/dev/admin-v2/changes/${draft.json().id}/publish`,
      headers: adminHeaders("publisher", "PUBLISHER", "premature-publish-command"),
    });
    expect(premature.statusCode).toBe(409);
    expect(premature.json().error.code).toBe("MAKER_CHECKER_REQUIRED");

    await advanceWorkflow(app, draft.json().id, "ROUTE");

    const quote = await app.inject({
      method: "POST",
      url: "/v1/dev/mock/quotes",
      payload: { modelId: "local/test-image-v1" },
    });
    const operation = await app.inject({
      method: "POST",
      url: "/v1/dev/mock/operations",
      payload: { quoteId: quote.json().id, idempotencyKey: "kill-switch-operation" },
    });
    const blocked = await app.inject({
      method: "POST",
      url: `/v1/dev/mock/operations/${operation.json().id}/advance`,
    });
    expect(blocked.json()).toMatchObject({ state: "PROVIDER_FAILED" });

    const wallet = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(wallet.json().customerCredits).toMatchObject({ available: 1_000, held: 0, spent: 0 });
    expect(wallet.json().providerTreasury.localProvider).toMatchObject({ availableAtomic: "1000", heldAtomic: "0", spentAtomic: "0" });

    const audit = await app.inject({
      method: "GET",
      url: "/v1/dev/admin-v2/audit",
      headers: adminHeaders("auditor", "AUDITOR"),
    });
    expect(audit.json()).toMatchObject({ chainValid: true, records: { length: 5 } });
  });

  it("posts an approved financial adjustment through the same whole-credit ledger", async () => {
    const app = createApp();
    const draft = await app.inject({
      method: "POST",
      url: "/v1/dev/admin-v2/changes",
      headers: adminHeaders("finance-maker", "FINANCE_MAKER", "finance-draft-command"),
      payload: {
        resourceType: "FINANCIAL_ADJUSTMENT",
        resourceId: "local-user:manual-adjustment-1",
        payload: { ownerId: "local-user", direction: "CREDIT", credits: 25 },
        reasonCode: "SUPPORT_REMEDIATION",
      },
    });
    expect(draft.statusCode).toBe(201);
    await advanceWorkflow(app, draft.json().id, "FINANCE");

    const wallet = await app.inject({ method: "GET", url: "/v1/dev/mock/wallets/local-user" });
    expect(wallet.json().customerCredits).toMatchObject({ available: 1_025, held: 0, spent: 0 });
  });

  it("keeps provider credentials write-only, versioned, audited, and maker-checker activated", async () => {
    const app = createApp();
    const rawSecret = "local-test-secret-never-return";
    const written = await app.inject({
      method: "POST",
      url: "/v1/dev/admin-v2/credentials",
      headers: adminHeaders("credential-maker", "SECURITY_OPERATOR", "credential-write-command"),
      payload: { providerId: "provider-test", accountId: "local-account", environment: "LOCAL", secret: rawSecret },
    });
    expect(written.statusCode).toBe(201);
    expect(written.body).not.toContain(rawSecret);
    expect(written.json()).not.toHaveProperty("secret");

    const tested = await app.inject({
      method: "POST",
      url: `/v1/dev/admin-v2/credentials/${written.json().id}/test`,
      headers: adminHeaders("credential-maker", "SECURITY_OPERATOR", "credential-test-command"),
    });
    expect(tested.statusCode, tested.body).toBe(200);
    expect(tested.json().status).toBe("TESTED");
    const health = await app.inject({
      method: "GET", url: "/v1/dev/admin-v2/provider-accounts/health",
      headers: adminHeaders("auditor", "AUDITOR"),
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual([expect.objectContaining({
      credentialId: written.json().id, providerId: "provider-test", accountId: "local-account",
      accountLabel: "Provider For Test", balance: null, keyLimit: null,
    })]);
    expect(health.body).not.toContain(rawSecret);

    const sameMaker = await app.inject({
      method: "POST",
      url: `/v1/dev/admin-v2/credentials/${written.json().id}/activate`,
      headers: adminHeaders("credential-maker", "SECURITY_OPERATOR", "credential-activate-same"),
    });
    expect(sameMaker.statusCode).toBe(409);
    expect(sameMaker.json().error.code).toBe("MAKER_CHECKER_REQUIRED");

    const activated = await app.inject({
      method: "POST",
      url: `/v1/dev/admin-v2/credentials/${written.json().id}/activate`,
      headers: adminHeaders("credential-checker", "SECURITY_OPERATOR", "credential-activate-other"),
    });
    expect(activated.json().status).toBe("ACTIVE");

    const listed = await app.inject({
      method: "GET",
      url: "/v1/dev/admin-v2/credentials",
      headers: adminHeaders("auditor", "AUDITOR"),
    });
    expect(listed.body).not.toContain(rawSecret);
    expect(listed.json()[0]).not.toHaveProperty("secret");
  });
});
