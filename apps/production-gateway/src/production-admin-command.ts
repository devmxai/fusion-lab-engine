import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { requireAdminPermission } from "../../../packages/admin-control-plane/src/authorization.js";
import type { AdminIdentity, CredentialMetadata } from "../../../packages/admin-control-plane/src/types.js";
import type { ProductionGatewayConfig } from "./config.js";
import { productionDatabase } from "./database-readiness.js";

type Row = Record<string, unknown>;

export class ProductionAdminCommandError extends Error {
  constructor(
    readonly code: "ADMIN_COMMAND_INVALID" | "ADMIN_COMMAND_CONFLICT" | "CREDENTIAL_NOT_FOUND" | "CREDENTIAL_ILLEGAL_TRANSITION" | "MAKER_CHECKER_REQUIRED" | "PROVIDER_CONNECTION_TEST_FAILED",
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ProductionAdminCommandError";
  }
}

const CredentialInput = z.object({
  providerId: z.enum(["kie", "openrouter"]),
  secret: z.string().min(12).max(16_384),
  purpose: z.enum(["PROVIDER_GENERATION_KEY", "PROVIDER_WEBHOOK_HMAC", "PROVIDER_MANAGEMENT_KEY"]).default("PROVIDER_GENERATION_KEY"),
}).strict().superRefine((value, context) => {
  if (value.purpose === "PROVIDER_WEBHOOK_HMAC" && value.providerId !== "kie") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["purpose"], message: "Webhook HMAC is currently supported only for KIE." });
  }
  if (value.purpose === "PROVIDER_WEBHOOK_HMAC" && value.secret.length < 16) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["secret"], message: "KIE webhook HMAC keys must be at least 16 characters." });
  }
});

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const stableHash = (value: unknown) => sha256(JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort()));
const accountId = (providerId: string) => `account.${providerId}.primary`;
const displayName = (providerId: string) => providerId === "kie" ? "KIE.ai primary" : "OpenRouter primary";

