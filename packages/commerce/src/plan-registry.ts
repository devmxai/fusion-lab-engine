import { z } from "zod";
import type { PlanVersion } from "./types.ts";

const PlanVersionSchema = z.object({
  id: z.string().min(8).max(200),
  planKey: z.string().min(3).max(100),
  version: z.number().int().positive(),
  lifecycle: z.enum(["PUBLISHED", "RETIRED"]),
  displayName: z.string().min(1).max(200),
  price: z.object({ amountMinor: z.string().regex(/^\d+$/), currency: z.string().regex(/^[A-Z]{3}$/), interval: z.literal("MONTH") }).strict(),
  creditsPerPeriod: z.number().int().positive(),
  creditExpiry: z.literal("PERIOD_END"),
  limits: z.object({ concurrency: z.number().int().positive(), queue: z.number().int().positive(), storageBytes: z.string().regex(/^\d+$/), retentionDays: z.number().int().positive() }).strict(),
  eligibility: z.object({ features: z.array(z.string()).min(1), models: z.array(z.string()).min(1), profiles: z.array(z.string()).min(1) }).strict(),
  renewal: z.object({ graceDays: z.number().int().min(0).max(90), cancellation: z.literal("AT_PERIOD_END") }).strict(),
  termsVersion: z.string().min(1).max(100),
  effectiveFrom: z.string().datetime(),
  publishedAt: z.string().datetime(),
}).strict();

export class PlanRegistryError extends Error {
  constructor(public readonly code: "INVALID_PLAN_VERSION" | "IMMUTABLE_PLAN_VERSION" | "DUPLICATE_PLAN_SEQUENCE" | "PLAN_VERSION_NOT_FOUND", message: string) {
    super(message);
    this.name = "PlanRegistryError";
  }
}

function immutableClone(plan: PlanVersion): PlanVersion {
  return Object.freeze({
    ...structuredClone(plan),
    price: Object.freeze({ ...plan.price }),
    limits: Object.freeze({ ...plan.limits }),
    renewal: Object.freeze({ ...plan.renewal }),
    eligibility: Object.freeze({
      features: Object.freeze([...plan.eligibility.features]),
      models: Object.freeze([...plan.eligibility.models]),
      profiles: Object.freeze([...plan.eligibility.profiles]),
    }),
  });
}

export class InMemoryPlanRegistry {
  private readonly versions = new Map<string, PlanVersion>();
  private readonly sequences = new Map<string, string>();

  register(input: PlanVersion): PlanVersion {
    const parsed = PlanVersionSchema.safeParse(input);
    if (!parsed.success) throw new PlanRegistryError("INVALID_PLAN_VERSION", "Plan version does not satisfy the immutable published contract.");
    if (this.versions.has(input.id)) throw new PlanRegistryError("IMMUTABLE_PLAN_VERSION", "A Plan Version ID can never be overwritten.");
    const sequenceKey = `${input.planKey}:${input.version}`;
    if (this.sequences.has(sequenceKey)) throw new PlanRegistryError("DUPLICATE_PLAN_SEQUENCE", "A plan key/version sequence can be published only once.");
    const plan = immutableClone(parsed.data);
    this.versions.set(plan.id, plan);
    this.sequences.set(sequenceKey, plan.id);
    return plan;
  }

  require(id: string): PlanVersion {
    const plan = this.versions.get(id);
    if (!plan) throw new PlanRegistryError("PLAN_VERSION_NOT_FOUND", "Plan Version was not found.");
    return plan;
  }

  list(): readonly PlanVersion[] {
    return [...this.versions.values()];
  }
}
