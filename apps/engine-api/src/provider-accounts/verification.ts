import type { SecretPurpose } from "../../../../packages/admin-control-plane/src/secret-store.ts";

export type AccountBalanceSnapshot = Readonly<{ available: string; unit: "KIE_CREDIT" | "USD"; observedAt: string }>;
export type ProviderConnectionVerification = Readonly<{
  providerId: string;
  credentialPurpose: SecretPurpose;
  connected: boolean;
  observedAt: string;
  accountLabel: string | null;
  balance: AccountBalanceSnapshot | null;
  keyLimit: Readonly<{ limit: number | null; remaining: number | null; reset: string | null }> | null;
}>;

export class ProviderConnectionVerificationError extends Error {
  constructor(readonly code: "UNSUPPORTED_PROVIDER" | "UNSUPPORTED_CREDENTIAL_PURPOSE" | "CONNECTION_UNAUTHORIZED" | "CONNECTION_UNAVAILABLE" | "CONNECTION_PROTOCOL", message: string) {
    super(message);
    this.name = "ProviderConnectionVerificationError";
  }
}

export type SafeFetch = (input: string, init: RequestInit) => Promise<Response>;

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
async function readJson(response: Response): Promise<Record<string, unknown>> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > 65_536) throw new ProviderConnectionVerificationError("CONNECTION_PROTOCOL", "Verification response exceeds the permitted size.");
  const text = await response.text();
  if (text.length > 65_536) throw new ProviderConnectionVerificationError("CONNECTION_PROTOCOL", "Verification response exceeds the permitted size.");
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_json_shape");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ProviderConnectionVerificationError) throw error;
    throw new ProviderConnectionVerificationError("CONNECTION_PROTOCOL", "Verification response is not a valid provider object.");
  }
}
function authorization(secret: Uint8Array): string {
  const value = new TextDecoder().decode(secret).trim();
  if (!value) throw new ProviderConnectionVerificationError("CONNECTION_PROTOCOL", "Credential is empty.");
  return `Bearer ${value}`;
}
async function request(fetcher: SafeFetch, url: string, secret: Uint8Array): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      redirect: "error",
      headers: { authorization: authorization(secret), accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ProviderConnectionVerificationError("CONNECTION_UNAVAILABLE", "Provider connection verification could not reach the documented endpoint.");
  }
  if (response.status === 401 || response.status === 403) throw new ProviderConnectionVerificationError("CONNECTION_UNAUTHORIZED", "Provider rejected the credential.");
  if (!response.ok) throw new ProviderConnectionVerificationError("CONNECTION_UNAVAILABLE", `Provider verification returned HTTP ${response.status}.`);
  return readJson(response);
}

/**
 * Performs only documented read-only account/key endpoints. It never submits a
 * task, lists billable work, or treats a successful connection as activation.
 */
export async function verifyProviderConnection(input: {
  providerId: string;
  credentialPurpose: SecretPurpose;
  secret: Uint8Array;
  fetcher?: SafeFetch;
  now?: () => Date;
}): Promise<ProviderConnectionVerification> {
  const fetcher = input.fetcher ?? fetch;
  const observedAt = (input.now ?? (() => new Date()))().toISOString();
  if (input.providerId === "kie") {
    if (input.credentialPurpose !== "PROVIDER_GENERATION_KEY") throw new ProviderConnectionVerificationError("UNSUPPORTED_CREDENTIAL_PURPOSE", "KIE balance verification requires a generation API key; webhook HMAC secrets are not provider credentials.");
    const body = await request(fetcher, "https://api.kie.ai/api/v1/chat/credit", input.secret);
    if (body.code !== 200 || (typeof body.data !== "number" && typeof body.data !== "string")) throw new ProviderConnectionVerificationError("CONNECTION_PROTOCOL", "KIE balance response did not contain a successful credit value.");
    return { providerId: "kie", credentialPurpose: input.credentialPurpose, connected: true, observedAt, accountLabel: null,
      balance: { available: String(body.data), unit: "KIE_CREDIT", observedAt }, keyLimit: null };
  }
  if (input.providerId === "openrouter") {
    if (input.credentialPurpose !== "PROVIDER_GENERATION_KEY" && input.credentialPurpose !== "PROVIDER_MANAGEMENT_KEY") throw new ProviderConnectionVerificationError("UNSUPPORTED_CREDENTIAL_PURPOSE", "OpenRouter webhook secrets cannot be verified as API credentials.");
    const body = await request(fetcher, "https://openrouter.ai/api/v1/key", input.secret);
    const data = body.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new ProviderConnectionVerificationError("CONNECTION_PROTOCOL", "OpenRouter current-key response did not contain key metadata.");
    const key = data as Record<string, unknown>;
    if (typeof key.label !== "string") throw new ProviderConnectionVerificationError("CONNECTION_PROTOCOL", "OpenRouter current-key response did not contain a key label.");
    return { providerId: "openrouter", credentialPurpose: input.credentialPurpose, connected: true, observedAt, accountLabel: key.label,
      balance: null, keyLimit: { limit: safeNumber(key.limit), remaining: safeNumber(key.limit_remaining), reset: typeof key.limit_reset === "string" ? key.limit_reset : null } };
  }
  throw new ProviderConnectionVerificationError("UNSUPPORTED_PROVIDER", "This provider does not yet have a documented read-only verification client.");
}
