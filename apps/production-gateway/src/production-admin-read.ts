import { providerOnboardingProfiles } from "../../../packages/providers/src/provider-onboarding.js";
import type { ProductionGatewayConfig } from "./config.js";
import { productionDatabase } from "./database-readiness.js";
import { getProductionAuthUser, listProductionAuthUsers } from "./supabase-user-directory.js";
import type { ProductionAuthUser } from "./supabase-user-directory.js";

type Row = Record<string, unknown>;

const count = (value: unknown) => Number(value ?? 0);
const iso = (value: unknown) => new Date(String(value)).toISOString();
const payload = (value: unknown): Record<string, unknown> => {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
};

function primaryCatalogMediaType(providerModelId: string, modalities: string[]): string {
  // A model such as Image-to-Video legitimately exposes both image input and
  // video output. The admin catalog should classify it by the customer-facing
  // result rather than whichever input modality happens to be listed first.
  if (/(?:^|[-/])(?:text|image|reference)-to-video(?:$|[-/])/i.test(providerModelId)) return "video";
  if (/(?:^|[-/])(?:text|image)-to-audio(?:$|[-/])|text-to-speech/i.test(providerModelId)) return "audio";
  return modalities.find((item) => ["image", "video", "audio", "text"].includes(item)) ?? modalities[0] ?? "unknown";
}

function credentialMetadata(row: Row) {
  return { id: row.id, providerId: row.provider_id, accountId: row.account_id, environment: row.environment, purpose: row.purpose, fingerprint: row.fingerprint,
    version: count(row.version), status: row.status, createdAt: iso(row.created_at), testedAt: row.tested_at ? iso(row.tested_at) : null,
    activatedAt: row.activated_at ? iso(row.activated_at) : null, revokedAt: row.revoked_at ? iso(row.revoked_at) : null };
}

function providerReadiness(
  profile: (typeof providerOnboardingProfiles)[number],
  versions: Row[],
  accounts: Row[],
  credentials: Row[],
) {
  const records = versions.map((row) => ({ type: row.entity_type, value: payload(row.payload) })).filter(({ value }) => value.providerId === profile.providerId);
  const referenceSnapshotCount = records.filter(({ type }) => type === "CATALOG_SNAPSHOT").length;
  const account = accounts.find((row) => row.provider_id === profile.providerId);
  const providerCredentials = credentials.filter((row) => row.provider_id === profile.providerId);
  return { providerId: profile.providerId, displayName: profile.displayName, status: referenceSnapshotCount ? "CATALOG_IMPORTED" : profile.catalogState,
    connectionState: account?.state ?? "DISCONNECTED", lastVerifiedAt: account?.last_verified_at ? iso(account.last_verified_at) : null,
    routeCount: records.filter(({ type }) => type === "ROUTE_CANDIDATE").length, capabilities: profile.documentedCapabilities,
    snapshotCount: referenceSnapshotCount, referenceSnapshotCount, credentialMetadataCount: providerCredentials.length, credentialStatuses: providerCredentials.map((row) => String(row.status)),
    documentationUrl: profile.documentationUrl, catalogUrl: profile.catalogUrl, pricingUrl: profile.pricingUrl };
}

