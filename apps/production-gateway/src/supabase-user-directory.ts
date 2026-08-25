import type { ProductionGatewayConfig } from "./config.js";

export type ProductionAuthUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  confirmedAt: string | null;
  bannedUntil: string | null;
  authProvider: string | null;
};

type RawAuthUser = {
  id?: unknown;
  email?: unknown;
  created_at?: unknown;
  last_sign_in_at?: unknown;
  confirmed_at?: unknown;
  banned_until?: unknown;
  app_metadata?: unknown;
  user_metadata?: unknown;
};

const nullableText = (value: unknown): string | null => (
  typeof value === "string" && value.trim() ? value.trim() : null
);

function metadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeUser(value: RawAuthUser): ProductionAuthUser | null {
  const id = nullableText(value.id);
  const createdAt = nullableText(value.created_at);
  if (!id || !createdAt) return null;
  const userMetadata = metadata(value.user_metadata);
  const appMetadata = metadata(value.app_metadata);
  const providers = Array.isArray(appMetadata.providers) ? appMetadata.providers.map(String) : [];
  return {
    id,
    email: nullableText(value.email),
    displayName: nullableText(userMetadata.full_name) ?? nullableText(userMetadata.name),
    createdAt: new Date(createdAt).toISOString(),
    lastSignInAt: nullableText(value.last_sign_in_at),
    confirmedAt: nullableText(value.confirmed_at),
    bannedUntil: nullableText(value.banned_until),
    authProvider: providers[0] ?? nullableText(appMetadata.provider),
  };
}

function authHeaders(config: ProductionGatewayConfig): HeadersInit {
  return {
    apikey: config.SUPABASE_SECRET_KEY,
    authorization: `Bearer ${config.SUPABASE_SECRET_KEY}`,
    accept: "application/json",
  };
}

export class ProductionUserDirectoryError extends Error {
  constructor(readonly status: number) {
    super("The Supabase user directory is temporarily unavailable.");
    this.name = "ProductionUserDirectoryError";
  }
}

export async function listProductionAuthUsers(
  config: ProductionGatewayConfig,
  request: typeof fetch = fetch,
  limit = 200,
): Promise<ProductionAuthUser[]> {
  const safeLimit = Math.max(1, Math.min(1_000, Math.trunc(limit)));
  const response = await request(`${config.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=${safeLimit}`, {
    method: "GET",
    headers: authHeaders(config),
  });
  if (!response.ok) throw new ProductionUserDirectoryError(response.status);
  const body = await response.json() as { users?: RawAuthUser[] };
  return (body.users ?? []).map(normalizeUser).filter((user): user is ProductionAuthUser => user !== null);
}

export async function getProductionAuthUser(
  config: ProductionGatewayConfig,
  ownerId: string,
  request: typeof fetch = fetch,
): Promise<ProductionAuthUser | null> {
  const response = await request(`${config.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(ownerId)}`, {
    method: "GET",
    headers: authHeaders(config),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new ProductionUserDirectoryError(response.status);
  return normalizeUser(await response.json() as RawAuthUser);
}