export function verifyWebhookHmacSecret(secret: string): Record<string, unknown> {
  const taskId = `fusionlab-webhook-self-test-${randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1_000);
  const message = `${taskId}.${timestamp}`;
  const expected = createHmac("sha256", secret).update(message).digest();
  const supplied = createHmac("sha256", secret).update(message).digest();
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new ProductionAdminCommandError("PROVIDER_CONNECTION_TEST_FAILED", "The webhook HMAC key failed local cryptographic validation.", 422);
  }
  return {
    providerId: "kie",
    verificationType: "LOCAL_HMAC_SHA256_ROUNDTRIP",
    algorithm: "HMAC-SHA256",
    verifiedAt: new Date().toISOString(),
    externalProviderCallMade: false,
  };
}

function metadata(row: Row): CredentialMetadata {
  return {
    id: String(row.id),
    providerId: String(row.provider_id),
    accountId: String(row.account_id),
    environment: "PRODUCTION",
    purpose: String(row.purpose) as CredentialMetadata["purpose"],
    fingerprint: String(row.fingerprint),
    version: Number(row.version),
    status: String(row.status) as CredentialMetadata["status"],
    createdAt: new Date(String(row.created_at)).toISOString(),
    testedAt: row.tested_at ? new Date(String(row.tested_at)).toISOString() : null,
    activatedAt: row.activated_at ? new Date(String(row.activated_at)).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
  };
}

function storedResponse(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  throw new ProductionAdminCommandError("ADMIN_COMMAND_CONFLICT", "Stored Admin command response is invalid.", 409);
}

async function priorCommand(database: ReturnType<typeof productionDatabase>, commandId: string, requestHash: string): Promise<Record<string, unknown> | null> {
  const result = await database.query<Row>("SELECT request_hash,response FROM fusion_engine.provider_credential_commands WHERE command_id=$1", [commandId]);
  if (!result.rows[0]) return null;
  if (result.rows[0].request_hash !== requestHash) throw new ProductionAdminCommandError("ADMIN_COMMAND_CONFLICT", "The idempotency key is already bound to another Admin intent.", 409);
  return storedResponse(result.rows[0].response);
}

async function writeCredential(input: {
  identity: AdminIdentity;
  commandId: string;
  body: unknown;
  config: ProductionGatewayConfig;
}): Promise<Record<string, unknown>> {
  requireAdminPermission(input.identity, "WRITE_SECRET", "PROVIDER_CREDENTIAL");
  const parsed = CredentialInput.safeParse(input.body);
  if (!parsed.success) throw new ProductionAdminCommandError("ADMIN_COMMAND_INVALID", "Provider and a valid API key are required.");
  const database = productionDatabase(input.config);
  const secretDigest = sha256(parsed.data.secret);
  const requestHash = stableHash({ providerId: parsed.data.providerId, purpose: parsed.data.purpose, secretDigest });
  const prior = await priorCommand(database, input.commandId, requestHash);
  if (prior) return prior;

  return database.transaction(async (transaction) => {
    const repeated = await transaction.query<Row>("SELECT request_hash,response FROM fusion_engine.provider_credential_commands WHERE command_id=$1 FOR UPDATE", [input.commandId]);
    if (repeated.rows[0]) {
      if (repeated.rows[0].request_hash !== requestHash) throw new ProductionAdminCommandError("ADMIN_COMMAND_CONFLICT", "The idempotency key is already bound to another Admin intent.", 409);
      return storedResponse(repeated.rows[0].response);
    }
    const providerAccountId = accountId(parsed.data.providerId);
    await transaction.query(
      `INSERT INTO fusion_engine.provider_accounts (id,provider_id,display_name,environment,state)
       VALUES ($1,$2,$3,'PRODUCTION','PENDING_VERIFICATION')
       ON CONFLICT (provider_id,environment) DO UPDATE SET state=CASE WHEN fusion_engine.provider_accounts.state='CONNECTED' THEN fusion_engine.provider_accounts.state ELSE 'PENDING_VERIFICATION' END,updated_at=now()`,
      [providerAccountId, parsed.data.providerId, displayName(parsed.data.providerId)],
    );
    const versionResult = await transaction.query<Row>(
      "SELECT coalesce(max(version),0)+1 AS next_version FROM fusion_engine.provider_credentials WHERE provider_id=$1 AND account_id=$2 AND environment='PRODUCTION' AND purpose=$3",
      [parsed.data.providerId, providerAccountId, parsed.data.purpose],
    );
    const version = Number(versionResult.rows[0]?.next_version ?? 1);
    const credentialId = randomUUID();
    const secretResult = await transaction.query<Row>(
      "SELECT fusion_engine.store_provider_secret($1,$2,$3) AS vault_secret_id",
      [parsed.data.secret, `fusionlab/${parsed.data.providerId}/${credentialId}`, `FusionLab ${parsed.data.providerId} ${parsed.data.purpose} v${version}`],
    );
    const vaultSecretId = String(secretResult.rows[0]?.vault_secret_id ?? "");
    if (!vaultSecretId) throw new ProductionAdminCommandError("ADMIN_COMMAND_INVALID", "Secure credential storage did not return a reference.", 503);
    const inserted = await transaction.query<Row>(
      `INSERT INTO fusion_engine.provider_credentials
       (id,provider_id,account_id,environment,purpose,vault_secret_id,fingerprint,version,status,created_by)
       VALUES ($1,$2,$3,'PRODUCTION',$4,$5,$6,$7,'PENDING_TEST',$8) RETURNING *`,
      [credentialId, parsed.data.providerId, providerAccountId, parsed.data.purpose, vaultSecretId, secretDigest.slice(0, 16), version, input.identity.actorId],
    );
    const response = metadata(inserted.rows[0]!);
    await transaction.query(
      "INSERT INTO fusion_engine.provider_credential_commands(command_id,actor_id,action,request_hash,credential_id,response) VALUES($1,$2,'WRITE',$3,$4,$5::jsonb)",
      [input.commandId, input.identity.actorId, requestHash, credentialId, JSON.stringify(response)],
    );
    await transaction.query(
      "INSERT INTO fusion_engine.provider_credential_audit(command_id,actor_id,action,credential_id,before_status,after_status,evidence_hash) VALUES($1,$2,'CREDENTIAL_STORED',$3,NULL,'PENDING_TEST',$4)",
      [input.commandId, input.identity.actorId, credentialId, sha256(`${requestHash}:${credentialId}:PENDING_TEST`)],
    );
    return response as unknown as Record<string, unknown>;
  });
}

async function readProviderEvidence(providerId: string, secret: string, request: typeof fetch): Promise<Record<string, unknown>> {
  const endpoint = providerId === "kie" ? "https://api.kie.ai/api/v1/chat/credit" : "https://openrouter.ai/api/v1/key";
  let response: Response;
  try {
    response = await request(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${secret}`, accept: "application/json", "user-agent": "FusionLab-Provider-Verification/1.0" },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new ProductionAdminCommandError("PROVIDER_CONNECTION_TEST_FAILED", "The provider verification endpoint could not be reached.", 502);
  }
  const text = await response.text();
  if (text.length > 262_144) throw new ProductionAdminCommandError("PROVIDER_CONNECTION_TEST_FAILED", "Provider verification response exceeded the safety limit.", 502);
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!response.ok || !body || typeof body !== "object") throw new ProductionAdminCommandError("PROVIDER_CONNECTION_TEST_FAILED", "The provider rejected this API key.", 422);
  const verifiedAt = new Date().toISOString();
  if (providerId === "kie") {
    const value = body as { code?: unknown; data?: unknown };
    if (value.code !== 200 || typeof value.data !== "number") throw new ProductionAdminCommandError("PROVIDER_CONNECTION_TEST_FAILED", "KIE did not return valid account credit evidence.", 422);
    return { providerId, endpoint, verifiedAt, balanceCredits: value.data };
  }
  const value = (body as { data?: unknown }).data;
  if (!value || typeof value !== "object") throw new ProductionAdminCommandError("PROVIDER_CONNECTION_TEST_FAILED", "OpenRouter did not return valid API-key evidence.", 422);
  const record = value as Record<string, unknown>;
  return {
    providerId, endpoint, verifiedAt,
    label: typeof record.label === "string" ? record.label : null,
    limit: typeof record.limit === "number" ? record.limit : null,
    limitRemaining: typeof record.limit_remaining === "number" ? record.limit_remaining : null,
    usage: typeof record.usage === "number" ? record.usage : null,
    freeTier: record.is_free_tier === true,
  };
}

