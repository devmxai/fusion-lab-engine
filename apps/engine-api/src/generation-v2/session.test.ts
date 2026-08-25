import { describe, expect, it } from "vitest";
import { CompositeUserSessionAuthority, LocalUserSessionAuthority, localUserSessionCookieName } from "./session.ts";

describe("Engine user identity boundary", () => {
  it("uses a signed local cookie only in its local authority", async () => {
    const local = new LocalUserSessionAuthority("l".repeat(32));
    const authority = new CompositeUserSessionAuthority(local, undefined);
    const cookie = `${localUserSessionCookieName}=${local.issue("local-owner")}`;
    await expect(authority.resolve({ cookie })).resolves.toEqual({ ownerId: "local-owner", source: "LOCAL_DEV" });
    await expect(authority.resolve({ authorization: "Bearer unverified-token" })).resolves.toBeNull();
  });

  it("accepts a bearer subject only after an injected verifier confirms it", async () => {
    const authority = new CompositeUserSessionAuthority(undefined, {
      verifyAccessToken: async (token) => token === "verified-token" ? { subject: "supabase-user-1" } : null,
    });
    await expect(authority.resolve({ authorization: "Bearer verified-token" })).resolves.toEqual({ ownerId: "supabase-user-1", source: "EXTERNAL_IDP" });
    await expect(authority.resolve({ authorization: "Bearer forged-token" })).resolves.toBeNull();
  });
});
