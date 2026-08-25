import { createHash } from "node:crypto";
import { z } from "zod";
import type { AdminIdentity } from "../../../packages/admin-control-plane/src/types.js";
import type { ProductionGatewayConfig } from "./config.js";
import { productionDatabase } from "./database-readiness.js";

type Row = Record<string, unknown>;

const PublishPlanSchema = z.object({
  planKey: z.string().trim().min(3).max(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  displayName: z.string().trim().min(2).max(80),
  amountMinor: z.string().regex(/^\d+$/).transform(BigInt).refine((value) => value >= 0n && value <= 1_000_000_000n),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  interval: z.enum(["MONTH", "YEAR"]),
  creditsPerPeriod: z.number().int().min(1).max(1_000_000_000),
  termsVersion: z.string().trim().min(3).max(100),
  features: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
});

export class ProductionPlanCommandError extends Error {
  constructor(
    readonly code: "PLAN_COMMAND_INVALID" | "PLAN_COMMAND_CONFLICT" | "PLAN_PERMISSION_DENIED" | "PLAN_NOT_FOUND",
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ProductionPlanCommandError";
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const responseValue = (value: unknown): Record<string, unknown> => {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  throw new ProductionPlanCommandError("PLAN_COMMAND_CONFLICT", "Stored plan response is invalid.", 409);
};

function requireCommand(commandId: string | undefined, identity: AdminIdentity) {
  if (!commandId || commandId.length < 8 || commandId.length > 200) throw new ProductionPlanCommandError("PLAN_COMMAND_INVALID", "A valid idempotency key is required.");
  if (!identity.actorId || !identity.roles.includes("SUPER_ADMIN")) throw new ProductionPlanCommandError("PLAN_PERMISSION_DENIED", "Super Admin membership is required.", 403);
}

export async function publishProductionPlanVersion(input: {
  commandId: string | undefined;
  identity: AdminIdentity;
  config: ProductionGatewayConfig;
  body: unknown;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  requireCommand(input.commandId, input.identity);
  const parsed = PublishPlanSchema.safeParse(input.body);
  if (!parsed.success) throw new ProductionPlanCommandError("PLAN_COMMAND_INVALID", "Plan fields are invalid.");
  const intent = { ...parsed.data, amountMinor: parsed.data.amountMinor.toString() };
  const requestHash = sha256(JSON.stringify({ action: "PUBLISH_PLAN_VERSION", ...intent }));
  const database = productionDatabase(input.config);
  return database.transaction(async (transaction) => {
    await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`plan:${parsed.data.planKey}`]);
    const prior = await transaction.query<Row>("SELECT request_hash,response FROM fusion_engine.subscription_plan_admin_commands WHERE command_id=$1", [input.commandId]);
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash) throw new ProductionPlanCommandError("PLAN_COMMAND_CONFLICT", "The idempotency key is bound to another plan change.", 409);
      return { status: 200, body: { ...responseValue(prior.rows[0].response), replayed: true } };
    }
    const latest = await transaction.query<Row>("SELECT coalesce(max(version),0) AS version FROM fusion_engine.subscription_plan_versions WHERE plan_key=$1", [parsed.data.planKey]);
    const version = Number(latest.rows[0]?.version ?? 0) + 1;
    const planVersionId = `${parsed.data.planKey}-v${version}`;
    const now = new Date().toISOString();
    await transaction.query(
      `INSERT INTO fusion_engine.subscription_plan_versions
       (id,plan_key,version,lifecycle,display_name,amount_minor,currency,billing_interval,credits_per_period,terms_version,entitlement_snapshot,effective_from,published_at)
       VALUES($1,$2,$3,'PUBLISHED',$4,$5::bigint,$6,$7,$8::bigint,$9,$10::jsonb,$11,$11)`,
      [planVersionId, parsed.data.planKey, version, parsed.data.displayName, parsed.data.amountMinor.toString(), parsed.data.currency,
        parsed.data.interval, parsed.data.creditsPerPeriod, parsed.data.termsVersion, JSON.stringify({ features: parsed.data.features, customerPurchasable: false, paymentActivationRequired: true }), now],
    );
    const pointer = await transaction.query<Row>(
      `INSERT INTO fusion_engine.subscription_plan_pointers(plan_key,current_plan_version_id,state,version,updated_by,updated_at)
       VALUES($1,$2,'PUBLISHED',1,$3,$4)
       ON CONFLICT(plan_key) DO UPDATE SET current_plan_version_id=excluded.current_plan_version_id,state='PUBLISHED',
         version=fusion_engine.subscription_plan_pointers.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at
       RETURNING version`,
      [parsed.data.planKey, planVersionId, input.identity.actorId, now],
    );
    const response = { planVersionId, planKey: parsed.data.planKey, version, lifecycle: "PUBLISHED", displayName: parsed.data.displayName,
      amountMinor: parsed.data.amountMinor.toString(), currency: parsed.data.currency, interval: parsed.data.interval,
      creditsPerPeriod: parsed.data.creditsPerPeriod, pointerVersion: Number(pointer.rows[0]?.version), replayed: false };
    await transaction.query(
      "INSERT INTO fusion_engine.subscription_plan_admin_commands(command_id,actor_id,action,plan_key,request_hash,response) VALUES($1,$2,'PUBLISH_PLAN_VERSION',$3,$4,$5::jsonb)",
      [input.commandId, input.identity.actorId, parsed.data.planKey, requestHash, JSON.stringify(response)],
    );
    await transaction.query(
      `INSERT INTO fusion_engine.subscription_plan_admin_audit(command_id,actor_id,action,plan_key,plan_version_id,pointer_version,evidence_hash,occurred_at)
       VALUES($1,$2,'PUBLISH_PLAN_VERSION',$3,$4,$5,$6,$7)`,
      [input.commandId, input.identity.actorId, parsed.data.planKey, planVersionId, response.pointerVersion, sha256(JSON.stringify(response)), now],
    );
    return { status: 201, body: response };
  });
}