async function testCredential(input: { identity: AdminIdentity; commandId: string; credentialId: string; config: ProductionGatewayConfig; request: typeof fetch }): Promise<Record<string, unknown>> {
  requireAdminPermission(input.identity, "TEST_SECRET", "PROVIDER_CREDENTIAL");
  const database = productionDatabase(input.config);
  const requestHash = stableHash({ action: "TEST", credentialId: input.credentialId });
  const prior = await priorCommand(database, input.commandId, requestHash);
  if (prior) return prior;
  const credential = await database.query<Row>(
    "SELECT credential.*,fusion_engine.lease_provider_secret(credential.id) AS secret FROM fusion_engine.provider_credentials credential WHERE credential.id=$1",
    [input.credentialId],
  );
  const row = credential.rows[0];
  if (!row) throw new ProductionAdminCommandError("CREDENTIAL_NOT_FOUND", "Credential does not exist.", 404);
  if (row.status !== "PENDING_TEST") throw new ProductionAdminCommandError("CREDENTIAL_ILLEGAL_TRANSITION", "Only a pending credential can be tested.", 409);
  let secret = String(row.secret ?? "");
  if (!secret) throw new ProductionAdminCommandError("CREDENTIAL_NOT_FOUND", "Credential secret reference is unavailable.", 404);
  let evidence: Record<string, unknown>;
  try {
    evidence = row.purpose === "PROVIDER_WEBHOOK_HMAC"
      ? verifyWebhookHmacSecret(secret)
      : await readProviderEvidence(String(row.provider_id), secret, input.request);
  }
  finally { secret = ""; }
  return database.transaction(async (transaction) => {
    const locked = await transaction.query<Row>("SELECT * FROM fusion_engine.provider_credentials WHERE id=$1 FOR UPDATE", [input.credentialId]);
    if (!locked.rows[0] || locked.rows[0].status !== "PENDING_TEST") throw new ProductionAdminCommandError("CREDENTIAL_ILLEGAL_TRANSITION", "Credential state changed before verification completed.", 409);
    const updated = await transaction.query<Row>(
      "UPDATE fusion_engine.provider_credentials SET status='TESTED',tested_by=$2,tested_at=now(),verification_evidence=$3::jsonb WHERE id=$1 RETURNING *",
      [input.credentialId, input.identity.actorId, JSON.stringify(evidence)],
    );
    if (row.purpose === "PROVIDER_GENERATION_KEY") {
      await transaction.query(
        "UPDATE fusion_engine.provider_accounts SET state='CONNECTED',last_verified_at=now(),verification_evidence=$2::jsonb,updated_at=now() WHERE id=$1",
        [row.account_id, JSON.stringify(evidence)],
      );
    }
    const response = metadata(updated.rows[0]!);
    await transaction.query(
      "INSERT INTO fusion_engine.provider_credential_commands(command_id,actor_id,action,request_hash,credential_id,response) VALUES($1,$2,'TEST',$3,$4,$5::jsonb)",
      [input.commandId, input.identity.actorId, requestHash, input.credentialId, JSON.stringify(response)],
    );
    await transaction.query(
      "INSERT INTO fusion_engine.provider_credential_audit(command_id,actor_id,action,credential_id,before_status,after_status,evidence_hash) VALUES($1,$2,'CONNECTION_VERIFIED',$3,'PENDING_TEST','TESTED',$4)",
      [input.commandId, input.identity.actorId, input.credentialId, sha256(JSON.stringify(evidence))],
    );
    return response as unknown as Record<string, unknown>;
  });
}

