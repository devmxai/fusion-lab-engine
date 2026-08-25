-- Durable Production subscriptions and auditable credit-period grants.

CREATE TABLE IF NOT EXISTS fusion_engine.subscription_plan_versions (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 3 AND 100),
  plan_key text NOT NULL CHECK (length(plan_key) BETWEEN 3 AND 100),
  version integer NOT NULL CHECK (version > 0),
  lifecycle text NOT NULL CHECK (lifecycle IN ('INTERNAL_TEST', 'PUBLISHED', 'RETIRED')),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  billing_interval text NOT NULL CHECK (billing_interval = 'MONTH'),
  credits_per_period bigint NOT NULL CHECK (credits_per_period > 0),
  terms_version text NOT NULL CHECK (length(terms_version) BETWEEN 3 AND 100),
  entitlement_snapshot jsonb NOT NULL,
  effective_from timestamptz NOT NULL,
  published_at timestamptz NOT NULL,
  UNIQUE (plan_key, version)
);

DROP TRIGGER IF EXISTS subscription_plan_versions_immutable ON fusion_engine.subscription_plan_versions;
CREATE TRIGGER subscription_plan_versions_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.subscription_plan_versions
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

CREATE TABLE IF NOT EXISTS fusion_engine.subscriptions (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  plan_version_id text NOT NULL REFERENCES fusion_engine.subscription_plan_versions(id),
  state text NOT NULL CHECK (state IN ('ACTIVE', 'EXPIRED', 'CANCELLED')),
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  activated_by text NOT NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (current_period_end > current_period_start),
  CHECK ((state = 'CANCELLED') = (cancelled_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_active_owner_idx
ON fusion_engine.subscriptions (owner_id)
WHERE state = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_internal_starter_once_idx
ON fusion_engine.subscriptions (owner_id, plan_version_id)
WHERE plan_version_id = 'starter-v1';

CREATE TABLE IF NOT EXISTS fusion_engine.subscription_periods (
  id uuid PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES fusion_engine.subscriptions(id),
  period_number integer NOT NULL CHECK (period_number > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  granted_credits bigint NOT NULL CHECK (granted_credits > 0),
  grant_journal_id uuid NOT NULL UNIQUE REFERENCES fusion_engine.ledger_journals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, period_number),
  CHECK (ends_at > starts_at)
);

DROP TRIGGER IF EXISTS subscription_periods_immutable ON fusion_engine.subscription_periods;
CREATE TRIGGER subscription_periods_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.subscription_periods
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

CREATE TABLE IF NOT EXISTS fusion_engine.subscription_commands (
  command_id text PRIMARY KEY CHECK (length(command_id) BETWEEN 8 AND 200),
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('ACTIVATE_INTERNAL_STARTER')),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  subscription_id uuid NOT NULL REFERENCES fusion_engine.subscriptions(id),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS subscription_commands_immutable ON fusion_engine.subscription_commands;
CREATE TRIGGER subscription_commands_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.subscription_commands
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

CREATE TABLE IF NOT EXISTS fusion_engine.subscription_audit (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  command_id text NOT NULL UNIQUE REFERENCES fusion_engine.subscription_commands(command_id),
  actor_id text NOT NULL,
  owner_id text NOT NULL,
  action text NOT NULL,
  subscription_id uuid NOT NULL REFERENCES fusion_engine.subscriptions(id),
  plan_version_id text NOT NULL REFERENCES fusion_engine.subscription_plan_versions(id),
  credits_granted bigint NOT NULL CHECK (credits_granted > 0),
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS subscription_audit_immutable ON fusion_engine.subscription_audit;
CREATE TRIGGER subscription_audit_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.subscription_audit
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

INSERT INTO fusion_engine.subscription_plan_versions
  (id, plan_key, version, lifecycle, display_name, amount_minor, currency, billing_interval,
   credits_per_period, terms_version, entitlement_snapshot, effective_from, published_at)
VALUES
  ('starter-v1', 'starter', 1, 'INTERNAL_TEST', 'Starter', 0, 'USD', 'MONTH',
   100, 'internal-test-terms-v1',
   '{"features":["image"],"purpose":"production-credit-flow-validation","customerPurchasable":false}'::jsonb,
   '2026-08-23T00:00:00Z', '2026-08-23T00:00:00Z')
ON CONFLICT DO NOTHING;
