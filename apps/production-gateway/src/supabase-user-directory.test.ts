// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { ProductionGatewayConfig } from "./config.ts";
import { getProductionAuthUser, listProductionAuthUsers, ProductionUserDirectoryError } from "./supabase-user-directory.ts";

const config: ProductionGatewayConfig = {
  NODE_ENV: "production",
  ENGINE_ENVIRONMENT: "production",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_value",
  SUPABASE_SECRET_KEY: "sb_secret_test_value_long_enough",
};

describe("Supabase Production user directory", () => {
  it("normalizes the private Admin user response without exposing metadata", async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ users: [{
      id: "owner-1",
      email: "owner@example.com",
      created_at: "2026-08-20T00:00:00Z",
      last_sign_in_at: "2026-08-24T00:00:00Z",
      confirmed_at: "2026-08-20T00:01:00Z",
      user_metadata: { full_name: "Owner One", private_note: "must-not-leak" },
      app_metadata: { provider: "email", roles: ["private"] },
    }] }), { status: 200 }));

    await expect(listProductionAuthUsers(config, request, 50)).resolves.toEqual([{
      id: "owner-1",
      email: "owner@example.com",
      displayName: "Owner One",
      createdAt: "2026-08-20T00:00:00.000Z",
      lastSignInAt: "2026-08-24T00:00:00Z",
      confirmedAt: "2026-08-20T00:01:00Z",
      bannedUntil: null,
      authProvider: "email",
    }]);
    const headers = new Headers(request.mock.calls[0]?.[1]?.headers);
    expect(headers.get("apikey")).toBe(config.SUPABASE_SECRET_KEY);
    expect(headers.get("authorization")).toBe(`Bearer ${config.SUPABASE_SECRET_KEY}`);
  });

  it("returns null for a missing user and fails closed for other Auth errors", async () => {
    await expect(getProductionAuthUser(config, "missing", async () => new Response("{}", { status: 404 }))).resolves.toBeNull();
    await expect(listProductionAuthUsers(config, async () => new Response("{}", { status: 503 }))).rejects.toBeInstanceOf(ProductionUserDirectoryError);
  });
});