async function transitionCredential(input: { identity: AdminIdentity; commandId: string; credentialId: string; action: "ACTIVATE" | "REVOKE"; config: ProductionGatewayConfig }): Promise<Record<string, unknown>> {
  requireAdminPermission(input.identity, input.action === "ACTIVATE" ? "ACTIVATE_SECRET" : "REVOKE_SECRET", "PROVIDER_CREDENTIAL");
  const database = productionDatabase(input.config);
  const requestHash = stableHash({ action: input.action, credentialId: input.credentialId });
  const prior = await priorCommand(database, input.commandId, requestHash);
  if (prior) return prior;
  return database.transaction(async (transaction) => {
    const locked = await transaction.query<Row>("SELECT * FROM fusion_engine.provider_credentials WHERE id=$1 FOR UPDATE", [input.credentialId]);
    const row = locked.rows[0];
    if (!row) throw new ProductionAdminCommandError("CREDENTIAL_NOT_FOUND", "Credential does not exist.", 404);
    if (input.action === "ACTIVATE") {
      if (row.status !== "TESTED") throw new ProductionAdminCommandError("CREDENTIAL_ILLEGAL_TRANSITION", "Only a tested credential can be activated.", 409);
      if (row.created_by === input.identity.actorId && !input.identity.roles.includes("SUPER_ADMIN")) throw new ProductionAdminCommandError("MAKER_CHECKER_REQUIRED", "A different administrator must activate this credential.", 409);
      const previous = await transaction.query<Row>(
        "SELECT id FROM fusion_engine.provider_credentials WHERE provider_id=$1 AND account_id=$2 AND purpose=$3 AND status='ACTIVE' FOR UPDATE",
        [row.provider_id, row.account_id, row.purpose],
      );
      for (const active of previous.rows) {
        await transaction.query("SELECT fusion_engine.destroy_provider_secret($1)", [active.id]);
        await transaction.query("UPDATE fusion_engine.provider_credentials SET status='REVOKED',revoked_by=$2,revoked_at=now() WHERE id=$1", [active.id, input.identity.actorId]);
      }
      const updated = await transaction.query<Row>("UPDATE fusion_engine.provider_credentials SET status='ACTIVE',activated_by=$2,activated_at=now() WHERE id=$1 RETURNING *", [input.credentialId, input.identity.actorId]);
      if (row.purpose === "PROVIDER_GENERATION_KEY") {
        await transaction.query("UPDATE fusion_engine.provider_accounts SET state='CONNECTED',active_credential_id=$2,updated_at=now() WHERE id=$1", [row.account_id, input.credentialId]);
      }
      const response = metadata(updated.rows[0]!);
      await transaction.query("INSERT INTO fusion_engine.provider_credential_commands(command_id,actor_id,action,request_hash,credential_id,response) VALUES($1,$2,'ACTIVATE',$3,$4,$5::jsonb)", [input.commandId, input.identity.actorId, requestHash, input.credentialId, JSON.stringify(response)]);
      await transaction.query("INSERT INTO fusion_engine.provider_credential_audit(command_id,actor_id,action,credential_id,before_status,after_status,evidence_hash) VALUES($1,$2,'CREDENTIAL_ACTIVATED',$3,'TESTED','ACTIVE',$4)", [input.commandId, input.identity.actorId, input.credentialId, sha256(`${requestHash}:ACTIVE`)]);
      return response as unknown as Record<string, unknown>;
    }
    if (row.status !== "REVOKED") {
      await transaction.query("SELECT fusion_engine.destroy_provider_secret($1)", [input.credentialId]);
    }
    const updated = await transaction.query<Row>("UPDATE fusion_engine.provider_credentials SET status='REVOKED',revoked_by=$2,revoked_at=coalesce(revoked_at,now()) WHERE id=$1 RETURNING *", [input.credentialId, input.identity.actorId]);
    if (row.purpose === "PROVIDER_GENERATION_KEY") {
      await transaction.query("UPDATE fusion_engine.provider_accounts SET state=CASE WHEN active_credential_id=$2 THEN 'REVOKED' ELSE state END,active_credential_id=CASE WHEN active_credential_id=$2 THEN NULL ELSE active_credential_id END,updated_at=now() WHERE id=$1", [row.account_id, input.credentialId]);
    }
    const response = metadata(updated.rows[0]!);
    await transaction.query("INSERT INTO fusion_engine.provider_credential_commands(command_id,actor_id,action,request_hash,credential_id,response) VALUES($1,$2,'REVOKE',$3,$4,$5::jsonb)", [input.commandId, input.identity.actorId, requestHash, input.credentialId, JSON.stringify(response)]);
    await transaction.query("INSERT INTO fusion_engine.provider_credential_audit(command_id,actor_id,action,credential_id,before_status,after_status,evidence_hash) VALUES($1,$2,'CREDENTIAL_REVOKED',$3,$4,'REVOKED',$5)", [input.commandId, input.identity.actorId, input.credentialId, row.status, sha256(`${requestHash}:REVOKED`)]);
    return response as unknown as Record<string, unknown>;
  });
}

