import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { decimalToAtomic } from "../../provider-treasury/src/decimal.ts";
import { ProviderDefinitiveError } from "./types.ts";

const OpenRouterWebhookEventSchema = z.object({
  type: z.enum([
    "video.generation.completed",
    "video.generation.failed",
    "video.generation.cancelled",
    "video.generation.expired",
  ]),
  created_at: z.string().datetime(),
  data: z.object({
    id: z.string().min(1),
    status: z.enum(["completed", "failed", "cancelled", "expired"]),
    generation_id: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    unsigned_urls: z.string().url().array().optional(),
    usage: z.object({
      cost: z.union([z.string(), z.number()]).optional(),
      is_byok: z.boolean().optional(),
    }).optional(),
    error: z.string().optional(),
  }),
});

export type OpenRouterWebhookEvent = z.infer<typeof OpenRouterWebhookEventSchema>;

export function verifyOpenRouterWebhookSignature(input: {
  rawBody: Uint8Array;
  signatureHeader: string;
  secret: string;
  nowEpochSeconds?: number;
  toleranceSeconds?: number;
}): boolean {
  if (!input.secret || !input.signatureHeader) return false;
  const parts = input.signatureHeader.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signature = parts.find((part) => part.startsWith("v1="))?.slice(3);
  if (!timestamp || !signature || !/^\d+$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const timestampNumber = Number(timestamp);
  const now = input.nowEpochSeconds ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(timestampNumber) || Math.abs(now - timestampNumber) > (input.toleranceSeconds ?? 300)) {
    return false;
  }
  const expected = createHmac("sha256", input.secret)
    .update(Buffer.concat([Buffer.from(`${timestamp},`, "utf8"), Buffer.from(input.rawBody)]))
    .digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(expected, supplied);
}

export function parseOpenRouterWebhook(input: {
  rawBody: Uint8Array;
  signatureHeader: string;
  deliveryId: string;
  secret: string;
  nowEpochSeconds?: number;
}) {
  if (!verifyOpenRouterWebhookSignature(input)) {
    throw new ProviderDefinitiveError("INVALID_WEBHOOK_SIGNATURE", "OpenRouter webhook signature is invalid or stale.");
  }
  if (!input.deliveryId) {
    throw new ProviderDefinitiveError("MISSING_WEBHOOK_DELIVERY_ID", "OpenRouter webhook idempotency key is required.");
  }
  let event: OpenRouterWebhookEvent;
  try {
    event = OpenRouterWebhookEventSchema.parse(JSON.parse(Buffer.from(input.rawBody).toString("utf8")));
  } catch {
    throw new ProviderDefinitiveError("INVALID_WEBHOOK_PAYLOAD", "OpenRouter webhook payload is invalid.");
  }
  const expectedDeliveryId = `${event.data.id}-${event.data.status}`;
  if (input.deliveryId !== expectedDeliveryId) {
    throw new ProviderDefinitiveError("WEBHOOK_DELIVERY_MISMATCH", "OpenRouter webhook delivery id does not match its task and status.");
  }
  const cost = event.data.usage?.cost;
  const actualAtomic = cost === undefined ? null : decimalToAtomic(cost, 1_000_000n, "ceil");
  if (actualAtomic !== null && actualAtomic > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ProviderDefinitiveError("COST_OUT_OF_RANGE", "OpenRouter usage cost exceeds the canonical safe integer range.");
  }
  const completed = event.data.status === "completed";
  if (completed && (actualAtomic === null || !event.data.unsigned_urls?.[0])) {
    throw new ProviderDefinitiveError("INCOMPLETE_TERMINAL_USAGE", "Completed OpenRouter video lacks usage.cost or result URL.");
  }
  return {
    deliveryId: input.deliveryId,
    event,
    task: {
      taskId: event.data.id,
      status: completed ? "succeeded" as const : "failed" as const,
      actualProviderCredits: actualAtomic === null ? null : Number(actualAtomic),
      resultUrl: completed ? event.data.unsigned_urls![0] : null,
      errorCode: completed ? null : `OPENROUTER_${event.data.status.toUpperCase()}`,
      chargeStatus: actualAtomic === null ? "UNKNOWN" as const : "ACTUAL" as const,
    },
  };
}
