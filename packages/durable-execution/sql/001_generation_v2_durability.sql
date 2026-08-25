CREATE SCHEMA IF NOT EXISTS fusion_engine;

CREATE OR REPLACE FUNCTION fusion_engine.reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'immutable_financial_record';
END;
$$;

CREATE TABLE IF NOT EXISTS fusion_engine.wallets (
  owner_id text PRIMARY KEY,
  available_credits bigint NOT NULL DEFAULT 0 CHECK (available_credits >= 0),
  held_credits bigint NOT NULL DEFAULT 0 CHECK (held_credits >= 0),
  spent_credits bigint NOT NULL DEFAULT 0 CHECK (spent_credits >= 0),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Creative Space stores its canonical workspace document here.  The document
-- is deliberately versioned as one aggregate: financial operations remain in
-- their immutable tables, while canvas/layout changes use optimistic locking.
CREATE TABLE IF NOT EXISTS fusion_engine.creative_projects (
  project_id text PRIMARY KEY CHECK (length(project_id) BETWEEN 1 AND 200),
  owner_id text NOT NULL,
  document jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creative_projects_owner_updated_idx
ON fusion_engine.creative_projects (owner_id, updated_at DESC);

-- Local Admin control-plane state is isolated from financial records and never
-- contains a credential value.  The revision implements optimistic ownership
-- for a single local Engine process and makes restart recovery explicit.
CREATE TABLE IF NOT EXISTS fusion_engine.admin_control_plane_state (
  state_key text PRIMARY KEY CHECK (state_key = 'local-admin-v2'),
  document jsonb NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fusion_engine.quotes (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  customer_credits bigint NOT NULL CHECK (customer_credits > 0),
  state text NOT NULL DEFAULT 'ISSUED' CHECK (state IN ('ISSUED', 'CONSUMED', 'EXPIRED', 'CANCELLED')),
  consumed_operation_id uuid UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'CONSUMED') = (consumed_operation_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS fusion_engine.generation_quote_metadata (
  quote_id uuid PRIMARY KEY REFERENCES fusion_engine.quotes(id),
  owner_id text NOT NULL,
  project_id text NOT NULL,
  recipe_id text NOT NULL,
  provider_id text NOT NULL,
  provider_request_template jsonb NOT NULL,
  pricing_snapshot jsonb NOT NULL,
  execution_evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Local databases created before execution evidence existed are upgraded
-- explicitly.  A temporary default is immediately removed so all new quotes
-- must pin the provider/route/account/version evidence before a hold exists.
ALTER TABLE fusion_engine.generation_quote_metadata
  ADD COLUMN IF NOT EXISTS execution_evidence jsonb;
ALTER TABLE fusion_engine.generation_quote_metadata
  ALTER COLUMN execution_evidence SET DEFAULT '{}'::jsonb;
UPDATE fusion_engine.generation_quote_metadata
  SET execution_evidence = '{}'::jsonb
  WHERE execution_evidence IS NULL;
ALTER TABLE fusion_engine.generation_quote_metadata
  ALTER COLUMN execution_evidence SET NOT NULL;
ALTER TABLE fusion_engine.generation_quote_metadata
  ALTER COLUMN execution_evidence DROP DEFAULT;

DROP TRIGGER IF EXISTS generation_quote_metadata_immutable ON fusion_engine.generation_quote_metadata;
CREATE TRIGGER generation_quote_metadata_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.generation_quote_metadata
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

CREATE TABLE IF NOT EXISTS fusion_engine.operations (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  quote_id uuid NOT NULL UNIQUE REFERENCES fusion_engine.quotes(id),
  generation_intent_id text NOT NULL UNIQUE CHECK (length(generation_intent_id) BETWEEN 8 AND 200),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN (
    'RESERVED', 'QUEUED', 'DISPATCHING', 'SUBMISSION_UNKNOWN', 'SUBMITTED', 'RUNNING',
    'PROVIDER_SUCCEEDED', 'PROVIDER_FAILED', 'ASSET_STORED', 'DELIVERY_FAILED',
    'DELIVERED', 'SETTLED', 'CANCELLED', 'RECONCILIATION_REQUIRED'
  )),
  state_version bigint NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  customer_credits bigint NOT NULL CHECK (customer_credits > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION fusion_engine.enforce_operation_state_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NEW.state_version <> OLD.state_version + 1 THEN
      RAISE EXCEPTION 'operation_state_version_must_increment_once';
    END IF;
  ELSIF NEW.state_version <> OLD.state_version THEN
    RAISE EXCEPTION 'operation_version_changed_without_state_transition';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operations_state_version_guard ON fusion_engine.operations;
CREATE TRIGGER operations_state_version_guard
BEFORE UPDATE ON fusion_engine.operations
FOR EACH ROW EXECUTE FUNCTION fusion_engine.enforce_operation_state_version();

ALTER TABLE fusion_engine.quotes
  DROP CONSTRAINT IF EXISTS quotes_consumed_operation_fk;
ALTER TABLE fusion_engine.quotes
  ADD CONSTRAINT quotes_consumed_operation_fk
  FOREIGN KEY (consumed_operation_id) REFERENCES fusion_engine.operations(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS fusion_engine.idempotency_bindings (
  owner_id text NOT NULL,
  route text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  operation_id uuid NOT NULL REFERENCES fusion_engine.operations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, route, idempotency_key)
);

CREATE TABLE IF NOT EXISTS fusion_engine.credit_reservations (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES fusion_engine.operations(id),
  quote_id uuid NOT NULL UNIQUE REFERENCES fusion_engine.quotes(id),
  owner_id text NOT NULL,
  quoted_credits bigint NOT NULL CHECK (quoted_credits > 0),
  held_credits bigint NOT NULL CHECK (held_credits >= 0),
  captured_credits bigint NOT NULL DEFAULT 0 CHECK (captured_credits >= 0),
  released_credits bigint NOT NULL DEFAULT 0 CHECK (released_credits >= 0),
  state text NOT NULL CHECK (state IN ('HELD', 'SETTLED', 'RELEASED', 'MANUAL_REVIEW')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (held_credits + captured_credits + released_credits = quoted_credits)
);

CREATE TABLE IF NOT EXISTS fusion_engine.ledger_journals (
  id uuid PRIMARY KEY,
  command_id text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('GRANT', 'RESERVE', 'SETTLE', 'RELEASE', 'ADJUSTMENT')),
  operation_id uuid REFERENCES fusion_engine.operations(id),
  reason_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fusion_engine.ledger_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journal_id uuid NOT NULL REFERENCES fusion_engine.ledger_journals(id),
  account_id text NOT NULL,
  amount bigint NOT NULL CHECK (amount <> 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION fusion_engine.assert_journal_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM fusion_engine.ledger_entries
    WHERE journal_id = NEW.journal_id
    GROUP BY journal_id
    HAVING sum(amount) <> 0
  ) THEN
    RAISE EXCEPTION 'unbalanced_ledger_journal';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ledger_entries_balanced ON fusion_engine.ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced
AFTER INSERT ON fusion_engine.ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fusion_engine.assert_journal_balanced();

DROP TRIGGER IF EXISTS ledger_journals_immutable ON fusion_engine.ledger_journals;
CREATE TRIGGER ledger_journals_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.ledger_journals
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

DROP TRIGGER IF EXISTS ledger_entries_immutable ON fusion_engine.ledger_entries;
CREATE TRIGGER ledger_entries_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.ledger_entries
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

CREATE TABLE IF NOT EXISTS fusion_engine.operation_events (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES fusion_engine.operations(id),
  sequence bigint NOT NULL CHECK (sequence >= 0),
  state text NOT NULL,
  state_version bigint NOT NULL CHECK (state_version >= 0),
  event_name text NOT NULL,
  actor text NOT NULL,
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_id, sequence),
  UNIQUE (operation_id, state_version)
);

DROP TRIGGER IF EXISTS operation_events_immutable ON fusion_engine.operation_events;
CREATE TRIGGER operation_events_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.operation_events
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

CREATE TABLE IF NOT EXISTS fusion_engine.operation_attempts (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES fusion_engine.operations(id),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  provider_id text NOT NULL,
  provider_idempotency_key text NOT NULL UNIQUE CHECK (length(provider_idempotency_key) BETWEEN 8 AND 200),
  state text NOT NULL CHECK (state IN ('DISPATCHING', 'SUBMISSION_UNKNOWN', 'SUBMITTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RECONCILIATION_REQUIRED')),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  provider_task_id text,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  request_payload jsonb NOT NULL,
  response_hash char(64) CHECK (response_hash IS NULL OR response_hash ~ '^[a-f0-9]{64}$'),
  unknown_lookup_count integer NOT NULL DEFAULT 0 CHECK (unknown_lookup_count >= 0),
  poll_count integer NOT NULL DEFAULT 0 CHECK (poll_count >= 0),
  actual_provider_credits bigint CHECK (actual_provider_credits IS NULL OR actual_provider_credits >= 0),
  charge_status text CHECK (charge_status IS NULL OR charge_status IN ('ACTUAL', 'CONFIRMED_NO_CHARGE', 'UNKNOWN')),
  provider_result_url text,
  last_error_code text,
  dispatch_deadline_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_id, attempt_number)
);

ALTER TABLE fusion_engine.operation_attempts
  ADD COLUMN IF NOT EXISTS dispatch_deadline_at timestamptz;
UPDATE fusion_engine.operation_attempts
  SET dispatch_deadline_at = updated_at + interval '30 minutes'
  WHERE dispatch_deadline_at IS NULL;
ALTER TABLE fusion_engine.operation_attempts
  ALTER COLUMN dispatch_deadline_at SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS operation_attempt_provider_task_unique
ON fusion_engine.operation_attempts (provider_id, provider_task_id)
WHERE provider_task_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fusion_engine.enforce_attempt_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'attempt_version_must_increment_once';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operation_attempts_version_guard ON fusion_engine.operation_attempts;
CREATE TRIGGER operation_attempts_version_guard
BEFORE UPDATE ON fusion_engine.operation_attempts
FOR EACH ROW EXECUTE FUNCTION fusion_engine.enforce_attempt_version();

CREATE TABLE IF NOT EXISTS fusion_engine.operation_assets (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES fusion_engine.operations(id),
  attempt_id uuid NOT NULL REFERENCES fusion_engine.operation_attempts(id),
  provider_id text NOT NULL,
  provider_task_id text NOT NULL,
  private_object_id text NOT NULL UNIQUE,
  object_key text NOT NULL UNIQUE,
  bucket text NOT NULL,
  owner_id text NOT NULL,
  project_id text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('image', 'video', 'audio')),
  content_type text NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  checksum_sha256 char(64) NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  metadata jsonb NOT NULL,
  source_url text NOT NULL,
  stored_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fusion_engine.operation_deliveries (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES fusion_engine.operations(id),
  asset_id uuid NOT NULL REFERENCES fusion_engine.operation_assets(id),
  owner_id text NOT NULL,
  delivery_evidence_hash char(64) NOT NULL CHECK (delivery_evidence_hash ~ '^[a-f0-9]{64}$'),
  delivered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fusion_engine.asset_access_events (
  id uuid PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES fusion_engine.operation_assets(id),
  owner_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('GRANT_ISSUED', 'READ_ALLOWED', 'READ_DENIED')),
  token_hash char(64) CHECK (token_hash IS NULL OR token_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fusion_engine.provider_cost_outcomes (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES fusion_engine.operations(id),
  attempt_id uuid NOT NULL REFERENCES fusion_engine.operation_attempts(id),
  provider_id text NOT NULL,
  provider_credits bigint NOT NULL CHECK (provider_credits >= 0),
  disposition text NOT NULL CHECK (disposition IN ('DELIVERED', 'LOSS')),
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fusion_engine.financial_command_bindings (
  command_id text PRIMARY KEY CHECK (length(command_id) BETWEEN 8 AND 200),
  operation_id uuid NOT NULL REFERENCES fusion_engine.operations(id),
  action text NOT NULL CHECK (action IN ('SETTLE_DELIVERY', 'RELEASE_DELIVERY_FAILURE', 'RELEASE_PRE_DISPATCH', 'RELEASE_PROVIDER_FAILURE')),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  journal_id uuid NOT NULL UNIQUE REFERENCES fusion_engine.ledger_journals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_id, action)
);

ALTER TABLE fusion_engine.financial_command_bindings
  DROP CONSTRAINT IF EXISTS financial_command_bindings_action_check;
ALTER TABLE fusion_engine.financial_command_bindings
  ADD CONSTRAINT financial_command_bindings_action_check
  CHECK (action IN ('SETTLE_DELIVERY', 'RELEASE_DELIVERY_FAILURE', 'RELEASE_PRE_DISPATCH', 'RELEASE_PROVIDER_FAILURE'));

DROP TRIGGER IF EXISTS operation_assets_immutable ON fusion_engine.operation_assets;
CREATE TRIGGER operation_assets_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.operation_assets
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

DROP TRIGGER IF EXISTS operation_deliveries_immutable ON fusion_engine.operation_deliveries;
CREATE TRIGGER operation_deliveries_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.operation_deliveries
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

DROP TRIGGER IF EXISTS asset_access_events_immutable ON fusion_engine.asset_access_events;
CREATE TRIGGER asset_access_events_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.asset_access_events
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

DROP TRIGGER IF EXISTS provider_cost_outcomes_immutable ON fusion_engine.provider_cost_outcomes;
CREATE TRIGGER provider_cost_outcomes_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.provider_cost_outcomes
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

DROP TRIGGER IF EXISTS financial_command_bindings_immutable ON fusion_engine.financial_command_bindings;
CREATE TRIGGER financial_command_bindings_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.financial_command_bindings
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

CREATE TABLE IF NOT EXISTS fusion_engine.inbox_receipts (
  consumer_name text NOT NULL,
  event_id uuid NOT NULL,
  aggregate_id uuid NOT NULL REFERENCES fusion_engine.operations(id),
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('PROCESSING', 'PROCESSED')),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY (consumer_name, event_id)
);

-- Provider webhooks are an external boundary and must not share the internal
-- outbox-consumer inbox above.  In particular, provider delivery IDs are not
-- UUIDs and a webhook must be durable before it can wake a worker.  The body
-- hash proves the exact received bytes; the parsed payload is retained only
-- for audited, authoritative follow-up processing (never as settlement proof
-- on its own).
CREATE TABLE IF NOT EXISTS fusion_engine.provider_webhook_inbox (
  provider_id text NOT NULL CHECK (length(provider_id) BETWEEN 1 AND 100),
  delivery_id text NOT NULL CHECK (length(delivery_id) BETWEEN 1 AND 300),
  task_id text NOT NULL CHECK (length(task_id) BETWEEN 1 AND 300),
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'REJECTED')),
  consumer_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  rejection_code text,
  PRIMARY KEY (provider_id, delivery_id),
  CHECK (
    (status = 'RECEIVED' AND consumer_id IS NULL AND processing_started_at IS NULL AND processed_at IS NULL AND rejection_code IS NULL)
    OR (status = 'PROCESSING' AND consumer_id IS NOT NULL AND processing_started_at IS NOT NULL AND processed_at IS NULL AND rejection_code IS NULL)
    OR (status = 'PROCESSED' AND consumer_id IS NOT NULL AND processing_started_at IS NOT NULL AND processed_at IS NOT NULL AND rejection_code IS NULL)
    OR (status = 'REJECTED' AND consumer_id IS NULL AND processing_started_at IS NULL AND processed_at IS NOT NULL AND rejection_code IS NOT NULL)
  )
);

-- Generic immutable control-plane version store. Entity payloads are typed by
-- the Provider Control Plane package; this durable layer supplies command
-- idempotency, serial version assignment, and a separate published-offer
-- pointer without ever storing credential material.
CREATE TABLE IF NOT EXISTS fusion_engine.provider_control_entities (
  entity_type text NOT NULL CHECK (entity_type IN ('PROVIDER', 'PROVIDER_ACCOUNT', 'CATALOG_SNAPSHOT', 'REFERENCE_MODEL', 'ROUTE_CANDIDATE', 'RELEASE_BUNDLE', 'PUBLISHED_OFFER')),
  entity_id text NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 200),
  current_version bigint NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id)
);

-- Commercial pricing is an immutable durable source separate from the
-- provider-control generic records.  Its payload is encoded by the
-- commercial-engine repository so bigint atomic units remain exact in JSON.
CREATE TABLE IF NOT EXISTS fusion_engine.commercial_registry_snapshots (
  snapshot_id text NOT NULL CHECK (length(snapshot_id) BETWEEN 1 AND 200),
  snapshot_version bigint NOT NULL CHECK (snapshot_version > 0),
  command_id text NOT NULL UNIQUE CHECK (length(command_id) BETWEEN 8 AND 200),
  intent_hash char(64) NOT NULL CHECK (intent_hash ~ '^[a-f0-9]{64}$'),
  evidence_sha256 char(64) NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, snapshot_version)
);
DROP TRIGGER IF EXISTS commercial_registry_snapshots_immutable ON fusion_engine.commercial_registry_snapshots;
CREATE TRIGGER commercial_registry_snapshots_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.commercial_registry_snapshots
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

ALTER TABLE fusion_engine.provider_control_entities
  DROP CONSTRAINT IF EXISTS provider_control_entities_entity_type_check;
ALTER TABLE fusion_engine.provider_control_entities
  ADD CONSTRAINT provider_control_entities_entity_type_check
  CHECK (entity_type IN ('PROVIDER', 'PROVIDER_ACCOUNT', 'CATALOG_SNAPSHOT', 'REFERENCE_MODEL', 'ROUTE_CANDIDATE', 'RELEASE_BUNDLE', 'PUBLISHED_OFFER'));

CREATE TABLE IF NOT EXISTS fusion_engine.provider_control_versions (
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  command_id text NOT NULL UNIQUE CHECK (length(command_id) BETWEEN 8 AND 200),
  intent_hash char(64) NOT NULL CHECK (intent_hash ~ '^[a-f0-9]{64}$'),
  evidence_sha256 char(64) NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  effective_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id, version),
  FOREIGN KEY (entity_type, entity_id) REFERENCES fusion_engine.provider_control_entities(entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS fusion_engine.provider_published_offer_pointers (
  offer_id text PRIMARY KEY CHECK (length(offer_id) BETWEEN 1 AND 200),
  entity_type text NOT NULL DEFAULT 'PUBLISHED_OFFER' CHECK (entity_type = 'PUBLISHED_OFFER'),
  offer_version bigint NOT NULL CHECK (offer_version > 0),
  release_bundle_id text NOT NULL CHECK (length(release_bundle_id) BETWEEN 1 AND 200),
  release_bundle_version bigint NOT NULL CHECK (release_bundle_version > 0),
  published_at timestamptz NOT NULL,
  FOREIGN KEY (entity_type, offer_id, offer_version)
    REFERENCES fusion_engine.provider_control_versions(entity_type, entity_id, version)
);
ALTER TABLE fusion_engine.provider_published_offer_pointers
  ADD COLUMN IF NOT EXISTS release_bundle_version bigint;

-- A single active bundle makes the visible offer set an atomic projection.
-- Old offer pointers remain immutable evidence, but are invisible unless their
-- release bundle is the active pointer (which makes rollback a pointer swap).
CREATE TABLE IF NOT EXISTS fusion_engine.provider_active_release_bundle_pointer (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  entity_type text NOT NULL DEFAULT 'RELEASE_BUNDLE' CHECK (entity_type = 'RELEASE_BUNDLE'),
  release_bundle_id text NOT NULL CHECK (length(release_bundle_id) BETWEEN 1 AND 200),
  release_bundle_version bigint NOT NULL CHECK (release_bundle_version > 0),
  activated_at timestamptz NOT NULL,
  FOREIGN KEY (entity_type, release_bundle_id, release_bundle_version)
    REFERENCES fusion_engine.provider_control_versions(entity_type, entity_id, version)
);

CREATE TABLE IF NOT EXISTS fusion_engine.provider_control_audit (
  sequence bigint PRIMARY KEY CHECK (sequence > 0),
  command_id text NOT NULL UNIQUE,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  version bigint NOT NULL,
  intent_hash char(64) NOT NULL CHECK (intent_hash ~ '^[a-f0-9]{64}$'),
  previous_hash char(64) NOT NULL CHECK (previous_hash ~ '^[a-f0-9]{64}$'),
  record_hash char(64) NOT NULL CHECK (record_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL
);
DROP TRIGGER IF EXISTS provider_control_audit_immutable ON fusion_engine.provider_control_audit;
CREATE TRIGGER provider_control_audit_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.provider_control_audit
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

-- A one-row head serializes appends to the immutable audit chain.  Locking the
-- most recent audit record is insufficient when the chain is empty and is
-- fragile under concurrent first writes.  The head supplies both the next
-- sequence and the prior hash inside the same transaction as the version
-- mutation and audit insert.
CREATE TABLE IF NOT EXISTS fusion_engine.provider_control_audit_head (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  last_hash char(64) NOT NULL DEFAULT repeat('0', 64) CHECK (last_hash ~ '^[a-f0-9]{64}$')
);
INSERT INTO fusion_engine.provider_control_audit_head (singleton, last_sequence, last_hash)
VALUES (true, 0, repeat('0', 64))
ON CONFLICT (singleton) DO NOTHING;

CREATE INDEX IF NOT EXISTS provider_webhook_inbox_pending_idx
ON fusion_engine.provider_webhook_inbox (received_at)
WHERE status = 'RECEIVED';

CREATE TABLE IF NOT EXISTS fusion_engine.outbox_events (
  id uuid PRIMARY KEY,
  aggregate_id uuid NOT NULL REFERENCES fusion_engine.operations(id),
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 0),
  event_name text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'LEASED', 'ACKED', 'DEAD_LETTER')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aggregate_id, aggregate_version, event_name)
);

CREATE INDEX IF NOT EXISTS outbox_pending_delivery_idx
ON fusion_engine.outbox_events (available_at, created_at)
WHERE status = 'PENDING';

ALTER TABLE fusion_engine.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.generation_quote_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.idempotency_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.credit_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.ledger_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.operation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.operation_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.operation_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.operation_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.provider_cost_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.financial_command_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.inbox_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.provider_webhook_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.provider_control_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.commercial_registry_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.provider_control_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.provider_published_offer_pointers ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.provider_active_release_bundle_pointer ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.provider_control_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.provider_control_audit_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE fusion_engine.outbox_events ENABLE ROW LEVEL SECURITY;
