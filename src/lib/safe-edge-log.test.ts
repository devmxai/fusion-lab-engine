import { describe, expect, it, vi } from "vitest";
import { logSafeEdgeError } from "../../supabase/functions/_shared/safe-edge-log.ts";

describe("safe Edge logging", () => {
  it("records an error type without exposing the original error message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secretBearingError = new Error("prompt=private text url=https://private.example/token");

    logSafeEdgeError("provider_request_failed", secretBearingError, { provider: "kie", status: 500 });

    expect(spy).toHaveBeenCalledWith(
      "provider_request_failed",
      JSON.stringify({ provider: "kie", status: 500, error_type: "Error" }),
    );
    expect(JSON.stringify(spy.mock.calls)).not.toContain("private text");
    spy.mockRestore();
  });
});
