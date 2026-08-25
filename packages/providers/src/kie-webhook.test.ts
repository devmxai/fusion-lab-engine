import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseKieWebhook } from "./kie-webhook.ts";

describe("KIE webhook offline verifier", () => {
  const secret = "fixture-kie-webhook-secret";
  const timestamp = 1_786_536_000;
  const body = new TextEncoder().encode(JSON.stringify({ taskId: "kie-1", timestamp: "untrusted-body-value" }));
  const signature = createHmac("sha256", secret).update(`kie-1.${timestamp}`).digest("base64");

  it("uses the signed timestamp header, not an untrusted body field", () => {
    expect(parseKieWebhook({
      rawBody: body,
      signatureHeader: signature,
      timestampHeader: String(timestamp),
      secret,
      nowEpochSeconds: timestamp,
    })).toMatchObject({ deliveryId: "kie-1.1786536000", taskId: "kie-1" });
  });

  it("accepts KIE Market callbacks whose task identity is nested under data", () => {
    const nestedBody = new TextEncoder().encode(JSON.stringify({ code: 200, msg: "success", data: { taskId: "kie-market-1", resultJson: "{}" } }));
    const nestedSignature = createHmac("sha256", secret).update(`kie-market-1.${timestamp}`).digest("base64");
    expect(parseKieWebhook({
      rawBody: nestedBody,
      signatureHeader: nestedSignature,
      timestampHeader: String(timestamp),
      secret,
      nowEpochSeconds: timestamp,
    })).toMatchObject({ deliveryId: "kie-market-1.1786536000", taskId: "kie-market-1" });
  });

  it("rejects stale timestamps and malformed or incorrect signatures", () => {
    expect(() => parseKieWebhook({
      rawBody: body,
      signatureHeader: signature,
      timestampHeader: String(timestamp),
      secret,
      nowEpochSeconds: timestamp + 301,
    })).toThrowError(expect.objectContaining({ code: "STALE_WEBHOOK" }));
    expect(() => parseKieWebhook({
      rawBody: body,
      signatureHeader: "not-base64!",
      timestampHeader: String(timestamp),
      secret,
      nowEpochSeconds: timestamp,
    })).toThrowError(expect.objectContaining({ code: "INVALID_WEBHOOK_SIGNATURE" }));
  });
});
