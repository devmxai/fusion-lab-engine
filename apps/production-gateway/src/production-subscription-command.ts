import { createHash, randomUUID } from "node:crypto";
import type { AdminIdentity } from "../../../packages/admin-control-plane/src/types.js";
import type { ProductionGatewayConfig } from "./config.js";
import { productionDatabase } from "./database-readiness.js";

type Row = Record<string, unknown>;

export class ProductionSubscriptionCommandError extends Error {
  constructor(
    readonly code: "SUBSCRIPTION_COMMAND_INVALID" | "SUBSCRIPTION_COMMAND_CONFLICT" | "SUBSCRIPTION_PERMISSION_DENIED" | "SUBSCRIPTION_PLAN_UNAVAILABLE",
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ProductionSubscriptionCommandError";
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const PLAN_VERSION_ID = "starter-v1";

function responseValue(row: Row): Record<string, unknown> {
  const value = row.response;
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  throw new ProductionSubscriptionCommandError("SUBSCRIPTION_COMMAND_CONFLICT", "Stored subscription response is invalid.", 409);
}

export async function activateInternalStarterSubscription(input: {
  commandId: string | undefined;
  identity: AdminIdentity;
  config: ProductionGatewayConfig;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!input.commandId || input.commandId.length < 8 || input.commandId.length > 200) {
    throw new ProductionSubscriptionCommandError("SUBSCRIPTION_COMMAND_INVALID", "A valid idempotency key is required.");
  }
  // This narrow AAL1 exception is intentionally limited to the authenticated
  // Super Admin assigning the fixed, non-purchasable test plan to themselves.
  // It cannot target another owner or choose an arbitrary credit amount.
  if (!input.identity.actorId || !input.identity.roles.includes("SUPER_ADMIN")) {
    throw new ProductionSubscriptionCommandError("SUBSCRIPTION_PERMISSION_DENIED", "Super Admin membership is required.", 403);
  }

  const ownerId = input.identity.actorId;
  const requestHash = sha256(JSON.stringify({ action: "ACTIVATE_INTERNAL_STARTER", ownerId, planVersionId: PLAN_VERSION_ID }));
  const database = productionDatabase(input.config);

  return database.transaction(async (transaction) => {
    await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [input.commandId]);
    const prior = await transaction.query<Row>("SELECT request_hash,response FROM fusion_engine.subscription_commands WHERE command_id=$1", [input.commandId]);
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash) throw new ProductionSubscriptionCommandError("SUBSCRIPTION_COMMAND_CONFLICT", "The idempotency key is bound to another subscription intent.", 409);
      return { status: 200, body: responseValue(prior.rows[0]) };
    }

    const planResult = await transaction.query<Row>("SELECT * FROM fusion_engine.subscription_plan_versions WHERE id=$1 AND lifecycle='INTERNAL_TEST'", [PLAN_VERSION_ID]);
    const plan = planResult.rows[0];
    if (!plan) throw new ProductionSubscriptionCommandError("SUBSCRIPTION_PLAN_UNAVAILABLE", "The internal Starter plan is unavailable.", 503);

    const existing = await transaction.query<Row>(
      `SELECT s.*,w.available_credits,w.held_credits,w.spent_credits
       FROM fusion_engine.subscriptions s
       LEFT JOIN fusion_engine.wallets w ON w.owner_id=s.owner_id
       WHERE s.owner_id=$1 AND s.plan_version_id=$2`,
      [ownerId, PLAN_VERSION_ID],
    );
    if (existing.rows[0]) {
      const subscription = existing.rows[0];
      const response = {
        subscriptionId: String(subscription.id), ownerId, planVersionId: PLAN_VERSION_ID, planKey: "starter",
        displayName: String(plan.display_name), state: String(subscription.state),
        currentPeriodStart: new Date(String(subscription.current_period_start)).toISOString(),
        currentPeriodEnd: new Date(String(subscription.current_period_end)).toISOString(),
        creditsGranted: 0, alreadyAssigned: true,
        wallet: { availableCredits: Number(subscription.available_credits ?? 0), heldCredits: Number(subscription.held_credits ?? 0), spentCredits: Number(subscription.spent_credits ?? 0) },
      };
      await transaction.query(
        "INSERT INTO fusion_engine.subscription_commands(command_id,actor_id,action,request_hash,subscription_id,response) VALUES($1,$2,'ACTIVATE_INTERNAL_STARTER',$3,$4,$5::jsonb)",
        [input.commandId, ownerId, requestHash, subscription.id, JSON.stringify(response)],
      );
      return { status: 200, body: response };
    }

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setUTCDate(periodEnd.getUTCDate() + 30);
    const credits = Number(plan.credits_per_period);
    const subscriptionId = randomUUID();
    const periodId = randomUUID();
    const journalId = randomUUID();

    await transaction.query(
      "UPDATE fusion_engine.subscriptions SET state='EXPIRED',updated_at=$2 WHERE owner_id=$1 AND state='ACTIVE'",
      [ownerId, now.toISOString()],
    );
    await transaction.query(
      `INSERT INTO fusion_engine.subscriptions
       (id,owner_id,plan_version_id,state,current_period_start,current_period_end,activated_by,created_at,updated_at)
       VALUES($1,$2,$3,'ACTIVE',$4,$5,$2,$4,$4)`,
      [subscriptionId, ownerId, PLAN_VERSION_ID, now.toISOString(), periodEnd.toISOString()],
    );
    await transaction.query(
      "INSERT INTO fusion_engine.ledger_journals(id,command_id,kind,operation_id,reason_code,created_at) VALUES($1,$2,'GRANT',NULL,'SUBSCRIPTION_PERIOD_GRANT',$3)",
      [journalId, `subscription-grant:${subscriptionId}:1`, now.toISOString()],
    );
    await transaction.query(
      "INSERT INTO fusion_engine.wallets(owner_id,available_credits,updated_at) VALUES($1,0,$2) ON CONFLICT(owner_id) DO NOTHING",
      [ownerId, now.toISOString()],
    );
    const wallet = await transaction.query<Row>(
      `UPDATE fusion_engine.wallets SET available_credits=available_credits+$2::bigint,version=version+1,updated_at=$3
       WHERE owner_id=$1 RETURNING available_credits,held_credits,spent_credits,version,updated_at`,
      [ownerId, credits, now.toISOString()],
    );
    await transaction.query(
      `INSERT INTO fusion_engine.ledger_entries(journal_id,account_id,amount,created_at)
       VALUES($1,'platform:issued',-($2::bigint),$4),($1,$3,$2::bigint,$4)`,
      [journalId, credits, `owner:${ownerId}:available`, now.toISOString()],
    );
    await transaction.query(
      `INSERT INTO fusion_engine.subscription_periods
       (id,subscription_id,period_number,starts_at,ends_at,granted_credits,grant_journal_id,created_at)
       VALUES($1,$2,1,$3,$4,$5,$6,$3)`,
      [periodId, subscriptionId, now.toISOString(), periodEnd.toISOString(), credits, journalId],
    );

    const walletRow = wallet.rows[0]!;
    const response = {
      subscriptionId, ownerId, planVersionId: PLAN_VERSION_ID, planKey: "starter", displayName: String(plan.display_name), state: "ACTIVE",
      currentPeriodStart: now.toISOString(), currentPeriodEnd: periodEnd.toISOString(), creditsGranted: credits, alreadyAssigned: false,
      wallet: { availableCredits: Number(walletRow.available_credits), heldCredits: Number(walletRow.held_credits), spentCredits: Number(walletRow.spent_credits), version: Number(walletRow.version) },
    };
    await transaction.query(
      "INSERT INTO fusion_engine.subscription_commands(command_id,actor_id,action,request_hash,subscription_id,response) VALUES($1,$2,'ACTIVATE_INTERNAL_STARTER',$3,$4,$5::jsonb)",
      [input.commandId, ownerId, requestHash, subscriptionId, JSON.stringify(response)],
    );
    await transaction.query(
      `INSERT INTO fusion_engine.subscription_audit
       (command_id,actor_id,owner_id,action,subscription_id,plan_version_id,credits_granted,evidence_hash,occurred_at)
       VALUES($1,$2,$2,'INTERNAL_STARTER_ACTIVATED',$3,$4,$5,$6,$7)`,
      [input.commandId, ownerId, subscriptionId, PLAN_VERSION_ID, credits, sha256(JSON.stringify(response)), now.toISOString()],
    );
    return { status: 201, body: response };
  });
}

