import { createHmac, timingSafeEqual } from "node:crypto";

export const localUserSessionCookieName = "fl_user_session";
const audience = "fusionlab-local-user-v2";

export type EngineUserIdentity = Readonly<{ ownerId: string; source: "LOCAL_DEV" | "EXTERNAL_IDP" }>;

/**
 * The Engine only consumes a verified subject.  It does not know whether that
 * subject came from Google, Supabase, or a future enterprise IdP.
 */
export interface ExternalUserIdentityVerifier {
  verifyAccessToken(accessToken: string): Promise<{ subject: string } | null>;
}

export interface EngineUserSessionAuthority {
  resolve(headers: { cookie?: string; authorization?: string }): Promise<EngineUserIdentity | null>;
  issueLocal?(ownerId: string, ttlSeconds?: number): string;
}

export class LocalUserSessionAuthority implements EngineUserSessionAuthority {
  constructor(private readonly key: string, private readonly now: () => Date = () => new Date()) { if (key.length < 32) throw new TypeError("user_session_key_too_short"); }
  issue(ownerId: string, ttlSeconds = 3_600): string {
    const issuedAt = Math.floor(this.now().getTime() / 1000);
    const payload = Buffer.from(JSON.stringify({ audience, ownerId, issuedAt, expiresAt: issuedAt + ttlSeconds })).toString("base64url");
    return `v1.${payload}.${this.sign(payload)}`;
  }
  verify(cookie: string | undefined): string | null {
    const token = cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${localUserSessionCookieName}=`))?.slice(localUserSessionCookieName.length + 1);
    const [version, payload, signature, ...rest] = token?.split(".") ?? [];
    if (version !== "v1" || !payload || !signature || rest.length || !this.matches(payload, signature)) return null;
    try { const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { audience: string; ownerId: string; expiresAt: number }; return decoded.audience === audience && decoded.ownerId.length > 0 && decoded.expiresAt > Math.floor(this.now().getTime() / 1000) ? decoded.ownerId : null; } catch { return null; }
  }
  async resolve(headers: { cookie?: string }): Promise<EngineUserIdentity | null> {
    const ownerId = this.verify(headers.cookie);
    return ownerId ? { ownerId, source: "LOCAL_DEV" } : null;
  }
  issueLocal(ownerId: string, ttlSeconds = 3_600): string { return this.issue(ownerId, ttlSeconds); }
  private sign(payload: string) { return createHmac("sha256", this.key).update(payload).digest("base64url"); }
  private matches(payload: string, signature: string) { const a = Buffer.from(this.sign(payload)); const b = Buffer.from(signature); return a.length === b.length && timingSafeEqual(a, b); }
}

/**
 * Production wiring supplies a verifier that cryptographically validates the
 * Supabase/Google bearer token.  This class never treats a bearer value as an
 * identity by itself, and keeps the local cookie path isolated for development.
 */
export class CompositeUserSessionAuthority implements EngineUserSessionAuthority {
  constructor(
    private readonly local: LocalUserSessionAuthority | undefined,
    private readonly external: ExternalUserIdentityVerifier | undefined,
  ) {}
  async resolve(headers: { cookie?: string; authorization?: string }): Promise<EngineUserIdentity | null> {
    const local = this.local ? await this.local.resolve(headers) : null;
    if (local) return local;
    const token = headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!token || !this.external) return null;
    const verified = await this.external.verifyAccessToken(token);
    return verified?.subject ? { ownerId: verified.subject, source: "EXTERNAL_IDP" } : null;
  }
  issueLocal(ownerId: string, ttlSeconds = 3_600): string {
    if (!this.local) throw new Error("local_user_session_disabled");
    return this.local.issue(ownerId, ttlSeconds);
  }
}
