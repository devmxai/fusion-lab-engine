import { describe, expect, it } from "vitest";
import { evaluateBillingFormula } from "./formula.ts";
import { createLocalTestRegistrySnapshot, localFamilyVersionId } from "./local-test-fixture.ts";
import { DeterministicQuoteEngine } from "./quote-engine.ts";
import { VersionedCommercialRegistry } from "./registry.ts";
import { CommercialEngineError, type CommercialQuoteInput } from "./types.ts";

const NOW = new Date("2026-08-12T12:00:00.000Z");

function imageInput(): CommercialQuoteInput {
  return {
    projectId: "project-1",
    product: "image.generate",
    mode: "exact",
    familyVersionId: localFamilyVersionId("local/test-image-v1"),
    quantity: 1,
    resolution: "720p",
    audio: false,
    referenceCount: 0,
  };
}

function engineFor(snapshot = createLocalTestRegistrySnapshot()) {
  let sequence = 0;
  const registry = new VersionedCommercialRegistry();
  registry.registerSnapshot(snapshot);
  registry.activate(snapshot.id);
  const engine = new DeterministicQuoteEngine(registry, () => NOW, () => `quote-${++sequence}`);
  return { registry, engine };
}

describe("versioned commercial registry", () => {
  it("stores immutable snapshots and rejects overwriting the same version ID", () => {
    const source = createLocalTestRegistrySnapshot();
    const registry = new VersionedCommercialRegistry();
    registry.registerSnapshot(source);
    source.routes[0]!.killSwitch.enabled = true;
    expect(registry.require(source.id).routes[0]?.killSwitch.enabled).toBe(false);
    expect(() => registry.registerSnapshot(source))
      .toThrowError(expect.objectContaining<Partial<CommercialEngineError>>({ code: "DUPLICATE_REGISTRY_SNAPSHOT" }));
  });

  it("rejects a published route missing any certification evidence", () => {
    const snapshot = createLocalTestRegistrySnapshot();
    snapshot.routes[0]!.certification.goldenBilling = false;
    expect(() => new VersionedCommercialRegistry().registerSnapshot(snapshot))
      .toThrowError(expect.objectContaining<Partial<CommercialEngineError>>({ code: "UNCERTIFIED_PUBLISHED_ROUTE" }));
  });
});

