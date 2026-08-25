import { describe, expect, it } from "vitest";
import { InMemoryCatalogSnapshotStore } from "./catalog-snapshot.ts";
import { localTestRouteManifests } from "./local-test-route-catalog.ts";
import { kieCatalogRouteManifests } from "./kie-local-fixtures.ts";
import { openRouterCatalogRouteManifests } from "./openrouter-local-fixtures.ts";

const base = {
  providerId: "provider-test",
  scope: "LOCAL_TEST_ONLY" as const,
  sourceLabel: "Provider For Test fixture bundle",
  observedAt: "2026-08-21T00:00:00.000Z",
  rawPayloadSha256: "f".repeat(64),
  parserVersion: "fixture-parser-1",
};

describe("offline catalog snapshot store", () => {
  it("hashes a staged snapshot and exposes added and cost changes as a reviewable diff", () => {
    const store = new InMemoryCatalogSnapshotStore();
    const first = store.stage({ ...base, snapshotId: "snapshot.fixture-1", routes: localTestRouteManifests() });
    expect(first.diff).toHaveLength(3);
    const revisedRoutes = localTestRouteManifests();
    revisedRoutes[0] = { ...revisedRoutes[0], costGuard: { ...revisedRoutes[0].costGuard, maximumNativeAtomic: "99999" } };
    const second = store.stage({ ...base, snapshotId: "snapshot.fixture-2", routes: revisedRoutes }, first.snapshotId);
    expect(second.manifestSha256).not.toBe(first.manifestSha256);
    expect(second.diff).toContainEqual(expect.objectContaining({ routeId: "route.provider-test.image-v1", kind: "CHANGED", changedFields: ["costGuard"] }));
  });

  it("rejects a snapshot that mixes provider identities or scopes", () => {
    const store = new InMemoryCatalogSnapshotStore();
    const routes = localTestRouteManifests();
    routes[0] = { ...routes[0], providerId: "other-provider" };
    expect(() => store.stage({ ...base, snapshotId: "snapshot.invalid", routes })).toThrow();
  });

  it("stages every named KIE offline target in one local-only review snapshot", () => {
    const store = new InMemoryCatalogSnapshotStore();
    const record = store.stage({ ...base, snapshotId: "snapshot.kie.offline-1", providerId: "kie", routes: kieCatalogRouteManifests() });
    expect(record.diff.filter((item) => item.kind === "ADDED")).toHaveLength(kieCatalogRouteManifests().length);
    expect(record.routes.every((route) => route.certification.scope === "LOCAL_TEST_ONLY")).toBe(true);
  });

  it("stages every OpenRouter protocol fixture as a local-only review snapshot", () => {
    const store = new InMemoryCatalogSnapshotStore();
    const record = store.stage({ ...base, snapshotId: "snapshot.openrouter.offline-1", providerId: "openrouter", routes: openRouterCatalogRouteManifests() });
    expect(record.diff.filter((item) => item.kind === "ADDED")).toHaveLength(openRouterCatalogRouteManifests().length);
    expect(record.routes.map((route) => route.protocol).sort()).toEqual(["CHAT", "IMAGE", "STT", "TTS", "VIDEO"]);
    expect(record.routes.every((route) => route.certification.scope === "LOCAL_TEST_ONLY")).toBe(true);
  });
});
