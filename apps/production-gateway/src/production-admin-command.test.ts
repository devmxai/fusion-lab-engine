// @vitest-environment node

import { describe, expect, it } from "vitest";
import { verifyWebhookHmacSecret } from "./production-admin-command.ts";

describe("production provider webhook credential validation", () => {
  it("performs a local HMAC-SHA256 roundtrip without contacting KIE", () => {
    expect(verifyWebhookHmacSecret("kie-webhook-hmac-fixture-secret")).toMatchObject({
      providerId: "kie",
      verificationType: "LOCAL_HMAC_SHA256_ROUNDTRIP",
      algorithm: "HMAC-SHA256",
      externalProviderCallMade: false,
    });
  });
});
