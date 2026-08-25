import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { CommerceWebhookEvent } from "./types.ts";

const MoneySchema = z.object({
  amountMinor: z.string().regex(/^\d+$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  feeMinor: z.string().regex(/^\d+$/),
}).strict();

const BillingPeriodSchema = z.object({ start: z.string().datetime(), end: z.string().datetime() }).strict();

const PaymentSucceededEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().min(8).max(200),
  type: z.literal("PAYMENT_SUCCEEDED"),
  checkoutId: z.string().uuid(),
  providerPaymentId: z.string().min(8).max(200),
  money: MoneySchema,
  occurredAt: z.string().datetime(),
  billingPeriod: BillingPeriodSchema.nullable().optional(),
}).strict();

const SubscriptionRenewedEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().min(8).max(200),
  type: z.literal("SUBSCRIPTION_RENEWED"),
  subscriptionId: z.string().min(8).max(200),
  planVersionId: z.string().min(8).max(200),
  providerPaymentId: z.string().min(8).max(200),
  money: MoneySchema,
  billingPeriod: BillingPeriodSchema,
  occurredAt: z.string().datetime(),
}).strict();

const PaymentReversalEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().min(8).max(200),
  type: z.enum(["PAYMENT_REFUNDED", "PAYMENT_CHARGEBACK"]),
  originalPaymentEventId: z.string().min(8).max(200),
  providerReversalId: z.string().min(8).max(200),
  money: MoneySchema,
  reasonCode: z.string().min(3).max(200),
  occurredAt: z.string().datetime(),
}).strict();

const CommerceWebhookEventSchema = z.discriminatedUnion("type", [
  PaymentSucceededEventSchema,
  SubscriptionRenewedEventSchema,
  PaymentReversalEventSchema,
]);

export class PaymentWebhookError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PaymentWebhookError";
  }
}

function expectedSignature(rawBody: Uint8Array, timestamp: string, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update(timestamp)
    .update(".")
    .update(rawBody)
    .digest();
}

export function signPaymentWebhook(input: { rawBody: Uint8Array; timestamp: string; secret: string }): string {
  return `v1=${expectedSignature(input.rawBody, input.timestamp, input.secret).toString("hex")}`;
}

export function verifyPaymentWebhook(input: {
  rawBody: Uint8Array;
  timestamp: string;
  signature: string;
  secret: string;
  nowEpochSeconds: number;
  toleranceSeconds?: number;
}): boolean {
  if (!/^\d+$/.test(input.timestamp)) return false;
  const timestamp = Number(input.timestamp);
  const tolerance = input.toleranceSeconds ?? 300;
  if (!Number.isSafeInteger(timestamp) || Math.abs(input.nowEpochSeconds - timestamp) > tolerance) return false;
  const match = /^v1=([a-f0-9]{64})$/i.exec(input.signature);
  if (!match) return false;
  const actual = Buffer.from(match[1], "hex");
  const expected = expectedSignature(input.rawBody, input.timestamp, input.secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function parseVerifiedPaymentWebhook(input: {
  rawBody: Uint8Array;
  timestamp: string;
  signature: string;
  secret: string;
  nowEpochSeconds: number;
}): CommerceWebhookEvent {
  if (!verifyPaymentWebhook(input)) {
    throw new PaymentWebhookError("INVALID_PAYMENT_WEBHOOK_SIGNATURE", "Payment webhook signature is invalid or stale.");
  }
  try {
    return CommerceWebhookEventSchema.parse(JSON.parse(Buffer.from(input.rawBody).toString("utf8")));
  } catch {
    throw new PaymentWebhookError("INVALID_PAYMENT_WEBHOOK_PAYLOAD", "Payment webhook payload is invalid.");
  }
}
