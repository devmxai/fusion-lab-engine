import { describe, expect, it } from "vitest";
import { readBoundedProviderAsset } from "./bounded-response.ts";

describe("bounded provider asset response", () => {
  it("rejects oversized declared and streamed responses before asset ingestion", async () => {
    await expect(readBoundedProviderAsset(new Response("12345", {
      headers: { "content-length": "5" },
    }), 4)).rejects.toMatchObject({ code: "RESULT_TOO_LARGE" });
    await expect(readBoundedProviderAsset(new Response(new Uint8Array([1, 2, 3, 4, 5])), 4))
      .rejects.toMatchObject({ code: "RESULT_TOO_LARGE" });
  });

  it("returns only bounded direct response bytes", async () => {
    await expect(readBoundedProviderAsset(new Response(new Uint8Array([1, 2, 3])), 3))
      .resolves.toEqual(new Uint8Array([1, 2, 3]));
  });
});
