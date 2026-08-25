import { z } from "zod";
import { decimalToAtomic } from "../../provider-treasury/src/decimal.ts";
import { ProviderDefinitiveError } from "./types.ts";

const DecimalSchema = z.union([z.string(), z.number()]);
const GenerationSchema = z.object({ data: z.object({ id: z.string().min(1), model: z.string().min(1).nullable().optional(), provider_name: z.string().min(1).nullable().optional(), total_cost: DecimalSchema.optional(), usage: DecimalSchema.optional() }).passthrough() }).passthrough();
const KeySchema = z.object({ data: z.object({ limit: DecimalSchema.nullable().optional(), limit_remaining: DecimalSchema.nullable().optional(), limit_reset: z.string().nullable().optional(), is_management_key: z.boolean().optional() }).passthrough() }).passthrough();

type Options = { apiKey: string; fetch?: typeof fetch; baseUrl?: string };

function atomic(value: string | number | null | undefined, code: string): number | null {
  if (value === undefined || value === null) return null;
  try {
    const parsed = decimalToAtomic(value, 1_000_000n, "ceil");
    if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("range");
    return Number(parsed);
  } catch {
    throw new ProviderDefinitiveError(code, "OpenRouter financial value is not a safe decimal.");
  }
}

abstract class OpenRouterReadOnlyClient {
  private readonly transport: typeof fetch;
  private readonly baseUrl: string;
  protected constructor(private readonly options: Options) {
    if (!options.apiKey) throw new TypeError("OpenRouter credential is required server-side.");
    this.transport = options.fetch ?? fetch;
    this.baseUrl = (options.baseUrl ?? "https://openrouter.ai").replace(/\/$/, "");
  }
  protected async requestGet(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.transport(`${this.baseUrl}${path}`, { headers: { authorization: `Bearer ${this.options.apiKey}` } });
    } catch (error) {
      throw new ProviderDefinitiveError("OPENROUTER_AUDIT_UNAVAILABLE", error instanceof Error ? error.message : "OpenRouter audit request failed.");
    }
    if (!response.ok) throw new ProviderDefinitiveError(`OPENROUTER_HTTP_${response.status}`, "OpenRouter read-only request failed.");
    return response.json().catch(() => { throw new ProviderDefinitiveError("INVALID_PROVIDER_RESPONSE", "OpenRouter returned invalid JSON."); });
  }
}

/** Reconciliation evidence only; it cannot alter a customer quote or settle a missing delivery. */
export class OpenRouterGenerationUsageClient extends OpenRouterReadOnlyClient {
  constructor(options: Options) { super(options); }

  async get(generationId: string): Promise<{ generationId: string; actualModel: string | null; actualHostingProvider: string | null; actualProviderCostAtomic: number | null; reconciliationRequired: boolean }> {
    const payload = GenerationSchema.parse(await this.requestGet(`/api/v1/generation?id=${encodeURIComponent(generationId)}`)).data;
    if (payload.id !== generationId) throw new ProviderDefinitiveError("GENERATION_ID_MISMATCH", "OpenRouter generation evidence does not match the expected generation id.");
    const totalCost = atomic(payload.total_cost, "INVALID_GENERATION_COST");
    const usageCost = atomic(payload.usage, "INVALID_GENERATION_COST");
    if (totalCost !== null && usageCost !== null && totalCost !== usageCost) {
      throw new ProviderDefinitiveError("GENERATION_COST_MISMATCH", "OpenRouter generation total_cost and usage disagree.");
    }
    const cost = totalCost ?? usageCost;
    return { generationId: payload.id, actualModel: payload.model ?? null, actualHostingProvider: payload.provider_name ?? null, actualProviderCostAtomic: cost, reconciliationRequired: cost === null || !payload.provider_name };
  }
}

/** Sanitized key-limit observation; it intentionally never returns the key label or credential material. */
export class OpenRouterKeyStatusClient extends OpenRouterReadOnlyClient {
  constructor(options: Options) { super(options); }

  async get(): Promise<{ providerSideLimitAtomic: number | null; providerSideRemainingAtomic: number | null; reset: string | null; managementKey: boolean }> {
    const payload = KeySchema.parse(await this.requestGet("/api/v1/key")).data;
    return { providerSideLimitAtomic: atomic(payload.limit, "INVALID_KEY_LIMIT"), providerSideRemainingAtomic: atomic(payload.limit_remaining, "INVALID_KEY_LIMIT"), reset: payload.limit_reset ?? null, managementKey: payload.is_management_key ?? false };
  }
}
