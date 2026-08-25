import { createHash } from "node:crypto";
import type { AdminIdentity, AdminRole } from "../../../packages/admin-control-plane/src/types.js";
import type { ProductionGatewayConfig } from "./config.js";

type SupabaseUser = { id?: unknown };
type SupabaseRoleRow = { role?: unknown };

export type ProductionAdminSession = Readonly<{
  identity: AdminIdentity;
  appRoles: readonly ("user" | "admin" | "super_admin")[];
}>;

const readSessionCache = new Map<string, { session: ProductionAdminSession; expiresAt: number }>();

function sessionCacheKey(supabaseUrl: string, accessToken: string): string {
  return createHash("sha256").update(supabaseUrl).update("\0").update(accessToken).digest("base64url");
}

function trimSessionCache(now: number): void {
  for (const [key, value] of readSessionCache) {
    if (value.expiresAt <= now) readSessionCache.delete(key);
  }
  while (readSessionCache.size > 256) {
    const oldest = readSessionCache.keys().next().value as string | undefined;
    if (!oldest) break;
    readSessionCache.delete(oldest);
  }
}

export class ProductionAdminAuthenticationError extends Error {
  constructor(readonly code: "AUTH_REQUIRED" | "AUTH_INVALID" | "ADMIN_MEMBERSHIP_REQUIRED") {
    super(code);
    this.name = "ProductionAdminAuthenticationError";
  }
}

function bearer(authorization: string | undefined): string {
  const value = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!value) throw new ProductionAdminAuthenticationError("AUTH_REQUIRED");
  return value;
}

function jwtPayload(token: string): Record<string, unknown> {
  const encoded = token.split(".")[1];
  if (!encoded) return {};
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapRoles(appRoles: readonly string[]): AdminRole[] {
  if (appRoles.includes("super_admin")) return ["SUPER_ADMIN"];
  if (appRoles.includes("admin")) return ["ADMIN_VIEWER"];
  return [];
}

export class SupabaseProductionAdminAuthority {
  constructor(
    private readonly config: Pick<ProductionGatewayConfig, "SUPABASE_URL" | "SUPABASE_PUBLISHABLE_KEY" | "SUPABASE_SECRET_KEY">,
    private readonly request: typeof fetch = fetch,
    private readonly readCacheTtlMs = 0,
  ) {}

  async resolve(authorization: string | undefined): Promise<ProductionAdminSession> {
    const accessToken = bearer(authorization);
    const now = Date.now();
    const cacheKey = sessionCacheKey(this.config.SUPABASE_URL, accessToken);
    if (this.readCacheTtlMs > 0) {
      const cached = readSessionCache.get(cacheKey);
      if (cached && cached.expiresAt > now) return cached.session;
      trimSessionCache(now);
    }

    const claims = jwtPayload(accessToken);
    const claimedUserId = typeof claims.sub === "string" && claims.sub.length <= 128 ? claims.sub : null;
    const userRequest = this.request(`${this.config.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: this.config.SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${accessToken}`,
        "user-agent": "FusionLab-Production-Gateway/1.0",
      },
    });
    // The membership lookup may run concurrently, but its result is trusted
    // only after Supabase verifies the token and confirms the same subject.
    const membershipForClaim = claimedUserId ? this.request(
      `${this.config.SUPABASE_URL}/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(claimedUserId)}`,
      { headers: { apikey: this.config.SUPABASE_SECRET_KEY, "user-agent": "FusionLab-Production-Gateway/1.0" } },
    ) : null;
    const verified = await userRequest;
    if (!verified.ok) throw new ProductionAdminAuthenticationError("AUTH_INVALID");
    const user = await verified.json() as SupabaseUser;
    if (typeof user.id !== "string" || !user.id) throw new ProductionAdminAuthenticationError("AUTH_INVALID");

    const membership = membershipForClaim && claimedUserId === user.id ? await membershipForClaim : await this.request(
      `${this.config.SUPABASE_URL}/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(user.id)}`,
      { headers: { apikey: this.config.SUPABASE_SECRET_KEY, "user-agent": "FusionLab-Production-Gateway/1.0" } },
    );
    if (!membership.ok) throw new ProductionAdminAuthenticationError("ADMIN_MEMBERSHIP_REQUIRED");
    const rows = await membership.json() as SupabaseRoleRow[];
    const appRoles: Array<"user" | "admin" | "super_admin"> = [];
    for (const row of rows) {
      if (row.role === "user" || row.role === "admin" || row.role === "super_admin") {
        appRoles.push(row.role);
      }
    }
    const roles = mapRoles(appRoles);
    if (!roles.length) throw new ProductionAdminAuthenticationError("ADMIN_MEMBERSHIP_REQUIRED");

    // The token is decoded only after Supabase has verified it. Missing AAL is
    // treated as aal1, so sensitive commands remain fail-closed.
    const session: ProductionAdminSession = {
      identity: {
        actorId: user.id,
        roles,
        assuranceLevel: claims.aal === "aal2" ? 2 : 1,
      },
      appRoles,
    };
    if (this.readCacheTtlMs > 0) {
      const tokenExpiresAt = typeof claims.exp === "number" ? claims.exp * 1_000 : now + this.readCacheTtlMs;
      readSessionCache.set(cacheKey, { session, expiresAt: Math.min(now + this.readCacheTtlMs, tokenExpiresAt) });
      trimSessionCache(now);
    }
    return session;
  }
}
