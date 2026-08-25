import { createHash, randomUUID } from "node:crypto";
import { ceilDiv, evaluateBillingFormula } from "./formula.ts";
import { VersionedCommercialRegistry } from "./registry.ts";
import {
  CommercialEngineError,
  type CommercialQuote,
  type CommercialQuoteInput,
  type CustomerPriceVersion,
  type ProviderCostVersion,
  type RouteCapabilityVersion,
} from "./types.ts";

function canonicalize(value: unknown): unknown {
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

function stableRequestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function capabilityMatches(capability: RouteCapabilityVersion, input: CommercialQuoteInput): boolean {
  if (!capability.resolutions.includes(input.resolution)) return false;
  if (input.referenceCount > capability.maxReferences) return false;
  if (input.audio && !capability.supportsAudio) return false;
  if (capability.durationSeconds) {
    if (input.durationSeconds === undefined) return false;
    if (input.durationSeconds < capability.durationSeconds.min || input.durationSeconds > capability.durationSeconds.max) return false;
  }
  if (capability.characterCount) {
    if (input.characterCount === undefined) return false;
    if (input.characterCount < capability.characterCount.min || input.characterCount > capability.characterCount.max) return false;
  }
  return true;
}

function costIsUsable(cost: ProviderCostVersion, allowStale: boolean, now: Date): boolean {
  if (new Date(cost.source.validUntil).getTime() <= now.getTime()) return false;
  return cost.status === "FRESH" || cost.status === "PROMOTIONAL" || (cost.status === "STALE" && allowStale);
}

function chooseCustomerCredits(price: CustomerPriceVersion, conservativeCostMicrousd: bigint): bigint {
  const requiredEconomicValue = ceilDiv(
    conservativeCostMicrousd * 10_000n,
    10_000n - price.targetContributionMarginBps,
  );
  const targetCredits = ceilDiv(requiredEconomicValue, price.creditValueFloorMicrousd);
  let credits: bigint;
  if (price.policy === "manual_credits") {
    if (price.manualCredits === null) throw new CommercialEngineError("INVALID_PRICE_POLICY", "Manual pricing requires manual credits.");
    credits = price.manualCredits;
  } else if (price.policy === "target_margin") {
    credits = targetCredits;
  } else {
    credits = price.manualCredits !== null && price.manualCredits > targetCredits
      ? price.manualCredits
      : targetCredits;
  }
  if (credits < price.minimumChargeCredits) credits = price.minimumChargeCredits;
  return ceilDiv(credits, price.allowedCreditStep) * price.allowedCreditStep;
}

export class DeterministicQuoteEngine {
  constructor(
    private readonly registry: VersionedCommercialRegistry,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
    private readonly ttlMs = 15 * 60 * 1_000,
  ) {}

  quote(input: CommercialQuoteInput): CommercialQuote {
    const snapshot = this.registry.active();
    const now = this.now();
    const family = snapshot.families.find(({ id, lifecycle }) => id === input.familyVersionId && lifecycle === "PUBLISHED");
    if (!family) throw new CommercialEngineError("FAMILY_NOT_AVAILABLE", "The requested model family version is not published.");
    const recipe = snapshot.recipes.find(({ product, lifecycle, familyVersionIds }) =>
      product === input.product && lifecycle === "PUBLISHED" && familyVersionIds.includes(family.id));
    if (!recipe) throw new CommercialEngineError("RECIPE_NOT_AVAILABLE", "No published recipe supports this family version.");
    const routingPolicy = snapshot.routingPolicyVersions.find(({ mode, lifecycle }) => mode === input.mode && lifecycle === "PUBLISHED");
    if (!routingPolicy) throw new CommercialEngineError("NO_CERTIFIED_ROUTE", "No published routing policy supports the requested mode.");
    const customerPrice = snapshot.customerPriceVersions.find(({ lifecycle }) => lifecycle === "PUBLISHED");
    if (!customerPrice) throw new CommercialEngineError("INVALID_PRICE_POLICY", "No customer price version is published.");

    const candidates = snapshot.routes.filter((route) => {
      if (route.familyVersionId !== family.id || route.lifecycle !== "PUBLISHED" || route.killSwitch.enabled) return false;
      const capability = snapshot.capabilities.find(({ id, lifecycle }) => id === route.capabilityVersionId && lifecycle === "PUBLISHED");
      const cost = snapshot.costVersions.find(({ id }) => id === route.costVersionId);
      return Boolean(capability && cost && capabilityMatches(capability, input) && costIsUsable(cost, routingPolicy.allowStaleCost, now));
    });
    if (candidates.length === 0) {
      const familyRoutes = snapshot.routes.filter((route) => route.familyVersionId === family.id && route.lifecycle === "PUBLISHED" && !route.killSwitch.enabled);
      if (familyRoutes.length > 0) {
        const hasCapability = familyRoutes.some((route) => {
          const capability = snapshot.capabilities.find(({ id }) => id === route.capabilityVersionId);
          return capability && capabilityMatches(capability, input);
        });
        if (!hasCapability) throw new CommercialEngineError("CAPABILITY_MISMATCH", "No route capability accepts the full requested input.");
        throw new CommercialEngineError("COST_NOT_USABLE", "No route has a usable certified cost version.");
      }
      throw new CommercialEngineError("NO_CERTIFIED_ROUTE", "No published route is available for this family version.");
    }
    if (candidates.length > 1) {
      throw new CommercialEngineError("ROUTE_SELECTION_REQUIRED", "Phase 4 does not auto-route across multiple certified candidates.");
    }
    const route = candidates[0]!;
    const capability = snapshot.capabilities.find(({ id }) => id === route.capabilityVersionId)!;
    const billing = snapshot.billingManifests.find(({ id, lifecycle }) => id === route.billingManifestVersionId && lifecycle === "PUBLISHED");
    const cost = snapshot.costVersions.find(({ id }) => id === route.costVersionId)!;
    if (!billing) throw new CommercialEngineError("NO_CERTIFIED_ROUTE", "The route billing manifest is not published.");

    const providerAtomicUnits = evaluateBillingFormula(billing.formula, input);
    const replacementCostMicrousd = providerAtomicUnits * cost.nativeUnitReplacementCostMicrousd;
    const routeRiskBufferBps = cost.riskBufferBps
      + (cost.status === "STALE" ? routingPolicy.staleRiskBufferBps : 0n);
    const riskAdjusted = ceilDiv(replacementCostMicrousd * (10_000n + routeRiskBufferBps), 10_000n);
    const manifestMaximum = ceilDiv(replacementCostMicrousd * cost.maximumCostMultiplierBps, 10_000n);
    const conservativeCostMicrousd = (riskAdjusted > manifestMaximum ? riskAdjusted : manifestMaximum)
      + customerPrice.variablePlatformCostMicrousd;
    const customerCredits = chooseCustomerCredits(customerPrice, conservativeCostMicrousd);
    const customerEconomicValue = customerCredits * customerPrice.creditValueFloorMicrousd;
    const quotedGrossMarginBps = customerEconomicValue > 0n
      ? ((customerEconomicValue - conservativeCostMicrousd) * 10_000n) / customerEconomicValue
      : -10_000n;
    if (quotedGrossMarginBps < customerPrice.hardFloorMarginBps) {
      throw new CommercialEngineError("MARGIN_FLOOR_VIOLATION", "The quote would violate the published hard contribution margin floor.");
    }

    const createdAt = now.toISOString();
    return structuredClone({
      id: this.id(),
      registrySnapshotId: snapshot.id,
      requestHash: stableRequestHash(input),
      createdAt,
      expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(),
      customerCredits,
      discountCredits: 0n,
      replacementCostMicrousd,
      conservativeCostMicrousd,
      providerAtomicUnits,
      quotedGrossMarginBps,
      mode: input.mode,
      pins: {
        recipeVersionId: recipe.id,
        familyVersionId: family.id,
        routeVersionId: route.id,
        capabilityVersionId: capability.id,
        billingManifestVersionId: billing.id,
        costVersionId: cost.id,
        customerPriceVersionId: customerPrice.id,
        routingPolicyVersionId: routingPolicy.id,
        adapterVersion: route.adapterVersion,
      },
      internalRoute: {
        providerId: route.providerId,
        providerAccountId: route.providerAccountId,
        providerModelId: route.providerModelId,
      },
    } satisfies CommercialQuote);
  }

  publicView(quote: CommercialQuote) {
    return {
      quoteId: quote.id,
      customerCredits: quote.customerCredits,
      discountCredits: quote.discountCredits,
      expiresAt: quote.expiresAt,
      mode: quote.mode,
      pinned: {
        recipeVersionId: quote.pins.recipeVersionId,
        familyVersionId: quote.pins.familyVersionId,
        customerPriceVersionId: quote.pins.customerPriceVersionId,
      },
      requestHash: quote.requestHash,
    };
  }
}