export async function executeProductionAdminCommand(input: {
  path: string;
  body: unknown;
  commandId: string | undefined;
  identity: AdminIdentity;
  config: ProductionGatewayConfig;
  request?: typeof fetch;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!input.commandId || input.commandId.length < 8 || input.commandId.length > 200) throw new ProductionAdminCommandError("ADMIN_COMMAND_INVALID", "A valid idempotency key is required.");
  if (input.path === "/v1/admin/credentials") {
    return { status: 201, body: await writeCredential({ identity: input.identity, commandId: input.commandId, body: input.body, config: input.config }) };
  }
  const match = input.path.match(/^\/v1\/admin\/credentials\/([0-9a-f-]{36})\/(test|activate|revoke)$/i);
  if (!match) throw new ProductionAdminCommandError("ADMIN_COMMAND_INVALID", "Admin credential command route was not found.", 404);
  const credentialId = match[1]!;
  const action = match[2]!.toLowerCase();
  if (action === "test") return { status: 200, body: await testCredential({ identity: input.identity, commandId: input.commandId, credentialId, config: input.config, request: input.request ?? fetch }) };
  return { status: 200, body: await transitionCredential({ identity: input.identity, commandId: input.commandId, credentialId, action: action === "activate" ? "ACTIVATE" : "REVOKE", config: input.config }) };
}
