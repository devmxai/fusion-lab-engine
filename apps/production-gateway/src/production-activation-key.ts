import { createHash, createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AdminIdentity } from "../../../packages/admin-control-plane/src/types.js";
import type { ProductionGatewayConfig } from "./config.js";
import { productionDatabase } from "./database-readiness.js";

type Row = Record<string, unknown>;

const GenerateSchema = z.object({
  planVersionId: z.string().trim().min(3).max(100),
  expiresInDays: z.number().int().min(1).max(365).default(30),
});
const RedeemSchema = z.object({ activationKey: z.string().trim().min(50).max(180) });

export class ProductionActivationKeyError extends Error {
  constructor(
    readonly code:
      | "ACTIVATION_KEY_CONFIGURATION_REQUIRED" | "ACTIVATION_KEY_COMMAND_INVALID" | "ACTIVATION_KEY_PERMISSION_DENIED"
      | "ACTIVATION_KEY_PLAN_UNAVAILABLE" | "ACTIVATION_KEY_INVALID" | "ACTIVATION_KEY_EXPIRED"
      | "ACTIVATION_KEY_REDEEMED" | "ACTIVATION_KEY_REVOKED" | "ACTIVE_SUBSCRIPTION_EXISTS" | "ACTIVATION_KEY_COMMAND_CONFLICT",
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ProductionActivationKeyError";
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const storedResponse = (value: unknown): Record<string, unknown> => {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  throw new ProductionActivationKeyError("ACTIVATION_KEY_COMMAND_CONFLICT", "Stored activation response is invalid.", 409);
};

function requireSecret(config: ProductionGatewayConfig): string {
  if (!config.SUBSCRIPTION_ACTIVATION_SECRET) {
    throw new ProductionActivationKeyError("ACTIVATION_KEY_CONFIGURATION_REQUIRED", "Subscription activation is not configured.", 503);
  }
  return config.SUBSCRIPTION_ACTIVATION_SECRET;
}

function requireCommand(commandId: string | undefined) {
  if (!commandId || commandId.length < 8 || commandId.length > 200) {
    throw new ProductionActivationKeyError("ACTIVATION_KEY_COMMAND_INVALID", "A valid idempotency key is required.");
  }
}

function activationKeyValue(secret: string, commandId: string, keyId: string) {
  const token = createHmac("sha256", secret).update(`fusionlab-subscription-key:${commandId}`).digest("base64url");
  return `FLK-${keyId.replaceAll("-", "").toUpperCase()}-${token}`;
}

function keyHint(value: string) {
  return `${value.slice(0, 12)}…${value.slice(-6)}`;
}

function addCalendarPeriod(start: Date, interval: string): Date {
  const end = new Date(start);
  const originalDay = end.getUTCDate();
  end.setUTCDate(1);
  if (interval === "YEAR") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(originalDay, lastDay));
  return end;
}

export async function generateSubscriptionActivationKey(input: {
  commandId: string | undefined;
  identity: AdminIdentity;
  config: ProductionGatewayConfig;
  body: unknown;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  requireCommand(input.commandId);
  if (!input.identity.actorId || !input.identity.roles.includes("SUPER_ADMIN")) {
    throw new ProductionActivationKeyError("ACTIVATION_KEY_PERMISSION_DENIED", "Super Admin membership is required.", 403);
  }
  const secret = requireSecret(input.config);
  const parsed = GenerateSchema.safeParse(input.body);
  if (!parsed.success) throw new ProductionActivationKeyError("ACTIVATION_KEY_COMMAND_INVALID", "Activation-key fields are invalid.");
  const requestHash = sha256(JSON.stringify({ action: "GENERATE_ACTIVATION_KEY", ...parsed.data }));
  const database = productionDatabase(input.config);
  return database.transaction(async (transaction) => {
    await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`activation-admin:${input.commandId}`]);
    const prior = await transaction.query<Row>("SELECT request_hash,response FROM fusion_engine.subscription_activation_admin_commands WHERE command_id=$1", [input.commandId]);
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash) throw new ProductionActivationKeyError("ACTIVATION_KEY_COMMAND_CONFLICT", "The idempotency key is bound to another activation-key intent.", 409);
      const response = storedResponse(prior.rows[0].response);
      return { status: 200, body: { ...response, activationKey: activationKeyValue(secret, input.commandId!, String(response.keyId)), replayed: true } };
    }
    const planResult = await transaction.query<Row>(
      `SELECT plan.id,plan.plan_key,plan.display_name,plan.billing_interval,plan.credits_per_period
       FROM fusion_engine.subscription_plan_versions plan
       JOIN fusion_engine.subscription_plan_pointers pointer ON pointer.plan_key=plan.plan_key AND pointer.current_plan_version_id=plan.id
       WHERE plan.id=$1 AND pointer.state='PUBLISHED'`,
      [parsed.data.planVersionId],
    );
    const plan = planResult.rows[0];
    if (!plan) throw new ProductionActivationKeyError("ACTIVATION_KEY_PLAN_UNAVAILABLE", "Choose a currently published plan version.", 409);
    const keyId = randomUUID();
    const activationKey = activationKeyValue(secret, input.commandId!, keyId);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + parsed.data.expiresInDays * 86_400_000);
    await transaction.query(
      `INSERT INTO fusion_engine.subscription_activation_keys
       (id,key_hash,key_hint,plan_version_id,state,expires_at,created_by,created_at)
       VALUES($1,$2,$3,$4,'ISSUED',$5,$6,$7)`,
      [keyId, sha256(activationKey), keyHint(activationKey), parsed.data.planVersionId, expiresAt.toISOString(), input.identity.actorId, createdAt.toISOString()],
    );
    const response = {
      keyId, keyHint: keyHint(activationKey), planVersionId: String(plan.id), planKey: String(plan.plan_key),
      displayName: String(plan.display_name), interval: String(plan.billing_interval), creditsPerPeriod: Number(plan.credits_per_period),
      state: "ISSUED", createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(), replayed: false,
    };
    await transaction.query(
      `INSERT INTO fusion_engine.subscription_activation_admin_commands(command_id,actor_id,action,key_id,request_hash,response)
       VALUES($1,$2,'GENERATE_ACTIVATION_KEY',$3,$4,$5::jsonb)`,
      [input.commandId, input.identity.actorId, keyId, requestHash, JSON.stringify(response)],
    );
    await transaction.query(
      `INSERT INTO fusion_engine.subscription_activation_audit(action,actor_id,key_id,plan_version_id,evidence_hash,occurred_at)
       VALUES('ISSUED',$1,$2,$3,$4,$5)`,
      [input.identity.actorId, keyId, parsed.data.planVersionId, sha256(JSON.stringify(response)), createdAt.toISOString()],
    );
    return { status: 201, body: { ...response, activationKey } };
  });
}

