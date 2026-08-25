import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ProviderDefinitiveError } from "./types.js";

// KIE's signed delivery timestamp is transported in X-Webhook-Timestamp.  It
// is deliberately not read from the JSON body: changing a body field must not
// change the authentication contract.
const PayloadSchema = z.union([
  z.object({ taskId: z.string().min(1) }).passthrough(),
  z.object({ data: z.object({ taskId: z.string().min(1) }).passthrough() }).passthrough(),
]);

function callbackTaskId(payload: z.infer<typeof PayloadSchema>): string {
  const direct = (payload as { taskId?: unknown }).taskId;
  return typeof direct === "string" ? direct : (payload as { data: { taskId: string } }).data.taskId;
}

function parseEpochSeconds(value: string, now: number, tolerance: number): number {
  if (!/^\d+$/.test(value)) {
    throw new ProviderDefinitiveError("INVALID_WEBHOOK_TIMESTAMP", "KIE webhook timestamp is missing or invalid.");
  }
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > tolerance) {
    throw new ProviderDefinitiveError("STALE_WEBHOOK", "KIE webhook timestamp is stale.");
  }
  return timestamp;
}

function decodeStrictBase64(value: string): Buffer | null {
  const normalized = value.trim();
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) return null;
  const decoded = Buffer.from(normalized, "base64");
  return decoded.toString("base64") === normalized ? decoded : null;
}

/**
 * Authenticates and normalizes a KIE callback, but intentionally does not
 * perform replay detection. Replay protection belongs to the durable inbox,
 * which survives process restarts and is shared by all workers.
 */
export function parseKieWebhook(input: {
  rawBody: Uint8Array;
  signatureHeader: string;
  timestampHeader: string;
  secret: string;
  nowEpochSeconds?: number;
  toleranceSeconds?: number;
}) {
  let payload: z.infer<typeof PayloadSchema>;
  try {
    payload = PayloadSchema.parse(JSON.parse(Buffer.from(input.rawBody).toString("utf8")));
  } catch {
    throw new ProviderDefinitiveError("INVALID_WEBHOOK_PAYLOAD", "KIE webhook payload is invalid.");
  }
  if (!input.secret) {
    throw new ProviderDefinitiveError("INVALID_WEBHOOK_SIGNATURE", "KIE webhook signing secret is unavailable.");
  }
  const now = input.nowEpochSeconds ?? Math.floor(Date.now() / 1_000);
  const timestamp = parseEpochSeconds(input.timestampHeader.trim(), now, input.toleranceSeconds ?? 300);
  const taskId = callbackTaskId(payload);
  const expected = createHmac("sha256", input.secret).update(`${taskId}.${timestamp}`).digest();
  const supplied = decodeStrictBase64(input.signatureHeader);
  if (!supplied || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new ProviderDefinitiveError("INVALID_WEBHOOK_SIGNATURE", "KIE webhook signature is invalid.");
  }
  return {
    deliveryId: `${taskId}.${timestamp}`,
    taskId,
    rawPayload: payload,
  };
}
