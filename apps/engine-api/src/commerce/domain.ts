import { z } from "zod";
import type { CommerceProductSnapshot, PlanVersion } from "../../../../packages/commerce/src/types.ts";

export const CreateCheckoutInputSchema = z.object({
  userId: z.string().min(1).max(100).default("local-user"),
  productId: z.string().min(1).max(100),
  idempotencyKey: z.string().min(8).max(200),
}).strict();

export const localCommerceProducts: readonly CommerceProductSnapshot[] = [
  {
    id: "local-credit-pack-100-v1",
    version: 1,
    kind: "CREDIT_PACK",
    displayName: "Local Test · 100 Credits",
    grantedCredits: 100,
    amountMinor: "1000",
    currency: "USD",
    planVersionId: null,
  },
  {
    id: "local-subscription-pro-monthly-v1",
    version: 1,
    kind: "SUBSCRIPTION",
    displayName: "Local Test · Pro Monthly",
    grantedCredits: 200,
    amountMinor: "1500",
    currency: "USD",
    planVersionId: "local-plan-pro-v1",
  },
] as const;

export const localPlanVersions: readonly PlanVersion[] = [
  {
    id: "local-plan-pro-v1",
    planKey: "pro",
    version: 1,
    lifecycle: "PUBLISHED",
    displayName: "Local Test · Pro",
    price: { amountMinor: "1500", currency: "USD", interval: "MONTH" },
    creditsPerPeriod: 200,
    creditExpiry: "PERIOD_END",
    limits: { concurrency: 2, queue: 10, storageBytes: "10737418240", retentionDays: 30 },
    eligibility: {
      features: ["image", "video", "audio"],
      models: ["local/test-image-v1", "local/test-video-v1", "local/test-audio-v1"],
      profiles: ["standard"],
    },
    renewal: { graceDays: 3, cancellation: "AT_PERIOD_END" },
    termsVersion: "local-terms-v1",
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    publishedAt: "2026-08-01T00:00:00.000Z",
  },
] as const;
