import { describe, expect, it } from "vitest";
import { CompositeAdminIdentityAuthority, LocalAdminSessionAuthority, localAdminSessionCookieName } from "./session.ts";

describe("Admin identity boundary", () => {
  it("does not grant roles from an unverified bearer token", async () => {
    const authority = new CompositeAdminIdentityAuthority(undefined, undefined, undefined);
    await expect(authority.resolve({ authorization: "Bearer forged-admin-token" })).resolves.toBeNull();
  });

  it("requires independent token verification and server-side membership roles", async () => {
    const authority = new CompositeAdminIdentityAuthority(undefined, {
      verifyAccessToken: async (token) => token === "verified" ? { subject: "admin-subject", assuranceLevel: 2 } : null,
    }, { resolve: async (subject) => subject === "admin-subject" ? ["PRICING_MAKER"] : [] });
    await expect(authority.resolve({ authorization: "Bearer verified" })).resolves.toEqual({ actorId: "admin-subject", roles: ["PRICING_MAKER"], assuranceLevel: 2 });
    await expect(authority.resolve({ authorization: "Bearer forged" })).resolves.toBeNull();
  });

  it("keeps the local read-only session isolated to the local authority", async () => {
    const local = new LocalAdminSessionAuthority("a".repeat(32));
    const authority = new CompositeAdminIdentityAuthority(local, undefined, undefined);
    await expect(authority.resolve({ cookie: `${localAdminSessionCookieName}=${local.localViewerSession()}` })).resolves.toMatchObject({
      actorId: "local-admin-viewer", roles: ["ADMIN_VIEWER"], assuranceLevel: 2,
    });
  });
});
