import { describe, expect, it } from "vitest";
import { InMemoryPlanRegistry, PlanRegistryError } from "./plan-registry.ts";
import type { PlanVersion } from "./types.ts";

function plan(version = 1): PlanVersion {
  return {
    id: `local-plan-pro-v${version}`,
    planKey: "pro",
    version,
    lifecycle: "PUBLISHED",
    displayName: `Pro V${version}`,
    price: { amountMinor: String(1000 + version), currency: "USD", interval: "MONTH" },
    creditsPerPeriod: 100 + version,
    creditExpiry: "PERIOD_END",
    limits: { concurrency: 2, queue: 10, storageBytes: "1073741824", retentionDays: 30 },
    eligibility: { features: ["image"], models: ["local/test-image-v1"], profiles: ["standard"] },
    renewal: { graceDays: 3, cancellation: "AT_PERIOD_END" },
    termsVersion: `terms-v${version}`,
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    publishedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("immutable Plan Version registry", () => {
  it("freezes the published version and every nested policy snapshot", () => {
    const published = new InMemoryPlanRegistry().register(plan());
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(published.price)).toBe(true);
    expect(Object.isFrozen(published.eligibility.features)).toBe(true);
  });

  it("rejects an overwrite even when the payload is identical", () => {
    const registry = new InMemoryPlanRegistry();
    registry.register(plan());
    expect(() => registry.register(plan())).toThrowError(PlanRegistryError);
  });

  it("rejects a second ID for the same plan sequence", () => {
    const registry = new InMemoryPlanRegistry();
    registry.register(plan());
    expect(() => registry.register({ ...plan(), id: "another-plan-version-id" })).toThrowError("plan key/version sequence");
  });

  it("preserves historical subscribers on V1 after V2 is published", () => {
    const registry = new InMemoryPlanRegistry();
    const first = registry.register(plan(1));
    registry.register(plan(2));
    expect(registry.require(first.id)).toMatchObject({ version: 1, creditsPerPeriod: 101, termsVersion: "terms-v1" });
    expect(registry.list()).toHaveLength(2);
  });
});
