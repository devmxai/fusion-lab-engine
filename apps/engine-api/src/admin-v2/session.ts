import { createHmac, timingSafeEqual } from "node:crypto";
import type { AdminIdentity } from "../../../../packages/admin-control-plane/src/types.ts";

const SESSION_AUDIENCE = "fusionlab-local-admin-v2";
export const localAdminSessionCookieName = "fl_admin_session";

type SessionPayload = {
  audience: typeof SESSION_AUDIENCE;
  actorId: string;
  roles: AdminIdentity["roles"];
  assuranceLevel: AdminIdentity["assuranceLevel"];
  issuedAt: number;
  expiresAt: number;
};

export interface AdminIdentityAuthority {
  resolve(headers: { cookie?: string; authorization?: string }): Promise<AdminIdentity | null>;
  issueLocalViewer?(): string;
}

/** Verifies an external access token but does not supply roles from the token. */
export interface ExternalAdminTokenVerifier {
  verifyAccessToken(accessToken: string): Promise<{ subject: string; assuranceLevel: 1 | 2 } | null>;
}

/** Maps a verified subject to server-controlled workspace roles. */
export interface AdminMembershipResolver {
  resolve(subject: string): Promise<readonly AdminIdentity["roles"][number][]>;
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const entry of header.split(";")) {
    const [key, ...rawValue] = entry.trim().split("=");
    if (key === name) return rawValue.join("=") || null;
  }
  return null;
}

/**
 * Local-only signed session boundary. It intentionally replaces browser
 * supplied actor/role headers. A real IdP session resolver replaces this
 * adapter before any non-local environment is permitted.
 */
export class LocalAdminSessionAuthority implements AdminIdentityAuthority {
  constructor(
    private readonly signingKey: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (signingKey.length < 32) throw new TypeError("local admin session signing key is too short");
  }

  issue(identity: AdminIdentity, ttlSeconds = 900): string {
    if (!identity.actorId || identity.assuranceLevel !== 2 || identity.roles.length === 0) {
      throw new TypeError("local admin sessions require a complete AAL2 identity");
    }
    const issuedAt = Math.floor(this.now().getTime() / 1000);
    const payload: SessionPayload = {
      audience: SESSION_AUDIENCE,
      actorId: identity.actorId,
      roles: [...identity.roles],
      assuranceLevel: identity.assuranceLevel,
      issuedAt,
      expiresAt: issuedAt + ttlSeconds,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `v1.${encoded}.${this.sign(encoded)}`;
  }

  verifyCookie(cookieHeader: string | undefined): AdminIdentity | null {
    const token = readCookie(cookieHeader, localAdminSessionCookieName);
    if (!token) return null;
    const [version, encoded, signature, ...rest] = token.split(".");
    if (version !== "v1" || !encoded || !signature || rest.length !== 0 || !this.matches(encoded, signature)) return null;
    try {
      const payload = JSON.parse(fromBase64Url(encoded).toString("utf8")) as SessionPayload;
      const nowEpochSeconds = Math.floor(this.now().getTime() / 1000);
      if (
        payload.audience !== SESSION_AUDIENCE
        || !payload.actorId
        || !Array.isArray(payload.roles)
        || payload.roles.length === 0
        || payload.assuranceLevel !== 2
        || !Number.isInteger(payload.issuedAt)
        || !Number.isInteger(payload.expiresAt)
        || payload.expiresAt <= nowEpochSeconds
      ) return null;
      return { actorId: payload.actorId, roles: payload.roles, assuranceLevel: 2 };
    } catch {
      return null;
    }
  }

  localViewerSession(): string {
    return this.issue({ actorId: "local-admin-viewer", roles: ["ADMIN_VIEWER"], assuranceLevel: 2 });
  }

  async resolve(headers: { cookie?: string }): Promise<AdminIdentity | null> {
    return this.verifyCookie(headers.cookie);
  }
  issueLocalViewer(): string { return this.localViewerSession(); }

  private sign(encodedPayload: string): string {
    return createHmac("sha256", this.signingKey).update(encodedPayload).digest("base64url");
  }

  private matches(encodedPayload: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(encodedPayload));
    const supplied = Buffer.from(signature);
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  }
}

/**
 * Future Supabase/Google integration is deliberately two-stage: cryptographic
 * token verification first, then a server-side membership/role lookup.  A
 * bearer value and its claims can never elevate an Admin role by themselves.
 */
export class CompositeAdminIdentityAuthority implements AdminIdentityAuthority {
  constructor(
    private readonly local: LocalAdminSessionAuthority | undefined,
    private readonly verifier: ExternalAdminTokenVerifier | undefined,
    private readonly memberships: AdminMembershipResolver | undefined,
  ) {}
  async resolve(headers: { cookie?: string; authorization?: string }): Promise<AdminIdentity | null> {
    const local = this.local ? await this.local.resolve(headers) : null;
    if (local) return local;
    const accessToken = headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!accessToken || !this.verifier || !this.memberships) return null;
    const verified = await this.verifier.verifyAccessToken(accessToken);
    if (!verified || verified.assuranceLevel !== 2) return null;
    const roles = await this.memberships.resolve(verified.subject);
    return roles.length ? { actorId: verified.subject, roles, assuranceLevel: 2 } : null;
  }
  issueLocalViewer(): string {
    if (!this.local) throw new Error("local_admin_session_disabled");
    return this.local.localViewerSession();
  }
}