export async function readProductionAdmin(
  path: string,
  config: ProductionGatewayConfig,
  request: typeof fetch = fetch,
): Promise<{ status: number; body: Record<string, unknown> | unknown[] }> {
  const database = productionDatabase(config);

  if (path === "/v1/admin/overview") {
    const audit = await database.query<Row>("SELECT count(*) AS records FROM fusion_engine.provider_control_audit");
    return { status: 200, body: {
      mode: "PRODUCTION_ADMIN",
      legacyMutationPolicy: "DENY",
      stateCounts: { DRAFT: 0, VALIDATED: 0, SIMULATED: 0, APPROVED: 0, PUBLISHED: 0, REJECTED: 0 },
      runtime: { routeControls: [] },
      treasury: { treasury: { state: "UNCONFIGURED", confirmedRemainingAtomic: "Unavailable", shadowAvailableAtomic: "Unavailable" } },
      reconciliation: { reconciliationRateBps: 10_000, targetMet: true, issues: [] },
      audit: { records: count(audit.rows[0]?.records), chainValid: count(audit.rows[0]?.records) === 0 },
    } };
  }

  if (path === "/v1/admin/durable/overview") {
    const [operations, holds, reconciliations, outcomes, outbox] = await Promise.all([
      database.query<Row>("SELECT state, count(*) FROM fusion_engine.operations GROUP BY state"),
      database.query<Row>("SELECT operation_id, owner_id, state, held_credits, quoted_credits, updated_at FROM fusion_engine.credit_reservations WHERE state IN ('HELD','MANUAL_REVIEW') ORDER BY updated_at DESC LIMIT 50"),
      database.query<Row>("SELECT id, owner_id, state_version, updated_at FROM fusion_engine.operations WHERE state='RECONCILIATION_REQUIRED' ORDER BY updated_at DESC LIMIT 50"),
      database.query<Row>("SELECT operation_id, provider_id, provider_credits, disposition, recorded_at FROM fusion_engine.provider_cost_outcomes ORDER BY recorded_at DESC LIMIT 50"),
      database.query<Row>("SELECT status, count(*) FROM fusion_engine.outbox_events GROUP BY status"),
    ]);
    const operationCounts = Object.fromEntries(operations.rows.map((row) => [String(row.state), count(row.count)]));
    return { status: 200, body: {
      enabled: true,
      runtime: { database: "fusion_engine", worker: "vercel-request-driven", lastErrorCode: null, operations: operationCounts, outbox: Object.fromEntries(outbox.rows.map((row) => [String(row.status), count(row.count)])) },
      audit: {
        operationCounts,
        holds: holds.rows.map((row) => ({ operationId: row.operation_id, ownerId: row.owner_id, state: row.state, heldCredits: count(row.held_credits), quotedCredits: count(row.quoted_credits), updatedAt: iso(row.updated_at) })),
        reconciliations: reconciliations.rows.map((row) => ({ operationId: row.id, ownerId: row.owner_id, stateVersion: count(row.state_version), updatedAt: iso(row.updated_at) })),
        providerCostOutcomes: outcomes.rows.map((row) => ({ operationId: row.operation_id, providerId: row.provider_id, providerCredits: count(row.provider_credits), disposition: row.disposition, recordedAt: iso(row.recorded_at) })),
      },
    } };
  }

  if (path === "/v1/admin/durable/operations") {
    const result = await database.query<Row>(`SELECT o.id, o.owner_id, o.state, o.state_version, o.customer_credits, o.created_at,
      greatest(o.updated_at,coalesce(a.updated_at,o.updated_at)) AS observed_updated_at,
      r.state AS reservation_state, r.held_credits, r.captured_credits, r.released_credits,
      a.provider_id, c.provider_credits, c.disposition
      FROM fusion_engine.operations o
      LEFT JOIN fusion_engine.credit_reservations r ON r.operation_id=o.id
      LEFT JOIN LATERAL (SELECT * FROM fusion_engine.operation_attempts WHERE operation_id=o.id ORDER BY attempt_number DESC LIMIT 1) a ON true
      LEFT JOIN fusion_engine.provider_cost_outcomes c ON c.operation_id=o.id
      ORDER BY observed_updated_at DESC LIMIT 50`);
    return { status: 200, body: result.rows.map((row) => ({
      operationId: row.id, ownerId: row.owner_id, state: row.state, stateVersion: count(row.state_version), customerCredits: count(row.customer_credits), providerId: row.provider_id ?? null,
      reservation: row.reservation_state ? { state: row.reservation_state, heldCredits: count(row.held_credits), capturedCredits: count(row.captured_credits), releasedCredits: count(row.released_credits) } : null,
      providerCost: row.provider_credits == null ? null : { credits: count(row.provider_credits), disposition: row.disposition ?? "UNKNOWN" },
      createdAt: iso(row.created_at), updatedAt: iso(row.observed_updated_at),
    })) };
  }

  if (path === "/v1/admin/durable/owners") {
    const result = await database.query<Row>(`WITH owners AS (SELECT owner_id FROM fusion_engine.wallets UNION SELECT owner_id FROM fusion_engine.operations)
      SELECT owners.owner_id, w.available_credits, w.held_credits, w.spent_credits, count(o.id) AS operation_count,
      count(o.id) FILTER (WHERE o.state NOT IN ('SETTLED','CANCELLED')) AS active_operation_count,
      max(o.updated_at) AS last_operation_at, max(w.updated_at) AS wallet_updated_at
      FROM owners LEFT JOIN fusion_engine.wallets w ON w.owner_id=owners.owner_id LEFT JOIN fusion_engine.operations o ON o.owner_id=owners.owner_id
      GROUP BY owners.owner_id,w.available_credits,w.held_credits,w.spent_credits ORDER BY COALESCE(max(o.updated_at),max(w.updated_at)) DESC LIMIT 50`);
    return { status: 200, body: result.rows.map((row) => ({ ownerId: row.owner_id,
      wallet: row.available_credits == null ? null : { availableCredits: count(row.available_credits), heldCredits: count(row.held_credits), spentCredits: count(row.spent_credits) },
      operationCount: count(row.operation_count), activeOperationCount: count(row.active_operation_count), lastActivityAt: iso(row.last_operation_at ?? row.wallet_updated_at ?? 0),
    })) };
  }

  if (path === "/v1/admin/customers") {
    const [authUsers, finance] = await Promise.all([
      listProductionAuthUsers(config, request, 500),
      database.query<Row>(`WITH owners AS (
          SELECT owner_id FROM fusion_engine.wallets
          UNION SELECT owner_id FROM fusion_engine.operations
          UNION SELECT owner_id FROM fusion_engine.subscriptions
        ), operation_totals AS (
          SELECT owner_id,count(*) AS operation_count,
            count(*) FILTER (WHERE state NOT IN ('SETTLED','CANCELLED')) AS active_operation_count,
            max(updated_at) AS last_operation_at
          FROM fusion_engine.operations GROUP BY owner_id
        )
        SELECT owners.owner_id,w.available_credits,w.held_credits,w.spent_credits,
          coalesce(operations.operation_count,0) AS operation_count,
          coalesce(operations.active_operation_count,0) AS active_operation_count,
          operations.last_operation_at,w.updated_at AS wallet_updated_at,
          subscription.id AS subscription_id,subscription.state AS subscription_state,
          subscription.current_period_end,plan.plan_key,plan.display_name AS plan_display_name
        FROM owners
        LEFT JOIN fusion_engine.wallets w ON w.owner_id=owners.owner_id
        LEFT JOIN operation_totals operations ON operations.owner_id=owners.owner_id
        LEFT JOIN LATERAL (
          SELECT * FROM fusion_engine.subscriptions candidate
          WHERE candidate.owner_id=owners.owner_id
          ORDER BY (candidate.state='ACTIVE') DESC,candidate.created_at DESC LIMIT 1
        ) subscription ON true
        LEFT JOIN fusion_engine.subscription_plan_versions plan ON plan.id=subscription.plan_version_id
        ORDER BY coalesce(operations.last_operation_at,w.updated_at,subscription.updated_at) DESC NULLS LAST
        LIMIT 500`),
    ]);
    const financeByOwner = new Map(finance.rows.map((row) => [String(row.owner_id), row]));
    const authByOwner = new Map(authUsers.map((user) => [user.id, user]));
    const ownerIds = [...new Set([...authByOwner.keys(), ...financeByOwner.keys()])];
    return { status: 200, body: ownerIds.map((ownerId) => {
      const user = authByOwner.get(ownerId);
      const row = financeByOwner.get(ownerId);
      const bannedUntil = user?.bannedUntil ? new Date(user.bannedUntil) : null;
      const lifecycle = bannedUntil && bannedUntil.getTime() > Date.now() ? "BANNED" : !user?.confirmedAt ? "PENDING" : "ACTIVE";
      return {
        ownerId,
        email: user?.email ?? null,
        displayName: user?.displayName ?? null,
        authProvider: user?.authProvider ?? null,
        lifecycle,
        createdAt: user?.createdAt ?? null,
        lastSignInAt: user?.lastSignInAt ?? null,
        wallet: row?.available_credits == null ? null : {
          availableCredits: count(row.available_credits), heldCredits: count(row.held_credits), spentCredits: count(row.spent_credits),
        },
        subscription: row?.subscription_id == null ? null : {
          id: String(row.subscription_id), state: String(row.subscription_state), planKey: String(row.plan_key),
          displayName: String(row.plan_display_name), currentPeriodEnd: iso(row.current_period_end),
        },
        operationCount: count(row?.operation_count),
        activeOperationCount: count(row?.active_operation_count),
        lastActivityAt: row?.last_operation_at || row?.wallet_updated_at ? iso(row.last_operation_at ?? row.wallet_updated_at) : user?.lastSignInAt ?? user?.createdAt ?? null,
      };
    }) };
  }

  const customerDetail = path.match(/^\/v1\/admin\/customers\/([^/]+)$/);
  if (customerDetail) {
    const ownerId = decodeURIComponent(customerDetail[1]!);
    const accountPattern = `owner:${ownerId}:%`;
    const [user, wallet, subscriptions, operations, ledger] = await Promise.all([
      getProductionAuthUser(config, ownerId, request),
      database.query<Row>("SELECT owner_id,available_credits,held_credits,spent_credits,version,updated_at FROM fusion_engine.wallets WHERE owner_id=$1", [ownerId]),
      database.query<Row>(`SELECT s.id,s.state,s.current_period_start,s.current_period_end,s.created_at,s.cancelled_at,
        p.id AS plan_version_id,p.plan_key,p.display_name,p.credits_per_period,p.billing_interval,p.amount_minor,p.currency
        FROM fusion_engine.subscriptions s JOIN fusion_engine.subscription_plan_versions p ON p.id=s.plan_version_id
        WHERE s.owner_id=$1 ORDER BY s.created_at DESC LIMIT 20`, [ownerId]),
      database.query<Row>(`SELECT id,state,customer_credits,created_at,updated_at FROM fusion_engine.operations
        WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 25`, [ownerId]),
      database.query<Row>(`SELECT journal.id,journal.kind,journal.reason_code,journal.created_at,sum(entry.amount) AS owner_credit_delta
        FROM fusion_engine.ledger_journals journal
        JOIN fusion_engine.ledger_entries entry ON entry.journal_id=journal.id
        WHERE entry.account_id LIKE $1
        GROUP BY journal.id,journal.kind,journal.reason_code,journal.created_at
        ORDER BY journal.created_at DESC LIMIT 50`, [accountPattern]),
    ]);
    if (!user && !wallet.rows[0] && subscriptions.rows.length === 0 && operations.rows.length === 0) {
      return { status: 404, body: { error: { code: "CUSTOMER_NOT_FOUND", message: "Customer not found." } } };
    }
    const walletRow = wallet.rows[0];
    return { status: 200, body: {
      ownerId,
      profile: user,
      lifecycle: user?.bannedUntil && new Date(user.bannedUntil).getTime() > Date.now() ? "BANNED" : !user?.confirmedAt ? "PENDING" : "ACTIVE",
      wallet: walletRow ? {
        availableCredits: count(walletRow.available_credits), heldCredits: count(walletRow.held_credits), spentCredits: count(walletRow.spent_credits),
        version: count(walletRow.version), updatedAt: iso(walletRow.updated_at),
      } : null,
      subscriptions: subscriptions.rows.map((row) => ({
        id: String(row.id), state: String(row.state), planVersionId: String(row.plan_version_id), planKey: String(row.plan_key),
        displayName: String(row.display_name), creditsPerPeriod: count(row.credits_per_period), interval: String(row.billing_interval),
        amountMinor: String(row.amount_minor), currency: String(row.currency), currentPeriodStart: iso(row.current_period_start),
        currentPeriodEnd: iso(row.current_period_end), createdAt: iso(row.created_at), cancelledAt: row.cancelled_at ? iso(row.cancelled_at) : null,
      })),
      operations: operations.rows.map((row) => ({
        operationId: String(row.id), state: String(row.state), customerCredits: count(row.customer_credits),
        createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
      })),
      ledgerActivity: ledger.rows.map((row) => ({
        journalId: String(row.id), kind: String(row.kind), reasonCode: String(row.reason_code),
        creditDelta: count(row.owner_credit_delta), createdAt: iso(row.created_at),
      })),
    } };
  }

  if (path === "/v1/admin/durable/exceptions") {
    const result = await database.query<Row>(`SELECT o.id AS operation_id,o.owner_id,o.state,
      CASE WHEN a.last_error_code='SUCCESS_EVIDENCE_INCOMPLETE' THEN 'PROVIDER_SUCCESS_EVIDENCE_INCOMPLETE'
      WHEN a.last_error_code='SUCCESS_EVIDENCE_MISSING_PROVIDER_TASK_OR_RESULT_URL' THEN 'PROVIDER_SUCCESS_RESULT_MISSING'
      WHEN a.last_error_code='FAILED_PROVIDER_CHARGE_NOT_PROVEN_ZERO' THEN 'REFUND_EVIDENCE_REQUIRED'
      WHEN a.last_error_code LIKE 'ASSET_INGEST_UNPROVEN:%' OR a.last_error_code LIKE 'DELIVERY_UNPROVEN:%' THEN 'DELIVERY_EVIDENCE_REQUIRED'
      ELSE 'RECONCILIATION_REQUIRED' END AS category,'CRITICAL' AS severity,
      coalesce(a.last_error_code,'protected_hold_requires_reconciliation') AS reason,o.updated_at
      FROM fusion_engine.operations o LEFT JOIN fusion_engine.operation_attempts a ON a.id=(SELECT id FROM fusion_engine.operation_attempts WHERE operation_id=o.id ORDER BY attempt_number DESC LIMIT 1)
      WHERE o.state='RECONCILIATION_REQUIRED' ORDER BY o.updated_at DESC LIMIT 50`);
    return { status: 200, body: result.rows.map((row) => ({ operationId: row.operation_id, ownerId: row.owner_id, state: row.state, category: row.category, severity: row.severity, reason: row.reason, updatedAt: iso(row.updated_at) })) };
  }

  const providerDetail = path.match(/^\/v1\/admin\/catalog\/providers\/(kie|openrouter)\/detail$/);
  if (providerDetail) {
    const providerId = providerDetail[1]!;
    const profile = providerOnboardingProfiles.find((candidate) => candidate.providerId === providerId);
    if (!profile) return { status: 404, body: { error: { code: "PROVIDER_NOT_FOUND", message: "Provider not found." } } };
    const [versions, accounts, credentials] = await Promise.all([
      database.query<Row>(`SELECT version.entity_type,version.payload
        FROM fusion_engine.provider_control_entities entity
        JOIN fusion_engine.provider_control_versions version
          ON version.entity_type=entity.entity_type AND version.entity_id=entity.entity_id AND version.version=entity.current_version
        WHERE version.entity_type IN ('CATALOG_SNAPSHOT','REFERENCE_MODEL','ROUTE_CANDIDATE')`),
      database.query<Row>("SELECT provider_id,state,last_verified_at,verification_evidence FROM fusion_engine.provider_accounts WHERE provider_id=$1", [providerId]),
      database.query<Row>("SELECT id,provider_id,account_id,environment,purpose,fingerprint,version,status,created_at,tested_at,activated_at,revoked_at FROM fusion_engine.provider_credentials WHERE provider_id=$1 ORDER BY created_at DESC", [providerId]),
    ]);
    return { status: 200, body: { provider: providerReadiness(profile, versions.rows, accounts.rows, credentials.rows), credentials: credentials.rows.map(credentialMetadata) } };
  }

  if (path === "/v1/admin/catalog/providers/directory") {
    const [versions, accounts, credentials] = await Promise.all([
      database.query<Row>(`SELECT version.entity_type,version.payload
        FROM fusion_engine.provider_control_entities entity
        JOIN fusion_engine.provider_control_versions version
          ON version.entity_type=entity.entity_type AND version.entity_id=entity.entity_id AND version.version=entity.current_version
        WHERE version.entity_type IN ('CATALOG_SNAPSHOT','REFERENCE_MODEL','ROUTE_CANDIDATE')`),
      database.query<Row>("SELECT provider_id,state,last_verified_at,verification_evidence FROM fusion_engine.provider_accounts"),
      database.query<Row>("SELECT id,provider_id,account_id,environment,purpose,fingerprint,version,status,created_at,tested_at,activated_at,revoked_at FROM fusion_engine.provider_credentials ORDER BY created_at DESC"),
    ]);
    return { status: 200, body: {
      providers: providerOnboardingProfiles.map((profile) => providerReadiness(profile, versions.rows, accounts.rows, credentials.rows)),
      credentials: credentials.rows.map(credentialMetadata),
    } };
  }

  if (path === "/v1/admin/catalog/providers") {
    const [versions, accounts, credentials] = await Promise.all([
      database.query<Row>(`SELECT version.entity_type,version.payload
        FROM fusion_engine.provider_control_entities entity
        JOIN fusion_engine.provider_control_versions version
          ON version.entity_type=entity.entity_type AND version.entity_id=entity.entity_id AND version.version=entity.current_version
        WHERE version.entity_type IN ('CATALOG_SNAPSHOT','REFERENCE_MODEL','ROUTE_CANDIDATE')`),
      database.query<Row>("SELECT provider_id,state,last_verified_at,verification_evidence FROM fusion_engine.provider_accounts"),
      database.query<Row>("SELECT provider_id,status FROM fusion_engine.provider_credentials"),
    ]);
    return { status: 200, body: providerOnboardingProfiles.map((profile) => providerReadiness(profile, versions.rows, accounts.rows, credentials.rows)) };
  }

  if (path === "/v1/admin/catalog/reference-models") {
    const result = await database.query<Row>(`SELECT version.entity_id,version.version,version.effective_at,version.payload,selection.state AS selection_state,selection.version AS selection_version
      FROM fusion_engine.provider_control_entities entity
      JOIN fusion_engine.provider_control_versions version ON version.entity_type=entity.entity_type AND version.entity_id=entity.entity_id AND version.version=entity.current_version
      LEFT JOIN fusion_engine.provider_model_selections selection ON selection.reference_model_id=entity.entity_id
      WHERE entity.entity_type='REFERENCE_MODEL' ORDER BY version.payload->>'displayName',version.entity_id`);
    return { status: 200, body: result.rows.map((row) => {
      const value = payload(row.payload);
      return { providerId: value.providerId, snapshotId: value.catalogSnapshotId ?? "", observedAt: value.observedAt ?? row.effective_at, snapshotChangeState: "PUBLISHED", id: row.entity_id,
        providerModelId: value.providerModelId, displayName: value.displayName, familyId: value.familyId, modalities: value.modalities ?? [], supportedParameters: value.supportedParameters ?? [], sourceUrls: value.sourceUrls ?? [], taxonomyHint: value.taxonomyHint ?? null, reviewedTaxonomy: value.reviewedTaxonomy ?? null, state: "REFERENCE_ACTIVE",
        selectionState: row.selection_state ?? "UNSELECTED", selectionVersion: count(row.selection_version) };
    }) };
  }

  if (path === "/v1/admin/catalog/offline") {
    const result = await database.query<Row>(`SELECT model.entity_id,model.payload,selection.catalog_snapshot_id,selection.version,selection.updated_at
      FROM fusion_engine.provider_model_selections selection
      JOIN fusion_engine.provider_control_entities entity ON entity.entity_type='REFERENCE_MODEL' AND entity.entity_id=selection.reference_model_id
      JOIN fusion_engine.provider_control_versions model ON model.entity_type=entity.entity_type AND model.entity_id=entity.entity_id AND model.version=entity.current_version
      WHERE selection.state='SELECTED' ORDER BY model.payload->>'displayName'`);
    return { status: 200, body: result.rows.map((row) => {
      const value = payload(row.payload);
      return { providerId: value.providerId, status: "SNAPSHOT_STAGED", routeId: row.entity_id, snapshotId: row.catalog_snapshot_id,
        model: value.displayName, family: value.familyId, mediaType: Array.isArray(value.modalities) ? value.modalities.find((item) => ["image", "video", "audio"].includes(String(item))) ?? value.modalities[0] : "unknown",
        protocol: "NOT_CONFIGURED", providerCost: { unit: "Official rate", scale: "Not imported", version: "Pending pricing evidence" }, certification: "SELECTED_FOR_PRICING" };
    }) };
  }

  if (path === "/v1/admin/pricing") {
    const result = await database.query<Row>(`SELECT model.entity_id,model.payload,
      rate.rate_key,rate.version AS provider_rate_version,rate.label AS rate_label,rate.billing_unit,
      rate.provider_credit_micros,rate.provider_usd_picos,rate.variant,rate.source_url,rate.effective_at,
      price.version AS customer_price_version,price.customer_credits,price.configured_by,price.created_at AS customer_price_updated_at
      FROM fusion_engine.provider_model_selections selection
      JOIN fusion_engine.provider_control_entities entity ON entity.entity_type='REFERENCE_MODEL' AND entity.entity_id=selection.reference_model_id
      JOIN fusion_engine.provider_control_versions model ON model.entity_type=entity.entity_type AND model.entity_id=entity.entity_id AND model.version=entity.current_version
      LEFT JOIN fusion_engine.provider_model_rate_pointers rate_pointer ON rate_pointer.reference_model_id=model.entity_id
      LEFT JOIN fusion_engine.provider_model_rate_versions rate ON rate.reference_model_id=rate_pointer.reference_model_id AND rate.rate_key=rate_pointer.rate_key AND rate.version=rate_pointer.current_version
      LEFT JOIN fusion_engine.platform_model_price_pointers price_pointer ON price_pointer.reference_model_id=rate.reference_model_id AND price_pointer.rate_key=rate.rate_key
      LEFT JOIN fusion_engine.platform_model_price_versions price ON price.reference_model_id=price_pointer.reference_model_id AND price.rate_key=price_pointer.rate_key AND price.version=price_pointer.current_version
      WHERE selection.state='SELECTED'
      ORDER BY model.payload->>'displayName',rate.label NULLS FIRST`);
    return { status: 200, body: result.rows.map((row) => {
      const value = payload(row.payload);
      const modalities = Array.isArray(value.modalities) ? value.modalities.map(String) : [];
      const providerRate = row.rate_key == null ? null : {
        rateKey: String(row.rate_key), version: count(row.provider_rate_version), label: String(row.rate_label), billingUnit: String(row.billing_unit),
        providerCreditMicros: row.provider_credit_micros == null ? null : String(row.provider_credit_micros),
        providerUsdPicos: row.provider_usd_picos == null ? null : String(row.provider_usd_picos), variant: payload(row.variant),
        sourceUrl: String(row.source_url), effectiveAt: iso(row.effective_at),
      };
      const customerPrice = row.customer_price_version == null ? null : {
        version: count(row.customer_price_version), customerCredits: count(row.customer_credits), configuredBy: String(row.configured_by), updatedAt: iso(row.customer_price_updated_at),
      };
      const providerModelId = String(value.providerModelId);
      return {
        referenceModelId: String(row.entity_id), providerId: String(value.providerId), providerModelId: String(value.providerModelId),
        model: String(value.displayName), mediaType: primaryCatalogMediaType(providerModelId, modalities),
        providerRate, customerPrice, status: !providerRate ? "RATE_SYNC_REQUIRED" : !customerPrice ? "CUSTOMER_PRICE_REQUIRED" : "CONFIGURED",
      };
    }) };
  }

  if (path === "/v1/admin/catalog/reference-snapshots") {
    const result = await database.query<Row>(`SELECT version.entity_id,version.version,version.effective_at,version.payload
      FROM fusion_engine.provider_control_entities entity
      JOIN fusion_engine.provider_control_versions version ON version.entity_type=entity.entity_type AND version.entity_id=entity.entity_id AND version.version=entity.current_version
      WHERE entity.entity_type='CATALOG_SNAPSHOT' ORDER BY version.effective_at DESC`);
    return { status: 200, body: await Promise.all(result.rows.map(async (row) => {
      const value = payload(row.payload);
      const models = await database.query<Row>("SELECT count(*) AS count FROM fusion_engine.provider_control_versions WHERE entity_type='REFERENCE_MODEL' AND payload->>'catalogSnapshotId'=$1", [row.entity_id]);
      return { snapshotId: row.entity_id, providerId: value.providerId, observedAt: value.observedAt ?? row.effective_at, parserVersion: value.parserVersion,
        sourceUrls: value.sourceUrls ?? [], rawPayloadSha256: value.rawPayloadSha256, manifestSha256: value.manifestSha256, diffSha256: value.manifestSha256,
        modelCount: count(models.rows[0]?.count), diff: { added: count(models.rows[0]?.count), changed: 0, removed: 0 }, change: { id: `source:${String(row.entity_id)}`, state: "PUBLISHED" } };
    })) };
  }

  if (path === "/v1/admin/credentials") {
    const result = await database.query<Row>("SELECT id,provider_id,account_id,environment,purpose,fingerprint,version,status,created_at,tested_at,activated_at,revoked_at FROM fusion_engine.provider_credentials ORDER BY created_at DESC");
    return { status: 200, body: result.rows.map(credentialMetadata) };
  }

  if (["/v1/admin/changes", "/v1/admin/approval-inbox", "/v1/admin/workflow-policies", "/v1/admin/catalog/routes", "/v1/admin/catalog/release-gates", "/v1/admin/catalog/snapshots"].includes(path)) {
    return { status: 200, body: [] };
  }

  if (path === "/v1/admin/audit") {
    const result = await database.query<Row>("SELECT sequence,command_id,action,entity_type,entity_id,version,intent_hash,previous_hash,record_hash,occurred_at FROM fusion_engine.provider_control_audit ORDER BY sequence DESC LIMIT 200");
    return { status: 200, body: { chainValid: result.rows.length === 0, records: result.rows.map((row) => ({ sequence: count(row.sequence), id: row.command_id, actorId: "server-control-plane", action: row.action, resourceType: row.entity_type, resourceId: row.entity_id, versionId: `${row.entity_type}:${row.entity_id}:v${row.version}`, commandHash: row.intent_hash, previousHash: row.previous_hash, recordHash: row.record_hash, occurredAt: iso(row.occurred_at) })) } };
  }

  if (path === "/v1/admin/commerce/overview") {
    const [plans, subscriptions, activationKeys, authUsers] = await Promise.all([
      database.query<Row>(`SELECT DISTINCT ON (plan.plan_key)
        plan.id,plan.plan_key,plan.version,coalesce(pointer.state,plan.lifecycle) AS lifecycle,
        plan.display_name,plan.amount_minor,plan.currency,plan.billing_interval,plan.credits_per_period,plan.terms_version
        FROM fusion_engine.subscription_plan_versions plan
        LEFT JOIN fusion_engine.subscription_plan_pointers pointer ON pointer.plan_key=plan.plan_key
        ORDER BY plan.plan_key,plan.version DESC`),
      database.query<Row>(`SELECT s.id,s.owner_id,s.state,s.current_period_start,s.current_period_end,s.created_at,
        p.id AS plan_version_id,p.plan_key,p.display_name,p.credits_per_period,
        w.available_credits,w.held_credits,w.spent_credits
        FROM fusion_engine.subscriptions s
        JOIN fusion_engine.subscription_plan_versions p ON p.id=s.plan_version_id
        LEFT JOIN fusion_engine.wallets w ON w.owner_id=s.owner_id
        ORDER BY s.created_at DESC LIMIT 100`),
      database.query<Row>(`SELECT activation.id,activation.key_hint,activation.plan_version_id,activation.state,
        activation.expires_at,activation.created_at,activation.redeemed_by,activation.redeemed_at,
        activation.revoked_at,plan.plan_key,plan.display_name,plan.billing_interval,plan.credits_per_period
        FROM fusion_engine.subscription_activation_keys activation
        JOIN fusion_engine.subscription_plan_versions plan ON plan.id=activation.plan_version_id
        ORDER BY activation.created_at DESC LIMIT 200`),
      listProductionAuthUsers(config, request, 500).catch((): ProductionAuthUser[] => []),
    ]);
    const authByOwner = new Map<string, ProductionAuthUser>();
    for (const user of authUsers) authByOwner.set(user.id, user);
    return { status: 200, body: {
      enabled: true, sandboxOnly: false, paymentProvider: "NOT_CONNECTED", products: [],
      plans: plans.rows.map((row) => ({
        id: row.id, planKey: row.plan_key, version: count(row.version), lifecycle: row.lifecycle, displayName: row.display_name,
        amountMinor: String(row.amount_minor), currency: row.currency, interval: row.billing_interval,
        creditsPerPeriod: count(row.credits_per_period), termsVersion: row.terms_version,
      })),
      subscriptions: subscriptions.rows.map((row) => ({
        id: row.id, ownerId: row.owner_id, ownerEmail: authByOwner.get(String(row.owner_id))?.email ?? null,
        ownerDisplayName: authByOwner.get(String(row.owner_id))?.displayName ?? null,
        state: row.state, planVersionId: row.plan_version_id, planKey: row.plan_key,
        displayName: row.display_name, creditsPerPeriod: count(row.credits_per_period),
        currentPeriodStart: iso(row.current_period_start), currentPeriodEnd: iso(row.current_period_end),
        wallet: row.available_credits == null ? null : { availableCredits: count(row.available_credits), heldCredits: count(row.held_credits), spentCredits: count(row.spent_credits) },
      })),
      activationKeys: activationKeys.rows.map((row) => ({
        id: String(row.id), keyHint: String(row.key_hint), planVersionId: String(row.plan_version_id), planKey: String(row.plan_key),
        displayName: String(row.display_name), interval: String(row.billing_interval), creditsPerPeriod: count(row.credits_per_period),
        state: row.state === "ISSUED" && new Date(String(row.expires_at)).getTime() <= Date.now() ? "EXPIRED" : String(row.state),
        createdAt: iso(row.created_at), expiresAt: iso(row.expires_at), redeemedAt: row.redeemed_at ? iso(row.redeemed_at) : null,
        revokedAt: row.revoked_at ? iso(row.revoked_at) : null, redeemedBy: row.redeemed_by ?? null,
        redeemedByEmail: row.redeemed_by ? authByOwner.get(String(row.redeemed_by))?.email ?? null : null,
      })),
      activity: {
        checkoutsByState: {},
        subscriptionsByState: Object.fromEntries([...new Set(subscriptions.rows.map((row) => String(row.state)))].map((state) => [state, subscriptions.rows.filter((row) => row.state === state).length])),
        invoicesByState: {}, reversalsByKind: {},
      },
    } };
  }
  return { status: 404, body: { error: { code: "ADMIN_READ_ROUTE_NOT_FOUND", message: "Admin read route not found." } } };
}
