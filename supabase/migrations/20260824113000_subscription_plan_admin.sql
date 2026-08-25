-- Governed SaaS plan administration. Published plan versions stay immutable;
-- the pointer records which version is currently offered.

ALTER TABLE fusion_engine.subscription_plan_versions
  DROP CONSTRAINT IF EXISTS subscription_plan_versions_billing_interval_check;

ALTER TABLE fusion_engine.subscription_plan_versions
  ADD CONSTRAINT subscription_plan_versions_billing_interval_check
  CHECK (billing_interval IN ('MONTH', 'YEAR'));

CREATE TABLE IF NOT EXISTS fusion_engine.subscription_plan_pointers (
  plan_key text PRIMARY KEY CHECK (length(plan_key) BETWEEN 3 AND 100),
  current_plan_version_id text NOT NULL REFERENCES fusion_engine.subscription_plan_versions(id),
  state text NOT NULL CHECK (state IN ('INTERNAL_TEST', 'PUBLISHED', 'RETIRED')),
  version integer NOT NULL CHECK (version > 0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fusion_engine.subscription_plan_admin_commands (
  command_id text PRIMARY KEY CHECK (length(command_id) BETWEEN 8 AND 200),
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('PUBLISH_PLAN_VERSION', 'RETIRE_PLAN')),
  plan_key text NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS subscription_plan_admin_commands_immutable ON fusion_engine.subscription_plan_admin_commands;
CREATE TRIGGER subscription_plan_admin_commands_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.subscription_plan_admin_commands
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

CREATE TABLE IF NOT EXISTS fusion_engine.subscription_plan_admin_audit (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  command_id text NOT NULL UNIQUE REFERENCES fusion_engine.subscription_plan_admin_commands(command_id),
  actor_id text NOT NULL,
  action text NOT NULL,
  plan_key text NOT NULL,
  plan_version_id text NOT NULL REFERENCES fusion_engine.subscription_plan_versions(id),
  pointer_version integer NOT NULL CHECK (pointer_version > 0),
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS subscription_plan_admin_audit_immutable ON fusion_engine.subscription_plan_admin_audit;
CREATE TRIGGER subscription_plan_admin_audit_immutable
BEFORE UPDATE OR DELETE ON fusion_engine.subscription_plan_admin_audit
FOR EACH ROW EXECUTE FUNCTION fusion_engine.reject_immutable_mutation();

INSERT INTO fusion_engine.subscription_plan_pointers
  (plan_key,current_plan_version_id,state,version,updated_by,updated_at)
SELECT plan_key,id,lifecycle,1,'migration',published_at
FROM fusion_engine.subscription_plan_versions
WHERE id='starter-v1'
ON CONFLICT (plan_key) DO NOTHING;
