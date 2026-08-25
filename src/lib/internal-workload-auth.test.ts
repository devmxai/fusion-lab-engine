import { describe, expect, it } from "vitest";
import { signInternalWorkloadRequest, verifyInternalWorkloadRequest } from "../../supabase/functions/_shared/internal-workload-auth.ts";

const secret = "local-test-secret";
const timestamp = "2026-08-19T12:00:00.000Z";
const body = JSON.stringify({ reservationId: "reservation-1", status: "success" });
const request = { method: "POST", path: "/functions/v1/complete-generation", timestamp, body, secret };

describe("internal workload HMAC", () => {
  it("accepts only a fresh signature matching method, path and raw body", async () => {
    const signature = await signInternalWorkloadRequest(request);
    await expect(verifyInternalWorkloadRequest({ ...request, signature, now: new Date(timestamp) })).resolves.toBe(true);
    await expect(verifyInternalWorkloadRequest({ ...request, signature, body: "{}", now: new Date(timestamp) })).resolves.toBe(false);
    await expect(verifyInternalWorkloadRequest({ ...request, signature, path: "/functions/v1/other", now: new Date(timestamp) })).resolves.toBe(false);
  });

  it("rejects missing, malformed and expired internal credentials", async () => {
    const signature = await signInternalWorkloadRequest(request);
    await expect(verifyInternalWorkloadRequest({ ...request, signature: null, now: new Date(timestamp) })).resolves.toBe(false);
    await expect(verifyInternalWorkloadRequest({ ...request, signature: "not-a-signature", now: new Date(timestamp) })).resolves.toBe(false);
    await expect(verifyInternalWorkloadRequest({ ...request, signature, now: new Date("2026-08-19T12:05:01.000Z") })).resolves.toBe(false);
  });
});