export async function retireProductionPlan(input: {
  commandId: string | undefined;
  identity: AdminIdentity;
  config: ProductionGatewayConfig;
  planKey: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  requireCommand(input.commandId, input.identity);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.planKey)) throw new ProductionPlanCommandError("PLAN_COMMAND_INVALID", "Plan key is invalid.");
  const requestHash = sha256(JSON.stringify({ action: "RETIRE_PLAN", planKey: input.planKey }));
  const database = productionDatabase(input.config);
  return database.transaction(async (transaction) => {
    await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`plan:${input.planKey}`]);
    const prior = await transaction.query<Row>("SELECT request_hash,response FROM fusion_engine.subscription_plan_admin_commands WHERE command_id=$1", [input.commandId]);
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash) throw new ProductionPlanCommandError("PLAN_COMMAND_CONFLICT", "The idempotency key is bound to another plan change.", 409);
      return { status: 200, body: { ...responseValue(prior.rows[0].response), replayed: true } };
    }
    const now = new Date().toISOString();
    const pointer = await transaction.query<Row>(
      `UPDATE fusion_engine.subscription_plan_pointers SET state='RETIRED',version=version+1,updated_by=$2,updated_at=$3
       WHERE plan_key=$1 RETURNING current_plan_version_id,version`,
      [input.planKey, input.identity.actorId, now],
    );
    if (!pointer.rows[0]) throw new ProductionPlanCommandError("PLAN_NOT_FOUND", "Plan not found.", 404);
    const response = { planKey: input.planKey, planVersionId: String(pointer.rows[0].current_plan_version_id), lifecycle: "RETIRED", pointerVersion: Number(pointer.rows[0].version), replayed: false };
    await transaction.query(
      "INSERT INTO fusion_engine.subscription_plan_admin_commands(command_id,actor_id,action,plan_key,request_hash,response) VALUES($1,$2,'RETIRE_PLAN',$3,$4,$5::jsonb)",
      [input.commandId, input.identity.actorId, input.planKey, requestHash, JSON.stringify(response)],
    );
    await transaction.query(
      `INSERT INTO fusion_engine.subscription_plan_admin_audit(command_id,actor_id,action,plan_key,plan_version_id,pointer_version,evidence_hash,occurred_at)
       VALUES($1,$2,'RETIRE_PLAN',$3,$4,$5,$6,$7)`,
      [input.commandId, input.identity.actorId, input.planKey, response.planVersionId, response.pointerVersion, sha256(JSON.stringify(response)), now],
    );
    return { status: 200, body: response };
  });
}