export async function revokeSubscriptionActivationKey(input: {
  commandId: string | undefined;
  identity: AdminIdentity;
  config: ProductionGatewayConfig;
  keyId: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  requireCommand(input.commandId);
  if (!input.identity.actorId || !input.identity.roles.includes("SUPER_ADMIN")) throw new ProductionActivationKeyError("ACTIVATION_KEY_PERMISSION_DENIED", "Super Admin membership is required.", 403);
  if (!z.string().uuid().safeParse(input.keyId).success) throw new ProductionActivationKeyError("ACTIVATION_KEY_COMMAND_INVALID", "Activation key ID is invalid.");
  const requestHash = sha256(JSON.stringify({ action: "REVOKE_ACTIVATION_KEY", keyId: input.keyId }));
  const database = productionDatabase(input.config);
  return database.transaction(async (transaction) => {
    await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`activation-admin:${input.commandId}`]);
    const prior = await transaction.query<Row>("SELECT request_hash,response FROM fusion_engine.subscription_activation_admin_commands WHERE command_id=$1", [input.commandId]);
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash) throw new ProductionActivationKeyError("ACTIVATION_KEY_COMMAND_CONFLICT", "The idempotency key is bound to another activation-key intent.", 409);
      return { status: 200, body: { ...storedResponse(prior.rows[0].response), replayed: true } };
    }
    const now = new Date().toISOString();
    const key = await transaction.query<Row>(
      `UPDATE fusion_engine.subscription_activation_keys SET state='REVOKED',revoked_by=$2,revoked_at=$3
       WHERE id=$1 AND state='ISSUED' RETURNING id,key_hint,plan_version_id,expires_at`,
      [input.keyId, input.identity.actorId, now],
    );
    if (!key.rows[0]) throw new ProductionActivationKeyError("ACTIVATION_KEY_REDEEMED", "Only an unused activation key can be revoked.", 409);
    const row = key.rows[0];
    const response = { keyId: input.keyId, keyHint: String(row.key_hint), planVersionId: String(row.plan_version_id), state: "REVOKED", revokedAt: now, replayed: false };
    await transaction.query(
      `INSERT INTO fusion_engine.subscription_activation_admin_commands(command_id,actor_id,action,key_id,request_hash,response)
       VALUES($1,$2,'REVOKE_ACTIVATION_KEY',$3,$4,$5::jsonb)`,
      [input.commandId, input.identity.actorId, input.keyId, requestHash, JSON.stringify(response)],
    );
    await transaction.query(
      `INSERT INTO fusion_engine.subscription_activation_audit(action,actor_id,key_id,plan_version_id,evidence_hash,occurred_at)
       VALUES('REVOKED',$1,$2,$3,$4,$5)`,
      [input.identity.actorId, input.keyId, row.plan_version_id, sha256(JSON.stringify(response)), now],
    );
    return { status: 200, body: response };
  });
}

