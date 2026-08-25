import { describe, expect, it } from "vitest";
import { createLocalTestRegistrySnapshot, localFamilyVersionId } from "./local-test-fixture.ts";
import { PricingSimulationService } from "./pricing-simulation.ts";
import { CommercialEngineError, type PricingSimulationScenario } from "./types.ts";

const NOW = new Date("2026-08-22T12:00:00.000Z");

const scenarios: PricingSimulationScenario[] = [
  {
    id: "image-standard",
    label: "Standard image",
    required: true,
    input: {
      projectId: "finance-simulation",
      product: "image.generate",
      mode: "exact",
      familyVersionId: localFamilyVersionId("local/test-image-v1"),
      quantity: 1,
      resolution: "720p",
      audio: false,
      referenceCount: 0,
    },
  },
  {
    id: "video-high-with-audio",
    label: "1080p video with audio",
    required: true,
    input: {
      projectId: "finance-simulation",
      product: "video.generate",
      mode: "exact",
      familyVersionId: localFamilyVersionId("local/test-video-v1"),
      quantity: 1,
      durationSeconds: 60,
      resolution: "1080p",
      audio: true,
      referenceCount: 2,
    },
  },
];

describe("PricingSimulationService", () => {
  it("simulates a release-shaped candidate without changing a shared active registry", () => {
    const service = new PricingSimulationService(() => NOW, () => "simulation-1");
    const report = service.simulate(createLocalTestRegistrySnapshot(), scenarios);
    expect(report).toMatchObject({
      id: "simulation-1",
      candidateSnapshotVersion: 1,
      eligibleForApproval: true,
      summary: {
        totalScenarios: 2,
        requiredScenarios: 2,
        quotedScenarios: 2,
        rejectedScenarios: 0,
        minimumQuotedMarginBps: 5_000n,
        maximumCustomerCredits: 370n,
      },
    });
    expect(report.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.results[0]?.quote?.customerCredits).toBe(4n);
    expect(report.results[1]?.quote).toMatchObject({ providerAtomicUnits: 185n, customerCredits: 370n });
  });

  it("records a required rejected scenario and makes the report ineligible", () => {
    const service = new PricingSimulationService(() => NOW, () => "simulation-2");
    const report = service.simulate(createLocalTestRegistrySnapshot(), [{
      ...scenarios[0]!,
      input: { ...scenarios[0]!.input, resolution: "4k" },
    }]);
    expect(report.eligibleForApproval).toBe(false);
    expect(report.results[0]).toMatchObject({ outcome: "REJECTED", rejectionCode: "CAPABILITY_MISMATCH", quote: null });
  });

  it("fails closed for a non-release candidate, unnamed scenarios, and duplicate IDs", () => {
    const service = new PricingSimulationService(() => NOW);
    const draft = createLocalTestRegistrySnapshot();
    draft.status = "DRAFT";
    expect(() => service.simulate(draft, scenarios))
      .toThrowError(expect.objectContaining<Partial<CommercialEngineError>>({ code: "INVALID_PRICING_SIMULATION" }));
    expect(() => service.simulate(createLocalTestRegistrySnapshot(), []))
      .toThrowError(expect.objectContaining<Partial<CommercialEngineError>>({ code: "INVALID_PRICING_SIMULATION" }));
    expect(() => service.simulate(createLocalTestRegistrySnapshot(), [scenarios[0]!, { ...scenarios[1]!, id: scenarios[0]!.id }]))
      .toThrowError(expect.objectContaining<Partial<CommercialEngineError>>({ code: "INVALID_PRICING_SIMULATION" }));
  });
});
