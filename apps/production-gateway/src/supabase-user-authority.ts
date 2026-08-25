import type { ProductionGatewayConfig } from "./config.js";

export class ProductionUserAuthenticationError extends Error {
  constructor(readonly code: "AUTH_REQUIRED" | "AUTH_INVALID") { super(code); }
}

export class SupabaseProductionUserAuthority {
  constructor(
    private readonly config: Pick<ProductionGatewayConfig, "SUPABASE_URL" | "SUPABASE_PUBLISHABLE_KEY">,
    private readonly request: typeof fetch = fetch,
  ) {}

  async resolve(authorization: string | undefined): Promise<{ ownerId: string }> {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!token) throw new ProductionUserAuthenticationError("AUTH_REQUIRED");
    const response = await this.request(`${this.config.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: this.config.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}`, "user-agent": "FusionLab-Production-Gateway/1.0" },
    });
    if (!response.ok) throw new ProductionUserAuthenticationError("AUTH_INVALID");
    const user = await response.json() as { id?: unknown };
    if (typeof user.id !== "string" || !user.id) throw new ProductionUserAuthenticationError("AUTH_INVALID");
    return { ownerId: user.id };
  }
}
