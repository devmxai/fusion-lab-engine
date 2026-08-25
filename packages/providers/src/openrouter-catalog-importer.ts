import { z } from "zod";
import { decimalToAtomic } from "../../provider-treasury/src/decimal.ts";
import { ProviderDefinitiveError } from "./types.ts";

const ScalarPriceSchema = z.union([z.string(), z.number()]);
const GeneralEndpointSchema = z.object({
  provider_name: z.string().min(1),
  provider_slug: z.string().min(1),
  provider_tag: z.string().min(1).nullable().optional(),
  pricing: z.record(ScalarPriceSchema).optional(),
  supported_parameters: z.record(z.unknown()).optional(),
}).passthrough();
const ImageEndpointSchema = z.object({
  provider_name: z.string().min(1),
  provider_slug: z.string().min(1),
  provider_tag: z.string().min(1).nullable().optional(),
  pricing: z.array(z.object({ billable: z.string().min(1), unit: z.string().min(1), cost_usd: ScalarPriceSchema, variant: z.string().min(1).optional() }).passthrough()),
  supported_parameters: z.record(z.unknown()).optional(),
}).passthrough();
const VideoModelSchema = z.object({
  id: z.string().min(1),
  pricing_skus: z.record(ScalarPriceSchema).optional(),
  supported_resolutions: z.array(z.string()).optional(),
  supported_aspect_ratios: z.array(z.string()).optional(),
}).passthrough();

export type OpenRouterPriceLine = { billable: string; unit: string; variant: string | null; costAtomic: number };
export type OpenRouterNormalizedEndpoint = {
  providerSlug: string;
  providerName: string;
  providerTag: string | null;
  supportedParameters: string[];
  pricing: OpenRouterPriceLine[];
};

function atomic(value: string | number, field: string): number {
  try {
    const amount = decimalToAtomic(value, 1_000_000n, "ceil");
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("range");
    return Number(amount);
  } catch {
    throw new ProviderDefinitiveError("INVALID_CATALOG_PRICE", `OpenRouter ${field} is not a safe decimal USD price.`);
  }
}

/**
 * Pure snapshot normalizer.  It performs no fetch and deliberately refuses a
 * model-level union as an endpoint price: publication must bind this output to
 * a named hosting endpoint or an approved endpoint policy.
 */
export class OpenRouterCatalogSnapshotImporter {
  normalizeGeneralEndpoint(raw: unknown): OpenRouterNormalizedEndpoint {
    const endpoint = GeneralEndpointSchema.parse(raw);
    const pricing = Object.entries(endpoint.pricing ?? {}).map(([billable, value]) => ({ billable, unit: "model-meter", variant: null, costAtomic: atomic(value, `pricing.${billable}`) }));
    return { providerSlug: endpoint.provider_slug, providerName: endpoint.provider_name, providerTag: endpoint.provider_tag ?? null, supportedParameters: Object.keys(endpoint.supported_parameters ?? {}).sort(), pricing };
  }

  normalizeImageEndpoint(raw: unknown): OpenRouterNormalizedEndpoint {
    const endpoint = ImageEndpointSchema.parse(raw);
    return {
      providerSlug: endpoint.provider_slug,
      providerName: endpoint.provider_name,
      providerTag: endpoint.provider_tag ?? null,
      supportedParameters: Object.keys(endpoint.supported_parameters ?? {}).sort(),
      pricing: endpoint.pricing.map((line) => ({ billable: line.billable, unit: line.unit, variant: line.variant ?? null, costAtomic: atomic(line.cost_usd, `image.${line.billable}`) })),
    };
  }

  normalizeVideoModel(raw: unknown): { model: string; capabilities: { resolutions: string[]; aspectRatios: string[] }; pricing: OpenRouterPriceLine[] } {
    const model = VideoModelSchema.parse(raw);
    const skus = Object.entries(model.pricing_skus ?? {});
    if (!skus.length) throw new ProviderDefinitiveError("INCOMPLETE_CATALOG_PRICING", "OpenRouter video model lacks pricing SKUs.");
    return {
      model: model.id,
      capabilities: { resolutions: model.supported_resolutions ?? [], aspectRatios: model.supported_aspect_ratios ?? [] },
      pricing: skus.map(([sku, value]) => ({ billable: sku, unit: "video-sku", variant: sku, costAtomic: atomic(value, `video.${sku}`) })),
    };
  }
}
