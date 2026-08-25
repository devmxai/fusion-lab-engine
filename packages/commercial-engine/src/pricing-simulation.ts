import { createHash, randomUUID } from "node:crypto";
import { DeterministicQuoteEngine } from "./quote-engine.ts";
import { VersionedCommercialRegistry } from "./registry.ts";
import {
  CommercialEngineError,
  type CommercialRegistrySnapshot,
  type PricingSimulationReport,
  type PricingSimulationResult,
  type PricingSimulationScenario,
} from "./types.ts";

function canonicalize(value: unknown): unknown {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function evidenceHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

/**
 * Runs deterministic pricing scenarios against one candidate snapshot.  The
 * registry used here is intentionally ephemeral: this operation neither
 * activates a customer-visible catalog nor reserves credits nor reaches a
 * provider.  A Release Bundle may therefore require this report before it
 * promotes the same immutable snapshot.
 */
export class PricingSimulationService {
  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
  ) {}

  simulate(candidate: CommercialRegistrySnapshot, scenarios: PricingSimulationScenario[]): PricingSimulationReport {
    if (candidate.status !== "PUBLISHED") {
      throw new CommercialEngineError(
        "INVALID_PRICING_SIMULATION",
        "A pricing simulation candidate must be release-shaped with PUBLISHED lifecycle versions.",
      );
    }
    if (scenarios.length === 0 || scenarios.some((scenario) => !scenario.id || !scenario.label)) {
      throw new CommercialEngineError("INVALID_PRICING_SIMULATION", "Pricing simulation requires named scenarios.");
    }
    if (new Set(scenarios.map(({ id }) => id)).size !== scenarios.length) {
      throw new CommercialEngineError("INVALID_PRICING_SIMULATION", "Pricing simulation scenario IDs must be unique.");
    }

    // A candidate must satisfy the same immutable-reference and certification
    // checks as an active registry.  It is not added to any shared registry.
    const isolatedRegistry = new VersionedCommercialRegistry();
    isolatedRegistry.registerSnapshot(candidate);
    isolatedRegistry.activate(candidate.id);
    let quoteSequence = 0;
    const quoteEngine = new DeterministicQuoteEngine(
      isolatedRegistry,
      this.now,
      () => `pricing-simulation:${candidate.id}:${++quoteSequence}`,
    );
    const results: PricingSimulationResult[] = scenarios.map((scenario) => {
      try {
        const quote = quoteEngine.quote(scenario.input);
        return {
          scenarioId: scenario.id,
          label: scenario.label,
          required: scenario.required,
          outcome: "QUOTED",
          rejectionCode: null,
          quote: {
            customerCredits: quote.customerCredits,
            replacementCostMicrousd: quote.replacementCostMicrousd,
            conservativeCostMicrousd: quote.conservativeCostMicrousd,
            providerAtomicUnits: quote.providerAtomicUnits,
            quotedGrossMarginBps: quote.quotedGrossMarginBps,
            mode: quote.mode,
            pins: quote.pins,
          },
        };
      } catch (error) {
        return {
          scenarioId: scenario.id,
          label: scenario.label,
          required: scenario.required,
          outcome: "REJECTED",
          rejectionCode: error instanceof CommercialEngineError ? error.code : "UNEXPECTED_ERROR",
          quote: null,
        };
      }
    });
    const quoted = results.filter((result) => result.outcome === "QUOTED");
    const requiredRejected = results.some((result) => result.required && result.outcome !== "QUOTED");
    const margins = quoted.map((result) => result.quote!.quotedGrossMarginBps);
    const credits = quoted.map((result) => result.quote!.customerCredits);
    const generatedAt = this.now().toISOString();
    const reportWithoutHash = {
      candidateSnapshotId: candidate.id,
      candidateSnapshotVersion: candidate.version,
      generatedAt,
      scenarios,
      results,
    };
    return structuredClone({
      id: this.id(),
      candidateSnapshotId: candidate.id,
      candidateSnapshotVersion: candidate.version,
      generatedAt,
      evidenceHash: evidenceHash(reportWithoutHash),
      eligibleForApproval: !requiredRejected,
      summary: {
        totalScenarios: results.length,
        requiredScenarios: results.filter((result) => result.required).length,
        quotedScenarios: quoted.length,
        rejectedScenarios: results.length - quoted.length,
        minimumQuotedMarginBps: margins.length > 0 ? margins.reduce((min, value) => value < min ? value : min) : null,
        maximumCustomerCredits: credits.length > 0 ? credits.reduce((max, value) => value > max ? value : max) : null,
      },
      results,
    } satisfies PricingSimulationReport);
  }
}