export async function redeemSubscriptionActivationKey(input: {
  commandId: string | undefined;
  ownerId: string;
  config: ProductionGatewayConfig;
  body: unknown;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  requireCommand(input.commandId);
  requireSecret(input.config);
  const parsed = RedeemSchema.safeParse(input.body);
  if (!parsed.success) throw new ProductionActivationKeyError("ACTIVATION_KEY_COMMAND_INVALID", "Enter a valid subscription activation key.");
  const keyHash = sha256(parsed.data.activationKey);
  const requestHash = sha256(JSON.stringify({ action: "REDEEM_ACTIVATION_KEY", ownerId: input.ownerId, keyHash }));
  const database = productionDatabase(input.config);
  return database.transaction(async (transaction) => {
    await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`activation-redeem:${input.commandId}`]);
    await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`subscription-owner:${input.ownerId}`]);
    const prior = await transaction.query<Row>("SELECT request_hash,response FROM fusion_engine.subscription_activation_redemptions WHERE command_id=$1", [input.commandId]);
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash) throw new ProductionActivationKeyError("ACTIVATION_KEY_COMMAND_CONFLICT", "The idempotency key is bound to another activation intent.", 409);
      return { status: 200, body: { ...storedResponse(prior.rows[0].response), replayed: true } };
    }
    const keyResult = await transaction.query<Row>(
      `SELECT activation.*,plan.plan_key,plan.display_name,plan.billing_interval,plan.credits_per_period,
        coalesce(pointer.state,plan.lifecycle) AS plan_state
       FROM fusion_engine.subscription_activation_keys activation
       JOIN fusion_engine.subscription_plan_versions plan ON plan.id=activation.plan_version_id
       LEFT JOIN fusion_engine.subscription_plan_pointers pointer ON pointer.plan_key=plan.plan_key
       WHERE activation.key_hash=$1 FOR UPDATE OF activation`,
      [keyHash],
    );
    const key = keyResult.rows[0];
    if (!key) throw new ProductionActivationKeyError("ACTIVATION_KEY_INVALID", "The activation key is invalid.", 404);
    if (key.state === "REVOKED") throw new ProductionActivationKeyError("ACTIVATION_KEY_REVOKED", "The activation key was revoked.", 409);
    if (key.state === "REDEEMED") throw new ProductionActivationKeyError("ACTIVATION_KEY_REDEEMED", key.redeemed_by === input.ownerId ? "This activation key was already used on your account." : "The activation key was already used.", 409);
    if (new Date(String(key.expires_at)).getTime() <= Date.now()) throw new ProductionActivationKeyError("ACTIVATION_KEY_EXPIRED", "The activation key has expired.", 409);
    if (key.plan_state !== "PUBLISHED") throw new ProductionActivationKeyError("ACTIVATION_KEY_PLAN_UNAVAILABLE", "The plan linked to this key is no longer available.", 409);
    const now = new Date();
    await transaction.query("UPDATE fusion_engine.subscriptions SET state='EXPIRED',updated_at=$2 WHERE owner_id=$1 AND state='ACTIVE' AND current_period_end<=$2", [input.ownerId, now.toISOString()]);
    const active = await transaction.query<Row>("SELECT id FROM fusion_engine.subscriptions WHERE owner_id=$1 AND state='ACTIVE'", [input.ownerId]);
    if (active.rows[0]) throw new ProductionActivationKeyError("ACTIVE_SUBSCRIPTION_EXISTS", "Your current subscription must end before another activation key can be used.", 409);
    const subscriptionId = randomUUID();
    const periodId = randomUUID();
    const journalId = randomUUID();
    const periodEnd = addCalendarPeriod(now, String(key.billing_interval));
    const credits = Number(key.credits_per_period);
    await transaction.query(
      `INSERT INTO fusion_engine.subscriptions(id,owner_id,plan_version_id,state,current_period_start,current_period_end,activated_by,created_at,updated_at)
       VALUES($1,$2,$3,'ACTIVE',$4,$5,$6,$4,$4)`,
      [subscriptionId, input.ownerId, key.plan_version_id, now.toISOString(), periodEnd.toISOString(), `activation-key:${String(key.id)}`],
    );
    await transaction.query(
      "INSERT INTO fusion_engine.ledger_journals(id,command_id,kind,operation_id,reason_code,created_at) VALUES($1,$2,'GRANT',NULL,'SUBSCRIPTION_KEY_REDEMPTION',$3)",
      [journalId, `subscription-key:${String(key.id)}`, now.toISOString()],
    );
    await transaction.query("INSERT INTO fusion_engine.wallets(owner_id,available_credits,updated_at) VALUES($1,0,$2) ON CONFLICT(owner_id) DO NOTHING", [input.ownerId, now.toISOString()]);
    const wallet = await transaction.query<Row>(
      `UPDATE fusion_engine.wallets SET available_credits=available_credits+$2::bigint,version=version+1,updated_at=$3
       WHERE owner_id=$1 RETURNING available_credits,held_credits,spent_credits,version,updated_at`,
      [input.ownerId, credits, now.toISOString()],
    );
    await transaction.query(
      `INSERT INTO fusion_engine.ledger_entries(journal_id,account_id,amount,created_at)
       VALUES($1,'platform:issued',-($2::bigint),$4),($1,$3,$2::bigint,$4)`,
      [journalId, credits, `owner:${input.ownerId}:available`, now.toISOString()],
    );
    await transaction.query(
      `INSERT INTO fusion_engine.subscription_periods(id,subscription_id,period_number,starts_at,ends_at,granted_credits,grant_journal_id,created_at)
       VALUES($1,$2,1,$3,$4,$5,$6,$3)`,
      [periodId, subscriptionId, now.toISOString(), periodEnd.toISOString(), credits, journalId],
    );
    await transaction.query(
      `UPDATE fusion_engine.subscription_activation_keys SET state='REDEEMED',redeemed_by=$2,redeemed_at=$3,subscription_id=$4
       WHERE id=$1 AND state='ISSUED'`,
      [key.id, input.ownerId, now.toISOString(), subscriptionId],
    );
    const walletRow = wallet.rows[0]!;
    const response = {
      subscriptionId, planVersionId: String(key.plan_version_id), planKey: String(key.plan_key), displayName: String(key.display_name),
      interval: String(key.billing_interval), state: "ACTIVE", currentPeriodStart: now.toISOString(), currentPeriodEnd: periodEnd.toISOString(),
      creditsGranted: credits, wallet: { availableCredits: Number(walletRow.available_credits), heldCredits: Number(walletRow.held_credits), spentCredits: Number(walletRow.spent_credits) }, replayed: false,
    };
    await transaction.query(
      `INSERT INTO fusion_engine.subscription_activation_redemptions(command_id,owner_id,key_id,request_hash,subscription_id,response)
       VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
      [input.commandId, input.ownerId, key.id, requestHash, subscriptionId, JSON.stringify(response)],
    );
    await transaction.query(
      `INSERT INTO fusion_engine.subscription_activation_audit(action,actor_id,key_id,plan_version_id,owner_id,subscription_id,evidence_hash,occurred_at)
       VALUES('REDEEMED',$1,$2,$3,$1,$4,$5,$6)`,
      [input.ownerId, key.id, key.plan_version_id, subscriptionId, sha256(JSON.stringify(response)), now.toISOString()],
    );
    return { status: 201, body: response };
  });
}

export async function readProductionCustomerAccount(ownerId: string, config: ProductionGatewayConfig) {
  const database = productionDatabase(config);
  const [wallet, subscription] = await Promise.all([
    database.query<Row>("SELECT available_credits,held_credits,spent_credits,updated_at FROM fusion_engine.wallets WHERE owner_id=$1", [ownerId]),
    database.query<Row>(`SELECT subscription.id,subscription.state,subscription.current_period_start,subscription.current_period_end,
      plan.id AS plan_version_id,plan.plan_key,plan.display_name,plan.billing_interval,plan.credits_per_period
      FROM fusion_engine.subscriptions subscription JOIN fusion_engine.subscription_plan_versions plan ON plan.id=subscription.plan_version_id
      WHERE subscription.owner_id=$1 ORDER BY (subscription.state='ACTIVE') DESC,subscription.created_at DESC LIMIT 1`, [ownerId]),
  ]);
  const walletRow = wallet.rows[0];
  const subscriptionRow = subscription.rows[0];
  return { status: 200, body: {
    ownerId,
    wallet: walletRow ? { availableCredits: Number(walletRow.available_credits), heldCredits: Number(walletRow.held_credits), spentCredits: Number(walletRow.spent_credits), updatedAt: new Date(String(walletRow.updated_at)).toISOString() } : null,
    subscription: subscriptionRow ? { id: String(subscriptionRow.id), state: String(subscriptionRow.state), planVersionId: String(subscriptionRow.plan_version_id), planKey: String(subscriptionRow.plan_key), displayName: String(subscriptionRow.display_name), interval: String(subscriptionRow.billing_interval), creditsPerPeriod: Number(subscriptionRow.credits_per_period), currentPeriodStart: new Date(String(subscriptionRow.current_period_start)).toISOString(), currentPeriodEnd: new Date(String(subscriptionRow.current_period_end)).toISOString() } : null,
  } };
}