describe("deterministic quote engine", () => {
  it("quotes the golden image route as provider 2 and customer 4 with 50% margin", () => {
    const { engine } = engineFor();
    const quote = engine.quote(imageInput());
    expect(quote).toMatchObject({
      providerAtomicUnits: 2n,
      replacementCostMicrousd: 20_000n,
      conservativeCostMicrousd: 20_000n,
      customerCredits: 4n,
      quotedGrossMarginBps: 5_000n,
    });
    expect(quote.pins).toMatchObject({
      familyVersionId: "family:local/test-image-v1:v1",
      routeVersionId: "route:local/test-image-v1:v1",
      billingManifestVersionId: "billing:local/test-image-v1:v1",
      costVersionId: "cost:provider-test-credit:v1",
    });
  });

  it("evaluates golden video and audio billing without floating point", () => {
    const { engine } = engineFor();
    const video = engine.quote({
      ...imageInput(),
      product: "video.generate",
      familyVersionId: localFamilyVersionId("local/test-video-v1"),
      durationSeconds: 5,
      resolution: "1080p",
      audio: true,
    });
    expect(video).toMatchObject({ providerAtomicUnits: 20n, customerCredits: 40n });
    const audio = engine.quote({
      ...imageInput(),
      product: "audio.generate",
      familyVersionId: localFamilyVersionId("local/test-audio-v1"),
      characterCount: 250,
      resolution: "720p",
    });
    expect(audio).toMatchObject({ providerAtomicUnits: 3n, customerCredits: 6n });
  });

  it("is deterministic for amounts, pins and request hash", () => {
    const { engine } = engineFor();
    const first = engine.quote(imageInput());
    const second = engine.quote(imageInput());
    const reversedKeyOrder = engine.quote({
      referenceCount: 0,
      audio: false,
      resolution: "720p",
      quantity: 1,
      familyVersionId: localFamilyVersionId("local/test-image-v1"),
      mode: "exact",
      product: "image.generate",
      projectId: "project-1",
    });
    expect(second.id).not.toBe(first.id);
    expect(second.requestHash).toBe(first.requestHash);
    expect(reversedKeyOrder.requestHash).toBe(first.requestHash);
    expect(second.customerCredits).toBe(first.customerCredits);
    expect(second.pins).toEqual(first.pins);
  });

  it("keeps an accepted quote unchanged after a new price snapshot activates", () => {
    const firstSnapshot = createLocalTestRegistrySnapshot();
    const registry = new VersionedCommercialRegistry();
    registry.registerSnapshot(firstSnapshot);
    registry.activate(firstSnapshot.id);
    const engine = new DeterministicQuoteEngine(registry, () => NOW, () => "quote-fixed");
    const accepted = engine.quote(imageInput());

    const secondSnapshot = createLocalTestRegistrySnapshot({ snapshotVersion: 2, targetContributionMarginBps: 7_500n });
    registry.registerSnapshot(secondSnapshot);
    registry.activate(secondSnapshot.id);
    const future = engine.quote(imageInput());
    expect(accepted.customerCredits).toBe(4n);
    expect(accepted.pins.customerPriceVersionId).toContain("5000");
    expect(future.customerCredits).toBe(8n);
    expect(future.pins.customerPriceVersionId).toContain("7500");
    expect(accepted.customerCredits).toBe(4n);
  });

  it("absorbs a certified maximum cost shock into future quote calculation", () => {
    const snapshot = createLocalTestRegistrySnapshot();
    snapshot.costVersions[0]!.maximumCostMultiplierBps = 15_000n;
    const quote = engineFor(snapshot).engine.quote(imageInput());
    expect(quote).toMatchObject({
      replacementCostMicrousd: 20_000n,
      conservativeCostMicrousd: 30_000n,
      customerCredits: 6n,
      quotedGrossMarginBps: 5_000n,
    });
  });

  it("rejects a manual customer price below the hard margin floor", () => {
    const snapshot = createLocalTestRegistrySnapshot();
    const price = snapshot.customerPriceVersions[0]!;
    price.policy = "manual_credits";
    price.manualCredits = 1n;
    price.hardFloorMarginBps = 0n;
    expect(() => engineFor(snapshot).engine.quote(imageInput()))
      .toThrowError(expect.objectContaining<Partial<CommercialEngineError>>({ code: "MARGIN_FLOOR_VIOLATION" }));
  });

  it("fails closed for capability mismatch, cost expiry and kill switch", () => {
    const capabilitySnapshot = createLocalTestRegistrySnapshot();
    const capability = engineFor(capabilitySnapshot).engine;
    expect(() => capability.quote({ ...imageInput(), resolution: "4k" }))
      .toThrowError(expect.objectContaining<Partial<CommercialEngineError>>({ code: "CAPABILITY_MISMATCH" }));

    const expiredSnapshot = createLocalTestRegistrySnapshot({ snapshotVersion: 2 });
    expiredSnapshot.costVersions[0]!.source.validUntil = "2026-08-12T11:59:59.000Z";
    expect(() => engineFor(expiredSnapshot).engine.quote(imageInput()))
      .toThrowError(expect.objectContaining<Partial<CommercialEngineError>>({ code: "COST_NOT_USABLE" }));

    const killedSnapshot = createLocalTestRegistrySnapshot({ snapshotVersion: 3 });
    killedSnapshot.routes[0]!.killSwitch = { enabled: true, reasonCode: "LOCAL_TEST_STOP" };
    expect(() => engineFor(killedSnapshot).engine.quote(imageInput()))
      .toThrowError(expect.objectContaining<Partial<CommercialEngineError>>({ code: "NO_CERTIFIED_ROUTE" }));
  });

  it("does not auto-route when more than one exact candidate exists", () => {
    const snapshot = createLocalTestRegistrySnapshot();
    snapshot.routes.push({ ...structuredClone(snapshot.routes[0]!), id: "route:duplicate:v1", routeId: "route:duplicate" });
    expect(() => engineFor(snapshot).engine.quote(imageInput()))
      .toThrowError(expect.objectContaining<Partial<CommercialEngineError>>({ code: "ROUTE_SELECTION_REQUIRED" }));
  });

  it("returns a public quote projection without provider routing or cost", () => {
    const { engine } = engineFor();
    const publicQuote = engine.publicView(engine.quote(imageInput()));
    const serialized = JSON.stringify(publicQuote, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value);
    expect(serialized).not.toContain("providerId");
    expect(serialized).not.toContain("providerModelId");
    expect(serialized).not.toContain("replacementCost");
    expect(serialized).not.toContain("routeVersionId");
  });

  it("disables unknown billing formula kinds", () => {
    expect(() => evaluateBillingFormula(
      { kind: "unknown_formula" } as never,
      imageInput(),
    )).toThrowError(expect.objectContaining<Partial<CommercialEngineError>>({ code: "UNKNOWN_BILLING_FORMULA" }));
  });
});
