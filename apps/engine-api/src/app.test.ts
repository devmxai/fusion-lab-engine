// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import {
  HealthResponseSchema,
  ReadinessResponseSchema,
} from "../../../packages/contracts/src/system.ts";
import { buildEngineApp } from "./app.ts";
import { loadLocalEngineConfig } from "./config.ts";
import { createFakeProviderRegistry } from "./test/fake-provider-adapter.ts";

const apps: ReturnType<typeof buildEngineApp>[] = [];
const fixedNow = new Date("2026-08-11T18:00:00.000Z");

function createApp() {
  const app = buildEngineApp({
    config: loadLocalEngineConfig({
      NODE_ENV: "test",
      ENGINE_MODE: "local",
      ENGINE_LOG_LEVEL: "silent",
      ENGINE_VERSION: "test",
    }),
    now: () => fixedNow,
    providerRegistry: createFakeProviderRegistry(),
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("local Engine API", () => {
  it("serves the versioned API-001 OpenAPI contract", async () => {
    const response = await createApp().inject({ method: "GET", url: "/openapi/v2.json" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toMatchObject({
      openapi: "3.1.0",
      info: { "x-contract-id": "API-001", version: "2.0.0-local-draft" },
    });
  });

  it("returns a validated health contract without infrastructure details", async () => {
    const response = await createApp().inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(HealthResponseSchema.parse(response.json())).toEqual({
      service: "fusionlab-engine",
      status: "ok",
      mode: "local",
      version: "test",
      timestamp: fixedNow.toISOString(),
    });
  });

  it("reports readiness from explicit checks", async () => {
    const response = await createApp().inject({ method: "GET", url: "/readyz" });

    expect(response.statusCode).toBe(200);
    expect(ReadinessResponseSchema.parse(response.json()).checks).toEqual({ config: true });
  });

  it("returns a stable redacted not-found error", async () => {
    const response = await createApp().inject({
      method: "GET",
      url: "/does-not-exist?secret=not-reflected",
      headers: { "x-request-id": "test-request-id" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
        requestId: "test-request-id",
      },
    });
    expect(response.body).not.toContain("not-reflected");
  });

  it("redacts unsupported content-type errors without converting them to 500", async () => {
    const response = await createApp().inject({
      method: "POST",
      url: "/v1/dev/mock/reset",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "sensitive=value",
    });

    expect(response.statusCode).toBe(415);
    expect(response.json().error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(response.body).not.toContain("sensitive=value");
  });
});
